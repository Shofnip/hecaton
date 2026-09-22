import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { windowManager } from 'node-window-manager'
import { DesktopSnapshotReader } from './desktop-snapshot-reader.js'
import { NativeWindowManager } from './native-window-manager.js'
import { Win32Worker } from './win32-worker.js'

const onWindows = process.platform === 'win32'

describe.skipIf(!onWindows)('periodic desktop reads', () => {
  it('returns only windows requested by pid or panel handle', async () => {
    const reader = new DesktopSnapshotReader()
    try {
      const snapshot = await reader.read({ processIds: [process.pid] })

      expect(snapshot.windows.every((window) => window.processId === process.pid)).toBe(true)
      expect(reader.processId).toBeGreaterThan(0)
      expect(reader.processId).not.toBe(process.pid)
    } finally {
      await reader.dispose()
    }
  })

  it('turns a late sweep after disposal into a no-op', async () => {
    const disposed = new NativeWindowManager()
    await disposed.dispose()

    await expect(disposed.sweepExtraWindows([123, 456])).resolves.toEqual([
      { pid: 123, moved: 0, extraWindows: 0 },
      { pid: 456, moved: 0, extraWindows: 0 },
    ])
    expect(disposed.desktopEnumerations).toBe(0)
  })
})

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
function commandUsesProfile(commandLine: string, profilePath: string): boolean {
  const command = commandLine.toLowerCase()
  const profile = profilePath.toLowerCase()
  return [`--user-data-dir=${profile}`, `--user-data-dir="${profile}"`].some((argument) => {
    const index = command.indexOf(argument)
    if (index < 0) return false
    const next = command[index + argument.length]
    return next === undefined || next === '"' || /\s/.test(next)
  })
}

function browserPidFor(profilePath: string): number | undefined {
  const script =
    "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' } " +
    '| Select-Object ProcessId,CommandLine) | ConvertTo-Json -Compress'
  const stdout = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  if (!stdout.trim()) return undefined
  const parsed = JSON.parse(stdout) as
    | { ProcessId: number; CommandLine: string | null }
    | { ProcessId: number; CommandLine: string | null }[]
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  return rows.find(
    (row) =>
      commandUsesProfile(row.CommandLine ?? '', profilePath) &&
      !(row.CommandLine ?? '').includes('--type='),
  )?.ProcessId
}

function temporaryProfile(profilePath: string, prefix: string): string {
  const resolved = resolve(profilePath)
  if (dirname(resolved) !== resolve(tmpdir()) || !basename(resolved).startsWith(prefix)) {
    throw new Error(`refusing to remove unexpected profile path ${JSON.stringify(resolved)}`)
  }
  return resolved
}

async function removeBrowserProfile(profilePath: string, prefix: string): Promise<void> {
  await removeBrowserProfiles(profilePath, prefix, [profilePath])
}

async function removeBrowserProfiles(
  rootPath: string,
  prefix: string,
  profilePaths: readonly string[],
): Promise<void> {
  const safeProfile = temporaryProfile(rootPath, prefix)
  const safeChildren = profilePaths.map((profilePath) => {
    const child = resolve(profilePath)
    if (child !== safeProfile && !child.startsWith(`${safeProfile}${sep}`)) {
      throw new Error(`refusing to inspect profile outside temporary root ${JSON.stringify(child)}`)
    }
    return child
  })

  // Resolve every kill from the current command line rather than trusting the
  // launch-time pid: Windows can reuse that pid for an unrelated process.
  for (const browserProfile of safeChildren) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const remainingPid = browserPidFor(browserProfile)
      if (remainingPid === undefined) break
      try {
        execFileSync('taskkill', ['/PID', String(remainingPid), '/F', '/T'], { stdio: 'ignore' })
      } catch {
        // The next profile query decides whether it is really gone.
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250))
    }
    const remainingPid = browserPidFor(browserProfile)
    if (remainingPid !== undefined) {
      throw new Error(`browser ${remainingPid} still holds temporary profile ${browserProfile}`)
    }
  }

  let lastError: unknown
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      rmSync(safeProfile, { recursive: true, force: true })
      if (!existsSync(safeProfile)) return
    } catch (error) {
      lastError = error
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250))
  }
  throw new Error(`could not remove temporary profile ${safeProfile}: ${String(lastError)}`)
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
    await removeBrowserProfile(profileRoot, 'hecaton-wm-')
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
    let secondPid: number
    let secondProfile: string
    let secondHwnd: number
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

      // A second embedded child makes a partial newest frame observable. With
      // one child, replacing a queued frame can never discard another screen's
      // last position, which is the live four-screen resize regression.
      secondProfile = mkdtempSync(join(tmpdir(), 'hecaton-wm-second-'))
      const second = spawn(
        CHROME!,
        [
          `--user-data-dir=${secondProfile}`,
          '--no-first-run',
          '--no-default-browser-check',
          '--window-position=300,300',
          '--window-size=800,600',
          '--new-window',
          'about:blank',
        ],
        { detached: true, stdio: 'ignore' },
      )
      second.unref()
      for (let attempt = 0; attempt < 60; attempt++) {
        const found = browserPidFor(secondProfile)
        if (found !== undefined) {
          secondPid = found
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      expect(secondPid).toBeGreaterThan(0)
      await new Promise((resolve) => setTimeout(resolve, 3000))
      secondHwnd = new NativeWindowManager().windowIdOf(secondPid)!
      expect(secondHwnd).toBeGreaterThan(0)
    }, 90_000)

    afterAll(async () => {
      await embedManager?.dispose()
      await removeBrowserProfile(parentProfile, 'hecaton-panel-')
      await removeBrowserProfile(secondProfile, 'hecaton-wm-second-')
    })

    it('embeds a spawned window into the panel window', async () => {
      // The port is synchronous but the worker is driven fire-and-forget, so the
      // adapter returns true at once and the SetParent lands a moment later —
      // confirmed independently, through user32, not the adapter's bookkeeping.
      expect(embedManager.reparent(pid)).toBe(true)
      expect(await waitFor(() => parentOf(childHwnd) === parentHwnd)).toBe(true)
    })

    it('reads the desktop once for a sweep containing several screens', async () => {
      expect(embedManager.reparent(pid)).toBe(true)
      expect(await waitFor(() => parentOf(childHwnd) === parentHwnd)).toBe(true)
      const before = embedManager.desktopEnumerations

      const pending = embedManager.sweepExtraWindows([pid, secondPid])

      // Enumeration is synchronous inside node-window-manager. The adapter must
      // hand it to a worker before returning or this call itself freezes input.
      expect(pending).toBeInstanceOf(Promise)
      const sweep = await pending

      expect(sweep.map(({ pid: sweptPid }) => sweptPid)).toEqual([pid, secondPid])
      expect(embedManager.desktopEnumerations - before).toBe(1)
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

    it('places a whole layout frame in one command', async () => {
      // What the video wall actually drives: the renderer computes a frame and
      // the core hands over every screen that moved at once. Measured 2026-09-20
      // with six screens — one command per screen placed a frame in 75 ms, one
      // command for all six in 36 ms, because each is a Win32 call that waits on
      // a browser that is busy drawing.
      embedManager.setLayout([{ pid, bounds: { x: 70, y: 80, width: 380, height: 300 } }])
      await waitForRect(childHwnd, () => regionSize(childHwnd).width === 380)
      expect(regionSize(childHwnd)).toEqual({ width: 380, height: 300 })
    })

    it('repairs a displaced D3D presentation child during layout', async () => {
      expect(embedManager.reparent(pid)).toBe(true)
      expect(await waitFor(() => parentOf(childHwnd) === parentHwnd)).toBe(true)
      const bounds = { x: 70, y: 80, width: 420, height: 320 }
      embedManager.setLayout([{ pid, bounds }])
      embedManager.show(pid)
      await waitForRect(childHwnd, () => regionSize(childHwnd).width === bounds.width)
      await new Promise((resolve) => setTimeout(resolve, 300))

      const d3d = Number(
        win32Query(`DirectChild([IntPtr]${childHwnd}, "Intermediate D3D Window").ToInt64()`),
      )
      expect(d3d).toBeGreaterThan(0)
      const clientSize = win32Query(`ClientSize([IntPtr]${childHwnd})`)
      expect(win32Query(`Move([IntPtr]${d3d}, 32000, 32000, 420, 320)`)).toBe('True')
      expect(win32Query(`ClientRelativeRect([IntPtr]${childHwnd}, [IntPtr]${d3d})`)).toBe(
        '32000 32000 420 320',
      )

      // This is the same input the app emits after a panel/layout frame. The
      // browser document and processes stay untouched; only its misplaced
      // presentation child needs to follow the outer window again.
      embedManager.setLayout([{ pid, bounds }])

      expect(
        await waitFor(
          () =>
            win32Query(`ClientRelativeRect([IntPtr]${childHwnd}, [IntPtr]${d3d})`) ===
            `0 0 ${clientSize}`,
        ),
        'layout did not recover the displaced D3D presentation child',
      ).toBe(true)
    })

    it('settles an asynchronous placement once after the layout becomes quiet', async () => {
      // SWP_ASYNCWINDOWPOS posts the resize to Chrome and returns before Chrome
      // applies it. MoveOne must therefore re-read the now-settled frame once;
      // otherwise the synchronous clip and the asynchronous window resize can
      // remain out of step until the user resizes the Hecaton panel again.
      expect(embedManager.reparent(pid)).toBe(true)
      expect(await waitFor(() => parentOf(childHwnd) === parentHwnd)).toBe(true)
      await new Promise((resolve) => setTimeout(resolve, 300))
      const before = embedManager.layoutCommandsSent

      embedManager.setLayout([{ pid, bounds: { x: 75, y: 85, width: 390, height: 310 } }])

      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(embedManager.layoutCommandsSent - before).toBe(2)
      await waitForRect(childHwnd, () => regionSize(childHwnd).width === 390)
      expect(regionSize(childHwnd)).toEqual({ width: 390, height: 310 })
    })

    it('bounds live clipping work and flushes the exact final region after resize', async () => {
      expect(embedManager.reparent(pid)).toBe(true)
      expect(await waitFor(() => parentOf(childHwnd) === parentHwnd)).toBe(true)
      await new Promise((resolve) => setTimeout(resolve, 150))
      const before = embedManager.layoutRegionsApplied

      // SetWindowRgn is synchronous across the browser process and the Stage 3
      // probe measured it at 20.1 ms per four-child frame. Small live deltas are
      // therefore bounded while SetWindowPos still receives every newest frame.
      for (let delta = 0; delta < 12; delta++) {
        embedManager.setLayout([
          { pid, bounds: { x: 75, y: 85, width: 380 + delta * 6, height: 300 + delta * 4 } },
        ])
        await new Promise((resolve) => setTimeout(resolve, 16))
      }

      await waitForRect(childHwnd, (rect) => rect.width >= 460)
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(embedManager.layoutRegionsApplied - before).toBeLessThanOrEqual(7)
      expect(embedManager.layoutRegionsApplied - before).toBeGreaterThan(0)
      expect(regionSize(childHwnd)).toEqual({ width: 446, height: 344 })
    })

    it('skips the frames the user has already moved past', async () => {
      // A divider drag emits one frame per animation frame — about 60 a second,
      // against the 15 to 25 Win32 can serve. Executing all of them left the
      // windows 2.2 s behind the pointer (measured 2026-09-20, six screens): when
      // the drag stopped, the worker was still applying positions the divider had
      // long passed. Only the newest frame is worth sending, and the newest frame
      // must never be the one that gets dropped.
      const before = embedManager.layoutCommandsSent
      for (let i = 0; i < 30; i++) {
        embedManager.setLayout([{ pid, bounds: { x: 60, y: 70, width: 300 + i * 4, height: 260 } }])
      }
      expect(embedManager.layoutCommandsSent - before).toBeLessThanOrEqual(2)
      await waitForRect(childHwnd, () => regionSize(childHwnd).width === 416)
      expect(regionSize(childHwnd)).toEqual({ width: 416, height: 260 })
    })

    it('keeps every screen from an overtaken frame when the newest delta is partial', async () => {
      expect(embedManager.reparent(pid)).toBe(true)
      expect(await waitFor(() => parentOf(childHwnd) === parentHwnd)).toBe(true)
      expect(embedManager.reparent(secondPid)).toBe(true)
      expect(await waitFor(() => parentOf(secondHwnd) === parentHwnd)).toBe(true)
      embedManager.setLayout([
        { pid: secondPid, bounds: { x: 400, y: 20, width: 320, height: 230 } },
      ])
      await waitForRect(secondHwnd, () => regionSize(secondHwnd).width === 320)
      expect(regionSize(secondHwnd)).toEqual({ width: 320, height: 230 })
      await new Promise((resolve) => setTimeout(resolve, 100))

      // The first frame is already in flight. The second has the latest place
      // for both screens; the third changes only the first because the core
      // correctly sends deltas. Replacing rather than merging the queued frame
      // strands the second screen at the first frame's rectangle.
      embedManager.setLayout([
        { pid, bounds: { x: 20, y: 20, width: 360, height: 250 } },
        { pid: secondPid, bounds: { x: 400, y: 20, width: 340, height: 250 } },
      ])
      embedManager.setLayout([
        { pid, bounds: { x: 20, y: 20, width: 380, height: 270 } },
        { pid: secondPid, bounds: { x: 420, y: 20, width: 380, height: 270 } },
      ])
      embedManager.setLayout([{ pid, bounds: { x: 20, y: 20, width: 400, height: 290 } }])

      await waitForRect(childHwnd, () => regionSize(childHwnd).width === 400)
      await waitForRect(secondHwnd, () => regionSize(secondHwnd).width === 380)
      expect(regionSize(secondHwnd)).toEqual({ width: 380, height: 270 })
      expect(embedManager.hide(secondPid)).toBe(true)
      expect(await waitFor(() => !isVisibleWindow(secondHwnd))).toBe(true)
    })

    it('sends nothing at all for a frame in which nothing moved', () => {
      const before = embedManager.layoutCommandsSent
      embedManager.setLayout([])
      expect(embedManager.layoutCommandsSent).toBe(before)
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

    it('restores an embedded screen above the host input window without changing bounds or focus', async () => {
      expect(embedManager.reparent(pid)).toBe(true)
      expect(await waitFor(() => parentOf(childHwnd) === parentHwnd)).toBe(true)
      embedManager.setBounds(pid, { x: 50, y: 60, width: 420, height: 320 })
      embedManager.show(pid)
      expect(await waitFor(() => isVisibleWindow(childHwnd))).toBe(true)
      await waitForRect(childHwnd, () => regionSize(childHwnd).width === 420)

      // Both are real Chromium windows. Reproduce the measured native defect:
      // the host's own input HWND covers its embedded browser despite the game
      // still painting. No page script, injected input or mocked window API.
      const blocker = Number(win32Query(`InputChild([IntPtr]${parentHwnd}).ToInt64()`))
      expect(blocker).toBeGreaterThan(0)
      expect(blocker).not.toBe(childHwnd)
      expect(win32Query(`Raise([IntPtr]${blocker})`)).toBe('True')
      expect(Number(win32Query(`GetTopWindow([IntPtr]${parentHwnd}).ToInt64()`))).toBe(blocker)
      const before = windowRect(childHwnd)
      const clip = regionSize(childHwnd)
      const focus = win32Query(`Focus([IntPtr]${parentHwnd})`)

      embedManager.restoreEmbeddedZOrder()

      expect(
        await waitFor(
          () => Number(win32Query(`GetTopWindow([IntPtr]${parentHwnd}).ToInt64()`)) === childHwnd,
        ),
      ).toBe(true)
      expect(windowRect(childHwnd)).toEqual(before)
      expect(regionSize(childHwnd)).toEqual(clip)
      expect(win32Query(`Focus([IntPtr]${parentHwnd})`)).toBe(focus)
    })

    it('does not reveal a screen hidden by focus mode or a modal when restoring stacking', async () => {
      expect(embedManager.reparent(pid)).toBe(true)
      expect(await waitFor(() => parentOf(childHwnd) === parentHwnd)).toBe(true)
      embedManager.hide(pid)
      expect(await waitFor(() => !isVisibleWindow(childHwnd))).toBe(true)
      const blocker = Number(win32Query(`InputChild([IntPtr]${parentHwnd}).ToInt64()`))
      expect(blocker).toBeGreaterThan(0)
      expect(win32Query(`Raise([IntPtr]${blocker})`)).toBe('True')

      embedManager.restoreEmbeddedZOrder()

      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(isVisibleWindow(childHwnd)).toBe(false)
      expect(Number(win32Query(`GetTopWindow([IntPtr]${parentHwnd}).ToInt64()`))).toBe(blocker)
    })

    it('rejects a restack command whose PID or parent does not match the real child', async () => {
      expect(embedManager.reparent(pid)).toBe(true)
      expect(await waitFor(() => parentOf(childHwnd) === parentHwnd)).toBe(true)
      const worker = new Win32Worker()
      try {
        await expect(
          worker.send(`restack ${childHwnd} ${parentPid} ${parentHwnd}`),
        ).rejects.toThrow('invalid restack target')
        await expect(worker.send(`restack ${childHwnd} ${pid} ${childHwnd}`)).rejects.toThrow(
          'invalid restack target',
        )
        await expect(worker.send('restack 0 0 0')).rejects.toThrow('invalid restack target')
        expect(parentOf(childHwnd)).toBe(parentHwnd)
      } finally {
        await worker.dispose()
      }
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
      try {
        for (let attempt = 0; attempt < 60 && paintedPid === undefined; attempt++) {
          paintedPid = browserPidFor(profile)
          if (paintedPid === undefined) await new Promise((r) => setTimeout(r, 250))
        }
        expect(paintedPid).toBeDefined()
        for (let attempt = 0; attempt < 60 && !embedManager.reparent(paintedPid!); attempt++) {
          await new Promise((r) => setTimeout(r, 250))
        }
        embedManager.setBounds(paintedPid!, { x: 30, y: 30, width: 660, height: 420 })
        embedManager.show(paintedPid!)
        // The post-embed repaint is a real page load; measured at ~600 ms.
        await new Promise((r) => setTimeout(r, 4000))

        // The suite's two setup browsers overlap this rectangle. Hide only
        // those known fixtures so the desktop capture cannot read a sibling.
        const initialHwnd = embedManager.windowIdOf(pid)!
        const otherChildHwnd = embedManager.windowIdOf(secondPid)!
        expect(embedManager.hide(pid)).toBe(true)
        expect(embedManager.hide(secondPid)).toBe(true)
        expect(
          await waitFor(
            () => !isVisibleWindow(initialHwnd) && !isVisibleWindow(otherChildHwnd),
            4000,
          ),
        ).toBe(true)
        // Pin immediately before the screen read: another app can cover a
        // window during the repaint wait even if it was topmost beforehand.
        bringToFront(parentHwnd)
        const paintedHwnd = embedManager.windowIdOf(paintedPid!)!
        const pixel = centrePixelOfWindow(paintedHwnd)
        const pixelBelongsToChild =
          win32Query(`CentreBelongsTo([IntPtr]${paintedHwnd})`).trim() === 'True'
        const [red, green, blue] = pixel.split(',').map(Number)
        // #c0392b is (192,57,43); the browser's empty grey is near (43,47,56). The
        // gap is enormous, so this needs no tolerance tuning.
        expect(pixelBelongsToChild, 'centre pixel was covered by another window').toBe(true)
        expect(red, `centre pixel was ${pixel}`).toBeGreaterThan(120)
        expect(green, `centre pixel was ${pixel}`).toBeLessThan(120)
        expect(blue, `centre pixel was ${pixel}`).toBeLessThan(120)
      } finally {
        releaseTopmost(parentHwnd)
        server.close()
        await removeBrowserProfile(profile, 'hecaton-paint-')
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
  let parentPid: number | undefined
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
    // Both profiles launch a real browser. The screen used to be the only one
    // killed here, leaving the visible parent `about:blank` on the desktop. A
    // later run's real-screen pixel assertion then photographed that orphan
    // instead of its own embedded page.
    await embedManager?.dispose()
    await removeBrowserProfiles(root, 'hecaton-detached-', [
      join(root, 'screen'),
      join(root, 'panel'),
    ])
  })

  it('moves the out-of-view window onto the desktop', async () => {
    expect(await embedManager.revealDetachedWindows(screenPid!)).toBe(1)

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

  it('leaves it alone once it is on the desktop', async () => {
    // Idempotence is the property that makes this safe on a timer: it runs
    // several times a second, and a window the user then dragged must stay where
    // they put it.
    const before = detachedBoundsOf(screenPid!)

    expect(await embedManager.revealDetachedWindows(screenPid!)).toBe(0)

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

    expect(await embedManager.revealDetachedWindows(screenPid!)).toBe(0)

    await new Promise((r) => setTimeout(r, 500))
    expect(detachedBoundsOf(screenPid!)?.x).toBe(-32000)
  })

  it('does nothing for a process with no embedded screen', async () => {
    // Before the embed, a screen is *supposed* to be off-screen - that is what
    // keeps it from flashing on the desktop. Rescuing then would undo the
    // architecture rather than help the user.
    const virgin = new NativeWindowManager()
    expect(await virgin.revealDetachedWindows(screenPid!)).toBe(0)
    await virgin.dispose()
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
using System.Text;
using System.Runtime.InteropServices;
public class ProbeUser32 {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern bool IsChild(IntPtr parent, IntPtr child);
  [DllImport("user32.dll")] static extern int GetWindowRgnBox(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr GetTopWindow(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h,uint command);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent,IntPtr after,string cls,string title);
  [DllImport("user32.dll")] static extern bool MoveWindow(IntPtr h,int x,int y,int w,int hh,bool repaint);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int hh,uint flags);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,IntPtr pid);
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint tid,ref GUI value);
  [StructLayout(LayoutKind.Sequential)] struct GUI { public uint Size,Flags; public IntPtr Active,Focus,Capture,Menu,MoveSize,Caret; public RECT CaretRect; }
  public static long Focus(IntPtr h) { var value=new GUI();value.Size=(uint)Marshal.SizeOf(typeof(GUI)); if(!GetGUIThreadInfo(GetWindowThreadProcessId(h,IntPtr.Zero),ref value)) throw new Exception("GUI read failed");return value.Focus.ToInt64(); }
  public static bool Raise(IntPtr h) { return SetWindowPos(h,IntPtr.Zero,0,0,0,0,0x0013); }
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  public static IntPtr InputChild(IntPtr parent) {
    for(IntPtr h=GetTopWindow(parent);h!=IntPtr.Zero;h=GetWindow(h,2)) {
      var name=new StringBuilder(128);GetClassName(h,name,128);
      if(name.ToString()=="Chrome_RenderWidgetHostHWND") return h;
    }
    return IntPtr.Zero;
  }
  public static string Rect(IntPtr h) { RECT r; GetWindowRect(h, out r); return r.L + " " + r.T + " " + r.R + " " + r.B; }
  public static string ClientSize(IntPtr h) { RECT r; GetClientRect(h,out r);return (r.R-r.L)+" "+(r.B-r.T); }
  public static IntPtr DirectChild(IntPtr parent,string cls) { return FindWindowEx(parent,IntPtr.Zero,cls,null); }
  public static bool Move(IntPtr h,int x,int y,int w,int hh) { return MoveWindow(h,x,y,w,hh,true); }
  public static string ClientRelativeRect(IntPtr parent,IntPtr child) { RECT r;GetWindowRect(child,out r);POINT p;p.X=0;p.Y=0;ClientToScreen(parent,ref p);return (r.L-p.X)+" "+(r.T-p.Y)+" "+(r.R-r.L)+" "+(r.B-r.T); }
  public static string RgnBox(IntPtr h) { RECT r; GetWindowRgnBox(h, out r); return r.L + " " + r.T + " " + r.R + " " + r.B; }
  public static bool CentreBelongsTo(IntPtr h) { RECT r; GetWindowRect(h, out r); POINT p; p.X=(r.L+r.R)/2; p.Y=(r.T+r.B)/2; IntPtr at=WindowFromPoint(p); return at==h || IsChild(h,at); }
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

describe.skipIf(!onWindows)('a reveal asked for before the window is embedded', () => {
  /**
   * The bug this covers, reported by the owner on 2026-09-21: turning on every
   * screen at once, the first time the app is opened, leaves some of them
   * black for good - and starting them again fixes it.
   *
   * The sequence that does it is a race between two things the shell does
   * independently. `Orchestrator.start` calls `reparent` the instant the
   * launcher returns a pid, and on a cold first launch the browser's window
   * does not exist yet, so the adapter starts polling for it instead. Meanwhile
   * the screen is already `running`, so the panel redraws, computes a layout
   * and sends it, and the core asks for a `show`. That reveal lands on the
   * window as it still is - top-level and off-screen - and the core records the
   * screen as shown. `embed` then arrives, hides the window to reparent it, and
   * **nobody asks for it to be shown again**: the core only calls `show` when
   * the wanted visibility changes, and as far as it knows the screen is already
   * visible.
   *
   * `embed`'s own comment states the assumption this breaks - "the core's first
   * screens:layout shows it again already positioned" - which holds only while
   * that first layout arrives after the embed. On a warm restart the window is
   * up before `reparent` is called, the embed happens first, and the screen is
   * fine; that is why starting the screens a second time cures it.
   *
   * No pixels here: a black card is not a painting failure but a hidden window,
   * which `IsWindowVisible` answers directly.
   */
  let root: string
  let parentPid: number | undefined
  let parentHwnd: number | undefined
  let screenPid: number | undefined
  let manager: NativeWindowManager

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'hecaton-early-show-'))
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
    for (let attempt = 0; attempt < 60 && parentPid === undefined; attempt++) {
      parentPid = browserPidFor(parentProfile)
      await new Promise((r) => setTimeout(r, 250))
    }
    expect(parentPid).toBeGreaterThan(0)
    await new Promise((r) => setTimeout(r, 2000))
    parentHwnd = new NativeWindowManager().windowIdOf(parentPid!)
    manager = new NativeWindowManager(() => parentHwnd)
  }, 120_000)

  afterAll(async () => {
    await manager?.dispose()
    await removeBrowserProfiles(root, 'hecaton-early-show-', [
      join(root, 'screen'),
      join(root, 'panel'),
    ])
  })

  /** The cell the staged layout frame asks for, in the panel's client area. */
  const CELL = { x: 30, y: 30, width: 660, height: 420 }

  it('cancels a forgotten poll, then still embeds a fresh request visibly in its cell', async () => {
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

    for (let attempt = 0; attempt < 60 && screenPid === undefined; attempt++) {
      screenPid = browserPidFor(screenProfile)
      if (screenPid === undefined) await new Promise((r) => setTimeout(r, 100))
    }
    expect(screenPid).toBeGreaterThan(0)
    let hwnd: number | undefined
    expect(
      await waitFor(
        () => (hwnd = new NativeWindowManager().windowIdOf(screenPid!)) !== undefined,
        25_000,
      ),
    ).toBe(true)

    // Staged, not raced for. On this machine the window is up within the time
    // it takes to read the pid, so a real cold start cannot be waited for
    // reliably - and a test that only sometimes reaches the bug is not a test.
    // Hiding the window is how "it has not appeared yet" is staged: `reparent`
    // looks for a **visible, titled** window, finds nothing, and starts the
    // same poll a cold start puts it in.
    win32Query(`ShowWindow([IntPtr]${hwnd!}, 0)`)
    expect(manager.reparent(screenPid!)).toBe(false)

    // Forgetting while that poll is pending must cancel the poll itself, not
    // merely remove a marker. Otherwise its already-armed timer still runs,
    // sees the window when it appears, and repopulates the adapter with the pid
    // it was explicitly told to release.
    manager.forget(screenPid!)
    win32Query(`ShowWindow([IntPtr]${hwnd!}, 5)`)
    await new Promise((r) => setTimeout(r, 750))
    expect(parentOf(hwnd!)).not.toBe(parentHwnd)

    // Stage the real early-layout sequence after proving cancellation. This is
    // a fresh poll for the same pid; cancelling the old one must not prevent a
    // later explicit reparent request from working.
    win32Query(`ShowWindow([IntPtr]${hwnd!}, 0)`)
    expect(manager.reparent(screenPid!)).toBe(false)

    // The layout frame, arriving in that gap. It carries **both** halves, and
    // both are one-shot: the core calls `show` only when wanted visibility
    // changes, and sends a rectangle only when it differs from the one it
    // believes the screen already has. Spend either on the pre-embed window and
    // the screen never gets it again.
    manager.show(screenPid!)
    manager.setLayout([{ pid: screenPid!, bounds: CELL }])

    // The window turns up, and the poll embeds it - hiding it to reparent it.
    win32Query(`ShowWindow([IntPtr]${hwnd!}, 5)`)
    expect(await waitFor(() => parentOf(hwnd!) === parentHwnd, 25_000)).toBe(true)
    // Past the repaint settle that holds a reveal back, so a screen still
    // hidden here is hidden for good - the black card the owner reported.
    await new Promise((r) => setTimeout(r, 2500))

    expect(isVisibleWindow(hwnd!)).toBe(true)
    // And in its cell, not at the corner it was born in. A screen placed while
    // it was still top-level is placed in **screen** coordinates and then
    // reparented, which is how three of the owner's four came up small and in
    // the wrong corners while the fourth sat at the launch offset, invisible.
    // Letting go of the pid stops the adapter claiming that screen is embedded.
    // The real hazard is a **recycled** id, which a test cannot ask Windows
    // for; what it can pin is the contract the core depends on - that after
    // `forget`, a pid is as unknown as it was before it ever embedded, so the
    // next browser handed that id is embedded rather than waved through.
    expect(manager.reparent(screenPid!)).toBe(true)
    manager.forget(screenPid!)
    expect(manager.windowIdOf(screenPid!)).toBeUndefined()
    expect(manager.reparent(screenPid!)).toBe(false)

    // The clipped region, which is what the user sees - the window itself is
    // `APP_TITLE` taller, because `MoveOne` offsets Chrome's in-client title
    // strip and then excludes it. Every other embedding test measures it this
    // way for the same reason.
    expect(regionSize(hwnd!)).toEqual({ width: CELL.width, height: CELL.height })
  }, 60_000)
})
