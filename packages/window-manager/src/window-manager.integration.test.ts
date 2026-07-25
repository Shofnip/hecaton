import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { NativeWindowManager } from './native-window-manager.js'

const onWindows = process.platform === 'win32'

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].find((path) => existsSync(path))

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

describe.skipIf(!onWindows || !CHROME)('NativeWindowManager', () => {
  beforeAll(async () => {
    manager = new NativeWindowManager()
    profileRoot = mkdtempSync(join(tmpdir(), 'helloweb-wm-'))

    const child = spawn(
      CHROME!,
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
      parentProfile = mkdtempSync(join(tmpdir(), 'helloweb-panel-'))
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
  })
})

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
