/**
 * Window adapter, over node-window-manager plus a persistent Win32 worker.
 *
 * Needed because the browsers run in processes this app did not create:
 * --window-position only sets the initial state, so placing a slot in the grid,
 * embedding it into the panel, hiding it when it is covered or fullscreened,
 * moving it as the panel resizes or reloading it afterwards all mean driving a
 * foreign window.
 *
 * node-window-manager covers reading and moving top-level windows; the embed,
 * the child-window move, hide/show and in-place reload it has no API for are in
 * the Win32 worker (win32-worker.ts). Those go through a persistent PowerShell
 * process rather than a per-call shell-out because a video-wall screen has to
 * follow a panel resize or a focus-divider drag live — dozens of moves a second,
 * which a ~270 ms shell-out could never keep up with.
 *
 * Once a window is embedded (SetParent makes it a WS_CHILD) node-window-manager
 * can no longer find it — EnumWindows lists only top-level windows — so this
 * adapter remembers each embedded window's handle by pid and drives it from the
 * worker directly from then on.
 *
 * The port is synchronous, so the worker is driven fire-and-forget: a call
 * resolves the window's handle synchronously (returning false when there is
 * none yet) and queues the Win32 op without waiting. The worker's queue is FIFO,
 * so a reparent is always carried out before the moves that follow it.
 *
 * Holds no business rules. Where each window goes, and when it is embedded,
 * hidden or reloaded, is the core's decision; the invisible-border arithmetic
 * and the SetParent timing are Windows details it keeps to itself.
 */
import { createRequire } from 'node:module'
import { centredOver, isOffScreen } from '@hecaton/core'
import type { GridCell, WindowManager, WindowPlacement } from '@hecaton/core'
import { measureInsets } from './dwm-insets.js'
import type { Insets } from './dwm-insets.js'
import { Win32Worker } from './win32-worker.js'

// node-window-manager is CommonJS with a native addon; createRequire loads it
// from an ES module without pulling in an interop shim.
const require = createRequire(import.meta.url)

interface NativeMonitor {
  id: number
  getWorkArea(): { x: number; y: number; width: number; height: number }
  /** 1 at 100%, 1.5 at 150%. `getBounds` on a window is divided by this. */
  getScaleFactor(): number
}

interface NativeWindow {
  id: number
  processId: number
  getMonitor(): NativeMonitor
  isVisible(): boolean
  getTitle(): string
  getBounds(): { x?: number; y?: number; width?: number; height?: number }
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void
  /** Raises a window above its siblings, without taking keyboard focus from it. */
  bringToTop(): void
}

interface NativeApi {
  getWindows(): NativeWindow[]
  /** Every monitor, for deciding whether a window is reachable at all. */
  getMonitors(): NativeMonitor[]
}

const { windowManager } = require('node-window-manager') as { windowManager: NativeApi }

/** How long, and how often, reparent keeps looking for a window still starting. */
const EMBED_RETRY_MS = 250
const EMBED_MAX_ATTEMPTS = 80 // ~20s, matching the launcher's own pid wait

/** ShowWindow commands. */
const SW_HIDE = 0
const SW_SHOW = 5

/**
 * How long an embedded window is kept hidden while it repaints itself.
 *
 * Measured 2026-08-20 against the target game over the network: the reload issued
 * on embed produced its first painted frame at ~600 ms and a complete one at
 * 1000 ms; a localhost page painted in 200 ms. A second is therefore the whole
 * budget with margin, and it is the ceiling the owner set for this.
 *
 * On a slow link the reveal can still land before the paint, and the screen shows
 * grey for the remainder. That is the failure mode chosen deliberately over
 * waiting indefinitely: with no CDP there is no event that says "painted", only
 * elapsed time, and a screen that never appears is worse than one that appears
 * late.
 */
const REPAINT_SETTLE_MS = 1000

export class NativeWindowManager implements WindowManager {
  private readonly worker = new Win32Worker()

  /**
   * How the adapter finds the panel to embed into.
   *
   * Injected because the panel is the Electron shell window, which only the main
   * process knows; the core speaks pids, never handles. Left undefined (as the
   * integration suite's non-embedding cases do) reparent is a no-op — nothing to
   * embed into.
   */
  constructor(private readonly parentHwnd?: () => number | undefined) {
    // Warm the worker while the app is still starting, so the first embed does
    // not pay the compile. Harmless if it fails: the first op starts it instead.
    void this.worker.start().catch(() => {})
  }

  /** Embedded windows by pid: their handles, since node-window-manager loses them. */
  private readonly embedded = new Map<number, number>()

  /** Pids whose window is still being waited for, so retries do not stack. */
  private readonly pendingEmbeds = new Set<number>()

  /** When each freshly embedded pid may be revealed. See `embed`. */
  private readonly repaintDeadline = new Map<number, number>()

  /** Reveals the core asked for early, waiting out the repaint. One per pid. */
  private readonly deferredShows = new Map<number, NodeJS.Timeout>()

  /** Queues one worker command without waiting; the port is synchronous. */
  private fire(command: string): void {
    void this.worker.send(command).catch(() => {
      // Best effort: a worker that just died re-spawns on the next call, and a
      // window that vanished mid-op is the core's problem to notice via
      // liveness, not this adapter's to crash on.
    })
  }

  /**
   * The visible, titled top-level window belonging to a process.
   *
   * Matched by pid, never by title. During the Phase 0 spike a title filter
   * matched the user's own Chrome window - same game open - and moved it. In a
   * distributed app that would rearrange strangers' windows. Finds nothing once
   * the window is embedded (a WS_CHILD is not top-level); the embedded map
   * covers it from then on.
   */
  private windowFor(pid: number): NativeWindow | undefined {
    return windowManager
      .getWindows()
      .find((window) => window.processId === pid && window.isVisible() && window.getTitle().trim())
  }

  /** The handle to drive for a slot: the embedded one if any, else the live window. */
  private hwndFor(pid: number): number | undefined {
    return this.embedded.get(pid) ?? this.windowFor(pid)?.id
  }

  /**
   * Insets for the monitor a window is on, measured once per monitor.
   *
   * Per monitor rather than per process because the margin scales with DPI, and
   * a dual-monitor machine with mixed scaling would otherwise place windows
   * correctly on one screen and a few pixels off on the other. Measuring on
   * every call is not an option: each measurement spawns PowerShell, and
   * applying the grid touches every slot at once.
   */
  private readonly insetsByMonitor = new Map<number, Insets>()

  private insetsFor(window: NativeWindow): Insets {
    const monitor = window.getMonitor()
    const key = monitor.id
    const cached = this.insetsByMonitor.get(key)
    if (cached) return cached
    const measured = measureInsets(window.id)
    this.insetsByMonitor.set(key, measured)
    return measured
  }

  /**
   * Places a slot's window at `bounds`.
   *
   * Two coordinate worlds, one per lifecycle stage:
   *
   * - **Embedded** (the video-wall norm): `bounds` is the screen's rectangle in
   *   the panel's client area, and the child is moved there with MoveWindow,
   *   re-asserting HWND_TOP so Electron's own input hwnd cannot cover it. This is
   *   the path the renderer's layout drives, live, on every resize.
   * - **Top-level** (before the embed, e.g. the integration suite placing a bare
   *   window): `bounds` is a screen rectangle, inflated by the measured invisible
   *   border so the painted rect lands where asked — a Windows detail, not a
   *   decision, so the core never learns it.
   *
   * False when the window is not found yet (the browser may still be starting).
   */
  setBounds(pid: number, bounds: GridCell): boolean {
    if (this.embedded.has(pid)) {
      // A frame of one. The embedded path has a single implementation, so a
      // lone move cannot drift from what the video wall actually drives.
      this.setLayout([{ pid, bounds }])
      return true
    }

    const window = this.windowFor(pid)
    if (!window) return false
    const insets = this.insetsFor(window)
    window.setBounds({
      x: bounds.x - insets.left,
      y: bounds.y - insets.top,
      width: bounds.width + insets.left + insets.right,
      height: bounds.height + insets.top + insets.bottom,
    })
    return true
  }

  /**
   * Places a whole layout frame: one worker command, and never a stale one.
   *
   * Two things, both measured on 2026-09-20 against six embedded screens on a
   * busy page:
   *
   * - **One command, not one per screen.** Each is a Win32 call that has to
   *   reach a browser in the middle of drawing, and they queue behind each
   *   other: a frame took 75 ms as six commands and 36 ms as one. Entering or
   *   leaving focus is a single frame, so that is the wait the user feels.
   * - **The newest frame wins.** A divider drag emits about 60 frames a second
   *   and Win32 serves 15 to 25 of them. Sending all of them does not make the
   *   screens keep up — it makes them fall behind, because the worker is still
   *   working through positions the divider has already passed: 2.2 s of
   *   backlog after the pointer stopped. Holding only the latest frame while one
   *   is in flight brought that to 84 ms, and applied *more* frames (39 of 60
   *   against 22), because none of the worker's time went to superseded ones.
   *
   * Dropping a frame is safe precisely because a frame is complete in itself: it
   * carries every screen that moved, so the newest one is never missing anything
   * an older one would have applied.
   *
   * A pid that is not embedded yet falls back to the top-level move — the same
   * thing `setBounds` does, for a window the launcher has resolved but the embed
   * has not caught up with.
   */
  setLayout(placements: WindowPlacement[]): void {
    const parts: string[] = []
    for (const { pid, bounds } of placements) {
      const hwnd = this.embedded.get(pid)
      if (hwnd === undefined) {
        this.setBounds(pid, bounds)
        continue
      }
      parts.push(`${hwnd},${bounds.x},${bounds.y},${bounds.width},${bounds.height}`)
    }
    if (parts.length === 0) return
    this.queueLayout(`movechildren ${parts.join(';')}`)
  }

  /** Whether a layout command is still waiting on its reply. */
  private layoutInFlight = false
  /** The frame to send when it is not, if a newer one arrived meanwhile. */
  private queuedLayout: string | undefined

  /**
   * How many layout commands the worker was actually given. Diagnostics and
   * tests only — it is what makes "the superseded frames were never sent"
   * observable from outside.
   */
  layoutCommandsSent = 0

  private queueLayout(command: string): void {
    if (this.layoutInFlight) {
      this.queuedLayout = command
      return
    }
    this.layoutInFlight = true
    this.layoutCommandsSent++
    void this.worker
      .send(command)
      .catch(() => {
        // Best effort, as everywhere else here: a worker that just died re-spawns
        // on the next frame, and the next frame is at most one drag tick away.
      })
      .finally(() => {
        this.layoutInFlight = false
        const next = this.queuedLayout
        this.queuedLayout = undefined
        if (next !== undefined) this.queueLayout(next)
      })
  }

  /**
   * Embeds the freshly launched window into the panel (SetParent + style strip).
   *
   * Idempotent: an already-embedded slot is a no-op, so the core may call it
   * whenever it places a slot. The window may not exist the instant after
   * launch, so when it is not found yet this starts a bounded background poll and
   * returns false now, embedding once the window appears - the timing the core
   * comment says the adapter owns.
   */
  reparent(pid: number): boolean {
    if (this.embedded.has(pid)) return true
    const parent = this.parentHwnd?.()
    if (parent === undefined) return false
    const hwnd = this.windowFor(pid)?.id
    if (hwnd !== undefined) return this.embed(pid, hwnd, parent)
    if (!this.pendingEmbeds.has(pid)) this.pollEmbed(pid, 0)
    return false
  }

  /** SetParent the child into the panel and remember its handle. */
  private embed(pid: number, hwnd: number, parent: number): boolean {
    this.fire(`reparent ${hwnd} ${parent}`)
    // Hide it the instant it is embedded. The window launches off-screen so it is
    // not visible on the desktop, but should Chrome ever clamp that position onto a
    // monitor it would flash; hiding here covers that, and the core's first
    // screens:layout shows it again already positioned (its shownWindows starts
    // empty, so the first placement is a show). FIFO keeps this after the reparent.
    this.fire(`show ${hwnd} ${SW_HIDE}`)
    // Reparenting an --app window throws away its rendered surface, and it never
    // comes back on its own: the screen sits grey until somebody reloads it by
    // hand. Measured 2026-08-20 - Chrome 150 does not do this, the bundled
    // Chromium 154 does, and the regression landed during 151. Nothing short of a
    // new document repaints it: SW_HIDE/SW_SHOW, RedrawWindow, minimise/restore
    // and a resize were all tried and all stayed grey.
    //
    // So the window is reloaded here, while it is hidden, and `show` holds the
    // reveal until it has had time to paint. The user sees the panel's own
    // "loading" cell throughout and never sees the grey. A reload is safe for a
    // logged-in slot - ADR-0009 records it as the one operation that keeps the
    // tab-bound login.
    //
    // This is a workaround for somebody else's bug, not a design: it belongs here
    // rather than in the core because the core cannot know that this browser
    // loses a surface when Win32 reparents it. If a future revision stops doing
    // it, this whole block goes, and the integration test that pins it will say so.
    this.fire(`reload ${hwnd}`)
    this.embedded.set(pid, hwnd)
    this.repaintDeadline.set(pid, Date.now() + REPAINT_SETTLE_MS)
    return true
  }

  /** Keeps trying to embed a slot whose window has not appeared yet. */
  private pollEmbed(pid: number, attempt: number): void {
    this.pendingEmbeds.add(pid)
    const timer = setTimeout(() => {
      if (this.embedded.has(pid)) {
        this.pendingEmbeds.delete(pid)
        return
      }
      const parent = this.parentHwnd?.()
      const hwnd = this.windowFor(pid)?.id
      if (parent !== undefined && hwnd !== undefined) {
        this.embed(pid, hwnd, parent)
        this.pendingEmbeds.delete(pid)
        return
      }
      if (attempt + 1 >= EMBED_MAX_ATTEMPTS) {
        this.pendingEmbeds.delete(pid)
        return
      }
      this.pollEmbed(pid, attempt + 1)
    }, EMBED_RETRY_MS)
    // Never let a pending embed hold the process open (matters for tests and a
    // clean shutdown); a real app keeps running for its own reasons.
    timer.unref?.()
  }

  /**
   * Hides an embedded window (SW_HIDE) — fullscreen, a stopped screen, or under a
   * panel-drawn modal that actually covers it. Not focus mode: the other screens
   * stay live in their thumbnails.
   */
  hide(pid: number): boolean {
    const hwnd = this.hwndFor(pid)
    if (hwnd === undefined) return false
    // A pending reveal must die here, or a screen hidden during its first second
    // would pop back into view on its own a moment later.
    this.cancelDeferredShow(pid)
    this.fire(`show ${hwnd} ${SW_HIDE}`)
    return true
  }

  private cancelDeferredShow(pid: number): void {
    const timer = this.deferredShows.get(pid)
    if (timer !== undefined) clearTimeout(timer)
    this.deferredShows.delete(pid)
    this.repaintDeadline.delete(pid)
  }

  /**
   * Shows a hidden embedded window again (SW_SHOW).
   *
   * Held back while a freshly embedded window is still repainting itself - see
   * `embed`. The core is not told about the wait: it asked for the screen to be
   * visible and it will be, a beat later, already painted rather than grey. The
   * deferred reveal is the adapter's own timing, like `pollEmbed` above.
   */
  show(pid: number): boolean {
    const hwnd = this.hwndFor(pid)
    if (hwnd === undefined) return false

    const remaining = (this.repaintDeadline.get(pid) ?? 0) - Date.now()
    if (remaining <= 0) {
      this.repaintDeadline.delete(pid)
      this.fire(`show ${hwnd} ${SW_SHOW}`)
      return true
    }
    if (!this.deferredShows.has(pid)) {
      const timer = setTimeout(() => {
        this.deferredShows.delete(pid)
        this.repaintDeadline.delete(pid)
        const current = this.hwndFor(pid)
        if (current !== undefined) this.fire(`show ${current} ${SW_SHOW}`)
      }, remaining)
      // Never hold the process open on a screen that is merely late.
      timer.unref?.()
      this.deferredShows.set(pid, timer)
    }
    return true
  }

  /**
   * Reloads the page in place via WM_APPCOMMAND — the one recovery that keeps the
   * tab-bound login (ADR-0009). False when the window is not found yet.
   */
  reload(pid: number): boolean {
    const hwnd = this.hwndFor(pid)
    if (hwnd === undefined) return false
    this.fire(`reload ${hwnd}`)
    return true
  }

  /**
   * Posts WM_CLOSE to the embedded window so Chrome closes gracefully. Needed
   * because reparenting made the window a child, which the launcher's
   * CloseMainWindow can no longer reach — without this, stopping a screen waited
   * out the launcher's grace period before force-killing. False when not found.
   */
  close(pid: number): boolean {
    const hwnd = this.hwndFor(pid)
    if (hwnd === undefined) return false
    this.fire(`close ${hwnd}`)
    return true
  }

  /** The rectangle the user sees — the same coordinates a top-level setBounds accepts. */
  boundsOf(pid: number): GridCell | undefined {
    const window = this.windowFor(pid)
    if (!window) return undefined
    const bounds = window.getBounds()
    if (
      bounds.x === undefined ||
      bounds.y === undefined ||
      bounds.width === undefined ||
      bounds.height === undefined
    ) {
      return undefined
    }
    const insets = this.insetsFor(window)
    return {
      x: bounds.x + insets.left,
      y: bounds.y + insets.top,
      width: bounds.width - insets.left - insets.right,
      height: bounds.height - insets.top - insets.bottom,
    }
  }

  /**
   * Brings the windows a screen opened for itself back onto the desktop.
   *
   * The port says what this is for; here is how. Every visible, titled top-level
   * window of the process is a candidate — the embedded screen is a `WS_CHILD`
   * and `getWindows` does not list it, so it needs no excluding — and each one
   * that no monitor can show is centred over the panel and raised.
   *
   * **Nothing happens until the screen is embedded**, and that guard is the
   * whole reason this is not dangerous: before the embed, the screen itself is
   * deliberately parked at `OFFSCREEN_LAUNCH`, and rescuing it there would drag
   * it across the desktop exactly once per launch — the flash the offscreen
   * birth exists to prevent.
   *
   * Centred over the panel rather than over the primary monitor: a login window
   * belongs in front of the app that caused it, on the monitor the user is
   * looking at. When the panel's own rectangle cannot be read, the primary
   * monitor's work area stands in.
   */
  revealDetachedWindows(pid: number): number {
    if (!this.embedded.has(pid)) return 0

    // Everything here is in **physical pixels**, and that is a correction rather
    // than a detail. `Monitor.getWorkArea()` hands back the raw Win32 rectangle
    // while `Window.getBounds()` divides by that monitor's scale factor - read in
    // node-window-manager's own source, not assumed - so comparing the two
    // directly is wrong on any scaled display and wrong in a way that only shows
    // on somebody else's machine.
    const monitors = windowManager
      .getMonitors()
      .map((monitor) => asCell(monitor.getWorkArea()))
      .filter((area) => area.width > 0 && area.height > 0)
    if (monitors.length === 0) return 0
    const target = this.panelArea()
    // A panel that is itself off-screen - minimized, most often - is no place to
    // move anything to. Better to leave the window where it is than to drag it
    // somewhere equally invisible, every tick.
    if (!target || isOffScreen(target, monitors)) return 0

    let moved = 0
    for (const window of windowManager.getWindows()) {
      if (window.processId !== pid) continue
      if (!window.isVisible() || !window.getTitle().trim()) continue
      // Once per window, for the life of this process. A window is rescued when
      // it is born out of view; a window the user then minimizes or drags off a
      // second monitor is theirs to place, and chasing it would be the app
      // rearranging somebody's desktop on a two-second clock.
      if (this.rescued.has(window.id)) continue
      const bounds = physicalBounds(window)
      if (!isOffScreen(bounds, monitors)) continue

      const { x, y } = centredOver(bounds, target)
      // Through the worker rather than `setBounds`, for two reasons: the library
      // would re-scale these coordinates by the scale factor of whichever monitor
      // the window is nearest, and a minimized window has to be left alone, which
      // only Win32 can answer (IsIconic).
      this.fire(`movetop ${window.id} ${x} ${y}`)
      this.rescued.add(window.id)
      moved++
    }
    return moved
  }

  /**
   * How many windows this browser has open beside its embedded screen.
   *
   * The same enumeration the rescue does, asking a different question: the
   * screen itself is a `WS_CHILD` after the embed and `getWindows` does not list
   * it, so every visible, titled top-level window of the process is one the page
   * opened - a provider login, in practice. Zero before the embed, because until
   * then the screen *is* one of those windows and would count itself.
   */
  extraWindows(pid: number): number {
    if (!this.embedded.has(pid)) return 0
    return this.extraWindowsOf(pid).length
  }

  /**
   * Closes them, and says how many were asked.
   *
   * `close <hwnd>` posts WM_CLOSE, the same graceful path the screen's own stop
   * uses: the browser gets to tear the window down itself. A kill would be the
   * wrong tool twice over - these windows share the process with the screen the
   * user is still using, so killing is not even available without taking the
   * game down with it.
   */
  closeExtraWindows(pid: number): number {
    if (!this.embedded.has(pid)) return 0
    const windows = this.extraWindowsOf(pid)
    for (const window of windows) {
      this.fire(`close ${window.id}`)
      // Forgotten as rescued: if the page opens another login window later, that
      // one is new and deserves the same rescue this one got.
      this.rescued.delete(window.id)
    }
    return windows.length
  }

  /**
   * The visible, titled top-level windows of a process, never the embedded screen.
   *
   * The screen is excluded **by handle** rather than by trusting that a
   * `WS_CHILD` window is absent from the enumeration. That is true of
   * `EnumWindows`, and the rescue above already leans on it, but the cost of
   * being wrong differs: there it would move a screen once, here it would put a
   * "close the login" button on every running card and leave it there.
   */
  private extraWindowsOf(pid: number): NativeWindow[] {
    const screen = this.embedded.get(pid)
    return windowManager
      .getWindows()
      .filter(
        (window) =>
          window.processId === pid &&
          window.id !== screen &&
          window.isVisible() &&
          window.getTitle().trim(),
      )
  }

  /** Windows already brought into view, so none is moved twice. */
  private readonly rescued = new Set<number>()

  /** The panel's own rectangle, when the shell gave this adapter a way to find it. */
  private panelArea(): GridCell | undefined {
    const parent = this.parentHwnd?.()
    if (parent === undefined) return undefined
    const panel = windowManager.getWindows().find((window) => window.id === parent)
    return panel ? physicalBounds(panel) : undefined
  }

  /** The native window handle. Diagnostics and tests only. */
  windowIdOf(pid: number): number | undefined {
    return this.hwndFor(pid)
  }

  /**
   * Hands keyboard focus to whichever embedded screen sits under a click in the
   * panel, at (x, y) in the panel's client area. Not a WindowManager port method —
   * the core does not drive focus; the shell calls this from the panel's
   * WM_PARENTNOTIFY hook, since a click on a child of another process does not move
   * keyboard focus on its own (finding 0.1). The worker hit-tests and focuses.
   */
  focusChildAt(parentHwnd: number, x: number, y: number): void {
    this.fire(`focusat ${parentHwnd} ${x} ${y}`)
  }

  /** Stops the persistent worker. Call on shutdown; the adapter is done after. */
  async dispose(): Promise<void> {
    // A pending reveal outliving the worker would fire into a dead pipe. The
    // timers are unref'd so they cannot hold the process open, but a shutdown
    // that leaves them armed is untidy in exactly the way `dispose` exists to fix.
    for (const pid of [...this.deferredShows.keys()]) this.cancelDeferredShow(pid)
    await this.worker.dispose()
  }
}

/**
 * node-window-manager's rectangle with every field present.
 *
 * Its `IRectangle` types x, y, width and height as optional, and a window that
 * answers with a missing field is one no geometry can be done about — treating
 * the gap as 0 keeps the arithmetic total, and such a window is off-screen by
 * every test that matters anyway.
 */
function asCell(rect: { x?: number; y?: number; width?: number; height?: number }): GridCell {
  return { x: rect.x ?? 0, y: rect.y ?? 0, width: rect.width ?? 0, height: rect.height ?? 0 }
}

/**
 * A window's rectangle in physical pixels, which is the space monitors are in.
 *
 * `getBounds` divides by the scale factor of the window's monitor, so this
 * multiplies it back. On a 100% display the two are the same number, which is
 * exactly why the mismatch was invisible here and would not have been on a
 * laptop at 150%.
 */
function physicalBounds(window: NativeWindow): GridCell {
  const scale = window.getMonitor().getScaleFactor() || 1
  const bounds = asCell(window.getBounds())
  return {
    x: Math.round(bounds.x * scale),
    y: Math.round(bounds.y * scale),
    width: Math.round(bounds.width * scale),
    height: Math.round(bounds.height * scale),
  }
}
