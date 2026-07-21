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
    '--new-window',
  ]

  if (request.mute) args.push('--mute-audio')

  // Last, so Chrome reads it as the page to open rather than as a flag.
  args.push(request.url)
  return args
}
