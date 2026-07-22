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
import type { BrowserLauncher, ProfileArchive, WindowManager } from './ports.js'
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
  /** Optional: sets a removed slot's profile aside. Absent means removal leaves it. */
  profiles?: ProfileArchive
}

const DEFAULT_MAX_RESTART_ATTEMPTS = 3

interface SlotRuntime {
  /** The raw overrides as given, kept so the persisted form stays faithful. */
  overrides: SlotOverrides
  config: ResolvedSlotConfig
  state: SlotState
  pid: number | undefined
  restartAttempts: number
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
  private readonly profiles: ProfileArchive | undefined
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
    this.profiles = deps.profiles
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
        lastError: undefined,
      })
    }
  }

  private slot(slotId: number): SlotRuntime {
    const slot = this.slots.get(slotId)
    if (!slot) throw new Error(`slot ${slotId} is not configured`)
    return slot
  }

  /**
   * The ids that occupy the grid right now, ordered.
   *
   * The grid follows the *running* count, not the configured one: a slot only
   * takes a cell while it is live (starting, running or restarting). So one
   * running slot fills the screen, a second splits it in two, and stopping one
   * gives the other the whole screen back. A configured-but-stopped slot takes
   * no space, which is why adding one does not disturb the windows already up.
   */
  private layoutIds(): number[] {
    return [...this.slots.values()]
      .filter((slot) => isLive(slot.state))
      .map((slot) => slot.config.id)
      .sort((a, b) => a - b)
  }

  /** The cell a live slot should occupy in the current running grid. */
  private cellOf(slotId: number): GridCell {
    const ids = this.layoutIds()
    const cells = computeGrid(ids.length, this.screen)
    return cells[ids.indexOf(slotId)]!
  }

  /**
   * Adds a slot pointed at the given game or url and returns its id.
   *
   * The id is the lowest free number in `[1, maxSlots]`, reused so the cap is
   * respected. A slot's id is its profile directory name, and removal archives
   * that profile aside (slot-N.old-…), so a re-added slot with the same id gets
   * a fresh profile rather than the removed slot's session.
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
      lastError: undefined,
    })
    // No layout change: the new slot is stopped, so it is not on the grid until
    // it starts, and the running windows keep their places until then.
    this.emit({ level: 'info', event: 'slot.add', slotId: id })
    return id
  }

  /**
   * Removes a slot, stopping its browser first if it is running.
   *
   * The last slot cannot go: an empty panel does nothing and there is no UI to
   * add one back from. The slot's profile is archived — renamed aside, never
   * deleted — so the removed slot's session is discarded from use but stays
   * recoverable. Archiving happens after the browser is stopped, so the rename
   * does not race an open profile. Remaining windows fill the gap.
   */
  async removeSlot(slotId: number): Promise<void> {
    if (this.slots.size <= 1) {
      throw new Error('cannot remove the last slot')
    }
    const slot = this.slot(slotId)
    const pid = slot.pid
    if (pid !== undefined) await this.launcher.stop(pid)
    await this.profiles?.archive(slot.config.profileDir)

    this.slots.delete(slotId)
    this.emit({ level: 'info', event: 'slot.remove', slotId })
    // The removed window is gone; re-tile whatever is still running.
    this.applyLayout()
  }

  /**
   * Clears a stopped slot's browser cache, freeing disk without ending its
   * session — the adapter deletes only the cache sub-directories, never the
   * Cookies or Login Data.
   *
   * Refused while the slot is live: Chrome holds its cache files open, so a
   * delete would race the process. This guard is the real safeguard; the panel
   * disabling the button when the slot runs is only its UX echo, exactly as the
   * remove confirmation is UX over the archiving safeguard.
   */
  async clearSlotCache(slotId: number): Promise<void> {
    const slot = this.slot(slotId)
    if (isLive(slot.state)) {
      throw new Error(`cannot clear the cache of slot ${slotId} while it is running; stop it first`)
    }
    await this.profiles?.clearCache(slot.config.profileDir)
  }

  /**
   * Clears the cache of every stopped slot, skipping the running ones rather
   * than failing: a live slot cannot have its cache cleared, but that is no
   * reason to refuse the others.
   */
  async clearAllCaches(): Promise<void> {
    for (const id of [...this.slots.keys()].sort((a, b) => a - b)) {
      const slot = this.slots.get(id)!
      if (isLive(slot.state)) continue
      await this.profiles?.clearCache(slot.config.profileDir)
    }
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
        // The slot is already live (starting), so it counts toward the grid it
        // is about to join: launch it straight into its cell rather than moving
        // it a frame later.
        bounds: this.cellOf(slot.config.id),
        mute: slot.config.mute,
        persistProfile: slot.config.persistProfile,
      })
      slot.state = transition(slot.state, 'ready')
      slot.lastError = undefined
      this.emit({ level: 'info', event: 'slot.ready', ...this.slotFields(slot), pid: slot.pid })
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
    // The slot left the grid; the survivors expand to fill it.
    this.applyLayout()
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
    let changed = false
    for (const slot of this.slots.values()) {
      if (!isLive(slot.state) || slot.pid === undefined) continue
      if (this.launcher.isAlive(slot.pid)) continue

      changed = true
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
    // The running set changed - a slot left the grid, or came back - so the
    // survivors re-tile to match. Only when something actually changed, so a
    // quiet liveness tick moves no windows.
    if (changed) this.applyLayout()
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

  /**
   * Re-tiles the running slots into the grid for their current count.
   *
   * Called after anything that changes the running set, and on demand after a
   * slot was focused and maximised. Windows are placed by the same order the
   * grid is computed in, so slot ids map to cells left-to-right, top-to-bottom.
   */
  applyLayout(): void {
    const ids = this.layoutIds()
    if (ids.length === 0) return
    const cells = computeGrid(ids.length, this.screen)
    ids.forEach((id, index) => {
      const slot = this.slots.get(id)!
      if (slot.pid !== undefined) this.windows.setBounds(slot.pid, cells[index]!)
    })
  }
}
