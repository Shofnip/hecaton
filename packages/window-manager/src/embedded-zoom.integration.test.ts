import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, execFileSync } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { windowManager } from 'node-window-manager'
import { NativeWindowManager } from './native-window-manager.js'
import { Win32Worker } from './win32-worker.js'

const CHROME = join(
  fileURLToPath(new URL('../../..', import.meta.url)),
  'node_modules',
  'electron',
  'dist',
  'resources',
  'chromium',
  'chrome-win',
  'chrome.exe',
)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const HOST = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public class ZoomTitle { [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n); public static string Read(long h) { var s=new StringBuilder(512); GetWindowText((IntPtr)h,s,512); return s.ToString(); } }'
$f = New-Object System.Windows.Forms.Form
$f.Text = 'hecaton zoom integration'
$f.Width = 1600; $f.Height = 940
$f.Show()
[Console]::Out.WriteLine($f.Handle.ToInt64()); [Console]::Out.Flush()
while ($true) {
  [System.Windows.Forms.Application]::DoEvents()
  $line = [Console]::In.ReadLine()
  if ($null -eq $line -or $line -eq 'exit') { break }
  [Console]::Out.WriteLine([ZoomTitle]::Read([long]$line)); [Console]::Out.Flush()
}
$f.Dispose()
`

/**
 * Chrome's own zoom bubble, as the probe in `spike/bubble` found it: a visible
 * top-level window of the browser process with a **blank** title, which is the
 * mirror image of the rule `extraWindowsOf` uses. Every other untitled window
 * the browser owns was measured invisible, so this finds the bubble and
 * nothing else.
 */
function zoomBubbles(browserPid: number, screenHwnd: number): number[] {
  return windowManager
    .getWindows()
    .filter(
      (window) =>
        window.processId === browserPid &&
        window.id !== screenHwnd &&
        window.isVisible() &&
        !window.getTitle().trim(),
    )
    .map((window) => window.id)
}

/** Finds the browser root by exact profile, never by title or a spawn pid. */
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
    windowsHide: true,
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

function temporaryProfile(profilePath: string): string {
  const resolved = resolve(profilePath)
  if (
    dirname(resolved) !== resolve(tmpdir()) ||
    !basename(resolved).startsWith('hecaton-native-zoom-')
  ) {
    throw new Error(`refusing to remove unexpected profile path ${JSON.stringify(resolved)}`)
  }
  return resolved
}

async function removeBrowserProfile(profilePath: string): Promise<void> {
  const safeProfile = temporaryProfile(profilePath)

  for (let attempt = 0; attempt < 40; attempt++) {
    const remainingPid = browserPidFor(safeProfile)
    if (remainingPid === undefined) break
    try {
      execFileSync('taskkill', ['/PID', String(remainingPid), '/F', '/T'], { stdio: 'ignore' })
    } catch {
      // The next exact-profile query decides whether it is really gone.
    }
    await sleep(250)
  }
  const remainingPid = browserPidFor(safeProfile)
  if (remainingPid !== undefined) {
    throw new Error(`browser ${remainingPid} still holds temporary profile ${safeProfile}`)
  }

  let lastError: unknown
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      rmSync(safeProfile, { recursive: true, force: true })
      if (!existsSync(safeProfile)) return
    } catch (error) {
      lastError = error
    }
    await sleep(250)
  }
  throw new Error(`could not remove temporary profile ${safeProfile}: ${String(lastError)}`)
}

let host: ChildProcessWithoutNullStreams
let server: Server
let manager: NativeWindowManager
let profile: string
let pid: number | undefined
let hwnd: number
const replies: ((text: string) => void)[] = []

function readTitle(): Promise<string> {
  return new Promise((resolve) => {
    replies.push(resolve)
    host.stdin.write(hwnd + '\n')
  })
}
async function actualZoom(target: number): Promise<void> {
  const deadline = Date.now() + 8000
  let title: string
  do {
    title = await readTitle()
    const match = /^zoom=([\d.]+)/.exec(title)
    if (match && Math.abs(Number(match[1]) - target) < 0.001) return
    await sleep(100)
  } while (Date.now() < deadline)
  throw new Error(`wanted zoom ${target}, local probe reported ${title}`)
}

describe.skipIf(process.platform !== 'win32')('embedded page zoom through the real adapter', () => {
  beforeAll(async () => {
    if (!existsSync(CHROME))
      throw new Error(`bundled browser missing at ${CHROME}; run node scripts/fetch-chromium.mjs`)
    host = spawn(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-STA',
        '-EncodedCommand',
        Buffer.from(HOST, 'utf16le').toString('base64'),
      ],
      { windowsHide: true },
    )
    const parent = new Promise<number>((resolve) => replies.push((text) => resolve(Number(text))))
    createInterface({ input: host.stdout }).on('line', (text) => replies.shift()?.(text))
    const parentHwnd = await parent
    expect(parentHwnd).toBeGreaterThan(0)
    manager = new NativeWindowManager(() => parentHwnd)
    server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      // Instrumented local page, no CDP and no injection into a game.
      res.end(
        '<!doctype html><body>zoom calibration<script>setInterval(()=>document.title="zoom="+devicePixelRatio+" width="+innerWidth,50)</script>',
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('no server port')
    profile = mkdtempSync(join(tmpdir(), 'hecaton-native-zoom-'))
    // Synthetic fixture before first launch; production never edits Preferences.
    mkdirSync(join(profile, 'Default'))
    writeFileSync(
      join(profile, 'Default', 'Preferences'),
      JSON.stringify({ partition: { default_zoom_level: { x: Math.log(1.25) / Math.log(1.2) } } }),
    )
    const child = spawn(
      CHROME,
      [
        `--user-data-dir=${profile}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--window-position=80,60',
        '--window-size=800,600',
        `--app=http://127.0.0.1:${address.port}/`,
      ],
      { detached: true, stdio: 'ignore' },
    )
    child.unref()
    // Resolve by exact profile, not title or the launcher stub pid.
    for (let i = 0; i < 40 && pid === undefined; i++) {
      pid = browserPidFor(profile)
      if (!pid) await sleep(200)
    }
    expect(pid).toBeGreaterThan(0)
    for (let i = 0; i < 40; i++) {
      const found = manager.windowIdOf(pid!)
      if (found) {
        hwnd = found
        break
      }
      await sleep(100)
    }
    expect(hwnd).toBeGreaterThan(0)
    expect(manager.reparent(pid!)).toBe(true)
    manager.setLayout([{ pid: pid!, bounds: { x: 40, y: 60, width: 620, height: 350 } }])
    manager.show(pid!)
    await actualZoom(1.25)
  }, 60000)

  afterAll(async () => {
    await manager?.dispose()
    host?.stdin.end('exit\n')
    host?.kill()
    server?.close()
    if (profile) await removeBrowserProfile(profile)
  })

  it('applies card/focus/card from a non-100% default without relaunch', async () => {
    // 125 -> reset -> 110 -> 100 -> ... -> 33 1/3 = eight decrements.
    expect(await manager.applyZoom(pid!, -8)).toBe(true)
    await actualZoom(1 / 3)
    manager.setLayout([{ pid: pid!, bounds: { x: 40, y: 60, width: 1500, height: 800 } }])
    expect(await manager.applyZoom(pid!, -2)).toBe(true)
    await actualZoom(1)
    manager.setLayout([{ pid: pid!, bounds: { x: 40, y: 60, width: 620, height: 350 } }])
    expect(await manager.applyZoom(pid!, -8)).toBe(true)
    await actualZoom(1 / 3)
  })

  it('rejects missing windows and malformed command counts', async () => {
    expect(await manager.applyZoom(99999999, 0)).toBe(false)
    for (const steps of [NaN, Infinity, 1.5, -50, 50])
      expect(await manager.applyZoom(pid!, steps)).toBe(false)
  })

  it('rejects a real window paired with another process id', async () => {
    const worker = new Win32Worker()
    try {
      await expect(worker.send(`zoom ${hwnd} ${process.pid} 0`)).rejects.toThrow(
        'invalid zoom target',
      )
      await actualZoom(1 / 3)
    } finally {
      await worker.dispose()
    }
  })

  it('cancels a pending zoom when hidden and accepts the new target after showing', async () => {
    expect(manager.reload(pid!)).toBe(true)
    const stale = manager.applyZoom(pid!, -8)
    expect(manager.hide(pid!)).toBe(true)
    expect(await stale).toBe(false)
    expect(manager.show(pid!)).toBe(true)
    expect(await manager.applyZoom(pid!, -2)).toBe(true)
    await actualZoom(1)
  })

  it('drops a waiting target superseded by a reload and a newer target', async () => {
    expect(manager.reload(pid!)).toBe(true)
    const stale = manager.applyZoom(pid!, -8)
    expect(manager.reload(pid!)).toBe(true)
    const latest = manager.applyZoom(pid!, -2)
    expect(await stale).toBe(false)
    expect(await latest).toBe(true)
    await actualZoom(1)
  })

  it('reapplies after a reload and leaves the existing default untouched', async () => {
    expect(manager.reload(pid!)).toBe(true)
    expect(await manager.applyZoom(pid!, -2)).toBe(true)
    await actualZoom(1)
    expect(await manager.applyZoom(pid!, 0)).toBe(true)
    await actualZoom(1.25)
  })

  it('leaves no zoom bubble on the wall', async () => {
    // Measured 2026-09-21 in spike/bubble: the bubble becomes visible within
    // ~100 ms of the command and dismisses itself only after ~1.3 s. So a
    // window still visible most of a second later is one the user sees, and
    // before the suppressor existed this is exactly what every focus and
    // fullscreen transition put on each card.
    manager.setLayout([{ pid: pid!, bounds: { x: 40, y: 60, width: 620, height: 350 } }])
    expect(await manager.applyZoom(pid!, -8)).toBe(true)
    await sleep(700)
    expect(zoomBubbles(pid!, hwnd)).toEqual([])
    // The page keeps the zoom it was given: hiding the bubble is not undoing
    // the command that provoked it.
    await actualZoom(1 / 3)
  })

  it('keeps suppressing across a burst, since the bubble is a new window each time', async () => {
    // The handle is not reused - spike/bubble saw three different ones - so a
    // suppressor that remembered one window would miss the next. The gap is
    // shorter than the bubble's own ~1.3 s life, so each command arrives while
    // the previous bubble would still be on screen.
    for (const steps of [-7, -6, -5]) {
      expect(await manager.applyZoom(pid!, steps)).toBe(true)
      await sleep(250)
    }
    await sleep(600)
    expect(zoomBubbles(pid!, hwnd)).toEqual([])
    // Each command resets to this profile's 125% default first, so the page
    // ends where the **last** one put it: five presets below 1.25 is 0.75.
    await actualZoom(0.75)
  })
})
