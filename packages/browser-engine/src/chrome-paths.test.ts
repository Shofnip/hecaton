import { describe, expect, it } from 'vitest'
import { chromeSearchPaths } from './chrome-paths.js'

const LOCAL = 'C:\\Users\\x\\AppData\\Local'
const PER_USER = `${LOCAL}\\Google\\Chrome\\Application\\chrome.exe`
const MACHINE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const MACHINE_X86 = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'

describe('chromeSearchPaths', () => {
  it('looks where Chrome lands when it is installed without administrator', () => {
    // The gap that blocked handing the zip to anyone else. Chrome's installer
    // falls back to %LOCALAPPDATA% for a user who cannot elevate, and only the
    // two machine-wide directories were searched — so that user got "Chrome
    // executable not found" and had nowhere to point the app.
    expect(chromeSearchPaths({ LOCALAPPDATA: LOCAL })).toContain(PER_USER)
  })

  it('still prefers a machine-wide install when both exist', () => {
    // Order is the whole answer here, and it is chosen so that nobody for whom
    // the app already works sees it start a different browser after an update.
    const paths = chromeSearchPaths({ LOCALAPPDATA: LOCAL })
    expect(paths.indexOf(MACHINE)).toBeLessThan(paths.indexOf(PER_USER))
    expect(paths.indexOf(MACHINE_X86)).toBeLessThan(paths.indexOf(PER_USER))
  })

  it('builds Windows paths whatever platform it runs on', () => {
    // node:path.join is the *platform's* joiner, not Windows's. These are Windows
    // install locations wherever the code executes, and CI type-checks and tests
    // on Linux — where join produced forward slashes and turned this into a
    // function whose output depended on where it was called. CI caught it; this
    // pins it.
    for (const path of chromeSearchPaths({ LOCALAPPDATA: LOCAL })) {
      expect(path).not.toContain('/')
    }
  })

  it('does not double the separator when the variable ends with one', () => {
    expect(chromeSearchPaths({ LOCALAPPDATA: `${LOCAL}\\` })).toContain(PER_USER)
  })

  it('omits the per-user path rather than building one from an empty variable', () => {
    // Without this, an unset LOCALAPPDATA yields "\Google\Chrome\Application\
    // chrome.exe" — a path rooted at the drive the process happens to be on,
    // which is a directory nobody audited and an executable nobody chose.
    expect(chromeSearchPaths({})).toEqual([MACHINE, MACHINE_X86])
    expect(chromeSearchPaths({ LOCALAPPDATA: '' })).toEqual([MACHINE, MACHINE_X86])
  })
})
