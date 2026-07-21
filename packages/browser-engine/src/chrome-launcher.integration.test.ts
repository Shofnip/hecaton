import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ChromeLauncher, findChromeExecutable } from './chrome-launcher.js'
import type { LaunchRequest } from '@helloweb/core'

// Real Chrome, real processes. Windows only, and skipped elsewhere so CI on
// Linux stays useful for everything else.
const onWindows = process.platform === 'win32'

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
    ...overrides,
  }
}

describe.skipIf(!onWindows)('ChromeLauncher', () => {
  beforeAll(() => {
    expect(findChromeExecutable()).toBeTruthy()
  })

  beforeEach(() => {
    profilesRoot = mkdtempSync(join(tmpdir(), 'helloweb-chrome-'))
    launcher = new ChromeLauncher(profilesRoot)
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

  it('returns the browser process, not the launcher stub', async () => {
    // The pid spawn hands back is a stub that exits immediately; the real
    // browser is a different process. Reporting the stub would make every slot
    // look crashed a second after starting.
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

  it('fails with a useful message when Chrome is missing', async () => {
    const broken = new ChromeLauncher(profilesRoot, 'C:\\nope\\chrome.exe')
    await expect(broken.launch(request(1))).rejects.toThrow(/chrome/i)
  })

  it('is harmless when stopping a pid that is already gone', async () => {
    const pid = await launcher.launch(request(1))
    started.push(pid)
    await launcher.stop(pid)
    await expect(launcher.stop(pid)).resolves.toBeUndefined()
  })
})
