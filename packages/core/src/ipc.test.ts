import { describe, expect, it } from 'vitest'
import { DEFAULT_GLOBAL_CONFIG } from './config.js'
import {
  IPC_CHANNELS,
  parseNoPayload,
  parseSlotAddition,
  parseSlotId,
  parseSlotUpdate,
} from './ipc.js'

const globals = DEFAULT_GLOBAL_CONFIG

describe('the channel list', () => {
  it('has no duplicates', () => {
    // main registers one handler per name and preload exposes one method per
    // name. A repeated entry means the second handler silently replaces the
    // first, which is not visible anywhere at startup.
    expect(new Set(IPC_CHANNELS).size).toBe(IPC_CHANNELS.length)
  })

  it('is the whole surface', () => {
    // Written out rather than derived, so that widening the IPC surface has to
    // be a deliberate edit to a test that says what the surface is.
    expect([...IPC_CHANNELS]).toEqual([
      'slot:start',
      'slot:stop',
      'slot:focus',
      'slot:add',
      'slot:remove',
      'layout:apply',
      'config:read',
      'config:updateSlot',
      'logs:reveal',
    ])
  })
})

describe('parseSlotId', () => {
  it('accepts a positive integer', () => {
    expect(parseSlotId(2)).toBe(2)
  })

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['a numeric string', '1'],
    ['null', null],
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['an object', { id: 1 }],
    ['an array', [1]],
  ])('rejects %s', (_case, input) => {
    // The renderer is a separate process: what arrives is `unknown`, and the
    // TypeScript signature that appears to guarantee a number is gone by then.
    expect(() => parseSlotId(input)).toThrow(/slot id/i)
  })
})

describe('parseNoPayload', () => {
  it('accepts no argument', () => {
    expect(() => parseNoPayload(undefined)).not.toThrow()
  })

  it.each([
    ['a path', 'C:\\Windows\\System32'],
    ['an object', {}],
    ['null', null],
  ])('rejects %s', (_case, input) => {
    // logs:reveal is the app's only handoff to the OS shell, and it opens a
    // directory the main process computes. Accepting an argument here is the
    // difference between that and "open an arbitrary path", so an unexpected
    // payload is refused rather than ignored.
    expect(() => parseNoPayload(input)).toThrow()
  })
})

describe('parseSlotUpdate', () => {
  it('accepts a slot pointed at a registry game', () => {
    expect(parseSlotUpdate({ id: 1, gameId: 'poke-idleworld' }, globals)).toEqual({
      id: 1,
      gameId: 'poke-idleworld',
    })
  })

  it('accepts a custom slot with generic options', () => {
    expect(
      parseSlotUpdate(
        { id: 2, url: 'https://example.com/', persistProfile: false, mute: true },
        globals,
      ),
    ).toEqual({ id: 2, url: 'https://example.com/', persistProfile: false, mute: true })
  })

  it.each([
    ['a non-https url', { id: 1, url: 'http://example.com/' }],
    ['a javascript: url', { id: 1, url: 'javascript:alert(1)' }],
    ['a file: url', { id: 1, url: 'file:///C:/Windows/win.ini' }],
    ['a data: url', { id: 1, url: 'data:text/html,<script>1</script>' }],
  ])('rejects %s', (_case, input) => {
    // The https rule is a security boundary, not a style preference: it is what
    // keeps a configuration field from becoming code execution or disk access.
    // A custom slot is not a way around it, and neither is the IPC channel.
    expect(() => parseSlotUpdate(input, globals)).toThrow()
  })

  it.each([
    ['both a game and a url', { id: 1, gameId: 'g', url: 'https://example.com/' }],
    ['a non-boolean persistProfile', { id: 1, gameId: 'g', persistProfile: 'no' }],
    ['a non-boolean mute', { id: 1, gameId: 'g', mute: 1 }],
    ['a missing id', { gameId: 'g' }],
    ['an id above maxSlots', { id: 99, gameId: 'g' }],
    ['not an object', 'slot'],
  ])('rejects %s', (_case, input) => {
    expect(() => parseSlotUpdate(input, globals)).toThrow()
  })

  it('rejects an unknown key', () => {
    // `viewport` specifically: ADR-0006's body lists it as a per-slot option and
    // is wrong, so it is the field a panel built from that sentence would send.
    expect(() =>
      parseSlotUpdate({ id: 1, gameId: 'g', viewport: { width: 800, height: 600 } }, globals),
    ).toThrow(/viewport/)
  })

  it('drops nothing and invents nothing', () => {
    // Rebuilt field by field rather than spread, so an unvalidated key cannot
    // ride along into the running app.
    const update = parseSlotUpdate({ id: 1, gameId: 'g' }, globals)
    expect(Object.keys(update).sort()).toEqual(['gameId', 'id'])
  })

  it('accepts the same shapes the config file accepts', () => {
    // The renderer must not be able to ask for a slot that could not have been
    // written in config.json. One validator for both is what keeps that true
    // without anyone having to compare two lists.
    expect(() => parseSlotUpdate({ id: 1, url: 'https://example.com/' }, globals)).not.toThrow()
  })
})

describe('parseSlotAddition', () => {
  it('accepts a slot pointed at a game, with no id', () => {
    // The id is the orchestrator's to assign, so the add payload must not carry
    // one - it has no way to know which slot number is free.
    expect(parseSlotAddition({ gameId: 'poke-idleworld' }, globals)).toEqual({
      gameId: 'poke-idleworld',
    })
  })

  it('accepts a custom url with generic options', () => {
    expect(
      parseSlotAddition(
        { url: 'https://example.com/', persistProfile: false, mute: true },
        globals,
      ),
    ).toEqual({ url: 'https://example.com/', persistProfile: false, mute: true })
  })

  it('rejects an id, which the caller does not get to choose', () => {
    expect(() => parseSlotAddition({ id: 2, gameId: 'g' }, globals)).toThrow(/id/)
  })

  it('fills in https on a bare domain', () => {
    // The panel lets the user type just the host; the boundary makes it https.
    expect(parseSlotAddition({ url: 'example.com' }, globals)).toEqual({
      url: 'https://example.com',
    })
  })

  it.each([
    ['a non-https url', { url: 'http://example.com/' }],
    ['a javascript url', { url: 'javascript:alert(1)' }],
    ['both a game and a url', { gameId: 'g', url: 'https://example.com/' }],
    ['a non-boolean mute', { gameId: 'g', mute: 1 }],
    ['an unknown key', { gameId: 'g', viewport: {} }],
    ['not an object', 'slot'],
  ])('rejects %s', (_case, input) => {
    // Same rules as an update, minus the id: the https boundary in particular
    // is not something an add channel gets to skip.
    expect(() => parseSlotAddition(input, globals)).toThrow()
  })
})
