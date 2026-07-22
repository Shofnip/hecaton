/**
 * Sets a removed slot's profile aside, and clears what has been set aside.
 *
 * This is the one place the app touches a persistent profile's existence, and
 * it is built to honour ADR-0005 rather than reverse it. `archive` renames -
 * it never deletes a live profile - so a reset cannot destroy a logged-in
 * session by accident: the worst a bug here can do is move a directory that is
 * recoverable by renaming it back.
 *
 * `clearArchives` is the only deletion in the app, and it is guarded to touch
 * only directories that were archived (`slot-N.old-…`). A live `slot-N` is
 * never a candidate, whatever its name.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { ProfileArchive } from '@helloweb/core'

/** Marks an archived profile. A live profile never contains this. */
const ARCHIVE_MARKER = '.old-'

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
