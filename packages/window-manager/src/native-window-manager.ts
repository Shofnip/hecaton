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

// node-window-manager is CommonJS with a native addon; createRequire loads it
// from an ES module without pulling in an interop shim.
const require = createRequire(import.meta.url)

interface NativeWindow {
  id: number
  processId: number
  isVisible(): boolean
  getTitle(): string
  getBounds(): { x?: number; y?: number; width?: number; height?: number }
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void
  bringToTop(): void
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

  setBounds(pid: number, bounds: GridCell): boolean {
    const window = this.windowFor(pid)
    if (!window) return false
    window.setBounds({ ...bounds })
    return true
  }

  focus(pid: number): boolean {
    const window = this.windowFor(pid)
    if (!window) return false
    window.bringToTop()
    return true
  }

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
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
  }
}
