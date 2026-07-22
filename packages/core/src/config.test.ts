import { describe, expect, it } from 'vitest'
import { DEFAULT_GLOBAL_CONFIG, SCHEMA_VERSION, resolveSlotConfig } from './config.js'
import type { GlobalConfig } from './config.js'

const globals: GlobalConfig = { ...DEFAULT_GLOBAL_CONFIG }

describe('DEFAULT_GLOBAL_CONFIG', () => {
  it('defaults to four slots, the count measured as comfortable in the spike', () => {
    expect(DEFAULT_GLOBAL_CONFIG.maxSlots).toBe(4)
  })

  it('defaults to persistent profiles, so a Turnstile login survives a restart', () => {
    expect(DEFAULT_GLOBAL_CONFIG.persistProfile).toBe(true)
  })

  it('defaults to audio on, leaving muting to the game itself', () => {
    expect(DEFAULT_GLOBAL_CONFIG.mute).toBe(false)
  })

  it('defaults to audio following the focused window', () => {
    // The feature the user gets out of the box: only the game in the foreground
    // is audible. A global toggle can turn it off; on is the shipped state.
    expect(DEFAULT_GLOBAL_CONFIG.audioFollowsFocus).toBe(true)
  })

  it('carries a schema version from the first commit', () => {
    expect(SCHEMA_VERSION).toBe(1)
    expect(DEFAULT_GLOBAL_CONFIG.schemaVersion).toBe(SCHEMA_VERSION)
  })
})

describe('resolveSlotConfig', () => {
  it('falls back to the global defaults when a slot overrides nothing', () => {
    const resolved = resolveSlotConfig(globals, { id: 1 })
    expect(resolved).toEqual({
      id: 1,
      mute: false,
      persistProfile: true,
      profileDir: 'slot-1',
    })
  })

  it('lets a slot override mute without touching the others', () => {
    expect(resolveSlotConfig(globals, { id: 2, mute: true })).toMatchObject({
      id: 2,
      mute: true,
      persistProfile: true,
    })
  })

  it('lets a slot opt out of a persistent profile', () => {
    expect(resolveSlotConfig(globals, { id: 3, persistProfile: false })).toMatchObject({
      persistProfile: false,
    })
  })

  it('honours a global that differs from the shipped default', () => {
    const muted: GlobalConfig = { ...globals, mute: true }
    expect(resolveSlotConfig(muted, { id: 1 })).toMatchObject({ mute: true })
    expect(resolveSlotConfig(muted, { id: 1, mute: false })).toMatchObject({ mute: false })
  })

  it('derives the profile directory from the slot id', () => {
    expect(resolveSlotConfig(globals, { id: 4 }).profileDir).toBe('slot-4')
  })

  it('carries the game id through when the slot has one', () => {
    expect(resolveSlotConfig(globals, { id: 1, gameId: 'poke-idleworld' })).toMatchObject({
      gameId: 'poke-idleworld',
    })
  })

  it('carries a custom url through when the slot has one', () => {
    const url = 'https://example.com/'
    expect(resolveSlotConfig(globals, { id: 1, url })).toMatchObject({ url })
  })

  it('rejects a slot that names both a game and a custom url', () => {
    expect(() =>
      resolveSlotConfig(globals, { id: 1, gameId: 'poke-idleworld', url: 'https://example.com/' }),
    ).toThrow(/either a game or a url/i)
  })

  it('rejects a custom url that is not https, same rule as the registry', () => {
    expect(() => resolveSlotConfig(globals, { id: 1, url: 'http://example.com/' })).toThrow(
      /https/i,
    )
  })

  it('rejects a slot id beyond the configured maximum', () => {
    expect(() => resolveSlotConfig(globals, { id: 5 })).toThrow(/maxSlots/i)
  })

  it.each([0, -1, 1.5])('rejects slot id %p', (id) => {
    expect(() => resolveSlotConfig(globals, { id })).toThrow(/positive integer/i)
  })

  it('does not mutate either input', () => {
    const slot = { id: 1 }
    const before = JSON.stringify({ globals, slot })
    resolveSlotConfig(globals, slot)
    expect(JSON.stringify({ globals, slot })).toBe(before)
  })
})
