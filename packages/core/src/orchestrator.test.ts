import { beforeEach, describe, expect, it } from 'vitest'
import { Orchestrator } from './orchestrator.js'
import { DEFAULT_GLOBAL_CONFIG } from './config.js'
import { buildRegistry } from './registry.js'
import {
  FakeBrowserLauncher,
  FakeLogger,
  FakeProfileArchive,
  FakeWindowManager,
} from './testing/fakes.js'
import type { ScreenBounds } from './grid.js'

const SCREEN: ScreenBounds = { x: 0, y: 0, width: 1920, height: 1080 }
const REGISTRY = buildRegistry([
  { id: 'poke-idleworld', name: 'Poke IdleWorld', url: 'https://poke.idleworld.online/' },
])

let launcher: FakeBrowserLauncher
let windows: FakeWindowManager

function makeOrchestrator(options: { autoRestart?: boolean; maxRestartAttempts?: number } = {}) {
  return new Orchestrator({
    launcher,
    windows,
    screen: SCREEN,
    globals: DEFAULT_GLOBAL_CONFIG,
    registry: REGISTRY,
    slots: [
      { id: 1, gameId: 'poke-idleworld' },
      { id: 2, gameId: 'poke-idleworld' },
    ],
    autoRestart: options.autoRestart ?? false,
    ...(options.maxRestartAttempts !== undefined
      ? { maxRestartAttempts: options.maxRestartAttempts }
      : {}),
  })
}

beforeEach(() => {
  launcher = new FakeBrowserLauncher()
  windows = new FakeWindowManager()
})

describe('starting a slot', () => {
  it('begins stopped', () => {
    expect(makeOrchestrator().stateOf(1)).toBe('stopped')
  })

  it('reaches running and launches exactly once', async () => {
    const app = makeOrchestrator()
    await app.start(1)
    expect(app.stateOf(1)).toBe('running')
    expect(launcher.launched).toHaveLength(1)
  })

  it('resolves the url from the registry and the profile dir from the slot id', async () => {
    const app = makeOrchestrator()
    await app.start(2)
    expect(launcher.launched[0]).toMatchObject({
      slotId: 2,
      url: 'https://poke.idleworld.online/',
      profileDir: 'slot-2',
      persistProfile: true,
      mute: false,
    })
  })

  it('launches the only running slot filling the screen', async () => {
    const app = makeOrchestrator()
    await app.start(1)
    // The grid follows the running count, not the configured one: two slots are
    // configured, but only one is running, so it takes the whole screen.
    expect(launcher.launched[0]?.bounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
  })

  it('accepts a custom url slot', async () => {
    const app = new Orchestrator({
      launcher,
      windows,
      screen: SCREEN,
      globals: DEFAULT_GLOBAL_CONFIG,
      registry: REGISTRY,
      slots: [{ id: 1, url: 'https://example.com/' }],
      autoRestart: false,
    })
    await app.start(1)
    expect(launcher.launched[0]?.url).toBe('https://example.com/')
  })

  it('refuses a slot pointing at a game that is not in the registry', async () => {
    const app = new Orchestrator({
      launcher,
      windows,
      screen: SCREEN,
      globals: DEFAULT_GLOBAL_CONFIG,
      registry: REGISTRY,
      slots: [{ id: 1, gameId: 'ghost-game' }],
      autoRestart: false,
    })
    await expect(app.start(1)).rejects.toThrow(/ghost-game/)
  })

  it('refuses to start a slot that is already running', async () => {
    const app = makeOrchestrator()
    await app.start(1)
    await expect(app.start(1)).rejects.toThrow(/cannot handle "start"/i)
  })

  it('lands in crashed when the browser never comes up', async () => {
    const app = makeOrchestrator()
    launcher.failNextLaunch = new Error('chrome.exe not found')
    await expect(app.start(1)).rejects.toThrow(/chrome.exe not found/)
    expect(app.stateOf(1)).toBe('crashed')
  })
})

describe('crash detection', () => {
  it('notices a process that died and marks the slot crashed', async () => {
    const app = makeOrchestrator()
    await app.start(1)
    launcher.killSilently(launcher.pidForSlot(1)!)

    await app.checkLiveness()
    expect(app.stateOf(1)).toBe('crashed')
  })

  it('leaves a healthy slot alone', async () => {
    const app = makeOrchestrator()
    await app.start(1)
    await app.checkLiveness()
    expect(app.stateOf(1)).toBe('running')
  })

  it('never lets one slot crashing affect another', async () => {
    const app = makeOrchestrator()
    await app.start(1)
    await app.start(2)
    launcher.killSilently(launcher.pidForSlot(1)!)

    await app.checkLiveness()
    expect(app.stateOf(1)).toBe('crashed')
    expect(app.stateOf(2)).toBe('running')
  })

  it('ignores a stopped slot, whose process is gone on purpose', async () => {
    const app = makeOrchestrator()
    await app.start(1)
    await app.stop(1)
    await app.checkLiveness()
    expect(app.stateOf(1)).toBe('stopped')
  })
})

describe('auto-restart', () => {
  it('brings a crashed slot back when enabled', async () => {
    const app = makeOrchestrator({ autoRestart: true })
    await app.start(1)
    launcher.killSilently(launcher.pidForSlot(1)!)

    await app.checkLiveness()
    expect(app.stateOf(1)).toBe('running')
    expect(launcher.launched).toHaveLength(2)
  })

  it('stays crashed when disabled', async () => {
    const app = makeOrchestrator({ autoRestart: false })
    await app.start(1)
    launcher.killSilently(launcher.pidForSlot(1)!)

    await app.checkLiveness()
    expect(app.stateOf(1)).toBe('crashed')
    expect(launcher.launched).toHaveLength(1)
  })

  it('gives up after the attempt limit instead of looping forever', async () => {
    const app = makeOrchestrator({ autoRestart: true, maxRestartAttempts: 2 })
    await app.start(1)

    for (let i = 0; i < 5; i++) {
      const pid = launcher.pidForSlot(1)
      if (pid !== undefined) launcher.killSilently(pid)
      await app.checkLiveness()
    }

    expect(app.stateOf(1)).toBe('crashed')
    // One initial launch plus two restarts, then it stops trying.
    expect(launcher.launched).toHaveLength(3)
  })

  it('resets the attempt count once a slot is started again by hand', async () => {
    const app = makeOrchestrator({ autoRestart: true, maxRestartAttempts: 1 })
    await app.start(1)
    launcher.killSilently(launcher.pidForSlot(1)!)
    await app.checkLiveness() // restart 1, succeeds
    launcher.killSilently(launcher.pidForSlot(1)!)
    await app.checkLiveness() // limit reached, stays crashed
    expect(app.stateOf(1)).toBe('crashed')

    await app.stop(1)
    await app.start(1)
    launcher.killSilently(launcher.pidForSlot(1)!)
    await app.checkLiveness()
    expect(app.stateOf(1)).toBe('running')
  })

  it('stays crashed when the restart itself fails', async () => {
    const app = makeOrchestrator({ autoRestart: true })
    await app.start(1)
    launcher.killSilently(launcher.pidForSlot(1)!)
    launcher.failNextLaunch = new Error('profile locked')

    await app.checkLiveness()
    expect(app.stateOf(1)).toBe('crashed')
  })
})

describe('stopping', () => {
  it('stops the process and returns to stopped', async () => {
    const app = makeOrchestrator()
    await app.start(1)
    const pid = launcher.pidForSlot(1)!

    await app.stop(1)
    expect(app.stateOf(1)).toBe('stopped')
    expect(launcher.stopped).toContain(pid)
  })

  it('is harmless on an already stopped slot', async () => {
    const app = makeOrchestrator()
    await app.stop(1)
    expect(app.stateOf(1)).toBe('stopped')
    expect(launcher.stopped).toHaveLength(0)
  })
})

describe('window control', () => {
  it('focuses a running slot', async () => {
    const app = makeOrchestrator()
    await app.start(1)
    expect(app.focus(1)).toBe(true)
    expect(windows.focused).toEqual([launcher.pidForSlot(1)])
  })

  it('cannot focus a slot that is not running', () => {
    expect(makeOrchestrator().focus(1)).toBe(false)
  })

  it('reapplies the grid to every live slot', async () => {
    const app = makeOrchestrator()
    await app.start(1)
    await app.start(2)

    app.applyLayout()
    expect(windows.bounds.get(launcher.pidForSlot(1)!)).toEqual({
      x: 0,
      y: 0,
      width: 960,
      height: 1080,
    })
    expect(windows.bounds.get(launcher.pidForSlot(2)!)).toEqual({
      x: 960,
      y: 0,
      width: 960,
      height: 1080,
    })
  })

  it('skips slots that are not running when reapplying the grid', async () => {
    const app = makeOrchestrator()
    await app.start(1)
    app.applyLayout()
    expect(windows.bounds.size).toBe(1)
  })

  it('gives the survivor the whole screen when its neighbour stops', async () => {
    const app = makeOrchestrator()
    await app.start(1)
    await app.start(2)
    // Two running: side by side. Then one stops, so the grid is for one again.
    await app.stop(2)
    expect(windows.bounds.get(launcher.pidForSlot(1)!)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    })
  })

  it('re-tiles the survivors when one crashes', async () => {
    const app = makeOrchestrator()
    await app.start(1)
    await app.start(2)
    launcher.killSilently(launcher.pidForSlot(1)!)
    await app.checkLiveness()
    // Slot 1 is gone; slot 2 should no longer sit in its old half.
    expect(windows.bounds.get(launcher.pidForSlot(2)!)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    })
  })
})

describe('unknown slots', () => {
  it.each<[string, (app: Orchestrator) => unknown]>([
    ['stateOf', (app) => app.stateOf(99)],
    ['focus', (app) => app.focus(99)],
  ])('%s rejects a slot that was never configured', (_name, act) => {
    expect(() => act(makeOrchestrator())).toThrow(/slot 99/i)
  })

  it('start rejects a slot that was never configured', async () => {
    await expect(makeOrchestrator().start(99)).rejects.toThrow(/slot 99/i)
  })
})

describe('snapshot for the panel', () => {
  it('lists every configured slot with its state and what it points at', () => {
    expect(makeOrchestrator().snapshot()).toEqual([
      { id: 1, state: 'stopped', gameId: 'poke-idleworld', persistProfile: true, mute: false },
      { id: 2, state: 'stopped', gameId: 'poke-idleworld', persistProfile: true, mute: false },
    ])
  })

  it('carries neither the pid nor the profile directory', () => {
    // The renderer addresses slots by id - every command takes a slotId - so it
    // has no use for either. Leaving them out of the view model is what keeps
    // them out of the IPC surface by construction rather than by discipline.
    for (const slot of makeOrchestrator().snapshot()) {
      expect(slot).not.toHaveProperty('pid')
      expect(slot).not.toHaveProperty('profileDir')
    }
  })

  it('reflects a running slot', async () => {
    const app = makeOrchestrator()
    await app.start(1)
    expect(app.snapshot()[0]).toMatchObject({ id: 1, state: 'running' })
  })

  it('records why a start failed', async () => {
    const app = makeOrchestrator()
    launcher.failNextLaunch = new Error('Chrome executable not found')
    await expect(app.start(1)).rejects.toThrow()
    expect(app.snapshot()[0]).toMatchObject({
      state: 'crashed',
      lastError: 'Chrome executable not found',
    })
  })

  it('clears the error once the slot starts', async () => {
    const app = makeOrchestrator()
    launcher.failNextLaunch = new Error('Chrome executable not found')
    await expect(app.start(1)).rejects.toThrow()
    await app.start(1)
    expect(app.snapshot()[0]).not.toHaveProperty('lastError')
  })

  it('records why an auto-restart failed', async () => {
    // checkLiveness swallows a failed restart so one bad slot cannot abort the
    // sweep over the others. Without recording it here, the slot would sit in
    // `crashed` with nothing anywhere saying why - the silent failure this
    // project treats as a bug.
    const app = makeOrchestrator({ autoRestart: true })
    await app.start(1)
    launcher.killSilently(launcher.pidForSlot(1)!)
    launcher.failNextLaunch = new Error('profile is locked by another process')
    await app.checkLiveness()
    expect(app.snapshot()[0]).toMatchObject({
      state: 'crashed',
      lastError: 'profile is locked by another process',
    })
  })

  it('hands out a copy the caller cannot use to drive the orchestrator', async () => {
    const app = makeOrchestrator()
    const before = app.snapshot()
    before[0]!.state = 'running'
    expect(app.snapshot()[0]?.state).toBe('stopped')
  })
})

describe('a crashed slot the user then stops', () => {
  it('keeps the reason on the card', async () => {
    // Stopping a crashed slot is tidying up, not acknowledging the diagnosis.
    // The card is the only place the reason is visible, and it stops being true
    // at the next successful start - which is where it is cleared.
    const app = makeOrchestrator()
    launcher.failNextLaunch = new Error('Chrome executable not found')
    await expect(app.start(1)).rejects.toThrow()
    await app.stop(1)
    expect(app.snapshot()[0]).toMatchObject({
      state: 'stopped',
      lastError: 'Chrome executable not found',
    })
  })
})

describe('logging lifecycle events', () => {
  function withLogger(options: { autoRestart?: boolean } = {}) {
    const logger = new FakeLogger()
    const app = new Orchestrator({
      launcher,
      windows,
      screen: SCREEN,
      globals: DEFAULT_GLOBAL_CONFIG,
      registry: REGISTRY,
      slots: [{ id: 1, gameId: 'poke-idleworld' }],
      autoRestart: options.autoRestart ?? false,
      logger,
    })
    return { app, logger }
  }

  it('records a start reaching running', async () => {
    const { app, logger } = withLogger()
    await app.start(1)
    expect(logger.events()).toEqual(['slot.start', 'slot.ready'])
  })

  it('tags each entry with the slot and, when known, the pid', async () => {
    const { app, logger } = withLogger()
    await app.start(1)
    const ready = logger.entries.find((entry) => entry.event === 'slot.ready')
    expect(ready).toMatchObject({ slotId: 1, gameId: 'poke-idleworld' })
    expect(ready?.pid).toBeGreaterThan(0)
  })

  it('records a failed start as an error, with the reason', async () => {
    const { app, logger } = withLogger()
    launcher.failNextLaunch = new Error('Chrome executable not found')
    await expect(app.start(1)).rejects.toThrow()
    const crash = logger.entries.find((entry) => entry.event === 'slot.crash')
    expect(crash).toMatchObject({ level: 'error', message: 'Chrome executable not found' })
  })

  it('records a crash and the auto-restart that follows', async () => {
    const { app, logger } = withLogger({ autoRestart: true })
    await app.start(1)
    launcher.killSilently(launcher.pidForSlot(1)!)
    await app.checkLiveness()
    expect(logger.events()).toContain('slot.crash')
    expect(logger.events()).toContain('slot.restart')
  })

  it('records a stop', async () => {
    const { app, logger } = withLogger()
    await app.start(1)
    await app.stop(1)
    expect(logger.events()).toContain('slot.stop')
  })

  it('is optional: an orchestrator with no logger still runs', async () => {
    // Every existing test constructs the orchestrator without a logger, so this
    // guarantees the feature stayed additive rather than required.
    const app = makeOrchestrator()
    await expect(app.start(1)).resolves.not.toThrow()
  })
})

describe('adding and removing slots', () => {
  function oneSlot() {
    return new Orchestrator({
      launcher,
      windows,
      screen: SCREEN,
      globals: DEFAULT_GLOBAL_CONFIG,
      registry: REGISTRY,
      slots: [{ id: 1, gameId: 'poke-idleworld' }],
      autoRestart: false,
    })
  }

  it('starts a single slot filling the whole screen', async () => {
    const app = oneSlot()
    await app.start(1)
    // One slot: 1x1 grid, the whole work area.
    expect(windows.bounds.get(launcher.pidForSlot(1)!)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    })
  })

  it('adds a slot pointed at the given game and returns its id', () => {
    const app = oneSlot()
    expect(app.addSlot({ gameId: 'poke-idleworld' })).toBe(2)
    expect(app.snapshot().map((slot) => slot.id)).toEqual([1, 2])
  })

  it('does not move a running window when a slot is only added', async () => {
    const app = oneSlot()
    await app.start(1)
    app.addSlot({ gameId: 'poke-idleworld' })
    // The new slot is not running yet, so leaving slot 1 fullscreen avoids a
    // blank half sitting next to it until the second one launches.
    expect(windows.bounds.get(launcher.pidForSlot(1)!)?.width).toBe(1920)
  })

  it('resizes both windows into the two-up layout when the second slot starts', async () => {
    const app = oneSlot()
    await app.start(1)
    app.addSlot({ gameId: 'poke-idleworld' })
    await app.start(2)
    expect(windows.bounds.get(launcher.pidForSlot(1)!)).toEqual({
      x: 0,
      y: 0,
      width: 960,
      height: 1080,
    })
    expect(windows.bounds.get(launcher.pidForSlot(2)!)).toEqual({
      x: 960,
      y: 0,
      width: 960,
      height: 1080,
    })
  })

  it('uses the 2x2 layout for three slots', async () => {
    const app = oneSlot()
    app.addSlot({ gameId: 'poke-idleworld' })
    app.addSlot({ gameId: 'poke-idleworld' })
    await app.start(1)
    await app.start(2)
    await app.start(3)
    // 3 slots -> 2x2 grid, three cells filled.
    expect(windows.bounds.get(launcher.pidForSlot(3)!)).toEqual({
      x: 0,
      y: 540,
      width: 960,
      height: 540,
    })
  })

  it('refuses to add past the configured maximum', () => {
    const app = oneSlot()
    app.addSlot({ gameId: 'poke-idleworld' })
    app.addSlot({ gameId: 'poke-idleworld' })
    app.addSlot({ gameId: 'poke-idleworld' })
    // maxSlots is 4; the fifth has nowhere to go.
    expect(() => app.addSlot({ gameId: 'poke-idleworld' })).toThrow(/max/i)
  })

  it('validates a custom url slot on add', () => {
    const app = oneSlot()
    expect(() => app.addSlot({ url: 'http://insecure.test/' })).toThrow(/https/)
  })

  it('removes a slot and stops it if it was running', async () => {
    const app = oneSlot()
    app.addSlot({ gameId: 'poke-idleworld' })
    await app.start(2)
    const pid = launcher.pidForSlot(2)!
    await app.removeSlot(2)
    expect(app.snapshot().map((slot) => slot.id)).toEqual([1])
    expect(launcher.stopped).toContain(pid)
  })

  it('archives the removed slot profile, and only after stopping it', async () => {
    const archive = new FakeProfileArchive()
    const app = new Orchestrator({
      launcher,
      windows,
      screen: SCREEN,
      globals: DEFAULT_GLOBAL_CONFIG,
      registry: REGISTRY,
      slots: [{ id: 1, gameId: 'poke-idleworld' }],
      autoRestart: false,
      profiles: archive,
    })
    app.addSlot({ gameId: 'poke-idleworld' })
    await app.start(2)
    await app.removeSlot(2)
    // slot-2 is the profile dir for slot id 2. It is archived, not deleted, and
    // the browser was stopped first so the rename does not race an open profile.
    expect(archive.archived).toEqual(['slot-2'])
    expect(launcher.stopped).toContain(launcher.pidForSlot(2))
  })

  it('does not archive a persistent profile that is only being reconfigured', () => {
    // updateSlot changes a target; it must never touch the profile.
    const archive = new FakeProfileArchive()
    const app = new Orchestrator({
      launcher,
      windows,
      screen: SCREEN,
      globals: DEFAULT_GLOBAL_CONFIG,
      registry: REGISTRY,
      slots: [{ id: 1, gameId: 'poke-idleworld' }],
      autoRestart: false,
      profiles: archive,
    })
    app.updateSlot({ id: 1, url: 'https://example.com/' })
    expect(archive.archived).toEqual([])
  })

  it('reuses the freed id on the next add', async () => {
    const app = oneSlot()
    app.addSlot({ gameId: 'poke-idleworld' }) // id 2
    app.addSlot({ gameId: 'poke-idleworld' }) // id 3
    await app.removeSlot(2)
    // The lowest free id is reused so the cap of maxSlots is respected. Removal
    // archives that id's profile (slot-2) aside, so the re-added slot gets a
    // fresh one rather than the removed slot's session.
    expect(app.addSlot({ gameId: 'poke-idleworld' })).toBe(2)
  })

  it('will not remove the last slot', async () => {
    const app = oneSlot()
    await expect(app.removeSlot(1)).rejects.toThrow(/last/i)
  })

  it('changes what a slot points at, replacing the old target', () => {
    const app = oneSlot()
    app.updateSlot({ id: 1, url: 'https://example.com/' })
    const slot = app.snapshot()[0]!
    expect(slot.url).toBe('https://example.com/')
    // Switched from a game to a url: the gameId must be gone, not left beside
    // the url, since a slot points at one or the other and never both.
    expect(slot).not.toHaveProperty('gameId')
  })

  it('reports the persisted slot list, preserving inherited settings', () => {
    const app = oneSlot()
    app.addSlot({ url: 'https://example.com/', mute: true })
    // The first slot inherited persistProfile/mute from globals and set neither,
    // so its persisted form should not invent explicit values.
    expect(app.slotConfigs()).toEqual([
      { id: 1, gameId: 'poke-idleworld' },
      { id: 2, url: 'https://example.com/', mute: true },
    ])
  })
})

describe('clearing a slot cache', () => {
  function twoSlots(archive: FakeProfileArchive) {
    return new Orchestrator({
      launcher,
      windows,
      screen: SCREEN,
      globals: DEFAULT_GLOBAL_CONFIG,
      registry: REGISTRY,
      slots: [
        { id: 1, gameId: 'poke-idleworld' },
        { id: 2, gameId: 'poke-idleworld' },
      ],
      autoRestart: false,
      profiles: archive,
    })
  }

  it('clears the cache of a stopped slot by its profile dir', async () => {
    const archive = new FakeProfileArchive()
    const app = twoSlots(archive)
    // slot 2 is stopped: its cache may be cleared. slot-2 is its profile dir.
    await app.clearSlotCache(2)
    expect(archive.clearedCaches).toEqual(['slot-2'])
  })

  it('refuses to clear the cache of a running slot, touching nothing', async () => {
    const archive = new FakeProfileArchive()
    const app = twoSlots(archive)
    await app.start(1)
    // Chrome locks its cache files while running; clearing them under a live
    // process is refused. The guard is here, not only in the disabled button.
    await expect(app.clearSlotCache(1)).rejects.toThrow(/running/i)
    expect(archive.clearedCaches).toEqual([])
  })

  it('refuses an unknown slot id', async () => {
    const archive = new FakeProfileArchive()
    const app = twoSlots(archive)
    await expect(app.clearSlotCache(99)).rejects.toThrow(/not configured/i)
  })

  it('clears every stopped slot and skips the running ones', async () => {
    const archive = new FakeProfileArchive()
    const app = twoSlots(archive)
    await app.start(1)
    // slot 1 is running and is skipped; slot 2 is stopped and is cleared.
    await app.clearAllCaches()
    expect(archive.clearedCaches).toEqual(['slot-2'])
  })
})
