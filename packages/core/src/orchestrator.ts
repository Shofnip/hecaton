/**
 * Orchestrator: turns slot configuration into running browsers and back.
 *
 * It owns no I/O — every effect goes through a port, so the whole thing,
 * auto-restart included, is tested against fakes with no browser in sight.
 *
 * Liveness is checked by an explicit `checkLiveness()` call rather than an
 * internal timer. The timer is an effect and belongs to the shell; keeping it
 * out means crash handling is testable without waiting for wall-clock time.
 */
import { computeGrid } from './grid.js'
import type { GridCell, ScreenBounds } from './grid.js'
import { resolveSlotConfig } from './config.js'
import type { GlobalConfig, ResolvedSlotConfig, SlotOverrides } from './config.js'
import type { GameDefinition } from './registry.js'
import type { BrowserLauncher, WindowManager } from './ports.js'
import { isLive, transition } from './slot-state.js'
import type { SlotState } from './slot-state.js'
import type { LogEntry, Logger } from './log.js'

export interface OrchestratorDeps {
  launcher: BrowserLauncher
  windows: WindowManager
  screen: ScreenBounds
  globals: GlobalConfig
  registry: ReadonlyMap<string, GameDefinition>
  slots: readonly SlotOverrides[]
  autoRestart: boolean
  /** Restarts allowed per manual start, so a broken slot cannot spin forever. */
  maxRestartAttempts?: number
  /** Optional: where lifecycle events go. Absent means no logging at all. */
  logger?: Logger
}

const DEFAULT_MAX_RESTART_ATTEMPTS = 3

interface SlotRuntime {
  /** The raw overrides as given, kept so the persisted form stays faithful. */
  overrides: SlotOverrides
  config: ResolvedSlotConfig
  state: SlotState
  pid: number | undefined
  restartAttempts: number
  cell: GridCell
  lastError: string | undefined
}

/**
 * What the panel needs to draw one slot card, and nothing more.
 *
 * Deliberately not the runtime: no pid, no profile directory, no grid cell. The
 * renderer addresses slots by id — every command takes a slotId — so it has no
 * use for a pid, and a view model that never carries one cannot leak one into
 * the IPC surface later.
 */
export interface SlotSnapshot {
  id: number
  state: SlotState
  gameId?: string
  url?: string
  persistProfile: boolean
  mute: boolean
  /** Why the slot is not running, when that is known. Cleared once it starts. */
  lastError?: string
}

export class Orchestrator {
  private readonly launcher: BrowserLauncher
  private readonly windows: WindowManager
  private readonly registry: ReadonlyMap<string, GameDefinition>
  private readonly autoRestart: boolean
  private readonly maxRestartAttempts: number
  private readonly logger: Logger | undefined
  private readonly screen: ScreenBounds
  private readonly globals: GlobalConfig
  private readonly slots = new Map<number, SlotRuntime>()

  constructor(deps: OrchestratorDeps) {
    this.launcher = deps.launcher
    this.windows = deps.windows
    this.registry = deps.registry
    this.autoRestart = deps.autoRestart
    this.maxRestartAttempts = deps.maxRestartAttempts ?? DEFAULT_MAX_RESTART_ATTEMPTS
    this.logger = deps.logger
    this.screen = deps.screen
    this.globals = deps.globals

    for (const overrides of deps.slots) {
      const config = resolveSlotConfig(this.globals, overrides)
      this.slots.set(config.id, {
        overrides,
        config,
        state: 'stopped',
        pid: undefined,
        restartAttempts: 0,
        cell: { x: 0, y: 0, width: 0, height: 0 },
        lastError: undefined,
      })
    }
    this.reassignCells()
  }

  private slot(slotId: number): SlotRuntime {
    const slot = this.slots.get(slotId)
    if (!slot) throw new Error(`slot ${slotId} is not configured`)
    return slot
  }

  /**
   * Recomputes the grid for the current slot count and hands each slot its cell.
   *
   * Slots are ordered by id, so a slot keeps a stable position as neighbours
   * come and go: id 1 is always the first cell, id 2 the second. Called after
   * every add and remove, and once at construction. It moves no windows — that
   * is start() and applyLayout()'s job, so an added-but-not-started slot does
   * not shove its neighbours aside before it has anything to show.
   */
  private reassignCells(): void {
    const ids = [...this.slots.keys()].sort((a, b) => a - b)
    const cells = computeGrid(ids.length, this.screen)
    ids.forEach((id, index) => {
      this.slots.get(id)!.cell = cells[index]!
    })
  }

  /**
   * Adds a slot pointed at the given game or url and returns its id.
   *
   * The id is the lowest free number in `[1, maxSlots]`. That the cap forces id
   * reuse is deliberate: a slot's id is its profile directory name, so re-adding
   * after a remove reuses the same profile — and removal never deletes it
   * (ADR-0005), so the session comes back rather than being lost.
   *
   * Adds nothing to the screen: the new slot is stopped, and moving the others
   * to make room now would leave a blank cell until it launches.
   */
  addSlot(overrides: Omit<SlotOverrides, 'id'>): number {
    let id: number | undefined
    for (let candidate = 1; candidate <= this.globals.maxSlots; candidate++) {
      if (!this.slots.has(candidate)) {
        id = candidate
        break
      }
    }
    if (id === undefined) {
      throw new Error(`cannot add a slot: the maximum of ${this.globals.maxSlots} is reached`)
    }

    const full: SlotOverrides = { ...overrides, id }
    const config = resolveSlotConfig(this.globals, full)
    this.slots.set(id, {
      overrides: full,
      config,
      state: 'stopped',
      pid: undefined,
      restartAttempts: 0,
      cell: { x: 0, y: 0, width: 0, height: 0 },
      lastError: undefined,
    })
    this.reassignCells()
    this.emit({ level: 'info', event: 'slot.add', slotId: id })
    return id
  }

  /**
   * Removes a slot, stopping its browser first if it is running.
   *
   * The last slot cannot go: an empty panel does nothing and there is no UI to
   * add one back from. The profile directory is left untouched, as ever.
   * Remaining windows are repositioned to fill the gap.
   */
  async removeSlot(slotId: number): Promise<void> {
    if (this.slots.size <= 1) {
      throw new Error('cannot remove the last slot')
    }
    const slot = this.slot(slotId)
    const pid = slot.pid
    if (pid !== undefined) await this.launcher.stop(pid)

    this.slots.delete(slotId)
    this.reassignCells()
    this.emit({ level: 'info', event: 'slot.remove', slotId })
    this.applyLayout()
  }

  /**
   * Replaces what an existing slot points at. Takes effect at its next launch,
   * since the running browser is already on the old target.
   */
  updateSlot(overrides: SlotOverrides): void {
    const slot = this.slot(overrides.id)
    slot.config = resolveSlotConfig(this.globals, overrides)
    slot.overrides = overrides
  }

  /** The slots in their persisted shape, for the shell to save. */
  slotConfigs(): SlotOverrides[] {
    return [...this.slots.keys()]
      .sort((a, b) => a - b)
      .map((id) => ({ ...this.slots.get(id)!.overrides }))
  }

  /** A slot points either at a registry game or at its own url — never both. */
  private urlFor(slot: SlotRuntime): string {
    if (slot.config.url !== undefined) return slot.config.url
    const gameId = slot.config.gameId
    if (gameId === undefined) throw new Error(`slot ${slot.config.id} has no game or url`)
    const game = this.registry.get(gameId)
    if (!game) throw new Error(`slot ${slot.config.id} refers to unknown game "${gameId}"`)
    return game.url
  }

  stateOf(slotId: number): SlotState {
    return this.slot(slotId).state
  }

  /** Emits a lifecycle event, if a logger was provided. Redaction is the port's. */
  private emit(entry: LogEntry): void {
    this.logger?.log(entry)
  }

  /** The slot fields every log entry carries. Never the url — see log.ts. */
  private slotFields(slot: SlotRuntime): { slotId: number; gameId?: string } {
    const fields: { slotId: number; gameId?: string } = { slotId: slot.config.id }
    if (slot.config.gameId !== undefined) fields.gameId = slot.config.gameId
    return fields
  }

  async start(slotId: number): Promise<void> {
    const slot = this.slot(slotId)
    slot.state = transition(slot.state, 'start')
    slot.restartAttempts = 0
    this.emit({ level: 'info', event: 'slot.start', ...this.slotFields(slot) })
    await this.spawn(slot)
    // Re-tile every running window: the slot just added and started is what
    // turns one fullscreen window into a two-up split, and its neighbours have
    // to move to their new cells at that moment, not before.
    this.applyLayout()
  }

  /**
   * Shared by start and restart. On failure the slot lands in `crashed` and the
   * error is rethrown: infrastructure problems must be visible on the slot's
   * card, never swallowed.
   */
  private async spawn(slot: SlotRuntime): Promise<void> {
    let url: string
    try {
      url = this.urlFor(slot)
    } catch (error) {
      this.recordFailure(slot, error)
      throw error
    }

    try {
      slot.pid = await this.launcher.launch({
        slotId: slot.config.id,
        url,
        profileDir: slot.config.profileDir,
        bounds: slot.cell,
        mute: slot.config.mute,
        persistProfile: slot.config.persistProfile,
      })
      slot.state = transition(slot.state, 'ready')
      slot.lastError = undefined
      this.emit({ level: 'info', event: 'slot.ready', ...this.slotFields(slot), pid: slot.pid })
      this.windows.setBounds(slot.pid, slot.cell)
    } catch (error) {
      slot.pid = undefined
      this.recordFailure(slot, error)
      throw error
    }
  }

  /**
   * Moves a slot to `crashed` and keeps the reason.
   *
   * The reason matters most on the path that does not rethrow: checkLiveness
   * swallows a failed restart so one bad slot cannot abort the sweep over the
   * others, and without this the slot would sit in `crashed` with nothing
   * anywhere saying why.
   */
  private recordFailure(slot: SlotRuntime, error: unknown): void {
    slot.state = transition(slot.state, 'crash')
    slot.lastError = error instanceof Error ? error.message : String(error)
    this.emit({
      level: 'error',
      event: 'slot.crash',
      ...this.slotFields(slot),
      message: slot.lastError,
    })
  }

  async stop(slotId: number): Promise<void> {
    const slot = this.slot(slotId)
    const pid = slot.pid
    slot.state = transition(slot.state, 'stop')
    slot.pid = undefined
    slot.restartAttempts = 0
    this.emit({ level: 'info', event: 'slot.stop', ...this.slotFields(slot) })
    if (pid !== undefined) await this.launcher.stop(pid)
  }

  focus(slotId: number): boolean {
    const slot = this.slot(slotId)
    if (slot.state !== 'running' || slot.pid === undefined) return false
    return this.windows.focus(slot.pid)
  }

  /**
   * Called on a timer by the shell. Every slot is handled independently — one
   * slot crashing, or failing to come back, never touches its neighbours.
   */
  async checkLiveness(): Promise<void> {
    for (const slot of this.slots.values()) {
      if (!isLive(slot.state) || slot.pid === undefined) continue
      if (this.launcher.isAlive(slot.pid)) continue

      slot.pid = undefined
      slot.state = transition(slot.state, 'crash')
      slot.lastError = 'the browser process ended unexpectedly'
      this.emit({
        level: 'error',
        event: 'slot.crash',
        ...this.slotFields(slot),
        message: slot.lastError,
      })

      if (!this.autoRestart || slot.restartAttempts >= this.maxRestartAttempts) continue

      slot.restartAttempts++
      slot.state = transition(slot.state, 'restart')
      this.emit({ level: 'info', event: 'slot.restart', ...this.slotFields(slot) })
      try {
        await this.spawn(slot)
      } catch {
        // Already recorded as crashed by spawn. Swallowing here is deliberate:
        // a failed restart must not abort the sweep over the other slots.
      }
    }
  }

  /**
   * Everything the panel draws, as plain data.
   *
   * Built fresh per call rather than exposing the runtime: the renderer must
   * not be able to change orchestrator state by writing to what it was handed.
   */
  snapshot(): SlotSnapshot[] {
    return [...this.slots.values()].map((slot) => {
      const view: SlotSnapshot = {
        id: slot.config.id,
        state: slot.state,
        persistProfile: slot.config.persistProfile,
        mute: slot.config.mute,
      }
      if (slot.config.gameId !== undefined) view.gameId = slot.config.gameId
      if (slot.config.url !== undefined) view.url = slot.config.url
      if (slot.lastError !== undefined) view.lastError = slot.lastError
      return view
    })
  }

  /** Re-applies the grid, e.g. after a slot was focused and maximised. */
  applyLayout(): void {
    for (const slot of this.slots.values()) {
      if (slot.state !== 'running' || slot.pid === undefined) continue
      this.windows.setBounds(slot.pid, slot.cell)
    }
  }
}
