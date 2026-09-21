import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ChromeLauncher, bundledBrowserPath } from '@hecaton/browser-engine'
import type { LaunchRequest } from '@hecaton/core'
import { NativeWindowManager } from '@hecaton/window-manager'
import { StartAll } from './power-all.js'

const onWindows = process.platform === 'win32'
const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))
const BROWSER = bundledBrowserPath(join(REPO_ROOT, 'node_modules', 'electron', 'dist', 'resources'))

let profilesRoot: string
let launcher: ChromeLauncher
let manager: NativeWindowManager
let started: number[]
let hostPid: number | undefined
let parentHwnd: number | undefined

function request(slotId: number): LaunchRequest {
  return {
    slotId,
    url: 'about:blank',
    profileDir: `slot-${slotId}`,
    bounds: { x: -10_000, y: -10_000, width: 800, height: 600 },
    mute: true,
    persistProfile: true,
    backgroundThrottling: false,
  }
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

      await stopAll()
      expect(started.every((pid) => !launcher.isAlive(pid))).toBe(true)
    } finally {
      clearInterval(heartbeat)
    }
  }, 60_000)
})
