import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ChromeLauncher, bundledBrowserPath } from '@hecaton/browser-engine'
import type { LaunchRequest } from '@hecaton/core'
import { NativeWindowManager } from '@hecaton/window-manager'
import { StartAll } from './power-all.js'

const onWindows = process.platform === 'win32'
const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))
const BROWSER =
  process.env.HECATON_TEST_BROWSER ??
  bundledBrowserPath(join(REPO_ROOT, 'node_modules', 'electron', 'dist', 'resources'))

let profilesRoot: string
let launcher: ChromeLauncher
let manager: NativeWindowManager
let started: number[]
let hostPid: number | undefined
let parentHwnd: number | undefined

function request(slotId: number, url = 'about:blank'): LaunchRequest {
  return {
    slotId,
    url,
    profileDir: `slot-${slotId}`,
    bounds: { x: -10_000, y: -10_000, width: 800, height: 600 },
    mute: true,
    persistProfile: true,
    backgroundThrottling: false,
  }
}

function bringToFront(hwnd: number): void {
  execFileSync('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;" +
      'public class PowerAllFront{[DllImport("user32.dll")]public static extern bool SetWindowPos(' +
      "IntPtr h,IntPtr a,int x,int y,int cx,int cy,uint f);}'; " +
      `[void][PowerAllFront]::SetWindowPos([IntPtr]${hwnd}, [IntPtr](-1), 0, 0, 0, 0, 0x0043)`,
  ])
}

function releaseTopmost(hwnd: number): void {
  execFileSync('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;" +
      'public class PowerAllBack{[DllImport("user32.dll")]public static extern bool SetWindowPos(' +
      "IntPtr h,IntPtr a,int x,int y,int cx,int cy,uint f);}'; " +
      `[void][PowerAllBack]::SetWindowPos([IntPtr]${hwnd}, [IntPtr](-2), 0, 0, 0, 0, 0x0043)`,
  ])
}

interface PaintedCentre {
  hwnd: number
  belongs: boolean
  visible: boolean
  rgb: [number, number, number]
}

/** Reads every screen in one desktop capture pass, without hiding or rearranging siblings. */
function paintedCentres(hwnds: readonly number[]): PaintedCentre[] {
  const handles = hwnds.join(',')
  const script = `
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PowerAllPixel {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int L,T,R,B; }
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
  [DllImport("user32.dll")] public static extern int GetWindowRgnBox(IntPtr h, out Rect r);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point p);
  [DllImport("user32.dll")] public static extern bool IsChild(IntPtr parent, IntPtr child);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
}
'@
$out = foreach ($h in @(${handles})) {
  $window = New-Object PowerAllPixel+Rect
  $clip = New-Object PowerAllPixel+Rect
  [void][PowerAllPixel]::GetWindowRect([IntPtr]$h, [ref]$window)
  [void][PowerAllPixel]::GetWindowRgnBox([IntPtr]$h, [ref]$clip)
  $point = New-Object PowerAllPixel+Point
  $point.X = $window.L + [int](($clip.L + $clip.R) / 2)
  $point.Y = $window.T + [int](($clip.T + $clip.B) / 2)
  $owner = [PowerAllPixel]::WindowFromPoint($point)
  $belongs = ($owner -eq [IntPtr]$h) -or [PowerAllPixel]::IsChild([IntPtr]$h, $owner)
  $bitmap = New-Object System.Drawing.Bitmap(1, 1)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($point.X, $point.Y, 0, 0, (New-Object System.Drawing.Size(1, 1)))
  $pixel = $bitmap.GetPixel(0, 0)
  $graphics.Dispose(); $bitmap.Dispose()
  "${'$'}{h}|${'$'}{belongs}|$([PowerAllPixel]::IsWindowVisible([IntPtr]$h))|$($pixel.R),$($pixel.G),$($pixel.B)"
}
$out -join ';'
`
  const output = execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  ).trim()
  return output.split(';').map((row) => {
    const [hwnd, belongs, visible, rgb] = row.split('|')
    return {
      hwnd: Number(hwnd),
      belongs: belongs === 'True',
      visible: visible === 'True',
      rgb: rgb!.split(',').map(Number) as [number, number, number],
    }
  })
}

async function stopAll(): Promise<void> {
  await Promise.allSettled(started.map((pid) => launcher.stop(pid)))
  if (hostPid !== undefined) await launcher.stop(hostPid)
  await manager.dispose()
  const allPids = hostPid === undefined ? started : [...started, hostPid]
  for (let attempt = 0; attempt < 20; attempt++) {
    if (allPids.every((pid) => !launcher.isAlive(pid))) return
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250))
  }
}

async function waitFor<T>(read: () => T | undefined, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = read()
    if (value !== undefined) return value
    if (Date.now() >= deadline) throw new Error('window did not appear in time')
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
}

function parentOf(hwnd: number): number {
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class PowerAllUser32 {
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flag);
}
'@
[PowerAllUser32]::GetAncestor([IntPtr]${hwnd}, 1).ToInt64()
`
  return Number(
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim(),
  )
}

function visibleChildRect(
  hwnd: number,
  parent: number,
): { x: number; y: number; width: number; height: number } {
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class PowerAllRect {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern int GetWindowRgnBox(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  public static string Read(IntPtr child, IntPtr parent) {
    RECT window, region; POINT origin; origin.X=0; origin.Y=0;
    GetWindowRect(child, out window); GetWindowRgnBox(child, out region); ClientToScreen(parent, ref origin);
    return (window.L+region.L-origin.X) + "," + (window.T+region.T-origin.Y) + "," +
      (region.R-region.L) + "," + (region.B-region.T);
  }
}
'@
[PowerAllRect]::Read([IntPtr]${hwnd}, [IntPtr]${parent})
`
  const [x, y, width, height] = execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  )
    .trim()
    .split(',')
    .map(Number)
  return { x: x!, y: y!, width: width!, height: height! }
}

describe.skipIf(!onWindows)('starting four real browsers together', () => {
  beforeAll(() => {
    expect(existsSync(BROWSER), `bundled browser missing at ${BROWSER}`).toBe(true)
  })

  beforeEach(() => {
    profilesRoot = mkdtempSync(join(tmpdir(), 'hecaton-power-all-'))
    launcher = new ChromeLauncher(profilesRoot, BROWSER)
    manager = new NativeWindowManager(() => parentHwnd)
    started = []
    hostPid = undefined
    parentHwnd = undefined
  })

  afterEach(async () => {
    await stopAll()
    const safeRoot = resolve(profilesRoot)
    expect(dirname(safeRoot)).toBe(resolve(tmpdir()))
    expect(safeRoot.startsWith(join(resolve(tmpdir()), 'hecaton-power-all-'))).toBe(true)
    rmSync(safeRoot, { recursive: true, force: true })
  })

  it('dispatches without serial gaps, keeps the event loop responsive, and cleans up', async () => {
    hostPid = await launcher.launch(request(99))
    parentHwnd = await waitFor(() => manager.windowIdOf(hostPid!))

    const requestedAt: number[] = []
    const heartbeatGaps: number[] = []
    const childWindows = new Map<number, number>()
    let previousBeat = performance.now()
    const heartbeat = setInterval(() => {
      const now = performance.now()
      heartbeatGaps.push(now - previousBeat)
      previousBeat = now
    }, 16)
    const beganAt = performance.now()

    try {
      const accepted = await new StartAll().run(
        [1, 2, 3, 4],
        async (id) => {
          requestedAt.push(performance.now())
          const pid = await launcher.launch(request(id))
          started.push(pid)
          const hwnd = await waitFor(() => manager.windowIdOf(pid))
          childWindows.set(pid, hwnd)
          expect(manager.reparent(pid)).toBe(true)
        },
        (error) => {
          throw error
        },
      )
      const readyIn = performance.now() - beganAt
      clearInterval(heartbeat)

      expect(accepted).toBe(true)
      expect(started).toHaveLength(4)
      expect(new Set(started).size).toBe(4)
      expect(Math.max(...requestedAt) - Math.min(...requestedAt)).toBeLessThan(500)
      expect(readyIn).toBeLessThan(20_000)
      expect(heartbeatGaps.length).toBeGreaterThan(0)
      expect(Math.max(...heartbeatGaps)).toBeLessThan(500)
      for (const hwnd of childWindows.values()) {
        await waitFor(() => (parentOf(hwnd) === parentHwnd ? true : undefined))
      }

      const ordered = [...childWindows.entries()]
      const beforeCommands = manager.layoutCommandsSent
      const beforeRegions = manager.layoutRegionsApplied
      for (let frame = 0; frame < 40; frame++) {
        manager.setLayout(
          ordered.map(([pid], index) => ({
            pid,
            bounds: {
              x: 20 + (index % 2) * 390,
              y: 20 + Math.floor(index / 2) * 280,
              width: 350 + (frame % 20) * 3,
              height: 230 + (frame % 15) * 2,
            },
          })),
        )
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 16))
      }
      const final = ordered.map(([pid], index) => ({
        pid,
        bounds: {
          x: 20 + (index % 2) * 390,
          y: 20 + Math.floor(index / 2) * 280,
          width: 360,
          height: 240,
        },
      }))
      manager.setLayout(final)
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500))

      const commands = manager.layoutCommandsSent - beforeCommands
      const regions = manager.layoutRegionsApplied - beforeRegions
      expect(commands).toBeGreaterThan(0)
      expect(regions).toBeLessThan(commands * 4)
      for (const placement of final) {
        const hwnd = childWindows.get(placement.pid)!
        expect(visibleChildRect(hwnd, parentHwnd!)).toEqual(placement.bounds)
      }

      await stopAll()
      expect(started.every((pid) => !launcher.isAlive(pid))).toBe(true)
    } finally {
      clearInterval(heartbeat)
    }
  }, 60_000)

  it('paints every real HTTP app when all four start together', async () => {
    const colours = [
      [192, 57, 43],
      [39, 174, 96],
      [41, 128, 185],
      [243, 156, 18],
    ] as const
    const requests = new Map<string, number>()
    const server = createServer((request, response) => {
      const path = request.url ?? ''
      const match = /^\/([1-4])$/.exec(path)
      if (match === null) {
        response.writeHead(204)
        response.end()
        return
      }
      requests.set(path, (requests.get(path) ?? 0) + 1)
      const slotId = Number(match[1])
      const [red, green, blue] = colours[slotId - 1]!
      // The real game requests finish independently, not in one synthetic
      // network tick. Giving each request the same delay preserves the arrival
      // spacing created by the adapter's one-second automatic-reload queue.
      setTimeout(() => {
        response.writeHead(200, {
          'content-type': 'text/html',
          'cache-control': 'no-store',
        })
        response.end(
          `<!doctype html><meta charset=utf-8><body style="margin:0;background:rgb(${red},${green},${blue})">`,
        )
      }, 2000)
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const port = (server.address() as { port: number }).port

    try {
      hostPid = await launcher.launch(request(99))
      parentHwnd = await waitFor(() => manager.windowIdOf(hostPid!))
      expect(manager.setBounds(hostPid, { x: 80, y: 80, width: 1000, height: 760 })).toBe(true)

      const childWindows = new Map<number, { pid: number; hwnd: number }>()
      await Promise.all(
        [1, 2, 3, 4].map(async (id) => {
          const pid = await launcher.launch(request(id, `http://127.0.0.1:${port}/${id}`))
          started.push(pid)
          const hwnd = await waitFor(() => manager.windowIdOf(pid))
          childWindows.set(id, { pid, hwnd })
        }),
      )

      const ordered = [1, 2, 3, 4].map((slotId) => childWindows.get(slotId)!)
      // All four windows exist before the first embed, matching the user's
      // exact "open all" navigation burst. Letting whichever WMI lookup wins
      // embed early accidentally serialises the fixture before the production
      // timing gets a chance to do so.
      for (const { pid } of ordered) expect(manager.reparent(pid)).toBe(true)
      const placements = ordered.map(({ pid }, index) => ({
        pid,
        bounds: {
          x: 20 + (index % 2) * 470,
          y: 20 + Math.floor(index / 2) * 340,
          width: 440,
          height: 300,
        },
      }))
      manager.setLayout(placements)
      for (const { pid } of ordered) expect(manager.show(pid)).toBe(true)
      await waitFor(
        () => ([1, 2, 3, 4].every((id) => (requests.get(`/${id}`) ?? 0) >= 1) ? true : undefined),
        20_000,
      )
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 5500))

      for (const { hwnd } of ordered) {
        expect(parentOf(hwnd)).toBe(parentHwnd)
      }
      for (const placement of placements) {
        const screen = ordered.find(({ pid }) => pid === placement.pid)!
        expect(visibleChildRect(screen.hwnd, parentHwnd)).toEqual(placement.bounds)
      }

      // Chrome can briefly put the host's own render widget over its foreign
      // children. Repair sibling order before reading the real desktop; retry
      // only that independently measurable ownership condition, never colour.
      let centres: PaintedCentre[] = []
      for (let attempt = 0; attempt < 10; attempt++) {
        manager.restoreEmbeddedZOrder()
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 300))
        bringToFront(parentHwnd)
        try {
          centres = paintedCentres(ordered.map(({ hwnd }) => hwnd))
        } finally {
          releaseTopmost(parentHwnd)
        }
        if (centres.every(({ belongs }) => belongs)) break
      }

      expect(centres).toHaveLength(4)
      for (const [index, actual] of centres.entries()) {
        expect(actual.hwnd).toBe(ordered[index]!.hwnd)
        expect(actual.visible, `screen ${index + 1} was hidden`).toBe(true)
        expect(actual.belongs, `screen ${index + 1} was covered by another window`).toBe(true)
        expect(
          actual.rgb,
          `screen ${index + 1} painted ${actual.rgb.join(',')}; requests ${JSON.stringify([...requests])}`,
        ).toEqual(colours[index])
      }
    } finally {
      server.close()
      server.closeAllConnections()
    }
  }, 90_000)
})
