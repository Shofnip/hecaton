import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { ChromeLauncher } from './chrome-launcher.js'
import { bundledBrowserPath } from './browser-paths.js'
import type { LaunchRequest } from '@hecaton/core'

// The real bundled browser, real processes. Windows only, and skipped elsewhere
// so CI on Linux stays useful for everything else.
const onWindows = process.platform === 'win32'

/**
 * The browser the app ships, at the path a development tree puts it.
 *
 * Resolved through Electron's own resources directory rather than straight out
 * of `vendor/`, on purpose: that is the junction `scripts/fetch-chromium.mjs`
 * creates and the exact root `main.ts` passes at runtime, so this exercises the
 * dev half of the single load path instead of a shortcut around it.
 */
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const BROWSER = bundledBrowserPath(join(REPO_ROOT, 'node_modules', 'electron', 'dist', 'resources'))

let profilesRoot: string
let launcher: ChromeLauncher
const started: number[] = []

function request(slotId: number, overrides: Partial<LaunchRequest> = {}): LaunchRequest {
  return {
    slotId,
    // about:blank keeps the test off the network and off the game's servers.
    url: 'about:blank',
    profileDir: `slot-${slotId}`,
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    mute: true,
    persistProfile: true,
    backgroundThrottling: false,
    ...overrides,
  }
}

describe.skipIf(!onWindows)('ChromeLauncher', () => {
  beforeAll(() => {
    // Fails rather than skips, as it always has - a suite that quietly passes
    // when the thing it tests is absent is the vacuous green this repository
    // keeps hunting. What is absent has changed, though: it used to be the
    // user's installed Chrome, and is now the browser the app ships. If this
    // fails, run `node scripts/fetch-chromium.mjs`.
    expect(existsSync(BROWSER), `bundled browser missing at ${BROWSER}`).toBe(true)
  })

  beforeEach(() => {
    profilesRoot = mkdtempSync(join(tmpdir(), 'hecaton-chrome-'))
    launcher = new ChromeLauncher(profilesRoot, BROWSER)
    started.length = 0
  })

  afterEach(async () => {
    for (const pid of started) {
      try {
        await launcher.stop(pid)
      } catch {
        // already gone
      }
    }
    // Chrome keeps file handles open for a moment after the process dies, so a
    // straight rmSync races it and fails with EPERM.
    for (let attempt = 0; attempt < 20; attempt++) {
      if (started.every((pid) => !launcher.isAlive(pid))) break
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        rmSync(profilesRoot, { recursive: true, force: true })
        return
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }
    // Leaving a temp dir behind must not fail the suite; the OS cleans it up.
  })

  it('launches Chrome and reports a live pid', async () => {
    const pid = await launcher.launch(request(1))
    started.push(pid)

    expect(pid).toBeGreaterThan(0)
    expect(launcher.isAlive(pid)).toBe(true)
  })

  it('returns a pid that is still the browser seconds later', async () => {
    // The adapter resolves the pid through WMI rather than trusting the one
    // spawn hands back, and this is what that buys. With the installed Google
    // Chrome the spawned pid was a launcher stub that exited at once, so
    // reporting it made every slot look crashed a second after starting; probe
    // P5 measured the bundled snapshot returning the real pid instead, because
    // it has no such stub. The assertion is deliberately about the pid still
    // being alive and NOT about the two differing - that would now fail, and it
    // would be asserting a packaging detail of somebody else's build.
    const pid = await launcher.launch(request(1))
    started.push(pid)

    await new Promise((resolve) => setTimeout(resolve, 3000))
    expect(launcher.isAlive(pid)).toBe(true)
  })

  it('creates a separate profile directory per slot', async () => {
    const first = await launcher.launch(request(1))
    started.push(first)
    const second = await launcher.launch(request(2))
    started.push(second)

    expect(existsSync(join(profilesRoot, 'slot-1'))).toBe(true)
    expect(existsSync(join(profilesRoot, 'slot-2'))).toBe(true)
    expect(first).not.toBe(second)
  })

  it('stops a slot without touching its neighbour', async () => {
    const first = await launcher.launch(request(1))
    started.push(first)
    const second = await launcher.launch(request(2))
    started.push(second)

    await launcher.stop(first)
    expect(launcher.isAlive(first)).toBe(false)
    expect(launcher.isAlive(second)).toBe(true)
  })

  it('reports a pid that was never launched as not alive', () => {
    // 999999 is above Windows' usual pid range and reliably absent.
    expect(launcher.isAlive(999_999)).toBe(false)
  })

  describe('clean sessions', () => {
    // A clean session gets a throwaway directory outside the profiles root, and
    // that is the only thing stop() ever deletes. The slot's persistent profile
    // is never the target of removal code, so no bug in the flag can destroy a
    // logged-in session.
    it('never creates a slot profile directory', async () => {
      const pid = await launcher.launch(request(1, { persistProfile: false }))
      started.push(pid)

      expect(existsSync(join(profilesRoot, 'slot-1'))).toBe(false)
    })

    it('uses a directory outside the profiles root', async () => {
      const pid = await launcher.launch(request(1, { persistProfile: false }))
      started.push(pid)

      const path = launcher.profilePathOf(pid)
      expect(path).toBeDefined()
      expect(path!.startsWith(profilesRoot)).toBe(false)
      expect(existsSync(path!)).toBe(true)
    })

    it('removes the throwaway directory on stop', async () => {
      const pid = await launcher.launch(request(1, { persistProfile: false }))
      started.push(pid)
      const path = launcher.profilePathOf(pid)!

      await launcher.stop(pid)
      expect(existsSync(path)).toBe(false)
    })
  })

  describe('persistent profiles', () => {
    it('keeps the profile after stop, so the login survives a restart', async () => {
      const pid = await launcher.launch(request(1, { persistProfile: true }))
      started.push(pid)
      await launcher.stop(pid)

      expect(existsSync(join(profilesRoot, 'slot-1'))).toBe(true)
    })

    it('reuses the same directory across launches', async () => {
      const first = await launcher.launch(request(1, { persistProfile: true }))
      started.push(first)
      const path = launcher.profilePathOf(first)
      await launcher.stop(first)

      const second = await launcher.launch(request(1, { persistProfile: true }))
      started.push(second)
      expect(launcher.profilePathOf(second)).toBe(path)
    })
  })

  it('names the path it looked at when the browser is missing', async () => {
    // The binary ships inside the app now, so its absence means an incomplete
    // package or a tree that never ran the fetch script. The path is what tells
    // those apart.
    const broken = new ChromeLauncher(profilesRoot, 'C:\\nope\\chrome.exe')
    await expect(broken.launch(request(1))).rejects.toThrow(/C:\\nope\\chrome\.exe/)
  })

  it('launches the browser the app ships, not one installed on the machine', async () => {
    // The whole point of ADR-0016, and the one thing an integration test can
    // actually check: the running process's image path is the bundled binary.
    //
    // Compared as an exact string because that was measured: launched through
    // the development junction, Win32_Process reports the junction path it was
    // given, not the target it resolves to. If a later Windows starts
    // canonicalising it, this fails loudly rather than passing on a substring.
    const pid = await launcher.launch(request(1))
    started.push(pid)

    const { execFileSync } = await import('node:child_process')
    const imagePath = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').ExecutablePath`,
      ],
      { encoding: 'utf8' },
    ).trim()
    expect(imagePath.toLowerCase()).toBe(BROWSER.toLowerCase())
  })

  describe('stopping cleanly', () => {
    /**
     * Chrome records how it last exited in its own profile, and shows the
     * "Restore pages? Chrome didn't shut down correctly" bubble when that says
     * anything but Normal.
     *
     * Stopping with taskkill /F made every Stop -> Start cycle in the panel pop
     * that bubble, over a window the user had just asked to open. Asking the
     * window to close first is the fix; force stays as the fallback for a
     * browser that will not go.
     */
    function exitTypeOf(profilePath: string): string | undefined {
      const preferences = join(profilePath, 'Default', 'Preferences')
      if (!existsSync(preferences)) return undefined
      const parsed = JSON.parse(readFileSync(preferences, 'utf8')) as {
        profile?: { exit_type?: string }
      }
      return parsed.profile?.exit_type
    }

    it('leaves the profile marked as a normal exit', async () => {
      const pid = await launcher.launch(request(1))
      started.push(pid)
      // Chrome writes Preferences a moment after startup; without the window
      // being fully up there is nothing to mark.
      await new Promise((resolve) => setTimeout(resolve, 3000))
      await launcher.stop(pid)

      expect(exitTypeOf(join(profilesRoot, 'slot-1'))).toBe('Normal')
    })

    it('still returns once the browser is gone', async () => {
      const pid = await launcher.launch(request(1))
      started.push(pid)
      await new Promise((resolve) => setTimeout(resolve, 2000))
      await launcher.stop(pid)
      expect(launcher.isAlive(pid)).toBe(false)
    })
  })

  it('is harmless when stopping a pid that is already gone', async () => {
    const pid = await launcher.launch(request(1))
    started.push(pid)
    await launcher.stop(pid)
    await expect(launcher.stop(pid)).resolves.toBeUndefined()
  })
})
