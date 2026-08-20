/**
 * Sets a removed slot's profile aside, and clears what has been set aside.
 *
 * This is the one place the app touches a persistent profile's existence
 * *through the profile port*, and it is built to honour ADR-0005 rather than
 * reverse it. `archive` renames -
 * it never deletes a live profile - so a reset cannot destroy a logged-in
 * session by accident: the worst a bug here can do is move a directory that is
 * recoverable by renaming it back.
 *
 * `clearArchives` is the only path *here* that deletes a profile which ever held
 * a persistent session (the browser adapter's `discard` also deletes, but only
 * throwaway clean-session profiles under `%TEMP%`; and `data:deleteAll` removes
 * `%APPDATA%/hecaton` whole, live `slot-N` included, from outside this port
 * entirely - see ADR-0005's second Correction). It is guarded to touch
 * only directories that were archived (`slot-N.old-…`). A live `slot-N` is
 * never a candidate, whatever its name.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { ProfileArchive } from '@hecaton/core'

/** Marks an archived profile. A live profile never contains this. */
const ARCHIVE_MARKER = '.old-'

/**
 * The cache sub-directories cleared by clearCache, relative to a profile. These
 * are the only paths it ever removes: the session lives elsewhere in the
 * profile (Default/Cookies, Default/Login Data), so deleting exactly these frees
 * disk without logging anyone out. `GPUCache` sits at the profile root, the
 * other two under `Default`.
 */
const CACHE_DIRS = [join('Default', 'Cache'), join('Default', 'Code Cache'), 'GPUCache']

export class FileProfileArchive implements ProfileArchive {
  constructor(private readonly profilesRoot: string) {}

  async archive(profileDir: string): Promise<void> {
    const source = join(this.profilesRoot, profileDir)
    if (!existsSync(source)) return // Never launched, so nothing on disk to move.

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const target = join(this.profilesRoot, `${profileDir}${ARCHIVE_MARKER}${stamp}`)

    // Chrome can hold handles for a moment after it exits, so a rename right
    // after stop() may hit EPERM. Retry rather than fail, like discard does.
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        mkdirSync(this.profilesRoot, { recursive: true })
        renameSync(source, target)
        return
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }
  }

  async clearCache(profileDir: string): Promise<void> {
    // Only ever the cache sub-directories of this one profile, never the profile
    // itself and never a session file. A missing directory is fine - a slot that
    // never launched, or an already cache-free one, is a no-op, not an error.
    for (const dir of CACHE_DIRS) {
      const path = join(this.profilesRoot, profileDir, dir)
      if (!existsSync(path)) continue

      // Same EPERM retry as archive/clearArchives: Chrome may hold a handle for
      // a moment after it exits, and the orchestrator only clears stopped slots.
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          rmSync(path, { recursive: true, force: true })
          break
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
      }
    }
  }

  async clearArchives(): Promise<void> {
    if (!existsSync(this.profilesRoot)) return

    for (const name of readdirSync(this.profilesRoot)) {
      // The guard: only archives go. A live slot-N, however it is named, does
      // not carry the marker, so it can never be the target of this delete.
      if (!name.includes(ARCHIVE_MARKER)) continue

      const path = join(this.profilesRoot, name)
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          rmSync(path, { recursive: true, force: true })
          break
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
      }
    }
  }
}
