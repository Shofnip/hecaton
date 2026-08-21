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
import type { InstanceLockState, MachineFacts } from './instance-claim.js'

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
  /**
   * When false (the default), the adapter passes the flags that stop Chrome from
   * throttling a hidden window, so the farm keeps running in the background.
   * When true, the flags are omitted and Chrome throttles the screen to save
   * resources. Applies on the screen's next launch, like --mute-audio.
   */
  backgroundThrottling: boolean
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
  /**
   * Embeds the browser window into the app's panel (Win32 SetParent), so it
   * becomes one of the video-wall cells instead of a free desktop window. False
   * when the window is not found yet. Idempotent: re-parenting an already-child
   * window is a no-op, so the core may call it whenever it places a slot.
   */
  reparent(pid: number): boolean
  /**
   * Hides an embedded window (SW_HIDE) — fullscreen, a stopped screen, or a
   * panel-drawn modal that actually covers it. **Not focus mode:** a running,
   * non-focused screen keeps its bounds and stays live in its thumbnail, which is
   * the point of the video wall.
   */
  hide(pid: number): boolean
  /** Shows a hidden embedded window again (SW_SHOW). */
  show(pid: number): boolean
  /**
   * Reloads the page in place, keeping the login: the WM_APPCOMMAND browser
   * refresh, the one recovery that preserves the tab-bound session (ADR-0009).
   * False when the window is not found yet.
   */
  reload(pid: number): boolean
  /**
   * Asks the embedded window to close gracefully — posts WM_CLOSE to it, the way
   * clicking its X does, so Chrome flushes its session and exits clean. False when
   * the window is not found. It is the launcher that owns ending the process (and
   * force-kills as a fallback); this just makes the graceful path work, because
   * CloseMainWindow cannot reach a reparented child, so without it that path always
   * times out and the browser lingers seconds before the force-kill.
   */
  close(pid: number): boolean
}

/**
 * Per-process audio mute, so the core can make exactly one slot audible.
 *
 * Keyed by the slot's main pid — the same pid every other port speaks. On
 * Windows a slot's audio actually lives in a child "audio service" process, but
 * mapping the main pid to it is an OS detail the adapter owns; the core must
 * never learn it, exactly as it never learns a window handle.
 */
export interface AudioController {
  /**
   * Mutes or unmutes the browser with this main pid. A no-op when that process
   * has no audio session yet (nothing has played), so the core can call it
   * freely without first checking whether a session exists.
   */
  setMuted(pid: number, muted: boolean): Promise<void>
  /**
   * Sets the browser's output volume, 0-100, via the same WASAPI session the
   * mute drives (`ISimpleAudioVolume.SetMasterVolume`). Independent of the mute
   * flag: a muted session keeps its volume, so unmuting restores it. A no-op
   * when the process has no audio session yet, exactly like setMuted.
   */
  setVolume(pid: number, volume: number): Promise<void>
}

export interface Storage<T> {
  load(): Promise<T | undefined>
  save(value: T): Promise<void>
}

/**
 * Setting a removed slot's profile aside, and clearing what was set aside.
 *
 * `archive` renames the profile rather than deleting it — the shape ADR-0005
 * settled on for a reset: the slot starts fresh and the old session is
 * recoverable. Deletion through *this port* happens only in `clearArchives`, and
 * only over profiles already archived, never a live one.
 *
 * This used to say "no code path in the app deletes a live profile", full stop.
 * That stopped being true on 2026-08-08, when `data:deleteAll` gave the panel a
 * confirmed "delete all my data" action — a portable zip has no uninstaller to
 * ask the question in. That path does not go through this port; see ADR-0005's
 * second Correction.
 */
export interface ProfileArchive {
  /** Renames `profileDir` aside. A no-op if the slot never had a profile on disk. */
  archive(profileDir: string): Promise<void>
  /**
   * Permanently removes every archived profile. The only path *here* that deletes
   * a profile which ever held a persistent session — the browser adapter also
   * deletes throwaway clean-session profiles on stop, but never a persistent one,
   * and `data:deleteAll` removes the whole data directory from outside this port.
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

/**
 * What the machine says about itself, read once at start-up.
 *
 * The port hands back the raw WMI answers rather than a verdict, so every
 * judgement about them - which fields are placeholders, which manufacturer
 * strings mean a hypervisor - stays in `instance-claim.ts` where the fast suite
 * can reach it. An adapter that returned `isVirtual: boolean` would be holding
 * the business rule.
 */
export interface MachineIdentity {
  /** Empty strings for anything the machine would not answer; never throws. */
  read(): Promise<MachineFacts>
  /**
   * One-way digest of a canonical identity, for the form that goes on disk.
   *
   * Here rather than in the core because hashing is `node:crypto`, and here
   * rather than nowhere because the seal lives in a machine-wide directory that
   * every account on the machine can read: the raw SMBIOS uuid and board serial
   * must not be sitting in it. The digest is not a secret - the source is public,
   * so anyone can recompute their own - it just stops the file from disclosing
   * hardware identifiers to whoever opens it.
   *
   * Must be stable across runs and across app versions. Changing it re-seals
   * nothing and refuses every machine that already carries a seal.
   */
  digest(canonicalId: string): string
}

/**
 * The live "one Hecaton on this machine" lock.
 *
 * Held for the whole life of the process and dropped when it exits, however it
 * exits - which is why the adapter is a named `Global\` mutex rather than a
 * file: a killed process leaves no orphan to clean up, and there is no stale
 * lock to teach the app to ignore. Measured in probes P6 and P6b.
 *
 * `claim` distinguishes the two ways it can already be taken because they need
 * different words on the blocked window: the same Windows account is the user's
 * own second copy, another account is somebody else's session they cannot see.
 */
export interface InstanceLock {
  claim(): Promise<InstanceLockState>
  /** Releases a claim. A no-op when this process never held it. */
  release(): Promise<void>
}
