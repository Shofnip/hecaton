/**
 * Window adapter, over node-window-manager plus a persistent Win32 worker.
 *
 * Needed because the browsers run in processes this app did not create:
 * --window-position only sets the initial state, so placing a slot in the grid,
 * embedding it into the panel, hiding it in focus mode, moving it as the panel
 * resizes or reloading it afterwards all mean driving a foreign window.
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
import type { GridCell, WindowManager } from '@helloweb/core'
import { measureInsets } from './dwm-insets.js'
import type { Insets } from './dwm-insets.js'
import { Win32Worker } from './win32-worker.js'

// node-window-manager is CommonJS with a native addon; createRequire loads it
// from an ES module without pulling in an interop shim.
const require = createRequire(import.meta.url)

interface NativeMonitor {
  id: number
  getWorkArea(): { x: number; y: number; width: number; height: number }
}

interface NativeWindow {
  id: number
  processId: number
  getMonitor(): NativeMonitor
  isVisible(): boolean
  getTitle(): string
  getBounds(): { x?: number; y?: number; width?: number; height?: number }
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void
}

interface NativeApi {
  getWindows(): NativeWindow[]
}

const { windowManager } = require('node-window-manager') as { windowManager: NativeApi }

/** How long, and how often, reparent keeps looking for a window still starting. */
const EMBED_RETRY_MS = 250
const EMBED_MAX_ATTEMPTS = 80 // ~20s, matching the launcher's own pid wait

/** ShowWindow commands. */
const SW_HIDE = 0
const SW_SHOW = 5

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
    const embeddedHwnd = this.embedded.get(pid)
    if (embeddedHwnd !== undefined) {
      this.fire(
        `movechild ${embeddedHwnd} ${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`,
      )
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
    this.embedded.set(pid, hwnd)
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

  /** Hides an embedded window (SW_HIDE) — focus mode, or under a panel modal. */
  hide(pid: number): boolean {
    const hwnd = this.hwndFor(pid)
    if (hwnd === undefined) return false
    this.fire(`show ${hwnd} ${SW_HIDE}`)
    return true
  }

  /** Shows a hidden embedded window again (SW_SHOW). */
  show(pid: number): boolean {
    const hwnd = this.hwndFor(pid)
    if (hwnd === undefined) return false
    this.fire(`show ${hwnd} ${SW_SHOW}`)
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
    await this.worker.dispose()
  }
}
