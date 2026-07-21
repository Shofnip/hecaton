/**
 * Chrome command line for a slot.
 *
 * Deliberately boring: a normal browser, launched the way a desktop shortcut
 * would launch it. That is the whole point — the target game's Cloudflare
 * Turnstile rejects CDP-controlled browsers, so there is no remote debugging
 * port here and there never should be.
 *
 * Nothing that weakens a browser protection belongs in this list. Adding such a
 * flag to unblock a problem is a security decision for the project owner, not
 * an implementation detail, and chrome-args.test.ts enforces that.
 */
import type { LaunchRequest } from '@helloweb/core'

export function buildChromeArgs(request: LaunchRequest, profilePath: string): string[] {
  const { bounds } = request
  const args = [
    // The isolation mechanism: one profile per slot, so cookies, localStorage
    // and cache never cross between accounts.
    `--user-data-dir=${profilePath}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--window-position=${bounds.x},${bounds.y}`,
    `--window-size=${bounds.width},${bounds.height}`,
    // App window, not a normal window with a tab. App windows do not take part
    // in Chrome's session restore, so a slot never reopens last time's tabs and
    // never accumulates them. This became necessary once stop() started closing
    // cleanly: a clean exit is exactly what makes Chrome offer to restore, and a
    // normal window would bring the old tabs back plus the one we open. The url
    // is the app's target, so it is not passed again as a trailing argument.
    `--app=${request.url}`,
  ]

  if (request.mute) args.push('--mute-audio')

  return args
}
