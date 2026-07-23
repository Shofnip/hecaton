import { describe, expect, it } from 'vitest'
import { DEFAULT_GLOBAL_CONFIG, SCHEMA_VERSION } from './config.js'
import { parseConfig } from './parse-config.js'

const valid = {
  schemaVersion: SCHEMA_VERSION,
  maxSlots: 4,
  persistProfile: true,
  mute: false,
  slots: [
    { id: 1, gameId: 'poke-idleworld' },
    { id: 2, url: 'https://example.com/', persistProfile: false, mute: true },
  ],
}

describe('parseConfig on a first run', () => {
  it('returns the shipped defaults when there is no file', () => {
    // `undefined` is what the storage port returns for a missing file. A first
    // run is not a failure, so it must not be reported as one.
    expect(parseConfig(undefined)).toEqual({ globals: DEFAULT_GLOBAL_CONFIG, slots: [] })
  })

  it('does not hand out the shared defaults object', () => {
    // A caller mutating the result must not change the defaults for everyone
    // else in the process.
    expect(parseConfig(undefined).globals).not.toBe(DEFAULT_GLOBAL_CONFIG)
  })
})

describe('parseConfig on a valid file', () => {
  it('returns globals and slots', () => {
    expect(parseConfig(valid)).toEqual({
      globals: {
        schemaVersion: SCHEMA_VERSION,
        maxSlots: 4,
        persistProfile: true,
        mute: false,
        audioFollowsFocus: true,
      },
      slots: [
        { id: 1, gameId: 'poke-idleworld' },
        { id: 2, url: 'https://example.com/', persistProfile: false, mute: true },
      ],
    })
  })

  it('accepts a file with no slots', () => {
    expect(parseConfig({ ...valid, slots: [] }).slots).toEqual([])
  })

  it('carries the additive per-slot fields through untouched', () => {
    // name, volume, muted and backgroundThrottling are additive (no schema
    // bump). A slot that sets them round-trips exactly; one that omits them
    // stays minimal, so the resolver applies the shipped defaults later.
    const slots = [
      {
        id: 1,
        gameId: 'poke-idleworld',
        name: 'Alt',
        volume: 30,
        muted: true,
        backgroundThrottling: true,
      },
    ]
    expect(parseConfig({ ...valid, slots }).slots).toEqual(slots)
  })

  it('reads an explicit audioFollowsFocus', () => {
    expect(parseConfig({ ...valid, audioFollowsFocus: false }).globals.audioFollowsFocus).toBe(
      false,
    )
  })

  it('defaults audioFollowsFocus to true when the file predates the setting', () => {
    // Added after v1 shipped, so a config written before it simply omits the
    // key. Defaulting keeps those files valid without a schema bump — the field
    // is additive and its absence has one unambiguous meaning.
    expect('audioFollowsFocus' in valid).toBe(false)
    expect(parseConfig(valid).globals.audioFollowsFocus).toBe(true)
  })
})

describe('parseConfig refuses a file it cannot fully understand', () => {
  // Every case here fails the whole load rather than dropping the bad part.
  // Loading partially would make a slot vanish with no explanation, and the
  // next save would write the loss to disk permanently.

  it.each([
    ['not an object', 42],
    ['null', null],
    ['an array', []],
  ])('rejects %s', (_case, input) => {
    expect(() => parseConfig(input)).toThrow(/config/i)
  })

  it.each([
    ['a missing schemaVersion', { ...valid, schemaVersion: undefined }],
    ['a non-integer schemaVersion', { ...valid, schemaVersion: 1.5 }],
    ['a non-positive maxSlots', { ...valid, maxSlots: 0 }],
    ['a non-boolean persistProfile', { ...valid, persistProfile: 'yes' }],
    ['a non-boolean mute', { ...valid, mute: 1 }],
    ['a non-boolean audioFollowsFocus', { ...valid, audioFollowsFocus: 'on' }],
    ['slots that are not an array', { ...valid, slots: {} }],
  ])('rejects %s', (_case, input) => {
    expect(() => parseConfig(input)).toThrow()
  })

  it('rejects an unknown top-level key', () => {
    // A key nothing understands is either corruption or a hand edit. Silently
    // dropping it would delete it on the next save.
    expect(() => parseConfig({ ...valid, autoLogin: true })).toThrow(/autoLogin/)
  })

  it('rejects an unknown slot key', () => {
    // Named here because ADR-0006's body wrongly listed `viewport` as a
    // per-slot option, so it is the key most likely to be tried.
    expect(() =>
      parseConfig({ ...valid, slots: [{ id: 1, viewport: { width: 800, height: 600 } }] }),
    ).toThrow(/viewport/)
  })

  it.each([
    ['a slot with a non-https url', [{ id: 1, url: 'http://example.com/' }]],
    ['a slot with both a game and a url', [{ id: 1, gameId: 'g', url: 'https://example.com/' }]],
    ['a slot with a non-boolean persistProfile', [{ id: 1, gameId: 'g', persistProfile: 'no' }]],
    ['a slot id above maxSlots', [{ id: 9, gameId: 'g' }]],
    ['a slot id that is not a positive integer', [{ id: 0, gameId: 'g' }]],
    ['a non-string name', [{ id: 1, gameId: 'g', name: 42 }]],
    ['an empty name', [{ id: 1, gameId: 'g', name: '   ' }]],
    ['a name longer than 24 characters', [{ id: 1, gameId: 'g', name: 'x'.repeat(25) }]],
    ['a non-integer volume', [{ id: 1, gameId: 'g', volume: 12.5 }]],
    ['a volume above 100', [{ id: 1, gameId: 'g', volume: 101 }]],
    ['a negative volume', [{ id: 1, gameId: 'g', volume: -1 }]],
    ['a non-number volume', [{ id: 1, gameId: 'g', volume: '50' }]],
    ['a non-boolean muted', [{ id: 1, gameId: 'g', muted: 1 }]],
    ['a non-boolean backgroundThrottling', [{ id: 1, gameId: 'g', backgroundThrottling: 'off' }]],
  ])('rejects %s', (_case, slots) => {
    expect(() => parseConfig({ ...valid, slots })).toThrow()
  })

  it('accepts the volume bounds 0 and 100', () => {
    expect(() =>
      parseConfig({ ...valid, slots: [{ id: 1, gameId: 'g', volume: 0 }] }),
    ).not.toThrow()
    expect(() =>
      parseConfig({ ...valid, slots: [{ id: 1, gameId: 'g', volume: 100 }] }),
    ).not.toThrow()
  })

  it('accepts a name of exactly 24 characters', () => {
    expect(() =>
      parseConfig({ ...valid, slots: [{ id: 1, gameId: 'g', name: 'x'.repeat(24) }] }),
    ).not.toThrow()
  })

  it('rejects duplicate slot ids', () => {
    // Two entries for one slot means one silently wins, and which one depends
    // on iteration order.
    const slots = [
      { id: 1, gameId: 'a' },
      { id: 1, gameId: 'b' },
    ]
    expect(() => parseConfig({ ...valid, slots })).toThrow(/duplicate/i)
  })

  it('names the offending slot in the message', () => {
    // The user has to fix this by hand in a file the app will not rewrite, so
    // the message is the whole repair instruction.
    expect(() => parseConfig({ ...valid, slots: [{ id: 2, url: 'http://example.com/' }] })).toThrow(
      /slot 2/,
    )
  })
})

describe('parseConfig and schema versions', () => {
  it('refuses a file written by a newer app', () => {
    // Reading it with old code risks misreading a field whose meaning changed,
    // and the next save would overwrite everything the newer version stored.
    expect(() => parseConfig({ ...valid, schemaVersion: SCHEMA_VERSION + 1 })).toThrow(
      new RegExp(String(SCHEMA_VERSION + 1)),
    )
  })

  it('says which version it understands', () => {
    expect(() => parseConfig({ ...valid, schemaVersion: SCHEMA_VERSION + 1 })).toThrow(
      new RegExp(`\\b${SCHEMA_VERSION}\\b`),
    )
  })
})
