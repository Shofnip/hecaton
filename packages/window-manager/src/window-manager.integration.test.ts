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

  it('brings the window to the front', () => {
    expect(manager.focus(pid)).toBe(true)
  })

  it('reports failure for a pid with no window, instead of throwing', () => {
    // The orchestrator calls this while a browser is still starting up.
    expect(manager.setBounds(999_999, { x: 0, y: 0, width: 100, height: 100 })).toBe(false)
    expect(manager.focus(999_999)).toBe(false)
    expect(manager.boundsOf(999_999)).toBeUndefined()
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

  describe('a maximised window', () => {
    it('is restored before being placed, so the move is visible', () => {
      // setBounds on a maximised window is accepted and applied underneath: on
      // screen it stays maximised, and only snaps to the new place when the
      // user restores it by hand. "Restore the grid" appeared to do nothing.
      expect(manager.maximize(pid)).toBe(true)
      const asked = { x: 200, y: 200, width: 600, height: 450 }
      expect(manager.setBounds(pid, asked)).toBe(true)
      expect(manager.boundsOf(pid)).toEqual(asked)
    })
  })
})

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
