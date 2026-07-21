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
})
