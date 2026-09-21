/**
 * What an embedded screen's clip actually shows, in pixels.
 *
 * `MoveOne` in `win32-worker.ts` moves a screen's window up by `APP_TITLE` and
 * clips that much off the top, to hide the title bar Chrome draws **inside** its
 * own client area. That height is not a Win32 boundary — Chrome renders it — so
 * nothing in the API can report it and the constant has always been a measured
 * number with a comment telling the next person to re-measure it.
 *
 * It went stale. Measured here against the bundled Chromium (156.0.8065.0) on
 * 2026-09-20: the strip is **30** physical pixels, not 37, so the old constant
 * clipped 7 rows off the top of every game, on every screen — with no symptom an
 * eye would catch on a game page, which is exactly why this is a test and not a
 * comment.
 *
 * It has to be a screenshot. Every cheaper assertion was tried and each one is
 * vacuous: the window rect and the client rect are both placed *by* the constant,
 * so they agree with any value it takes, and the page's own view of itself is
 * unreachable without CDP. The pixels are the only thing that knows.
 *
 * The page is a green band of a known height on black, and the two assertions
 * below bracket it from opposite sides: too small an allowance leaves Chrome's
 * strip showing above the band, too large a one eats rows off the band's top.
 * A wrong constant cannot satisfy both.
 *
 * **Place once, then look.** `MoveOne` posts its move (`SWP_ASYNCWINDOWPOS`) but
 * applies its clip region synchronously, so a window re-placed several times in
 * quick succession can be photographed with the two out of step. Production
 * re-asserts both every frame and converges; a measurement does not get that
 * luxury, and an earlier sweep that moved one window through several allowances
 * read the strip as 4 because of it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { NativeWindowManager } from './native-window-manager.js'

const onWindows = process.platform === 'win32'

/** The browser the app ships. Spelled out for the reason the sibling suite gives. */
const CHROME = join(
  fileURLToPath(new URL('../../..', import.meta.url)),
  'node_modules\\electron\\dist\\resources\\chromium\\chrome-win\\chrome.exe',
)

/** Height of the page's green band, in CSS pixels. */
const BAND = 12

/**
 * The cell the screen is placed in, in the host window's client area.
 *
 * Offset from the origin so a failure cannot be an accident of the host window's
 * own border landing on the sampled column.
 */
const CELL = { x: 20, y: 20, width: 620, height: 350 }

/**
 * A plain Win32 window to embed into, and a screen reader, in one PowerShell.
 *
 * The adapter needs a parent handle, which in the app is Electron's panel. A
 * bare WinForms window is the same thing as far as `SetParent` is concerned, and
 * it keeps this suite out of Electron — vitest runs in plain node.
 *
 * Protocol: prints "<hwnd> <clientX> <clientY>" once the window is up, then one
 * command line in, one reply out. `row <n>` returns the colour of the pixel n
 * rows below the cell's top edge, as six hex digits.
 */
const HOST_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$form = New-Object System.Windows.Forms.Form
$form.Text = 'hecaton clip test'
$form.FormBorderStyle = 'FixedSingle'
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point 80, 60
$form.ClientSize = New-Object System.Drawing.Size 900, 500
$form.BackColor = [System.Drawing.Color]::FromArgb(21, 23, 27)
$form.TopMost = $true
$form.Show()
$form.Refresh()
$origin = $form.PointToScreen((New-Object System.Drawing.Point 0, 0))
[Console]::Out.WriteLine("$($form.Handle.ToInt64()) $($origin.X) $($origin.Y)")
[Console]::Out.Flush()
while ($true) {
  [System.Windows.Forms.Application]::DoEvents()
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $a = $line.Trim() -split ' '
  if ($a[0] -eq 'exit') { [Console]::Out.WriteLine('OK'); [Console]::Out.Flush(); break }
  if ($a[0] -eq 'row') {
    # One pixel, sampled from the middle of the cell so neither edge can answer
    # for it. Read off the composited desktop, which is what the user sees.
    $x = [int]$a[1]; $y = [int]$a[2]
    $bmp = New-Object System.Drawing.Bitmap 1, 1
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size 1, 1))
    $p = $bmp.GetPixel(0, 0)
    $g.Dispose(); $bmp.Dispose()
    [Console]::Out.WriteLine(('OK {0:x2}{1:x2}{2:x2}' -f $p.R, $p.G, $p.B))
    [Console]::Out.Flush()
  }
}
[System.Windows.Forms.Application]::Exit()
`

class Host {
  readonly proc: ChildProcessWithoutNullStreams
  private readonly queue: ((line: string) => void)[] = []
  readonly up: Promise<{ hwnd: number; x: number; y: number }>

  constructor() {
    this.proc = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-STA', '-Command', HOST_SCRIPT],
      { windowsHide: false },
    )
    let announce: (value: { hwnd: number; x: number; y: number }) => void = () => {}
    this.up = new Promise((resolve) => (announce = resolve))
    let started = false
    createInterface({ input: this.proc.stdout }).on('line', (line) => {
      if (!started) {
        started = true
        const [hwnd, x, y] = line.trim().split(' ').map(Number)
        announce({ hwnd: hwnd!, x: x!, y: y! })
        return
      }
      this.queue.shift()?.(line)
    })
  }

  send(command: string): Promise<string> {
    return new Promise((resolve) => {
      this.queue.push((line) => resolve(line.replace(/^OK ?/, '').trim()))
      this.proc.stdin.write(command + '\n')
    })
  }

  async stop(): Promise<void> {
    await Promise.race([this.send('exit'), sleep(1500)])
    this.proc.kill()
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** The browser process for a profile, matched the way the launcher matches it. */
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

async function removeBrowserProfile(profilePath: string): Promise<void> {
  const safeProfile = resolve(profilePath)
  if (
    dirname(safeProfile) !== resolve(tmpdir()) ||
    !basename(safeProfile).startsWith('hecaton-clip-')
  ) {
    throw new Error(`refusing to remove unexpected clip profile ${JSON.stringify(safeProfile)}`)
  }
  for (let attempt = 0; attempt < 40; attempt++) {
    const browserPid = browserPidFor(safeProfile)
    if (browserPid === undefined) break
    try {
      execFileSync('taskkill', ['/PID', String(browserPid), '/F', '/T'], { stdio: 'ignore' })
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
  throw new Error(`could not remove temporary clip profile ${safeProfile}: ${String(lastError)}`)
}

let host: Host
let manager: NativeWindowManager
let profileRoot: string
let pid: number
let origin: { x: number; y: number }

describe.skipIf(!onWindows)('an embedded screen shows its page from the first row', () => {
  beforeAll(async () => {
    // Fails rather than skips, for the reason the sibling suite records: a tree
    // that has not fetched the browser is fixable, not a reason to report green
    // over an adapter that never ran.
    expect(existsSync(CHROME), `bundled browser missing at ${CHROME}`).toBe(true)

    host = new Host()
    const up = await host.up
    origin = { x: up.x, y: up.y }
    manager = new NativeWindowManager(() => up.hwnd)

    profileRoot = mkdtempSync(join(tmpdir(), 'hecaton-clip-'))
    const page = join(profileRoot, 'band.html')
    writeFileSync(
      page,
      `<!doctype html><meta charset="utf-8"><title>band</title>` +
        `<style>html,body{margin:0;height:100%;background:#000}` +
        `#b{height:${BAND}px;background:#00ff00}</style><div id="b"></div>`,
    )

    const child = spawn(
      CHROME,
      [
        `--user-data-dir=${profileRoot}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--window-position=-32000,-32000',
        '--window-size=900,600',
        `--app=file:///${page.replace(/\\/g, '/')}`,
      ],
      { detached: true, stdio: 'ignore' },
    )
    child.unref()

    for (let attempt = 0; attempt < 80; attempt++) {
      const found = browserPidFor(profileRoot)
      if (found !== undefined) {
        pid = found
        break
      }
      await sleep(250)
    }
    expect(pid, 'the bundled browser did not start').toBeGreaterThan(0)

    // Embed, then wait out the repaint the adapter holds the reveal for — it
    // reloads the page on embed (ADR-0017) and there is no event that says
    // "painted", only elapsed time.
    for (let attempt = 0; attempt < 80 && !manager.reparent(pid); attempt++) await sleep(250)
    await sleep(3000)
    manager.show(pid)
    await sleep(1500)

    // Placed more than once, deliberately. `MoveOne` computes the window's frame
    // insets, posts the move (`SWP_ASYNCWINDOWPOS`) and applies the clip region
    // synchronously — so the very first placement of a freshly embedded window
    // can use insets that the move then invalidates, and land with the region
    // and the position out of step. Measured over repeated runs: a single
    // placement lands wrong about two times in five, in both directions
    // (Chrome's strip showing, or the page's top over-clipped).
    //
    // Production never notices because the renderer re-emits its layout on every
    // state push and every resize frame, so the screen converges within a frame
    // or two. Placing twice here is that same convergence, not a workaround for
    // the assertion: measuring the settled state is the honest thing to measure,
    // and a single shot measures a transient.
    for (let pass = 0; pass < 2; pass++) {
      manager.setBounds(pid, CELL)
      await sleep(1200)
    }
  }, 120_000)

  afterAll(async () => {
    manager?.close(pid)
    await sleep(1500)
    await manager?.dispose()
    await host?.stop()
    await removeBrowserProfile(profileRoot)
  }, 60_000)

  /** The colour `rows` pixels below the cell's top edge, in the middle column. */
  const rowColour = (rows: number): Promise<string> =>
    host.send(`row ${origin.x + CELL.x + Math.round(CELL.width / 2)} ${origin.y + CELL.y + rows}`)

  /**
   * The three readings that together can only describe a correctly placed cell.
   *
   * They are checked as one set, and that is the point. Each alone is satisfied
   * by some wrong placement — the band's first row survives a clip that ate the
   * strip as well, its last row survives a screen sitting too low — but nothing
   * except the page's own top row landing on the cell's own top row satisfies
   * all three. So the set can be polled without the poll making it vacuous.
   */
  const bracket = async (): Promise<string> =>
    [
      await rowColour(1), //          inside the band: no strip above it
      await rowColour(BAND - 1), //   still the band: none of its top clipped off
      await rowColour(BAND + 1), //   past the band: the clip has not slipped down
    ].join(' ')

  const CORRECT = '00ff00 00ff00 000000'

  it('shows the page from its first row, with no strip above and nothing clipped', async () => {
    // Polled, and re-placed between polls, because that is what the app does:
    // the renderer re-emits its layout on every state push and resize frame, so
    // a screen is placed continuously rather than once. A single placement is
    // measurably unreliable — `MoveOne` reads the window's frame insets, posts
    // the move (`SWP_ASYNCWINDOWPOS`) and applies the clip region synchronously,
    // so one placement in isolation can land with region and position out of
    // step, in either direction. Re-placing is the adapter's own convergence,
    // not a retry-until-green: the bracket above rejects every wrong placement,
    // so a wrong constant never satisfies it however long this runs.
    let seen = ''
    for (let attempt = 0; attempt < 12; attempt++) {
      seen = await bracket()
      if (seen === CORRECT) break
      manager.setBounds(pid, CELL)
      await sleep(900)
    }
    expect(seen, 'rows 1, BAND-1 and BAND+1 of the cell').toBe(CORRECT)
  }, 60_000)
})
