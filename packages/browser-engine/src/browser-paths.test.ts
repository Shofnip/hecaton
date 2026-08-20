import { describe, expect, it } from 'vitest'
import {
  BUNDLED_BROWSER_SUBPATH,
  browserExecutableName,
  bundledBrowserPath,
} from './browser-paths.js'

const PACKAGED = 'C:\\Users\\x\\Desktop\\Hecaton\\resources'
const DEV = 'D:\\GP\\helloweb\\node_modules\\electron\\dist\\resources'

describe('bundledBrowserPath', () => {
  it('points at the browser this app ships, under Electron resources', () => {
    expect(bundledBrowserPath(PACKAGED)).toBe(
      'C:\\Users\\x\\Desktop\\Hecaton\\resources\\chromium\\chrome-win\\chrome.exe',
    )
  })

  it('resolves the same relative path in development as in the package', () => {
    // The whole reason there is no `app.isPackaged` branch: extraResources puts
    // the tree under <app>/resources, and the fetch script links it under
    // Electron's own resources directory in dev. One root in, one layout out.
    // Measured 2026-08-20: process.resourcesPath in dev is
    // node_modules/electron/dist/resources, and a junction under it resolves.
    for (const root of [PACKAGED, DEV]) {
      expect(bundledBrowserPath(root).slice(root.length + 1)).toBe(BUNDLED_BROWSER_SUBPATH)
    }
  })

  it('builds a Windows path whatever platform it runs on', () => {
    // node:path.join is the *platform's* joiner, not Windows's. This is a
    // Windows path wherever the code executes, and CI type-checks and tests on
    // Linux — where join produced forward slashes and turned this into a
    // function whose output depended on where it was called.
    expect(bundledBrowserPath(PACKAGED)).not.toContain('/')
  })

  it('does not double the separator when the root ends with one', () => {
    expect(bundledBrowserPath(`${PACKAGED}\\`)).toBe(bundledBrowserPath(PACKAGED))
  })

  it('refuses an empty root rather than rooting the path at a drive', () => {
    // Without this, an empty resources path yields
    // "\chromium\chrome-win\chrome.exe" — a path on whichever drive the process
    // happens to be on, which is a directory nobody audited and an executable
    // nobody chose. It would be spawned.
    expect(() => bundledBrowserPath('')).toThrow(/bundled browser/i)
    expect(() => bundledBrowserPath('\\')).toThrow(/bundled browser/i)
  })

  it('offers no path to an installed Chrome', () => {
    // The app ships its own browser and launches nothing else (ADR-0016). A
    // fallback would put back the dependency the bundling removes, and make it
    // ambiguous which browser ran when Turnstile next rejects one.
    expect(bundledBrowserPath(PACKAGED)).not.toMatch(/Program Files|LOCALAPPDATA|Google/i)
  })
})

describe('browserExecutableName', () => {
  it('names the file the process filter has to match', () => {
    expect(browserExecutableName(bundledBrowserPath(PACKAGED))).toBe('chrome.exe')
  })

  it('splits on a backslash even when it runs on Linux', () => {
    // node:path.basename does not treat a backslash as a separator off Windows,
    // so it would hand back the whole path as the name — passing on the
    // developer's machine and lying on CI.
    expect(browserExecutableName('C:\\a\\b\\chrome.exe')).toBe('chrome.exe')
    expect(browserExecutableName('/a/b/chrome.exe')).toBe('chrome.exe')
  })
})
