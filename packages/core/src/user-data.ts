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
 * The caller this function is waiting for is the in-app panel action, behind an
 * explicit confirmation, on an enumerated IPC channel. It passes no path: where to
 * delete comes from `@hecaton/storage`'s own path functions, the same reason
 * `logs:reveal` takes no argument (ADR-0007 decision 3).
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
