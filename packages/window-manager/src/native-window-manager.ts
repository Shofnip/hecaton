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
 * Commands are driven fire-and-forget: a call resolves the window's handle
 * synchronously (returning false when there is none yet) and queues the Win32
 * op without waiting. The worker's queue is FIFO, so a reparent is always
 * carried out before the moves that follow it. The focus-triggered desktop snapshot is
 * the exception: it is asynchronous because its native enumeration runs in a
 * dedicated helper process rather than inside Electron.
 *
 * Holds no business rules. Where each window goes, and when it is embedded,
 * hidden or reloaded, is the core's decision; the invisible-border arithmetic
 * and the SetParent timing are Windows details it keeps to itself.
 */
import { createRequire } from 'node:module'
import { centredOver, isOffScreen } from '@hecaton/core'
import type {
  GridCell,
  WindowManager,
  WindowPlacement,
  WindowSweep,
  ZoomController,
} from '@hecaton/core'
import { measureInsets } from './dwm-insets.js'
import type { Insets } from './dwm-insets.js'
import { DesktopSnapshotReader } from './desktop-snapshot-reader.js'
import type { DesktopSnapshot } from './desktop-snapshot.js'
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

/**
 * Quiet period before re-applying the newest embedded layout once.
 *
 * `SWP_ASYNCWINDOWPOS` returns before Chrome applies the resize, while the clip
 * region beside it is applied synchronously. A second pass after the posted
 * resize has landed re-reads the real frame and brings both back into step. It
 * is debounced so a live divider drag gets one correction when it stops rather
 * than one extra native command per animation frame.
 */
const LAYOUT_SETTLE_MS = 100

/**
 * How long after a zoom command Chrome's own bubble is worth watching for, and
 * how often to look.
 *
 * Both are measurements, from the disposable probe in `spike/bubble` on
 * 2026-09-21 against the bundled Chromium: the bubble became visible 97 ms
 * after the first command of a session and 15-16 ms after later ones, and it
 * dismisses itself only after ~1.3 s. So the window has to open before the
 * first sighting and close before the browser would have tidied up anyway -
 * anything longer is sweeping for something that is no longer there.
 *
 * The cadence is a cost as much as a resolution: one sweep enumerates every
 * window on the desktop, measured at ~7 ms. One timer serves every screen, so
 * the cost is this cadence and not this cadence times the size of the wall.
 */
const BUBBLE_WATCH_MS = 900
const BUBBLE_SWEEP_MS = 40

export class NativeWindowManager implements WindowManager, ZoomController {
  private readonly worker = new Win32Worker()
  private desktop: DesktopSnapshotReader | undefined
  private disposed = false
  private readonly zoomReadyAt = new Map<number, number>()
  /** Cancels commands still waiting for a document when its window changes state. */
  private readonly pendingZoom = new Map<number, symbol>()

  /** Until when each screen's zoom bubble is being swept away. See `suppressZoomBubble`. */
  private readonly bubbleDeadlines = new Map<number, number>()
  private bubbleSweep: NodeJS.Timeout | undefined

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

  /**
   * Polls still waiting for a browser window, one cancelable operation per pid.
   *
   * The object identity is a generation token as well as a timer holder: a
   * callback that was already queued when `forget` ran can prove it belongs to
   * an obsolete poll before it touches a window. Merely deleting a pid from a
   * Set is not enough, because the old callback would otherwise recurse and add
   * it straight back.
   */
  private readonly pendingEmbeds = new Map<number, { timer?: NodeJS.Timeout }>()

  /** When each freshly embedded pid may be revealed. See `embed`. */
  private readonly repaintDeadline = new Map<number, number>()

  /** Reveals the core asked for early, waiting out the repaint. One per pid. */
  private readonly deferredShows = new Map<number, NodeJS.Timeout>()

  /**
   * Screens the core asked to reveal **before** they were embedded.
   *
   * The core asks once: it calls `show` when a screen's wanted visibility
   * changes and never again while it stays the same. So a reveal that arrives
   * during the gap between `reparent` and the poll that embeds is the only one
   * there will ever be, and honouring it on the window as it stands - still
   * top-level, still off-screen - spends it on nothing, because `embed` hides
   * the window a moment later to reparent it. That left screens black for good
   * (owner, 2026-09-21), and it is why the bug needed every screen started at
   * once on a cold launch: only then is the window slow enough to lose the race.
   *
   * Recorded here instead, and honoured by `embed`.
   */
  private readonly revealAfterEmbed = new Set<number>()

  /**
   * The same one-shot problem, for where a screen goes rather than whether it
   * shows.
   *
   * The core sends a screen's rectangle only when it differs from the one it
   * believes that screen already has, so a frame that arrives before the embed
   * is the only one that rectangle will get. Spent on the window as it stands,
   * it is worse than wasted: the window is still **top-level**, so the cell's
   * client coordinates are applied as desktop ones, and `SetParent` then
   * translates whatever that produced into the panel. The owner's four screens
   * on 2026-09-21 came up three small and in the wrong corners and one still at
   * the launch offset, invisible - one bug wearing two faces.
   */
  private readonly placeAfterEmbed = new Map<number, GridCell>()

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
   *   the panel's client area, and the child is moved there with `SetWindowPos`,
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
    // An embed is on its way: keep the rectangle for it. Narrowed to a pending
    // embed for the reason `show` is - a manager with no panel, and a pid this
    // adapter knows nothing about, must behave exactly as they always have.
    if (!this.embedded.has(pid) && this.pendingEmbeds.has(pid)) {
      this.placeAfterEmbed.set(pid, bounds)
      return true
    }
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
   * - **The newest delta per screen wins.** A divider drag emits about 60 frames a second
   *   and Win32 serves 15 to 25 of them. Sending all of them does not make the
   *   screens keep up — it makes them fall behind, because the worker is still
   *   working through positions the divider has already passed: 2.2 s of
   *   backlog after the pointer stopped. Holding only the latest frame while one
   *   is in flight brought that to 84 ms, and applied *more* frames (39 of 60
   *   against 22), because none of the worker's time went to superseded ones.
   *
   * Core calls are deltas against what it last emitted, not complete frames. A
   * newer queued delta therefore replaces only the screens it names and retains
   * every other screen's newest unsent rectangle (ADR-0034).
   *
   * A pid that is not embedded yet falls back to the top-level move — the same
   * thing `setBounds` does, for a window the launcher has resolved but the embed
   * has not caught up with.
   */
  setLayout(placements: WindowPlacement[]): void {
    const parts = new Map<number, string>()
    for (const { pid, bounds } of placements) {
      const hwnd = this.embedded.get(pid)
      if (hwnd === undefined) {
        this.setBounds(pid, bounds)
        continue
      }
      parts.set(pid, `${hwnd},${bounds.x},${bounds.y},${bounds.width},${bounds.height}`)
    }
    if (parts.size === 0) return
    this.queueLayout(parts)
  }

  /** Whether a layout command is still waiting on its reply. */
  private layoutInFlight = false
  /** Latest unsent delta for each screen while another layout command is in flight. */
  private queuedLayout: Map<number, string> | undefined
  /** Newest placement per screen, re-applied once after layout activity stops. */
  private readonly layoutToSettle = new Map<number, string>()
  private layoutSettleTimer: NodeJS.Timeout | undefined

  /**
   * How many layout commands the worker was actually given. Diagnostics and
   * tests only — it is what makes "the superseded frames were never sent"
   * observable from outside.
   */
  layoutCommandsSent = 0

  /** How many child clipping regions the worker actually replaced. Diagnostics and tests only. */
  layoutRegionsApplied = 0

  private queueLayout(parts: Map<number, string>): void {
    for (const [pid, part] of parts) this.layoutToSettle.set(pid, part)
    this.scheduleLayoutSettle()
    this.sendLayout(parts)
  }

  /** Debounces the one corrective pass that follows an asynchronous resize. */
  private scheduleLayoutSettle(): void {
    if (this.layoutSettleTimer !== undefined) clearTimeout(this.layoutSettleTimer)
    this.layoutSettleTimer = setTimeout(() => {
      this.layoutSettleTimer = undefined
      if (this.disposed || this.layoutToSettle.size === 0) return
      const settled = new Map(this.layoutToSettle)
      this.layoutToSettle.clear()
      this.layoutCommandsSent++
      const command = `settlechildren ${[...settled.values()].join(';')}`
      // Chrome has now applied the first posted resize. The worker re-reads the
      // settled frame, flushes the exact final clip after the live 20 Hz cap,
      // and posts the same outer rectangle again.
      void this.worker
        .send(command)
        .then((reply) => this.recordLayoutRegions(reply))
        .catch(() => {
          // Best effort, for the same worker-restart reason as `sendLayout`.
        })
    }, LAYOUT_SETTLE_MS)
    this.layoutSettleTimer.unref?.()
  }

  private sendLayout(parts: Map<number, string>): void {
    if (this.layoutInFlight) {
      const queued = this.queuedLayout ?? new Map<number, string>()
      for (const [pid, part] of parts) queued.set(pid, part)
      this.queuedLayout = queued
      return
    }
    this.layoutInFlight = true
    this.layoutCommandsSent++
    const command = `movechildren ${[...parts.values()].join(';')}`
    void this.worker
      .send(command)
      .then((reply) => this.recordLayoutRegions(reply))
      .catch(() => {
        // Best effort, as everywhere else here: a worker that just died re-spawns
        // on the next frame, and the next frame is at most one drag tick away.
      })
      .finally(() => {
        this.layoutInFlight = false
        const next = this.queuedLayout
        this.queuedLayout = undefined
        if (next !== undefined) this.sendLayout(next)
      })
  }

  private recordLayoutRegions(reply: string): void {
    const count = Number(reply)
    if (Number.isInteger(count) && count >= 0) this.layoutRegionsApplied += count
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
    if (this.disposed) return false
    if (this.embedded.has(pid)) return true
    const parent = this.parentHwnd?.()
    if (parent === undefined) return false
    const hwnd = this.windowFor(pid)?.id
    if (hwnd !== undefined) return this.embed(pid, hwnd, parent)
    if (!this.pendingEmbeds.has(pid)) {
      const pending: { timer?: NodeJS.Timeout } = {}
      this.pendingEmbeds.set(pid, pending)
      this.pollEmbed(pid, 0, pending)
    }
    return false
  }

  /**
   * Lets go of a pid whose browser is gone. See the port for why this exists.
   *
   * Everything here is keyed by pid, and a pid is only on loan: Windows hands
   * ids back out, most eagerly right after a burst of exits - which is what
   * "stop every screen, start them all again" is. Without this, the next
   * browser to be given a recycled id inherited a dead window handle and, worse,
   * a `reparent` that answered "already done", so it was never embedded at all
   * and stayed off-screen where it was born (owner, 2026-09-21).
   *
   * `rescued` is deliberately not cleared: it is keyed by **window** handle, not
   * by pid, and those handles belong to windows the browser opened for itself.
   */
  forget(pid: number): void {
    this.cancelDeferredShow(pid)
    this.embedded.delete(pid)
    this.cancelPendingEmbed(pid)
    this.zoomReadyAt.delete(pid)
    this.pendingZoom.delete(pid)
    this.revealAfterEmbed.delete(pid)
    this.placeAfterEmbed.delete(pid)
    this.bubbleDeadlines.delete(pid)
    this.layoutToSettle.delete(pid)
    this.queuedLayout?.delete(pid)
  }

  /** SetParent the child into the panel and remember its handle. */
  private embed(pid: number, hwnd: number, parent: number): boolean {
    this.cancelPendingEmbed(pid)
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
    this.zoomReadyAt.set(pid, Date.now() + REPAINT_SETTLE_MS)
    // What the core asked for while this window was still on its way: where it
    // goes, then whether it shows. Placing first so that the reveal - which
    // `show` defers until the repaint settles - uncovers a screen already in
    // its cell rather than one that jumps into place afterwards.
    const cell = this.placeAfterEmbed.get(pid)
    if (cell !== undefined) {
      this.placeAfterEmbed.delete(pid)
      this.setLayout([{ pid, bounds: cell }])
    }
    if (this.revealAfterEmbed.delete(pid)) this.show(pid)
    return true
  }

  /** Keeps trying to embed a slot whose window has not appeared yet. */
  private pollEmbed(pid: number, attempt: number, pending: { timer?: NodeJS.Timeout }): void {
    const timer = setTimeout(() => {
      // `forget`, `dispose`, or a newer explicit reparent may have cancelled
      // this generation while its callback was waiting in the event queue.
      if (this.disposed || this.pendingEmbeds.get(pid) !== pending) return
      if (this.embedded.has(pid)) {
        this.pendingEmbeds.delete(pid)
        return
      }
      const parent = this.parentHwnd?.()
      const hwnd = this.windowFor(pid)?.id
      if (parent !== undefined && hwnd !== undefined) {
        this.embed(pid, hwnd, parent)
        return
      }
      if (attempt + 1 >= EMBED_MAX_ATTEMPTS) {
        this.pendingEmbeds.delete(pid)
        return
      }
      this.pollEmbed(pid, attempt + 1, pending)
    }, EMBED_RETRY_MS)
    // Never let a pending embed hold the process open (matters for tests and a
    // clean shutdown); a real app keeps running for its own reasons.
    timer.unref?.()
    pending.timer = timer
  }

  /** Cancels both the next retry and every queued callback from its generation. */
  private cancelPendingEmbed(pid: number): void {
    const pending = this.pendingEmbeds.get(pid)
    if (pending?.timer !== undefined) clearTimeout(pending.timer)
    this.pendingEmbeds.delete(pid)
  }

  /**
   * Hides an embedded window (SW_HIDE) — fullscreen, a stopped screen, or under a
   * panel-drawn modal that actually covers it. Not focus mode: the other screens
   * stay live in their thumbnails.
   */
  hide(pid: number): boolean {
    this.pendingZoom.delete(pid)
    // A reveal that has not happened yet is cancelled by a hide, exactly as a
    // deferred one is below.
    this.revealAfterEmbed.delete(pid)
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
    // An embed is on its way for this screen: remember the reveal rather than
    // spending it on a window that is about to be reparented and hidden. True
    // because the intent is recorded and will be honoured - the core reads this
    // as "it is visible", and it will be.
    //
    // Narrowed to a *pending* embed on purpose. A pid this adapter knows
    // nothing about still answers false, which is the contract the orchestrator
    // relies on while a browser is starting; and a manager with no panel to
    // embed into keeps showing plain top-level windows, which is what the
    // non-embedding cases do.
    if (!this.embedded.has(pid) && this.pendingEmbeds.has(pid)) {
      this.revealAfterEmbed.add(pid)
      return true
    }
    const hwnd = this.hwndFor(pid)
    if (hwnd === undefined) return false

    const repaintAt = this.repaintDeadline.get(pid)
    if (repaintAt === undefined) {
      this.fire(`show ${hwnd} ${SW_SHOW}`)
      return true
    }
    const remaining = repaintAt - Date.now()
    if (remaining <= 0) {
      this.repaintDeadline.delete(pid)
      this.fire(`show ${hwnd} ${SW_SHOW}`)
      return true
    }
    if (this.deferredShows.has(pid)) return true
    const timer = setTimeout(() => {
      this.deferredShows.delete(pid)
      this.repaintDeadline.delete(pid)
      const current = this.hwndFor(pid)
      if (current !== undefined) this.fire(`show ${current} ${SW_SHOW}`)
    }, remaining)
    // Never hold the process open on a screen that is merely late.
    timer.unref?.()
    this.deferredShows.set(pid, timer)
    return true
  }

  /**
   * Reloads the page in place via WM_APPCOMMAND — the one recovery that keeps the
   * tab-bound login (ADR-0009). False when the window is not found yet.
   */
  reload(pid: number): boolean {
    this.pendingZoom.delete(pid)
    const hwnd = this.hwndFor(pid)
    if (hwnd === undefined) return false
    this.fire(`reload ${hwnd}`)
    this.zoomReadyAt.set(pid, Date.now() + REPAINT_SETTLE_MS)
    return true
  }

  /**
   * The core supplies signed preset steps relative to the profile default.
   * Native commands leave the cursor, focus and title-strip geometry alone.
   * Wait out the embed/reload repaint so a command is not lost with the old
   * document. A posted command is accepted, not a percentage readback.
   */
  async applyZoom(pid: number, steps: number): Promise<boolean> {
    if (this.disposed || !Number.isInteger(steps) || Math.abs(steps) > 16) return false
    const hwnd = this.embedded.get(pid)
    if (hwnd === undefined) return false
    const operation = Symbol()
    this.pendingZoom.set(pid, operation)
    const remaining = (this.zoomReadyAt.get(pid) ?? 0) - Date.now()
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
    if (this.disposed || this.embedded.get(pid) !== hwnd || this.pendingZoom.get(pid) !== operation)
      return false
    try {
      await this.worker.send(`zoom ${hwnd} ${pid} ${steps}`)
      // Chrome answers a zoom command with a bubble. Start watching for it the
      // moment the command is away, not when it was asked for: this call may
      // have waited out a repaint first.
      this.suppressZoomBubble(pid)
      return true
    } catch {
      return false
    } finally {
      if (this.pendingZoom.get(pid) === operation) this.pendingZoom.delete(pid)
    }
  }

  /**
   * Hides the bubble Chrome shows itself whenever the zoom changes.
   *
   * The app changes zoom by posting Chrome's own menu commands, and Chrome
   * answers the way it would answer a user: with a 294x64 bubble over the top
   * right of the card, for about a second and a third. On a video wall that is
   * one bubble per screen every time focus or fullscreen moves, which is what
   * the owner asked to be rid of (ADR-0031).
   *
   * **What it hides, and why that is narrow.** A visible top-level window of
   * that screen's browser whose title is blank - the mirror image of the rule
   * `extraWindowsOf` already uses, and measured in `spike/bubble`: every other
   * untitled window the browser process owns (its status tray, its power
   * message window, the IME windows, the hidden `Chrome_WidgetWin_0`) was
   * invisible, and the titled one is the save-password bubble, which waits for
   * an answer and must be left alone. The embedded screen is excluded by handle
   * rather than by trusting that a `WS_CHILD` is absent from the enumeration.
   *
   * **Why it is a bounded sweep and not a watch.** The handle is a different
   * one each time - the probe saw three - so there is nothing to remember, and
   * a permanent watch would be an app that hides browser windows at all times
   * rather than for the instant after a command it sent. The window closes
   * `BUBBLE_WATCH_MS` after the last command; anything the browser opens
   * outside it is the user's.
   *
   * Hiding it does not undo the zoom: the command has already been handled by
   * the time the bubble appears, and the integration test reads the resulting
   * zoom back off the page.
   */
  private suppressZoomBubble(pid: number): void {
    this.bubbleDeadlines.set(pid, Date.now() + BUBBLE_WATCH_MS)
    if (this.bubbleSweep !== undefined) return
    // One timer for the whole wall: six screens leaving fullscreen together
    // should cost one enumeration per tick, not six.
    const timer = setInterval(() => {
      const now = Date.now()
      for (const [each, deadline] of [...this.bubbleDeadlines]) {
        if (deadline <= now || !this.embedded.has(each)) this.bubbleDeadlines.delete(each)
      }
      if (this.bubbleDeadlines.size === 0 || this.disposed) {
        clearInterval(timer)
        if (this.bubbleSweep === timer) this.bubbleSweep = undefined
        return
      }
      for (const window of windowManager.getWindows()) {
        const screen = this.embedded.get(window.processId)
        if (screen === undefined || !this.bubbleDeadlines.has(window.processId)) continue
        if (window.id === screen || !window.isVisible() || window.getTitle().trim()) continue
        this.fire(`show ${window.id} ${SW_HIDE}`)
      }
    }, BUBBLE_SWEEP_MS)
    timer.unref?.()
    this.bubbleSweep = timer
  }

  /**
   * Posts WM_CLOSE to the embedded window so Chrome closes gracefully. Needed
   * because reparenting made the window a child, which the launcher's
   * CloseMainWindow can no longer reach — without this, stopping a screen waited
   * out the launcher's grace period before force-killing. False when not found.
   */
  close(pid: number): boolean {
    this.pendingZoom.delete(pid)
    this.revealAfterEmbed.delete(pid)
    this.placeAfterEmbed.delete(pid)
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

  /** How many desktop snapshots the batched sweep took. Diagnostics and tests only. */
  desktopEnumerations = 0

  /**
   * Rescues and counts extra windows for every live screen from one desktop snapshot.
   *
   * `getWindows()` is synchronous. Calling it separately for rescue, panel bounds and
   * counting made a four-screen liveness tick block the main thread for 100 ms median
   * every two seconds. Batching reduced that to 9-13 ms, but keeping the addon in
   * Electron's process still produced a visible pause. A persistent helper now uses
   * Win32 directly and returns only the requested processes' windows. The shell calls
   * it only on focus transitions, never on its periodic liveness tick.
   */
  async sweepExtraWindows(pids: readonly number[]): Promise<readonly WindowSweep[]> {
    const empty = (): readonly WindowSweep[] =>
      pids.map((pid) => ({ pid, moved: 0, extraWindows: 0 }))
    if (this.disposed) return empty()
    const embeddedPids = pids.filter((pid) => this.embedded.has(pid))
    if (embeddedPids.length === 0) return empty()

    this.desktopEnumerations++
    this.desktop ??= new DesktopSnapshotReader()
    const parent = this.parentHwnd?.()
    let snapshot: DesktopSnapshot
    try {
      snapshot = await this.desktop.read(
        parent === undefined
          ? { processIds: embeddedPids }
          : { processIds: embeddedPids, panelHwnd: parent },
      )
    } catch (error) {
      if (this.disposed) return empty()
      throw error
    }
    if (this.disposed) return empty()
    const { windows, monitors: allMonitors } = snapshot
    const monitors = allMonitors.filter((area) => area.width > 0 && area.height > 0)
    const target =
      parent === undefined ? undefined : windows.find((window) => window.id === parent)?.bounds
    const canRescue = target !== undefined && !isOffScreen(target, monitors)

    return pids.map((pid) => {
      if (!this.embedded.has(pid)) return { pid, moved: 0, extraWindows: 0 }
      const screen = this.embedded.get(pid)
      const extra = windows.filter(
        (window) =>
          window.processId === pid && window.id !== screen && window.visible && window.titled,
      )
      let moved = 0
      if (canRescue) {
        for (const window of extra) {
          // Once per window, for the life of this process. A window the user
          // subsequently moves is theirs to place and is never chased.
          if (this.rescued.has(window.id)) continue
          const bounds = window.bounds
          if (!isOffScreen(bounds, monitors)) continue
          const { x, y } = centredOver(bounds, target)
          this.fire(`movetop ${window.id} ${x} ${y}`)
          this.rescued.add(window.id)
          moved++
        }
      }
      return { pid, moved, extraWindows: extra.length }
    })
  }

  /** Single-screen diagnostic used by the focused integration coverage. */
  async revealDetachedWindows(pid: number): Promise<number> {
    return (await this.sweepExtraWindows([pid]))[0]?.moved ?? 0
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
  async extraWindows(pid: number): Promise<number> {
    return (await this.sweepExtraWindows([pid]))[0]?.extraWindows ?? 0
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
  private extraWindowsOf(pid: number, windows = windowManager.getWindows()): NativeWindow[] {
    const screen = this.embedded.get(pid)
    return windows.filter(
      (window) =>
        window.processId === pid &&
        window.id !== screen &&
        window.isVisible() &&
        window.getTitle().trim(),
    )
  }

  /** Windows already brought into view, so none is moved twice. */
  private readonly rescued = new Set<number>()

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

  /**
   * Panel reactivation can raise Electron's input HWND over the games while
   * geometry stays unchanged. Repair native sibling order independently of the
   * core's placement cache. The worker validates PID/parent and skips hidden
   * children; it changes neither focus, geometry nor visibility (ADR-0029).
   */
  restoreEmbeddedZOrder(): void {
    if (this.disposed) return
    const parent = this.parentHwnd?.()
    if (parent === undefined) return
    for (const [pid, hwnd] of this.embedded) {
      this.fire(`restack ${hwnd} ${pid} ${parent}`)
    }
  }

  /** Stops the persistent worker. Call on shutdown; the adapter is done after. */
  async dispose(): Promise<void> {
    this.disposed = true
    for (const pid of [...this.pendingEmbeds.keys()]) this.cancelPendingEmbed(pid)
    this.zoomReadyAt.clear()
    this.pendingZoom.clear()
    // A pending reveal outliving the worker would fire into a dead pipe. The
    // timers are unref'd so they cannot hold the process open, but a shutdown
    // that leaves them armed is untidy in exactly the way `dispose` exists to fix.
    for (const pid of [...this.deferredShows.keys()]) this.cancelDeferredShow(pid)
    // Same reasoning for the bubble sweep: it enumerates the whole desktop on a
    // timer, and nothing it finds after shutdown is this app's to hide.
    this.revealAfterEmbed.clear()
    this.placeAfterEmbed.clear()
    this.layoutToSettle.clear()
    if (this.layoutSettleTimer !== undefined) clearTimeout(this.layoutSettleTimer)
    this.layoutSettleTimer = undefined
    this.bubbleDeadlines.clear()
    if (this.bubbleSweep !== undefined) clearInterval(this.bubbleSweep)
    this.bubbleSweep = undefined
    await this.desktop?.dispose()
    await this.worker.dispose()
  }
}
