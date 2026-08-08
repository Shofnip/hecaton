/**
 * Removes the directories the core has cleared for deletion, and reports what
 * survived.
 *
 * A thin adapter on purpose: it holds no rule about *what* may be deleted, nor
 * about what a survivor means. Those decisions are `planUserDataDeletion` and
 * `verifyUserDataDeletion` in `@hecaton/core`, where the fast suite can hold
 * them. Nothing here decides anything, so there is no `if` encoding a policy for
 * CLAUDE.md to object to.
 *
 * Validation runs before the first removal, so a list containing one bad target
 * deletes nothing at all rather than half of what was asked.
 */
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { planUserDataDeletion, type UserDataTarget } from '@hecaton/core'

/** Chrome can hold handles briefly after exit; see docs/troubleshooting.md. */
const ATTEMPTS = 5
const RETRY_DELAY_MS = 300

/**
 * Deletes every approved target and returns the entries still present under
 * them afterwards — empty when everything went.
 *
 * **It reports rather than throws**, and that is the whole reason it returns
 * anything. The app cannot remove all of `%APPDATA%/hecaton` from inside itself:
 * Electron holds its own userData sub-directory open until the process exits, so
 * `rmSync` deletes config, logs and profiles and then raises `EPERM` on the one
 * directory it may not touch. Probe P4 measured that, twice. Throwing would
 * report a deletion that largely succeeded as a total failure.
 *
 * No information is lost by swallowing the error, which is what makes this safe:
 * anything genuinely left behind — a profile still held by a browser that was
 * running — appears in the returned list. `verifyUserDataDeletion` in the core is
 * what decides which survivors are acceptable.
 *
 * Synchronous deliberately: its caller quits the app immediately afterwards, and
 * the removal has to be finished by then. An async version would let the rest of
 * the process keep running — writing config, opening a log file — underneath a
 * directory being removed.
 */
export function deleteUserData(targets: readonly UserDataTarget[]): readonly string[] {
  const approved = planUserDataDeletion(targets)

  const remaining: string[] = []
  for (const path of approved) {
    try {
      // `force` makes an already-absent directory a success: deleting twice, or
      // deleting after the user removed the folder by hand, is not a failure.
      // `maxRetries` covers the EPERM race documented in troubleshooting.md.
      rmSync(path, {
        recursive: true,
        force: true,
        maxRetries: ATTEMPTS,
        retryDelay: RETRY_DELAY_MS,
      })
    } catch {
      // Deliberately empty: what survived is read back below, which says strictly
      // more than the error does.
    }
    if (existsSync(path)) remaining.push(...readdirSync(path))
  }
  return remaining
}
