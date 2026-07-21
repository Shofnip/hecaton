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
}

const DEFAULT_MAX_RESTART_ATTEMPTS = 3

interface SlotRuntime {
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
  private readonly slots = new Map<number, SlotRuntime>()

  constructor(deps: OrchestratorDeps) {
    this.launcher = deps.launcher
    this.windows = deps.windows
    this.registry = deps.registry
    this.autoRestart = deps.autoRestart
    this.maxRestartAttempts = deps.maxRestartAttempts ?? DEFAULT_MAX_RESTART_ATTEMPTS

    // The grid is computed once from the configured slot count, so a slot keeps
    // its cell whether or not its neighbours happen to be running.
    const cells = computeGrid(deps.slots.length, deps.screen)
    deps.slots.forEach((overrides, index) => {
      const config = resolveSlotConfig(deps.globals, overrides)
      this.slots.set(config.id, {
        config,
        state: 'stopped',
        pid: undefined,
        restartAttempts: 0,
        cell: cells[index]!,
        lastError: undefined,
      })
    })
  }

  private slot(slotId: number): SlotRuntime {
    const slot = this.slots.get(slotId)
    if (!slot) throw new Error(`slot ${slotId} is not configured`)
    return slot
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

  async start(slotId: number): Promise<void> {
    const slot = this.slot(slotId)
    slot.state = transition(slot.state, 'start')
    slot.restartAttempts = 0
    await this.spawn(slot)
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
  }

  async stop(slotId: number): Promise<void> {
    const slot = this.slot(slotId)
    const pid = slot.pid
    slot.state = transition(slot.state, 'stop')
    slot.pid = undefined
    slot.restartAttempts = 0
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

      if (!this.autoRestart || slot.restartAttempts >= this.maxRestartAttempts) continue

      slot.restartAttempts++
      slot.state = transition(slot.state, 'restart')
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
