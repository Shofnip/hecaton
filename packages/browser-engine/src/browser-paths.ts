/**
 * Where the browser this app ships lives, and what it is called.
 *
 * Pure, and separate from the launcher, so the layout is a decision the fast
 * suite holds rather than something only a machine with the browser unpacked on
 * it can check. The `existsSync` that checks the result lives in the adapter,
 * where the I/O belongs.
 *
 * The app used to search for an installed Google Chrome in three places. It no
 * longer looks anywhere: it launches **its own bundled Chromium and nothing
 * else** ([ADR-0016](../../../docs/adr/0016-ship-our-own-chromium.md)). A
 * fallback to whatever Chrome happens to be on the machine would reintroduce the
 * dependency the bundling exists to remove, and — worse — make it ambiguous
 * which browser actually ran when the game's Turnstile next rejects one.
 */

/**
 * The bundled browser's location, relative to Electron's resources directory.
 *
 * One relative path serves development and the packaged app alike, which is why
 * there is no `app.isPackaged` branch anywhere near this: `extraResources` puts
 * the tree at `<resources>/chromium/chrome-win` in the package, and
 * `scripts/fetch-chromium.mjs` links the same tree under Electron's own
 * `resources` directory in development. The load path that is tested is the load
 * path that ships (ADR-0007 decision 2).
 *
 * `tests/bundled-browser.test.ts` holds this string against
 * `electron-builder.yml` and the fetch script, because three files agreeing by
 * eye is exactly the kind of agreement that quietly stops being true.
 */
export const BUNDLED_BROWSER_SUBPATH = 'chromium\\chrome-win\\chrome.exe'

/**
 * The bundled browser executable, given Electron's `process.resourcesPath`.
 *
 * The separator is a literal backslash rather than `node:path.join`, which is
 * the platform's joiner and not Windows's. This is a Windows path whatever
 * machine the code runs on, and CI type-checks and tests on Linux — where `join`
 * produced forward slashes and turned this into a function whose output depended
 * on where it was called.
 *
 * An empty root is refused rather than joined onto: `\chromium\chrome-win\
 * chrome.exe` is a path rooted at whichever drive the process happens to be on,
 * which is a directory nobody audited and an executable nobody chose. Throwing
 * is the point — the alternative is spawning it.
 */
export function bundledBrowserPath(resourcesRoot: string): string {
  const root = resourcesRoot.replace(/[\\/]+$/, '')
  if (!root) throw new Error('resources root is empty, so the bundled browser cannot be located')
  return `${root}\\${BUNDLED_BROWSER_SUBPATH}`
}

/**
 * The file name of a browser executable, for the process filter that finds it.
 *
 * Splits on both separators rather than using `node:path.basename`, for the same
 * reason the path above is built by hand: `basename` on Linux does not treat a
 * backslash as a separator, so a CI run would see the whole path as the name and
 * the test would pass on Windows and lie everywhere else.
 */
export function browserExecutableName(browserPath: string): string {
  const parts = browserPath.split(/[\\/]/)
  return parts[parts.length - 1] ?? ''
}
