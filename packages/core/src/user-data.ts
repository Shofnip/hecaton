/**
 * The rule for "delete everything this app has written", and the guards that make
 * that safe to say out loud.
 *
 * This lives in the core, with no I/O, for the reason CLAUDE.md gives: the
 * dangerous part of a delete is not the `rm` but deciding *what* to delete, and
 * that decision belongs somewhere the fast suite can hold it. Probe P1 made the
 * point concrete — the alternative was writing this branch in NSIS, where nothing
 * tests it and where the copy that runs during an update is the previous release's
 * binary, so a wrong answer could never be repaired for anyone who had installed.
 *
 * **One location: `%APPDATA%/hecaton`** — config, logs, and the per-slot profiles,
 * which *are* the logged-in sessions. There were two while the app shipped as an
 * NSIS installer, the second being the installer copy left in `%LOCALAPPDATA%`; the
 * installer was dropped for a portable zip on 2026-08-08 and that copy no longer
 * exists to delete.
 *
 * The throwaway clean-session profiles under the OS temp directory are deliberately
 * out of scope: they are removed on `stop()` and only outlive a crash, and finding
 * them would mean deleting by filename pattern inside `%TEMP%`, where a pattern one
 * character too broad destroys a third party's files. So a truthful "where is my
 * data" text still names two places even though this function deletes one.
 *
 * Paths are validated as strings rather than with `node:path`, which the core may
 * not import. That is not a workaround: every rule below is about the *shape* a
 * path must have to be safe to remove, which is exactly a string property.
 */
import type { SlotState } from './slot-state.js'

/**
 * A directory the caller intends to delete, plus the name it must end with.
 *
 * The `leaf` is the allowlist. Without it, handing this function `%APPDATA%`
 * instead of `%APPDATA%/hecaton` would delete every application's roaming data,
 * and nothing in the call would look wrong. The caller has to state what it
 * believes the path is, and the path has to agree.
 */
export interface UserDataTarget {
  path: string
  leaf: string
}

/**
 * There is deliberately no command-line trigger here any more.
 *
 * A `--delete-user-data` flag existed so the NSIS uninstaller could ask the app to
 * delete everything when the user ticked its checkbox. Dropping the installer for a
 * portable zip took the checkbox with it and left the flag reachable with no
 * confirmation anywhere — a bare argument that removed every logged-in profile,
 * which is precisely what ADR-0005 means by "never by a flag". It was removed.
 *
 * The caller is the in-app panel action, behind an explicit confirmation, on the
 * enumerated `data:deleteAll` channel. It passes no path: where to delete comes
 * from `@hecaton/storage`'s own path functions, the same reason `logs:reveal`
 * takes no argument (ADR-0007 decision 3).
 */

/** Below this, a path is not inside a user profile and must not be removed. */
const MIN_SEGMENTS = 3

function segmentsOf(path: string): string[] {
  return path.split(/[/\\]+/).filter((segment) => segment !== '')
}

function isAbsolute(path: string): boolean {
  return /^[a-zA-Z]:[/\\]/.test(path) || path.startsWith('/') || path.startsWith('\\\\')
}

/** Normalised for comparison only — never returned, never used to delete. */
function comparable(path: string): string {
  return segmentsOf(path).join('/').toLowerCase()
}

export function planUserDataDeletion(targets: readonly UserDataTarget[]): string[] {
  if (targets.length === 0) {
    throw new Error('no targets to delete: refusing to report success for doing nothing')
  }

  for (const { path, leaf } of targets) {
    if (leaf === '') {
      throw new Error(`empty leaf declared for "${path}": the safety check would be vacuous`)
    }
    if (!isAbsolute(path)) {
      throw new Error(`"${path}" is not absolute; refusing to delete a relative path`)
    }

    const segments = segmentsOf(path)
    if (segments.length < MIN_SEGMENTS) {
      throw new Error(
        `"${path}" has depth ${segments.length}, below the minimum of ${MIN_SEGMENTS}: ` +
          'a path this shallow is not inside a user profile',
      )
    }

    const last = segments[segments.length - 1]
    if (last?.toLowerCase() !== leaf.toLowerCase()) {
      throw new Error(`"${path}" does not end in "${leaf}"; refusing to delete it`)
    }
  }

  const seen: string[] = []
  for (const { path } of targets) {
    const key = comparable(path)
    if (seen.includes(key)) {
      throw new Error(`"${path}" appears twice; a duplicate target hides a mistake`)
    }
    for (const other of seen) {
      if (key.startsWith(`${other}/`) || other.startsWith(`${key}/`)) {
        throw new Error(
          `"${path}" is nested inside another target; one of the two is not what the caller thinks`,
        )
      }
    }
    seen.push(key)
  }

  return targets.map((target) => target.path)
}

/**
 * Refuses the deletion unless every screen is stopped, so it is never attempted
 * underneath a browser.
 *
 * Chrome holds files open inside its profile: a removal attempted while a screen
 * runs deletes part of `%APPDATA%/hecaton` and then fails, which is the worst of
 * both outcomes — the user is told it did not work while their logins are
 * already gone. Measured, not assumed (probe P4).
 *
 * This is the safeguard; the panel greying the button out while a screen runs is
 * its UX echo, exactly as the remove confirmation is UX over the archiving that
 * actually protects the profile.
 *
 * Deliberately not `isLive`, which every other guard here uses. isLive answers
 * "is a browser process expected right now", and for a `crashed` slot the honest
 * answer is no. This asks something stricter, because auto-restart can put a
 * browser back between the check and the removal: nothing may be anything but
 * stopped. It is also what the panel promises the user in so many words.
 */
export function requireEveryScreenStopped(states: readonly SlotState[]): void {
  const open = states.filter((state) => state !== 'stopped').length
  if (open > 0) {
    throw new Error(`${open} screen(s) are still open; stop every screen before deleting your data`)
  }
}

/**
 * Judges what survived the removal: the deletion succeeded only if nothing but a
 * tolerated entry is left.
 *
 * The app cannot delete the whole of `%APPDATA%/hecaton` from inside itself.
 * Electron keeps its own userData directory (a sub-directory of it) open until
 * the process exits, so `rmSync` removes config, logs and profiles, then throws
 * `EPERM` on the one directory it may not touch. Probe P4 measured that twice,
 * including after the window was destroyed — it is a property of the shape, not
 * a race worth retrying.
 *
 * So the *error* is ignored and the *result* is checked instead. That is what
 * keeps the shrug honest: an entry the caller did not expect — a profile left
 * behind by a browser that was still running — is reported by name rather than
 * hidden under the same tolerance that covers Electron's own directory.
 *
 * Which entry is tolerated is a path fact and arrives from the caller; that only
 * a tolerated one may remain is the rule, and it lives here.
 */
export function verifyUserDataDeletion(
  remaining: readonly string[],
  tolerated: readonly string[],
): void {
  const allowed = tolerated.map((entry) => entry.toLowerCase())
  const unexpected = remaining.filter((entry) => !allowed.includes(entry.toLowerCase()))
  if (unexpected.length > 0) {
    throw new Error(`could not delete everything; these were left behind: ${unexpected.join(', ')}`)
  }
}
