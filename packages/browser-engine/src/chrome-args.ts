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
import type { LaunchRequest } from '@hecaton/core'

/**
 * Chromium features turned off in every slot, as one comma-separated switch.
 *
 * Chrome downloads Gemini Nano — ~4 GB — into `OptGuideOnDeviceModel` inside each
 * profile. Measured on this machine at Chrome 150.0.7871.187: 4,072 MB in each of
 * four slots, 16.3 GB in total, the same model version duplicated per profile,
 * and it arrived about **two days** after each profile was created, not at first
 * launch. A farm multiplies that by the number of screens, on the end user's disk.
 *
 * Two properties of this flag deserve stating, because both are traps:
 *
 * - **A wrong or removed feature name fails silently.** Chromium ignores names it
 *   does not know, so this switch could become a no-op in a future version and the
 *   only symptom would be the disk filling again. That is the `--load-extension`
 *   precedent, and it is why there is no quick test that proves this works: the
 *   download takes days, so verification means checking that the directory has not
 *   come back, not asserting anything at launch.
 * - **Chromium honours one value per switch.** A second `--disable-features` would
 *   make one of the two silently win; `chrome-args.test.ts` pins the count at one.
 *
 * Nothing here weakens a browser protection — these disable an AI model download.
 * The test file guards the parsed feature names, so a protection cannot be
 * smuggled into this list later.
 */
const DISABLED_FEATURES = ['OptimizationGuideOnDeviceModel', 'OptimizationGuideModelDownloading']

export function buildChromeArgs(request: LaunchRequest, profilePath: string): string[] {
  const { bounds } = request
  const args = [
    // The isolation mechanism: one profile per slot, so cookies, localStorage
    // and cache never cross between accounts.
    `--user-data-dir=${profilePath}`,
    '--no-first-run',
    '--no-default-browser-check',
    // Hide the scrollbar the game page shows when it is taller than its embedded
    // cell — cosmetic, approved by the owner. It weakens no protection (unlike the
    // forbidden flags chrome-args.test.ts guards) and wheel scrolling still works.
    '--hide-scrollbars',
    `--disable-features=${DISABLED_FEATURES.join(',')}`,
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

  // Embedded screens must keep running while hidden behind the video wall
  // (decision 6): the farm cannot pause the moment a screen is not on top. A
  // hidden window that keeps its full timer rate is what these three flags buy.
  // They are performance flags, not security ones — they weaken no browser
  // protection — but they ARE fragile across Chrome versions (precedent:
  // --load-extension), so the version the spike measured them on is recorded:
  // Chrome 150.0.7871.181. A per-screen toggle re-enables throttling by setting
  // backgroundThrottling to true, for screens where saving resources matters.
  if (!request.backgroundThrottling) {
    args.push(
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    )
  }

  return args
}
