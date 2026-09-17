/**
 * Making the bundled browser readable by its own sandbox.
 *
 * Chromium runs its **network service in an AppContainer**, and an AppContainer
 * process can only open files whose ACL admits `ALL APPLICATION PACKAGES`
 * (`S-1-15-2-1`). Without that ACE on the browser's own tree the service cannot
 * start: the browser logs `Sandbox cannot access executable … Access denied`
 * followed by `Network service crashed or was terminated`, the window opens and
 * paints nothing, and **no page ever loads**. A local `file://` page still
 * renders, which is what makes the symptom so misleading — the browser looks
 * alive.
 *
 * Measured 2026-09-17 on both pinned revisions, from three different
 * directories, with the grant flipping it in both directions. Google Chrome's
 * installer sets that ACE explicitly; `Program Files` hands it down by
 * inheritance. A folder the user extracted a zip into inherits nothing of the
 * sort, and neither does one under `%LOCALAPPDATA%\Programs` - measured, before
 * assuming an installer would have solved it.
 *
 * So the app does it for itself, once, at startup
 * ([ADR-0020](../../../docs/adr/0020-a-zip-the-user-extracts-not-an-installer.md)).
 * The rule is here; reading and writing an ACL is an adapter's job.
 */
import type { Logger } from './log.js'
import type { BrowserAccess } from './ports.js'

/**
 * What the browser tree's ACL says about AppContainer processes.
 *
 * `unknown` is not an error case to be handled elsewhere: it is one of the three
 * answers, because a machine that will not answer is common enough to have a
 * rule of its own.
 */
export type AppContainerReadState = 'granted' | 'missing' | 'unknown'

/**
 * Whether to write the ACE, given what was read.
 *
 * Grant unless we positively know it is already there. The asymmetry is the
 * whole decision: a redundant grant costs one `icacls` run on a tree the user
 * owns, and a skipped one costs every screen they open — grey, permanently, with
 * nothing on screen explaining it.
 */
export function needsAppContainerGrant(state: AppContainerReadState): boolean {
  return state !== 'granted'
}

export interface BrowserAccessDeps {
  access: BrowserAccess
  /** The directory holding the bundled browser, resolved by the shell. */
  browserDir: string
  logger: Logger
}

/**
 * Reads, grants if needed, and says where it ended up.
 *
 * Reads first rather than granting unconditionally, so the usual launch — every
 * one after the first — does not rewrite the ACL of 251 files.
 *
 * Fails open, like every other layer that depends on the machine cooperating: a
 * tree this user cannot re-ACL is the app's instrument failing, and refusing to
 * start over it turns a browser problem into no app at all. What it leaves
 * behind is a log line, which is the only thing that will explain the grey
 * screens to whoever reads the file afterwards.
 *
 * The path is never logged. It sits inside the folder the user extracted, so it
 * carries their account name — the same reason `instance.claim` logs a verdict
 * and not an identity. `redactUserPaths` would scrub it at the boundary anyway;
 * this keeps it out of the message to begin with.
 */
export async function ensureBrowserReadable(
  deps: BrowserAccessDeps,
): Promise<AppContainerReadState> {
  let state: AppContainerReadState
  try {
    state = await deps.access.readState(deps.browserDir)
  } catch {
    state = 'unknown'
  }

  if (!needsAppContainerGrant(state)) {
    deps.logger.log({ level: 'info', event: 'browser.access', message: 'already-readable' })
    return 'granted'
  }

  try {
    await deps.access.grantRead(deps.browserDir)
  } catch (error) {
    deps.logger.log({
      level: 'warn',
      event: 'browser.access',
      message: `grant-failed: ${error instanceof Error ? error.message : String(error)}`,
    })
    return state === 'unknown' ? 'unknown' : 'missing'
  }

  // Two words rather than one, because they answer different questions later:
  // `granted` means the ACE was measured absent and is now there, and
  // `granted-unread` means the check itself did not work, so the grant is the
  // only evidence there is.
  deps.logger.log({
    level: 'info',
    event: 'browser.access',
    message: state === 'unknown' ? 'granted-unread' : 'granted',
  })
  return 'granted'
}
