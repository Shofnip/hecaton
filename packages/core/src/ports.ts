/**
 * Ports: the narrow interfaces between the core and the outside world.
 *
 * Everything the orchestrator needs from a browser, a window server or a disk
 * is declared here, and nowhere else. Adapters implement these; fakes implement
 * them for tests. This narrowness is what let the Playwright→spawn switch land
 * without the core noticing, so resist widening it.
 *
 * Adapters hold no business rules. If an `if` encoding a decision appears in
 * one, that decision belongs in the core.
 */
import type { GridCell } from './grid.js'

export interface LaunchRequest {
  slotId: number
  url: string
  /**
   * Directory *name*, not a path. The core never builds absolute paths — the
   * adapter resolves this under the app's data directory.
   */
  profileDir: string
  bounds: GridCell
  /** Passed as --mute-audio. A fallback for games with no audio control of their own. */
  mute: boolean
  /** When false the adapter discards the profile on stop, giving a clean session. */
  persistProfile: boolean
}

export interface BrowserLauncher {
  /** Resolves to the pid of the real browser process, not of a launcher stub. */
  launch(request: LaunchRequest): Promise<number>
  stop(pid: number): Promise<void>
  /** Cheap enough to call on a timer — must not shell out to WMI. */
  isAlive(pid: number): boolean
}

export interface WindowManager {
  /** False when the window is not found yet; the browser may still be starting. */
  setBounds(pid: number, bounds: GridCell): boolean
  focus(pid: number): boolean
}

export interface Storage<T> {
  load(): Promise<T | undefined>
  save(value: T): Promise<void>
}
