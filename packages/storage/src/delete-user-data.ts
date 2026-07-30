/**
 * Removes the directories the core has cleared for deletion.
 *
 * A thin adapter on purpose: it holds no rule about *what* may be deleted. That
 * decision is `planUserDataDeletion` in `@hecaton/core`, where the fast suite can
 * hold it — which is the point of D4b's shape. Nothing here decides anything, so
 * there is no `if` encoding a policy for CLAUDE.md to object to.
 *
 * Validation runs before the first removal, so a list containing one bad target
 * deletes nothing at all rather than half of what was asked.
 */
import { rmSync } from 'node:fs'
import { planUserDataDeletion, type UserDataTarget } from '@hecaton/core'

/** Chrome can hold handles briefly after exit; see docs/troubleshooting.md. */
const ATTEMPTS = 5
const RETRY_DELAY_MS = 300

/**
 * Synchronous deliberately. Its one caller is a headless one-shot run that exits
 * the moment this returns, and the deletion has to be finished by then: an async
 * version would let the rest of the main module keep initialising - opening a
 * window, taking the single-instance lock - underneath a directory being removed.
 */
export function deleteUserData(targets: readonly UserDataTarget[]): void {
  const approved = planUserDataDeletion(targets)

  for (const path of approved) {
    // `force` makes an already-absent directory a success: uninstalling twice, or
    // uninstalling after the user removed the folder by hand, is not a failure.
    // `maxRetries` covers the EPERM race documented in troubleshooting.md.
    rmSync(path, {
      recursive: true,
      force: true,
      maxRetries: ATTEMPTS,
      retryDelay: RETRY_DELAY_MS,
    })
  }
}
