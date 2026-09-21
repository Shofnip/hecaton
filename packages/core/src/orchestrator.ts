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
import { ScreenZoom } from './screen-zoom.js'
import { manualZoomAtRung, screenZoomFactor } from './zoom.js'
import type { GridCell, ScreenBounds } from './grid.js'
import type { ScreenPlacement } from './ipc.js'
import { resolveSlotConfig } from './config.js'
import type { GlobalConfig, ResolvedSlotConfig, SlotOverrides } from './config.js'
import type { GameDefinition } from './registry.js'
import type {
  AudioController,
  BrowserLauncher,
  ProfileArchive,
  WindowManager,
  WindowPlacement,
  ZoomController,
  ZoomPreferences,
} from './ports.js'
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
  /** Optional: mutes slots by pid so audio can follow focus. Absent disables the feature. */
  audio?: AudioController
  /** Optional in headless consumers; the shell supplies both real adapters. */
  zoom?: { preferences: ZoomPreferences; controller: ZoomController }
}

const DEFAULT_MAX_RESTART_ATTEMPTS = 3

/** Whether a window is already exactly where a layout frame wants it. */
function sameCell(a: GridCell | undefined, b: GridCell): boolean {
  return (
    a !== undefined && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  )
}

/**
 * Where a slot's window is born: far off any monitor, so it never shows on the
 * desktop before it is embedded (item 6). Beyond the ±30000 range real virtual
 * desktops use, so it is not clamped onto a screen.
 */
const OFFSCREEN_LAUNCH = -32000

interface SlotRuntime {
  /** The raw overrides as given, kept so the persisted form stays faithful. */
  overrides: SlotOverrides
  config: ResolvedSlotConfig
  state: SlotState
  pid: number | undefined
  restartAttempts: number
  lastError: string | undefined
  /** Windows the browser has open beside the embedded screen; see the snapshot. */
  extraWindows: number
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
  /** The display name, when set. Absent means the UI's "Tela {N}" placeholder. */
  name?: string
  volume: number
  muted: boolean
  backgroundThrottling: boolean
  /** Whether this slot is the one in focus mode. Exactly one slot at most. */
  focused: boolean
  /** Why the slot is not running, when that is known. Cleared once it starts. */
  lastError?: string
  /**
   * Windows this screen's browser has open beside the embedded one - a provider
   * login, in practice. Refreshed by the same sweep that rescues them, and zero
   * for a screen that is not running.
   */
  extraWindows: number
  /** Whether the app still chooses this screen's zoom, for the magnifier's `Auto` button. */
  zoomAuto: boolean
  /**
   * The factor now in force, when one is known — the manual one the user
   * stepped to, or the automatic one the last layout worked out. The card shows
   * it as a percentage; absent means no layout has run yet.
   */
  zoom?: number
}

export class Orchestrator {
  private readonly launcher: BrowserLauncher
  private readonly windows: WindowManager
  private readonly registry: ReadonlyMap<string, GameDefinition>
  private readonly autoRestart: boolean
  private readonly maxRestartAttempts: number
  private readonly logger: Logger | undefined
  private readonly profiles: ProfileArchive | undefined
  private readonly audio: AudioController | undefined
  private readonly zoom: ScreenZoom | undefined
  private readonly screen: ScreenBounds
  private readonly globals: GlobalConfig
  private readonly slots = new Map<number, SlotRuntime>()
  /** Launches/stops in flight, so concurrent IPC calls cannot overlap one profile. */
  private readonly launchTasks = new Map<number, Promise<void>>()
  private readonly stopTasks = new Map<number, Promise<void>>()

  /**
   * The factor each screen was last given, by slot id.
   *
   * By slot rather than by pid, because it outlives the browser: it is what the
   * card shows as a percentage, and what the first press of `+` or `-` steps
   * from when the user has never chosen a factor. `ScreenZoom` keeps the
   * separate question of what has actually been *sent* to a live window, keyed
   * by pid, because that one must be forgotten when a pid is reused.
   */
  private readonly zoomFactors = new Map<number, number>()

  /** When on, focus mode silences the screens that are not focused. */
  private audioFollowsFocus: boolean
  /**
   * The slot in focus mode, or undefined for the normal grid. The audio policy
   * reads this (not the OS foreground, as it once did): the app's own focus mode
   * is the source of truth now (decision 2).
   */
  private focusedSlotId: number | undefined
  /**
   * The mute and volume we have applied per pid, so an audio tick touches only
   * what changed. Keyed by pid rather than slot id: a restarted slot gets a new
   * pid, so it is treated as fresh — unmuted, full volume — with no stale entry.
   */
  private readonly appliedMuted = new Map<number, boolean>()
  private readonly appliedVolume = new Map<number, number>()
  /**
   * Which running windows are currently shown, so the renderer's per-frame layout
   * only flips visibility on a real transition — a resize drag must not spam
   * ShowWindow. Keyed by pid, cleared for pids no longer running, like the audio
   * maps above.
   */
  private readonly shownWindows = new Map<number, boolean>()

  /**
   * Where each running window was last put, so an unchanged frame moves nothing.
   * Keyed by pid and cleared the same way — and cleared on a hide too, so a
   * screen coming back is always placed again.
   */
  private readonly placedWindows = new Map<number, GridCell>()

  constructor(deps: OrchestratorDeps) {
    this.launcher = deps.launcher
    this.windows = deps.windows
    this.registry = deps.registry
    this.autoRestart = deps.autoRestart
    this.maxRestartAttempts = deps.maxRestartAttempts ?? DEFAULT_MAX_RESTART_ATTEMPTS
    this.logger = deps.logger
    this.profiles = deps.profiles
    this.audio = deps.audio
    this.zoom = deps.zoom ? new ScreenZoom(deps.zoom.preferences, deps.zoom.controller) : undefined
    this.screen = deps.screen
    this.globals = deps.globals
    this.audioFollowsFocus = deps.globals.audioFollowsFocus

    for (const overrides of deps.slots) {
      const config = resolveSlotConfig(this.globals, overrides)
      this.slots.set(config.id, {
        overrides,
        config,
        state: 'stopped',
        pid: undefined,
        restartAttempts: 0,
        extraWindows: 0,
        lastError: undefined,
      })
    }
  }

  /**
   * Drops what we remember about a pid the instant its slot lets go of it.
   *
   * Both maps are also swept whenever a layout frame arrives, which is the
   * normal path; this closes the gap where a stop and a start both land before
   * one does. Windows reuses process ids, and a reused pid still listed here is
   * a new window that would be skipped as "already placed" and left where every
   * browser is born — off-screen.
   */
  private forgetWindow(pid: number | undefined): void {
    if (pid === undefined) return
    this.shownWindows.delete(pid)
    this.placedWindows.delete(pid)
    this.appliedMuted.delete(pid)
    this.appliedVolume.delete(pid)
    this.zoom?.forget(pid)
    // And the adapter's own memory of that pid, for the same reason this
    // method exists: the next browser may be handed the same id.
    this.windows.forget(pid)
  }

  private slot(slotId: number): SlotRuntime {
    const slot = this.slots.get(slotId)
    if (!slot) throw new Error(`slot ${slotId} is not configured`)
    return slot
  }

  /**
   * The ids that occupy the grid right now, in wall order.
   *
   * Wall order, not id order: the user arranges the cards, and a launching
   * window is sized from the cell it is about to fill, so the two have to agree.
   *
   * The grid follows the *running* count, not the configured one: a slot only
   * takes a cell while it is live (starting, running or restarting). So one
   * running slot fills the screen, a second splits it in two, and stopping one
   * gives the other the whole screen back. A configured-but-stopped slot takes
   * no space, which is why adding one does not disturb the windows already up.
   */
  private layoutIds(): number[] {
    return [...this.slots.values()]
      .filter((slot) => isLive(slot.state) && slot.state !== 'stopping')
      .map((slot) => slot.config.id)
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
      extraWindows: 0,
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
    if (isLive(slot.state)) await this.stop(slotId)
    await this.profiles?.archive(slot.config.profileDir)

    this.slots.delete(slotId)
    this.emit({ level: 'info', event: 'slot.remove', slotId })
    // Removing the focused screen returns to grid mode (design §7): otherwise
    // focus would point at a gone slot, leaving the rest muted by the audio
    // policy. The renderer re-lays-out the wall once it sees the snapshot.
    if (this.focusedSlotId === slotId) this.focusedSlotId = undefined
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

  /**
   * The runtime per-screen setters behind the approved slots:* channels.
   *
   * Each changes one field and leaves the rest of the slot's overrides intact —
   * unlike updateSlot, which replaces the target wholesale. They only touch the
   * stored config; applying the new volume or mute to the live WASAPI session is
   * applyAudio's job, which the shell calls right after so the change is heard at
   * once. Persisting is the shell's job too, from slotConfigs().
   */
  renameSlot(id: number, name: string): void {
    const slot = this.slot(id)
    const overrides: SlotOverrides = { ...slot.overrides }
    // An empty name means "revert to the Tela {N} default": drop the override
    // rather than storing a blank one, so the placeholder shows again.
    if (name.trim() === '') delete overrides.name
    else overrides.name = name
    slot.overrides = overrides
    slot.config = resolveSlotConfig(this.globals, overrides)
  }

  setSlotVolume(id: number, volume: number): void {
    const slot = this.slot(id)
    const overrides: SlotOverrides = { ...slot.overrides, volume }
    slot.overrides = overrides
    slot.config = resolveSlotConfig(this.globals, overrides)
  }

  setSlotMuted(id: number, muted: boolean): void {
    const slot = this.slot(id)
    const overrides: SlotOverrides = { ...slot.overrides, muted }
    slot.overrides = overrides
    slot.config = resolveSlotConfig(this.globals, overrides)
  }

  /**
   * The magnifier's `Auto` button: hands the choice of zoom to the user, or takes it back.
   *
   * Turning it **off** freezes the factor the screen already has, by storing
   * it — so the button changes who decides, not how big the game is. Turning it
   * **on** drops the stored factor and lets the next layout frame work one out,
   * which is what makes the toggle reversible rather than a one-way door.
   */
  setSlotZoomAuto(id: number, auto: boolean): void {
    const slot = this.slot(id)
    const overrides: SlotOverrides = { ...slot.overrides, zoomAuto: auto }
    if (auto) delete overrides.zoom
    else {
      const current = this.zoomFactors.get(id)
      if (current !== undefined) overrides.zoom = current
    }
    slot.overrides = overrides
    slot.config = resolveSlotConfig(this.globals, overrides)
    if (!auto) this.requestZoom(slot)
  }

  /**
   * The slider, dropped on one of its notches.
   *
   * It turns the automatic zoom off as a side effect, deliberately: with it on,
   * the next layout frame would overwrite whatever the user just dragged to, so
   * a slider that left the mode alone would appear to do nothing. The notch is
   * all the panel sends — `zoom.ts` owns what each one means and both ends of
   * the ladder — and a drag that rests on the notch the screen already has
   * stores and sends nothing, which matters because a drag reports the same
   * rung many times over and each command would cost a browser round trip.
   */
  setSlotZoomRung(id: number, rung: number): void {
    const slot = this.slot(id)
    const zoom = manualZoomAtRung(rung)
    if (zoom === undefined) throw new Error(`zoom rung ${rung} is not a notch of the slider`)
    if (!slot.config.zoomAuto && slot.config.zoom === zoom) return
    const overrides: SlotOverrides = { ...slot.overrides, zoomAuto: false, zoom }
    slot.overrides = overrides
    slot.config = resolveSlotConfig(this.globals, overrides)
    this.requestZoom(slot)
  }

  /**
   * Sends a screen the factor its config now names, if it is running and shown.
   *
   * Hidden screens are skipped rather than queued: a command posted to a hidden
   * window is one the user cannot see land, and the layout frame that reveals
   * the screen asks again. `ScreenZoom` drops a request that matches what it
   * last applied, so an unchanged factor costs nothing here either.
   */
  private requestZoom(slot: SlotRuntime): void {
    const pid = slot.pid
    if (slot.state !== 'running' || pid === undefined) return
    if (this.shownWindows.get(pid) !== true) return
    const factor = slot.config.zoomAuto ? this.zoomFactors.get(slot.config.id) : slot.config.zoom
    if (factor === undefined) return
    this.zoomFactors.set(slot.config.id, factor)
    this.zoom?.request(pid, factor)
  }

  /**
   * Moves a screen to another position on the wall.
   *
   * Position, and nothing else. The id stays with the screen because the id
   * *is* the profile directory name (`slot-N`): reordering by renumbering
   * would swap two screens' logged-in sessions, so this rewrites the order the
   * runtimes sit in and touches no field of any of them.
   *
   * The wall order is the insertion order of this map, which a Map cannot
   * rewrite in place — hence emptying and refilling it. Persisting is the
   * shell's job, from slotConfigs(), exactly as it is after a rename.
   */
  moveSlot(id: number, toIndex: number): void {
    this.slot(id) // refuses a screen that is not configured, with that message
    const ids = [...this.slots.keys()]
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= ids.length) {
      throw new Error(`position ${toIndex} is outside a wall of ${ids.length} screens`)
    }
    const runtimes = new Map(this.slots)
    const order = ids.filter((each) => each !== id)
    order.splice(toIndex, 0, id)
    this.slots.clear()
    for (const each of order) this.slots.set(each, runtimes.get(each)!)
    this.emit({ level: 'info', event: 'slot.move', slotId: id })
  }

  /**
   * The slots as configured, in wall order.
   *
   * Not sorted by id: since the owner made the wall reorderable, the order of
   * this array is what the user arranged, and it is what gets written back to
   * the config file. It used to sort, which quietly undid every reorder at the
   * next save.
   */
  slotConfigs(): SlotOverrides[] {
    return [...this.slots.values()].map((slot) => ({ ...slot.overrides }))
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
    await this.trackLaunch(slot)
  }

  /** Registers every launch path so a concurrent stop waits for its resulting pid. */
  private async trackLaunch(slot: SlotRuntime): Promise<void> {
    const task = this.spawn(slot)
    this.launchTasks.set(slot.config.id, task)
    try {
      await task
    } finally {
      if (this.launchTasks.get(slot.config.id) === task) this.launchTasks.delete(slot.config.id)
    }
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
      const cell = this.cellOf(slot.config.id)
      slot.pid = await this.launcher.launch({
        slotId: slot.config.id,
        url,
        profileDir: slot.config.profileDir,
        // Launch off-screen, at the size of the cell it will roughly fill. Without
        // CDP the window is born as a normal top-level window and shown before we
        // can embed it; born off-screen it is never visible on the desktop, so it
        // does not flash there and then jump into the panel — the adapter hides it
        // on reparent and the renderer's first layout shows it already in place.
        // The size is a sensible initial (close to its viewport), the position is
        // discarded the moment it is embedded.
        bounds: {
          x: OFFSCREEN_LAUNCH,
          y: OFFSCREEN_LAUNCH,
          width: cell.width,
          height: cell.height,
        },
        mute: slot.config.mute,
        persistProfile: slot.config.persistProfile,
        backgroundThrottling: slot.config.backgroundThrottling,
      })
      // A stop can arrive while launch is still resolving. The stop task waits
      // for this one and will close the pid it just produced; making the window
      // ready here would briefly resurrect a screen the user already stopped.
      if (slot.state === 'stopping') return
      slot.state = transition(slot.state, 'ready')
      slot.lastError = undefined
      // Embed the freshly launched window into the panel. Idempotent, so it is
      // safe here even though the real window may resolve a moment later — the
      // adapter owns that timing, as it does for setBounds.
      this.windows.reparent(slot.pid)
      this.emit({ level: 'info', event: 'slot.ready', ...this.slotFields(slot), pid: slot.pid })
    } catch (error) {
      this.forgetWindow(slot.pid)
      slot.pid = undefined
      if (slot.state === 'stopping') {
        slot.state = transition(slot.state, 'stopped')
        return
      }
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
    const existing = this.stopTasks.get(slotId)
    if (existing !== undefined) return existing
    const slot = this.slot(slotId)
    slot.state = transition(slot.state, 'stop')
    const task = this.finishStop(slot)
    this.stopTasks.set(slotId, task)
    try {
      await task
    } finally {
      if (this.stopTasks.get(slotId) === task) this.stopTasks.delete(slotId)
    }
  }

  private async finishStop(slot: SlotRuntime): Promise<void> {
    const launch = this.launchTasks.get(slot.config.id)
    if (launch !== undefined) await launch.catch(() => {})
    if (slot.state === 'stopped') return
    const pid = slot.pid
    // Ask the embedded window to close gracefully first (WM_CLOSE); the launcher
    // then waits for that clean exit and force-kills only as a fallback. Without
    // it the launcher's own graceful ask cannot reach the reparented child and
    // the browser lingers seconds before the force-kill.
    //
    // **Before `forgetWindow`, and that order is the whole point.** The handle
    // this needs is the one the adapter is about to be told to throw away, so
    // forgetting first silently turns every shutdown into the five-second
    // fallback - which is what the owner felt as "turning them all off takes a
    // while" on 2026-09-21.
    if (pid !== undefined) this.windows.close(pid)
    this.forgetWindow(pid)
    slot.restartAttempts = 0
    slot.extraWindows = 0
    this.emit({ level: 'info', event: 'slot.stop', ...this.slotFields(slot) })
    // Everything above is synchronous on purpose: the shell pushes its state
    // right after calling this, so the card goes dark now rather than when the
    // browser has finished exiting.
    if (pid === undefined) {
      slot.state = transition(slot.state, 'stopped')
      return
    }
    try {
      await this.launcher.stop(pid)
    } finally {
      // `stop` can still reject because cleanup of an ephemeral profile failed.
      // The process answer, not the promise answer, decides whether profile
      // operations and a new launch are safe.
      if (!this.launcher.isAlive(pid)) {
        slot.pid = undefined
        slot.state = transition(slot.state, 'stopped')
      }
    }
  }

  /**
   * Toggles focus mode for a slot, and returns whether that slot is now focused.
   *
   * Focus mode is an app-layout concept in the single-window video wall: the
   * focused screen takes the main area and the others shrink to DOM thumbnails.
   * The core only tracks which slot is focused and exposes it in the snapshot;
   * the geometry that follows — showing, hiding and sizing the embedded windows —
   * is the renderer's, which re-sends screens:layout when it sees the flag change
   * (Option 1). The audio policy reads the focus state on its next tick.
   */
  focus(slotId: number): boolean {
    this.slot(slotId) // throws for an unknown slot
    if (this.focusedSlotId === slotId) {
      this.focusedSlotId = undefined
      return false
    }
    this.focusedSlotId = slotId
    return true
  }

  /**
   * Reloads a running slot in place, keeping its login. Returns false for a slot
   * that is not running. The one session-safe recovery the shell has (ADR-0009).
   */
  reload(slotId: number): boolean {
    const slot = this.slot(slotId)
    if (slot.state !== 'running' || slot.pid === undefined) return false
    this.zoom?.forget(slot.pid)
    return this.windows.reload(slot.pid)
  }

  /**
   * Applies the layout the renderer computed: where each embedded screen goes,
   * or that it is hidden.
   *
   * This is the single source of embedded-window geometry in the video wall — the
   * renderer owns it because the rectangles depend on the card layout and the
   * focus divider, which only the DOM knows (Option 1, the owner's decision). A
   * screen with bounds is shown and moved there; a screen with none is hidden
   * (fullscreen, or a panel-drawn modal that actually covers it — never merely
   * because it is not the focused screen). Visibility flips
   * only on a real transition, so a resize drag does not spam ShowWindow.
   * Slots the renderer does not mention, or that are not running, are left alone.
   *
   * The whole frame goes to the adapter in **one** call, carrying **only the
   * screens that moved**. Both halves were measured on 2026-09-20 against six
   * embedded screens:
   *
   * - One Win32 command per screen placed a frame in 75 ms, one command for the
   *   whole frame in 36 ms. Entering or leaving focus is one frame, so that is
   *   the transition the user sits through.
   * - The panel redraws and re-emits its layout on every state push — the
   *   liveness sweep used to push every two seconds — so a frame that re-sends
   *   unchanged rectangles moves every screen to where it already is, for ever,
   *   each move costing a reflow inside the page. An unchanged frame now sends
   *   nothing at all.
   *
   * A screen keeps its remembered position across a hide, but not across a stop:
   * a pid that is no longer running is forgotten, because Windows reuses process
   * ids and a new browser at an old pid is a new window in the wrong place.
   */
  applyScreenLayout(placements: ScreenPlacement[], dpiScale = 1): void {
    const wanted = new Map(placements.map((placement) => [placement.id, placement.bounds]))
    const runningPids = new Set<number>()
    const moves: WindowPlacement[] = []
    for (const slot of this.slots.values()) {
      if (slot.state !== 'running' || slot.pid === undefined) continue
      const pid = slot.pid
      runningPids.add(pid)
      if (!wanted.has(slot.config.id)) continue

      const bounds = wanted.get(slot.config.id)
      const wantVisible = bounds !== undefined
      if (this.shownWindows.get(pid) !== wantVisible) {
        if (wantVisible) this.windows.show(pid)
        else this.windows.hide(pid)
        this.shownWindows.set(pid, wantVisible)
      }
      if (!bounds) {
        // Hidden: forget where it was, so coming back always places it again.
        // The **zoom** is deliberately not forgotten - hiding a window does not
        // change the zoom it already has, and re-sending it on every return
        // from fullscreen is what put a Chrome zoom bubble on each card
        // (ADR-0031). A reload or a restart still invalidates it, in `reload`
        // and `forgetWindow`, because there the document or the process is new.
        this.placedWindows.delete(pid)
        continue
      }
      // Zoom and geometry have different invalidation rules: focus/DPI may
      // change while the rectangle stays identical. Never wait on disk/native
      // commands in the layout path; ScreenZoom coalesces each screen's target.
      //
      // A screen whose user turned the automatic zoom off is not measured at
      // all: their factor is the whole answer, in the card, in focus and in
      // fullscreen alike (ADR-0031). With the mode off and no factor stored
      // yet, nothing is sent and the screen keeps what it has.
      const factor = slot.config.zoomAuto
        ? screenZoomFactor(bounds, dpiScale, slot.config.id === this.focusedSlotId)
        : slot.config.zoom
      if (factor !== undefined) {
        this.zoomFactors.set(slot.config.id, factor)
        this.zoom?.request(pid, factor)
      }
      if (sameCell(this.placedWindows.get(pid), bounds)) continue
      this.placedWindows.set(pid, bounds)
      moves.push({ pid, bounds })
    }
    if (moves.length > 0) this.windows.setLayout(moves)
    // Forget pids no longer running, so restarts do not leave stale entries.
    for (const pid of [...this.shownWindows.keys()]) {
      if (!runningPids.has(pid)) this.shownWindows.delete(pid)
    }
    for (const pid of [...this.placedWindows.keys()]) {
      if (!runningPids.has(pid)) this.placedWindows.delete(pid)
    }
  }

  /** Flips the audio-follows-focus toggle. Takes effect on the next audio tick. */
  setAudioFollowsFocus(enabled: boolean): void {
    this.audioFollowsFocus = enabled
  }

  /**
   * Applies the audio policy: each running slot gets its configured volume, and
   * is muted when the user muted it or when focus mode silences it.
   *
   * A slot is silenced by focus when the toggle is on, some screen is focused,
   * and this is not that screen. With no screen focused, or the toggle off,
   * nothing is silenced by focus — every screen plays at its volume, and only a
   * user-muted screen stays quiet. Called on a timer by the shell, like
   * checkLiveness; a slot is touched only when its volume or mute actually
   * changes, so a quiet tick shells out to nothing.
   */
  async applyAudio(): Promise<void> {
    if (!this.audio) return

    const running = new Set<number>()
    for (const slot of this.slots.values()) {
      if (slot.state !== 'running' || slot.pid === undefined) continue
      const pid = slot.pid
      running.add(pid)

      const silencedByFocus =
        this.audioFollowsFocus &&
        this.focusedSlotId !== undefined &&
        slot.config.id !== this.focusedSlotId
      const desiredMuted = slot.config.muted || silencedByFocus
      const desiredVolume = slot.config.volume

      if ((this.appliedMuted.get(pid) ?? false) !== desiredMuted) {
        await this.audio.setMuted(pid, desiredMuted)
        this.appliedMuted.set(pid, desiredMuted)
      }
      // 100 is the WASAPI session default, so a slot that wants full volume
      // needs no call the first time it is seen.
      if ((this.appliedVolume.get(pid) ?? 100) !== desiredVolume) {
        await this.audio.setVolume(pid, desiredVolume)
        this.appliedVolume.set(pid, desiredVolume)
      }
    }

    // Forget pids that are no longer running, so a long session of restarts does
    // not grow the maps without bound. A stopped slot's process is already gone,
    // so there is nothing to restore — only tracking to drop.
    for (const pid of [...this.appliedMuted.keys()]) {
      if (!running.has(pid)) this.appliedMuted.delete(pid)
    }
    for (const pid of [...this.appliedVolume.keys()]) {
      if (!running.has(pid)) this.appliedVolume.delete(pid)
    }
  }

  /**
   * Rescues the windows a screen's browser opens for itself — a provider login,
   * above all — which arrive out of view.
   *
   * Driven when the panel gains or loses focus. A provider popup changes focus
   * when it opens and again when it closes, giving the shell a native event to
   * react to without CDP and without polling the desktop. Why it lands off-screen
   * at all, and the rule for which ones may be moved, are in `detached-window.ts`.
   *
   * One batched adapter call covers the whole live set. The log line is for an
   * actual rescue, never for a quiet sweep, and the return value says whether the
   * renderer-visible count changed.
   */
  async revealDetachedWindows(): Promise<boolean> {
    const live = [...this.slots.values()].filter(
      (slot) => isLive(slot.state) && slot.state !== 'stopping' && slot.pid !== undefined,
    )
    const sweep =
      live.length === 0 ? [] : await this.windows.sweepExtraWindows(live.map((slot) => slot.pid!))
    const results = new Map(sweep.map((result) => [result.pid, result]))
    let changed = false
    for (const slot of this.slots.values()) {
      if (!isLive(slot.state) || slot.state === 'stopping' || slot.pid === undefined) {
        if (slot.extraWindows !== 0) changed = true
        slot.extraWindows = 0
        continue
      }
      const result = results.get(slot.pid)
      if (result?.moved) {
        this.emit({ level: 'info', event: 'slot.detached-window', ...this.slotFields(slot) })
      }
      const extraWindows = result?.extraWindows ?? 0
      if (slot.extraWindows !== extraWindows) changed = true
      slot.extraWindows = extraWindows
    }
    return changed
  }

  /**
   * Closes the windows a screen opened for itself, without touching the screen.
   *
   * The way out of a provider login the user cannot finish. Silent for a screen
   * that is not running: the panel draws its control from a state that is up to
   * a tick old, so "the screen stopped in between" is an ordinary race, not an
   * error to report.
   */
  closeExtraWindows(id: number): void {
    const slot = this.slots.get(id)
    if (!slot || !isLive(slot.state) || slot.state === 'stopping' || slot.pid === undefined) return
    const closed = this.windows.closeExtraWindows(slot.pid)
    if (closed > 0) {
      slot.extraWindows = 0
      this.emit({ level: 'info', event: 'slot.login-cancelled', ...this.slotFields(slot) })
    }
  }

  /**
   * Called on a timer by the shell. Every slot is handled independently — one
   * slot crashing, or failing to come back, never touches its neighbours.
   */
  async checkLiveness(): Promise<boolean> {
    let changed = false
    for (const slot of this.slots.values()) {
      if (!isLive(slot.state) || slot.state === 'stopping' || slot.pid === undefined) continue
      if (this.launcher.isAlive(slot.pid)) continue

      changed = true
      this.forgetWindow(slot.pid)
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
        await this.trackLaunch(slot)
      } catch {
        // Already recorded as crashed by spawn. Swallowing here is deliberate:
        // a failed restart must not abort the sweep over the other slots.
      }
    }
    return changed
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
        volume: slot.config.volume,
        muted: slot.config.muted,
        backgroundThrottling: slot.config.backgroundThrottling,
        focused: this.focusedSlotId === slot.config.id,
        // Never reported for a screen that is not running, whatever the last
        // sweep measured: the card draws its cancel control from this, and the
        // two answers - "how many windows" and "is it running" - must not be
        // able to disagree in the two seconds before the next sweep.
        extraWindows: isLive(slot.state) && slot.state !== 'stopping' ? slot.extraWindows : 0,
        zoomAuto: slot.config.zoomAuto,
      }
      const zoom = slot.config.zoom ?? this.zoomFactors.get(slot.config.id)
      if (zoom !== undefined) view.zoom = zoom
      if (slot.config.gameId !== undefined) view.gameId = slot.config.gameId
      if (slot.config.url !== undefined) view.url = slot.config.url
      if (slot.config.name !== undefined) view.name = slot.config.name
      if (slot.lastError !== undefined) view.lastError = slot.lastError
      return view
    })
  }
}
