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

/**
 * Setting a removed slot's profile aside, and clearing what was set aside.
 *
 * `archive` renames the profile rather than deleting it — the shape ADR-0005
 * settled on for a reset: the slot starts fresh, the old session is recoverable,
 * and no code path in the app deletes a live profile. Deletion happens only in
 * `clearArchives`, and only over profiles already archived, never a live one.
 */
export interface ProfileArchive {
  /** Renames `profileDir` aside. A no-op if the slot never had a profile on disk. */
  archive(profileDir: string): Promise<void>
  /**
   * Permanently removes every archived profile. The only path that deletes a
   * profile which ever held a persistent session — the browser adapter also
   * deletes throwaway clean-session profiles on stop, but never a persistent
   * one.
   */
  clearArchives(): Promise<void>
  /**
   * Deletes only the cache sub-directories of a live profile, freeing disk
   * without logging anyone out — the session files (Cookies, Login Data) are
   * left untouched. The orchestrator only calls this for a stopped slot, since
   * Chrome holds its cache files open while running.
   */
  clearCache(profileDir: string): Promise<void>
}
