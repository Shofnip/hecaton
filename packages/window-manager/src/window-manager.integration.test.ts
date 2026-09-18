import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { windowManager } from 'node-window-manager'
import { NativeWindowManager } from './native-window-manager.js'

const onWindows = process.platform === 'win32'

/**
 * The browser the app ships, not one installed on the machine (ADR-0016).
 *
 * This used to search two `Program Files` locations and let `describe.skipIf`
 * remove the suite when neither existed. That was fine while the app required an
 * installed Chrome; it stopped being fine the moment the README started telling
 * people there is no browser to install, because the suite then skips itself on a
 * correctly set up machine and still reports green — the vacuous signal this
 * repository keeps hunting.
 *
 * The path is spelled out rather than imported: this package does not depend on
 * `browser-engine` and should not start to for a test. `browser-paths.ts` owns
 * the layout, and `tests/bundled-browser.test.ts` holds this line to it.
 */
const CHROME = join(
  fileURLToPath(new URL('../../..', import.meta.url)),
  'node_modules\\electron\\dist\\resources\\chromium\\chrome-win\\chrome.exe',
)

let manager: NativeWindowManager
let profileRoot: string
let pid: number

/** Finds the browser process for a profile, the same way the launcher does. */
function browserPidFor(profilePath: string): number | undefined {
  const script =
    "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' } " +
    '| Select-Object ProcessId,CommandLine) | ConvertTo-Json -Compress'
  const stdout = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  if (!stdout.trim()) return undefined
  const rows = JSON.parse(stdout) as { ProcessId: number; CommandLine: string | null }[]
  return rows.find(
    (row) =>
      (row.CommandLine ?? '').includes(`--user-data-dir=${profilePath}`) &&
      !(row.CommandLine ?? '').includes('--type='),
  )?.ProcessId
}

describe.skipIf(!onWindows)('NativeWindowManager', () => {
  beforeAll(async () => {
    // Fails rather than skips: an absent bundled browser is a tree that has not
    // run `node scripts/fetch-chromium.mjs`, which is fixable, not a reason to
    // report green over an adapter that never ran.
    expect(existsSync(CHROME), `bundled browser missing at ${CHROME}`).toBe(true)
    manager = new NativeWindowManager()
    profileRoot = mkdtempSync(join(tmpdir(), 'hecaton-wm-'))

    const child = spawn(
      CHROME,
      [
        `--user-data-dir=${profileRoot}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--window-position=100,100',
        '--window-size=800,600',
        '--new-window',
        'about:blank',
      ],
      { detached: true, stdio: 'ignore' },
    )
    child.unref()

    for (let attempt = 0; attempt < 60; attempt++) {
      const found = browserPidFor(profileRoot)
      if (found !== undefined) {
        pid = found
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    expect(pid).toBeGreaterThan(0)
    // Give the window time to actually appear, not just the process to exist.
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }, 90_000)

  afterAll(async () => {
    // The adapter now holds a persistent worker; without closing it the test
    // process would not exit.
    await manager?.dispose()
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/F', '/T'], { stdio: 'ignore' })
    } catch {
      // already gone
    }
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        rmSync(profileRoot, { recursive: true, force: true })
        return
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }
  })

  it('moves a window the app did not create', () => {
    const bounds = { x: 200, y: 150, width: 900, height: 700 }
    expect(manager.setBounds(pid, bounds)).toBe(true)

    const actual = manager.boundsOf(pid)
    expect(actual).toEqual(bounds)
  })

  it('moves it again, so restoring the grid works', () => {
    expect(manager.setBounds(pid, { x: 0, y: 0, width: 960, height: 540 })).toBe(true)
    expect(manager.boundsOf(pid)).toEqual({ x: 0, y: 0, width: 960, height: 540 })
  })

  it('reports failure for a pid with no window, instead of throwing', () => {
    // The orchestrator calls this while a browser is still starting up.
    expect(manager.setBounds(999_999, { x: 0, y: 0, width: 100, height: 100 })).toBe(false)
    expect(manager.boundsOf(999_999)).toBeUndefined()
    expect(manager.hide(999_999)).toBe(false)
    expect(manager.show(999_999)).toBe(false)
    expect(manager.reload(999_999)).toBe(false)
  })

  it('handles a negative position, for a monitor left of the primary', () => {
    // Off-screen coordinates are accepted by Windows even with one monitor.
    expect(manager.setBounds(pid, { x: -300, y: 50, width: 800, height: 600 })).toBe(true)
    expect(manager.boundsOf(pid)?.x).toBe(-300)
  })

  /**
   * The rectangle Windows stores for a window is not the rectangle the user
   * sees: Windows 10 and 11 include an invisible resize border, measured on
   * this machine at 7px left, right and bottom and 0 on top. Placing windows by
   * the stored rect is why a grid that provably covers the screen exactly still
   * showed gaps - 7px at each screen edge, 14px between neighbours, since each
   * contributed its own margin.
   *
   * These tests measure the visible rectangle independently through DWM, rather
   * than trusting the adapter's own arithmetic about itself.
   */
  describe('the invisible border', () => {
    it('puts the visible window exactly where the core asked', () => {
      const asked = { x: 300, y: 200, width: 700, height: 500 }
      expect(manager.setBounds(pid, asked)).toBe(true)

      const hwnd = manager.windowIdOf(pid)
      expect(hwnd).toBeDefined()
      expect(visibleBoundsOf(hwnd!)).toEqual(asked)
    })

    it('reports what the user sees, not what Windows stores', () => {
      // Asymmetry between setBounds and boundsOf would make "restore the grid"
      // creep the windows a few pixels every time it ran.
      const asked = { x: 120, y: 90, width: 640, height: 480 }
      manager.setBounds(pid, asked)
      expect(manager.boundsOf(pid)).toEqual(asked)
    })

    it('leaves no gap between two cells that share an edge', async () => {
      // The bug exactly as reported: neighbouring windows never touched.
      //
      // The waits are not padding. Moving a window is asynchronous in effect,
      // and reading DWM immediately after setBounds returns the previous frame
      // - which showed up here as a 2px overlap that does not exist. The app
      // never reads bounds back, so this is a measuring problem, not a bug.
      // Cell size matters: Chrome refuses to go below a minimum window width,
      // and a 500px cell lands under it, so the window comes back 2px wider
      // than asked and the test fails on a Chrome limit rather than on the
      // adapter. 960 is what a 2x2 grid on a 1920 screen actually uses.
      const settle = () => new Promise((resolve) => setTimeout(resolve, 400))

      manager.setBounds(pid, { x: 0, y: 0, width: 960, height: 540 })
      await settle()
      const leftVisible = visibleBoundsOf(manager.windowIdOf(pid)!)

      manager.setBounds(pid, { x: 960, y: 0, width: 960, height: 540 })
      await settle()
      const rightVisible = visibleBoundsOf(manager.windowIdOf(pid)!)

      expect(leftVisible.x + leftVisible.width).toBe(rightVisible.x)
    })
  })

  /**
   * The video wall embeds each spawned Chrome window into the panel with Win32
   * SetParent, so a game becomes a cell instead of a free desktop window. These
   * run last, because reparenting the shared window into a stand-in panel
   * consumes it: after this it is a WS_CHILD, not the top-level window the tests
   * above drive.
   */
  describe('embedding into the panel', () => {
    let parentPid: number
    let parentProfile: string
    let parentHwnd: number
    let childHwnd: number
    let embedManager: NativeWindowManager

    beforeAll(async () => {
      // A second Chrome window stands in for the Electron panel to embed into —
      // any valid HWND is a valid SetParent target, and this keeps the test out
      // of Electron.
      parentProfile = mkdtempSync(join(tmpdir(), 'hecaton-panel-'))
      const child = spawn(
        CHROME!,
        [
          `--user-data-dir=${parentProfile}`,
          '--no-first-run',
          '--no-default-browser-check',
          '--window-position=200,200',
          '--window-size=1000,800',
          '--new-window',
          'about:blank',
        ],
        { detached: true, stdio: 'ignore' },
      )
      child.unref()
      for (let attempt = 0; attempt < 60; attempt++) {
        const found = browserPidFor(parentProfile)
        if (found !== undefined) {
          parentPid = found
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      expect(parentPid).toBeGreaterThan(0)
      await new Promise((resolve) => setTimeout(resolve, 3000))

      // Resolve both handles while they are still top-level, then build a manager
      // that knows where the panel is.
      parentHwnd = new NativeWindowManager().windowIdOf(parentPid)!
      childHwnd = new NativeWindowManager().windowIdOf(pid)!
      expect(parentHwnd).toBeGreaterThan(0)
      expect(childHwnd).toBeGreaterThan(0)
      embedManager = new NativeWindowManager(() => parentHwnd)
    }, 90_000)

    afterAll(async () => {
      await embedManager?.dispose()
      try {
        execFileSync('taskkill', ['/PID', String(parentPid), '/F', '/T'], { stdio: 'ignore' })
      } catch {
        // already gone
      }
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          rmSync(parentProfile, { recursive: true, force: true })
          return
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
      }
    })

    it('embeds a spawned window into the panel window', async () => {
      // The port is synchronous but the worker is driven fire-and-forget, so the
      // adapter returns true at once and the SetParent lands a moment later —
      // confirmed independently, through user32, not the adapter's bookkeeping.
      expect(embedManager.reparent(pid)).toBe(true)
      expect(await waitFor(() => parentOf(childHwnd) === parentHwnd)).toBe(true)
    })

    it('is idempotent, so the core may call it whenever it places a slot', async () => {
      expect(embedManager.reparent(pid)).toBe(true)
      expect(await waitFor(() => parentOf(childHwnd) === parentHwnd)).toBe(true)
    })

    it('still finds the embedded window by pid, which node-window-manager cannot', () => {
      // The whole reason for the pid->hwnd cache: once embedded the window is no
      // longer top-level, so a fresh manager (no cache) loses it.
      expect(embedManager.windowIdOf(pid)).toBe(childHwnd)
      expect(new NativeWindowManager().windowIdOf(pid)).toBeUndefined()
    })

    it('clips the child to the requested game rect, and moves by the delta', async () => {
      // The live path: setBounds on an embedded window sizes and clips it so the
      // game — not the window, which is bigger by Chrome's title bar and invisible
      // frame — fills the requested rect. The visible region (GetWindowRgnBox) is
      // that game area, and moving by (100,100) in client coords shifts the window
      // by exactly that. Both are read straight from user32, not the adapter.
      embedManager.setBounds(pid, { x: 50, y: 60, width: 420, height: 320 })
      const first = await waitForRect(childHwnd, () => regionSize(childHwnd).width === 420)
      expect(regionSize(childHwnd)).toEqual({ width: 420, height: 320 })
      embedManager.setBounds(pid, { x: 150, y: 160, width: 420, height: 320 })
      const second = await waitForRect(
        childHwnd,
        (r) => r.x === first.x + 100 && r.y === first.y + 100,
      )
      expect(second.width).toBe(first.width)
      expect(second.height).toBe(first.height)
      expect(regionSize(childHwnd)).toEqual({ width: 420, height: 320 })
    })

    it('hides and shows the embedded window', async () => {
      expect(embedManager.hide(pid)).toBe(true)
      expect(await waitFor(() => !isVisibleWindow(childHwnd))).toBe(true)
      expect(embedManager.show(pid)).toBe(true)
      expect(await waitFor(() => isVisibleWindow(childHwnd))).toBe(true)
    })

    it('reloads the embedded window in place', async () => {
      // WM_APPCOMMAND returns whether the message was delivered, not what the
      // page did; that the login survives a reload is ADR-0009's field test, not
      // something an about:blank window can show. Here: it does not throw and the
      // window stays alive and embedded.
      expect(embedManager.reload(pid)).toBe(true)
      expect(await waitFor(() => parentOf(childHwnd) === parentHwnd)).toBe(true)
    })

    /**
     * The regression this exists for: on the bundled Chromium, `SetParent` on an
     * `--app` window throws away its rendered surface, and it never comes back on
     * its own. Every other signal stayed green - process alive, window present,
     * bounds exact, parent correct - while the user looked at a grey rectangle
     * until they pressed reload by hand. Every test above would have passed.
     *
     * Two details are load-bearing and neither is obvious:
     *
     * - the url must be **http**, not `file://`. `--app=file://...` silently falls
     *   back to a normal tabbed window, which does not have the bug - so a
     *   file-served page makes this test pass while production stays broken.
     * - the assertion has to be a **pixel off the real screen**. Nothing in the
     *   window API distinguishes a painted surface from a discarded one, which is
     *   precisely why this shipped.
     */
    it('has actually painted, not just been placed', async () => {
      const { createServer } = await import('node:http')
      const server = createServer((_q, r) => {
        r.writeHead(200, { 'content-type': 'text/html' })
        r.end('<!doctype html><meta charset=utf-8><body style="margin:0;background:#c0392b">')
      })
      await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
      const port = (server.address() as { port: number }).port

      const profile = mkdtempSync(join(tmpdir(), 'hecaton-paint-'))
      const painted = spawn(
        CHROME,
        [
          `--user-data-dir=${profile}`,
          '--no-first-run',
          '--no-default-browser-check',
          '--window-position=-32000,-32000',
          '--window-size=700,480',
          `--app=http://127.0.0.1:${port}/`,
        ],
        { detached: true, stdio: 'ignore' },
      )
      painted.unref()

      let paintedPid: number | undefined
      for (let attempt = 0; attempt < 60 && paintedPid === undefined; attempt++) {
        paintedPid = browserPidFor(profile)
        if (paintedPid === undefined) await new Promise((r) => setTimeout(r, 250))
      }
      expect(paintedPid).toBeDefined()

      try {
        for (let attempt = 0; attempt < 60 && !embedManager.reparent(paintedPid!); attempt++) {
          await new Promise((r) => setTimeout(r, 250))
        }
        embedManager.setBounds(paintedPid!, { x: 30, y: 30, width: 660, height: 420 })
        embedManager.show(paintedPid!)
        bringToFront(parentHwnd)
        // The post-embed repaint is a real page load; measured at ~600 ms.
        await new Promise((r) => setTimeout(r, 4000))

        const pixel = centrePixelOfWindow(embedManager.windowIdOf(paintedPid!)!)
        const [red, green, blue] = pixel.split(',').map(Number)
        // #c0392b is (192,57,43); the browser's empty grey is near (43,47,56). The
        // gap is enormous, so this needs no tolerance tuning.
        expect(red, `centre pixel was ${pixel}`).toBeGreaterThan(120)
        expect(green, `centre pixel was ${pixel}`).toBeLessThan(120)
        expect(blue, `centre pixel was ${pixel}`).toBeLessThan(120)
      } finally {
        releaseTopmost(parentHwnd)
        server.close()
        try {
          execFileSync('taskkill', ['/PID', String(paintedPid), '/F', '/T'], { stdio: 'ignore' })
        } catch {
          // already gone
        }
      }
    }, 120_000)
  })
})

describe.skipIf(!onWindows)('rescuing the windows a screen opens for itself', () => {
  /**
   * The bug this covers, measured on 2026-09-18: a game's "sign in with
   * <provider>" opens a second browser window, and it arrives at
   * (-32000,-32000) - the corner a screen is launched in - because the browser
   * positions a new window against where it still believes the opener is, never
   * having been told that Win32 moved the screen into the panel. Visible, in the
   * taskbar, reachable by nothing.
   *
   * A second window in the **same** process is produced the way the game does it
   * in spirit and the way the shell can do it in a test: launching the browser
   * again against the same profile, which Chrome routes into the running process
   * rather than starting a second one.
   */
  let root: string
  let parent: number | undefined
  let screenPid: number | undefined
  let embedManager: NativeWindowManager

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'hecaton-detached-'))

    const parentProfile = join(root, 'panel')
    spawn(
      CHROME,
      [
        `--user-data-dir=${parentProfile}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--window-position=200,200',
        '--window-size=1000,800',
        '--new-window',
        'about:blank',
      ],
      { detached: true, stdio: 'ignore' },
    ).unref()

    const screenProfile = join(root, 'screen')
    spawn(
      CHROME,
      [
        `--user-data-dir=${screenProfile}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--window-position=-32000,-32000',
        '--window-size=700,480',
        '--app=about:blank',
      ],
      { detached: true, stdio: 'ignore' },
    ).unref()

    let parentPid: number | undefined
    for (let attempt = 0; attempt < 60 && !(parentPid && screenPid); attempt++) {
      parentPid ??= browserPidFor(parentProfile)
      screenPid ??= browserPidFor(screenProfile)
      await new Promise((r) => setTimeout(r, 250))
    }
    expect(screenPid).toBeGreaterThan(0)
    await new Promise((r) => setTimeout(r, 2000))

    parent = new NativeWindowManager().windowIdOf(parentPid!)
    embedManager = new NativeWindowManager(() => parent)
    for (let attempt = 0; attempt < 60 && !embedManager.reparent(screenPid!); attempt++) {
      await new Promise((r) => setTimeout(r, 250))
    }
    embedManager.setBounds(screenPid!, { x: 30, y: 30, width: 660, height: 420 })
    embedManager.show(screenPid!)

    // The second window of that same process, born where the login window is.
    spawn(
      CHROME,
      [
        `--user-data-dir=${screenProfile}`,
        '--window-position=-32000,-32000',
        '--window-size=520,640',
        '--app=about:blank',
      ],
      { detached: true, stdio: 'ignore' },
    ).unref()
    await new Promise((r) => setTimeout(r, 4000))
  }, 120_000)

  afterAll(async () => {
    if (screenPid !== undefined) {
      try {
        execFileSync('taskkill', ['/PID', String(screenPid), '/F', '/T'], { stdio: 'ignore' })
      } catch {
        // already gone
      }
    }
    // Retried, like the suite's other teardown: a browser that has just been
    // killed is still letting go of its profile, and `rmSync` answers EPERM for
    // a second or two afterwards - probe P4's finding, and not worth failing a
    // green run over.
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        rmSync(root, { recursive: true, force: true })
        return
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }
  })

  it('moves the out-of-view window onto the desktop', async () => {
    expect(embedManager.revealDetachedWindows(screenPid!)).toBe(1)

    // The move goes through the persistent worker, so it lands a beat later -
    // the adapter answers "I asked for it", not "Windows has done it".
    let rescued = detachedBoundsOf(screenPid!)
    for (let attempt = 0; attempt < 30 && rescued?.x === -32000; attempt++) {
      await new Promise((r) => setTimeout(r, 100))
      rescued = detachedBoundsOf(screenPid!)
    }
    expect(rescued, 'no top-level window left to inspect').toBeDefined()
    expect(rescued!.x).toBeGreaterThan(-32000)
    expect(rescued!.y).toBeGreaterThan(-32000)
  })

  it('leaves it alone once it is on the desktop', () => {
    // Idempotence is the property that makes this safe on a timer: it runs
    // several times a second, and a window the user then dragged must stay where
    // they put it.
    const before = detachedBoundsOf(screenPid!)

    expect(embedManager.revealDetachedWindows(screenPid!)).toBe(0)

    expect(detachedBoundsOf(screenPid!)).toEqual(before)
  })

  it('never rescues the same window twice, even if it goes out of view again', async () => {
    // The rule that stops the app chasing a window the user put away. Minimizing
    // is the case that forced it: a minimized window is still "visible" to
    // Win32 and reports (-32000,-32000), so without this the rescue would move
    // it back every two seconds, for ever, with a log line each time.
    const hwnd = topLevelOf(screenPid!)
    expect(hwnd).toBeDefined()
    moveWindowTo(hwnd!, -32000, -32000)

    expect(embedManager.revealDetachedWindows(screenPid!)).toBe(0)

    await new Promise((r) => setTimeout(r, 500))
    expect(detachedBoundsOf(screenPid!)?.x).toBe(-32000)
  })

  it('does nothing for a process with no embedded screen', () => {
    // Before the embed, a screen is *supposed* to be off-screen - that is what
    // keeps it from flashing on the desktop. Rescuing then would undo the
    // architecture rather than help the user.
    const virgin = new NativeWindowManager()
    expect(virgin.revealDetachedWindows(screenPid!)).toBe(0)
  })
})

/** The handle of the one visible, titled top-level window a process has. */
function topLevelOf(pid: number): number | undefined {
  return windowManager
    .getWindows()
    .find((window) => window.processId === pid && window.isVisible() && window.getTitle().trim())
    ?.id
}

/** Moves a window by handle, in screen pixels, without the library's scaling. */
function moveWindowTo(hwnd: number, x: number, y: number): void {
  execFileSync('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;" +
      'public class Mv{[DllImport("user32.dll")]public static extern bool SetWindowPos(' +
      "IntPtr h,IntPtr a,int x,int y,int cx,int cy,uint f);}'; " +
      `[void][Mv]::SetWindowPos([IntPtr]${hwnd}, [IntPtr](0), ${x}, ${y}, 0, 0, 0x0001 -bor 0x0004)`,
  ])
}

/**
 * The bounds of the one visible, titled top-level window a process still has.
 *
 * Measured through the same library the adapter uses, but independently of it:
 * the point is to read what Windows says about the window, not to ask the thing
 * under test where it thinks it put it. An embedded screen is a child window and
 * never appears here, so for a slot with a login window open, that window is the
 * only match.
 */
function detachedBoundsOf(pid: number): { x: number; y: number } | undefined {
  const found = windowManager
    .getWindows()
    .find((window) => window.processId === pid && window.isVisible() && window.getTitle().trim())
  if (!found) return undefined
  const bounds = found.getBounds()
  return { x: bounds.x ?? 0, y: bounds.y ?? 0 }
}

/**
 * Brings a window to the front, so a screen capture sees it rather than whatever
 * covers it.
 *
 * `SetForegroundWindow` alone is **not enough, and cannot be**: Windows refuses a
 * foreground change asked for by a process that does not already own the
 * foreground, which is every run of this suite from a terminal or an editor.
 * Measured 2026-09-17 — the paint assertion read the identical pixel on every
 * attempt, `24,56,81`, which was the terminal window over that spot rather than
 * anything the browser had drawn. A test that fails because of what sits on top
 * of it is one nobody will believe the day it reports a real regression.
 *
 * `SetWindowPos` with `HWND_TOPMOST` is not subject to that restriction, so the
 * window is pinned above everything for the capture. `releaseTopmost` unpins it
 * straight after: left pinned, it would cover the next test's window instead.
 */
function bringToFront(hwnd: number): void {
  setZOrder(hwnd, -1)
  execFileSync('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;" +
      'public class F{[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);' +
      '[DllImport("user32.dll")]public static extern bool BringWindowToTop(IntPtr h);}\'; ' +
      `[void][F]::BringWindowToTop([IntPtr]${hwnd}); [void][F]::SetForegroundWindow([IntPtr]${hwnd})`,
  ])
}

/** Undoes the pin, so this window does not sit over everything afterwards. */
function releaseTopmost(hwnd: number): void {
  setZOrder(hwnd, -2)
}

/**
 * `HWND_TOPMOST` is -1 and `HWND_NOTOPMOST` is -2; the flags are
 * NOMOVE|NOSIZE|SHOWWINDOW.
 *
 * **The parentheses around the negative number are load-bearing.** PowerShell
 * parses `[IntPtr]-1` as a subtraction — a type minus a number — and fails with a
 * *non-terminating* error, so the process still exits 0 and `execFileSync` is
 * happy while nothing has moved. Measured 2026-09-17: the first version of this
 * helper wrote it that way and the capture kept reading the window on top.
 */
function setZOrder(hwnd: number, insertAfter: -1 | -2): void {
  execFileSync('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;" +
      'public class Z{[DllImport("user32.dll")]public static extern bool SetWindowPos(' +
      "IntPtr h,IntPtr a,int x,int y,int cx,int cy,uint f);}'; " +
      `[void][Z]::SetWindowPos([IntPtr]${hwnd}, [IntPtr](${insertAfter}), 0, 0, 0, 0, 0x0043)`,
  ])
}

/**
 * The colour at the centre of a window, read off the real screen.
 *
 * A BitBlt of the desktop rather than `PrintWindow` on the parent: the browser is
 * a child window of another process, and `PrintWindow` does not include it.
 */
function centrePixelOfWindow(hwnd: number): string {
  return execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;" +
        'public struct RC{public int L,T,R,B;}' +
        'public class P{[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out RC r);}\'; ' +
        'Add-Type -AssemblyName System.Drawing; ' +
        `$r = New-Object RC; [void][P]::GetWindowRect([IntPtr]${hwnd}, [ref]$r); ` +
        '$x = [int](($r.L + $r.R) / 2); $y = [int](($r.T + $r.B) / 2); ' +
        '$b = New-Object System.Drawing.Bitmap(1, 1); ' +
        '$g = [System.Drawing.Graphics]::FromImage($b); ' +
        '$g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size(1, 1))); ' +
        '$p = $b.GetPixel(0, 0); "{0},{1},{2}" -f $p.R, $p.G, $p.B',
    ],
    { encoding: 'utf8' },
  ).trim()
}

/** Polls a predicate until true or a short timeout — for the worker's async effects. */
async function waitFor(pred: () => boolean, timeoutMs = 4000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (pred()) return true
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

/** Polls GetWindowRect until it satisfies `pred`, returning the rectangle. */
async function waitForRect(
  hwnd: number,
  pred: (rect: { x: number; y: number; width: number; height: number }) => boolean,
  timeoutMs = 4000,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const rect = windowRect(hwnd)
    if (pred(rect)) return rect
    if (Date.now() >= deadline) return rect
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

/** A window's screen rectangle (GetWindowRect), straight from user32. */
function windowRect(hwnd: number): { x: number; y: number; width: number; height: number } {
  const [left, top, right, bottom] = win32Query(`Rect([IntPtr]${hwnd})`).split(' ').map(Number)
  return { x: left!, y: top!, width: right! - left!, height: bottom! - top! }
}

/** The size of a window's visible region (GetWindowRgnBox) — the clipped game area. */
function regionSize(hwnd: number): { width: number; height: number } {
  const [left, top, right, bottom] = win32Query(`RgnBox([IntPtr]${hwnd})`).split(' ').map(Number)
  return { width: right! - left!, height: bottom! - top! }
}

/** The direct parent of a window (GetAncestor GA_PARENT), straight from user32. */
function parentOf(hwnd: number): number {
  return Number(win32Query(`GetAncestor([IntPtr]${hwnd}, 1).ToInt64()`))
}

/** Whether a window is visible (IsWindowVisible), straight from user32. */
function isVisibleWindow(hwnd: number): boolean {
  return win32Query(`IsWindowVisible([IntPtr]${hwnd})`).trim() === 'True'
}

/** Runs one user32 expression and returns its printed result. */
function win32Query(expression: string): string {
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class ProbeUser32 {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern int GetWindowRgnBox(IntPtr h, out RECT r);
  public static string Rect(IntPtr h) { RECT r; GetWindowRect(h, out r); return r.L + " " + r.T + " " + r.R + " " + r.B; }
  public static string RgnBox(IntPtr h) { RECT r; GetWindowRgnBox(h, out r); return r.L + " " + r.T + " " + r.R + " " + r.B; }
}
'@
[ProbeUser32]::${expression}
`
  return execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    // Silence stderr: Add-Type writes a CLIXML progress record there on first use.
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  ).trim()
}

/** The painted rectangle of a window, straight from DWM. */
function visibleBoundsOf(hwnd: number): { x: number; y: number; width: number; height: number } {
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class ProbeFrame {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("dwmapi.dll")]
  private static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int c);
  public static string Get(IntPtr h) {
    RECT r;
    DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT)));
    return r.Left + "," + r.Top + "," + r.Right + "," + r.Bottom;
  }
}
'@
[ProbeFrame]::Get([IntPtr]${hwnd})
`
  // -EncodedCommand, not -Command: the C# above is full of double quotes, and
  // PowerShell eats those out of a -Command string. This repository has hit
  // that trap three times now.
  const out = execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    { encoding: 'utf8' },
  )
  const [left, top, right, bottom] = out.trim().split(',').map(Number)
  return { x: left!, y: top!, width: right! - left!, height: bottom! - top! }
}
