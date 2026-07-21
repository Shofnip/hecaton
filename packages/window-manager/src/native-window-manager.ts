/**
 * Window adapter, over node-window-manager.
 *
 * Needed because the browsers run in processes this app did not create:
 * --window-position only sets the initial state, so re-arranging the grid or
 * focusing a slot afterwards requires driving foreign windows.
 *
 * Holds no business rules. Where each window goes is computed by the core.
 */
import { createRequire } from 'node:module'
import type { GridCell, WindowManager } from '@helloweb/core'
import { measureInsets } from './dwm-insets.js'
import type { Insets } from './dwm-insets.js'

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
  bringToTop(): void
  restore(): void
  maximize(): void
}

interface NativeApi {
  getWindows(): NativeWindow[]
}

const { windowManager } = require('node-window-manager') as { windowManager: NativeApi }

export class NativeWindowManager implements WindowManager {
  /**
   * The visible, titled window belonging to a process.
   *
   * Matched by pid, never by title. During the Phase 0 spike a title filter
   * matched the user's own Chrome window - same game open - and moved it. In a
   * distributed app that would rearrange strangers' windows.
   */
  private windowFor(pid: number): NativeWindow | undefined {
    return windowManager
      .getWindows()
      .find((window) => window.processId === pid && window.isVisible() && window.getTitle().trim())
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
   * Whether the window fills its monitor's work area.
   *
   * node-window-manager exposes no isMaximized, so this compares rectangles.
   * The tolerance covers the invisible border, which makes a maximised window's
   * stored rect slightly larger than the work area.
   */
  private isMaximized(window: NativeWindow): boolean {
    const bounds = window.getBounds()
    const work = window.getMonitor().getWorkArea()
    if (bounds.width === undefined || bounds.height === undefined) return false
    const slack = 20
    return bounds.width >= work.width - slack && bounds.height >= work.height - slack
  }

  /**
   * Places a window by the rectangle the user sees.
   *
   * Two corrections the core must never learn about, because both are Windows
   * details rather than decisions:
   *
   * - the stored rect includes an invisible resize border, so it is inflated by
   *   the measured insets to make the painted rect land where the grid says;
   * - a maximised window accepts setBounds silently and keeps filling the
   *   screen, applying the move only when the user restores it by hand. That
   *   made "restore the grid" look like it did nothing at all.
   */
  setBounds(pid: number, bounds: GridCell): boolean {
    const window = this.windowFor(pid)
    if (!window) return false

    if (this.isMaximized(window)) window.restore()

    const insets = this.insetsFor(window)
    window.setBounds({
      x: bounds.x - insets.left,
      y: bounds.y - insets.top,
      width: bounds.width + insets.left + insets.right,
      height: bounds.height + insets.top + insets.bottom,
    })
    return true
  }

  focus(pid: number): boolean {
    const window = this.windowFor(pid)
    if (!window) return false
    window.bringToTop()
    return true
  }

  /** The rectangle the user sees — the same coordinates setBounds accepts. */
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
    return this.windowFor(pid)?.id
  }

  /** Maximises a window. Used by the integration suite to set up the state. */
  maximize(pid: number): boolean {
    const window = this.windowFor(pid)
    if (!window) return false
    window.maximize()
    return true
  }
}
