import { describe, expect, it } from 'vitest'
import { DEFAULT_GLOBAL_CONFIG } from './config.js'
import {
  IPC_CHANNELS,
  parseAudioFollowsFocus,
  parseNoPayload,
  parseOverlayRequest,
  parseSlotAddition,
  parseScreenLayout,
  parseSlotId,
  parseSlotMuted,
  parseSlotRename,
  parseSlotUpdate,
  parseSlotVolume,
  parseTheme,
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
      'config:read',
      'config:updateSlot',
      'config:setAudioFollowsFocus',
      'logs:reveal',
      'profiles:clearArchives',
      'profiles:clearSlotCache',
      'profiles:clearAllCaches',
      'data:reveal',
      'data:deleteAll',
      'terms:acknowledge',
      'slots:rename',
      'slots:setVolume',
      'slots:setMuted',
      'slots:reload',
      'ui:setTheme',
      'screens:layout',
      'overlay:open',
      'overlay:close',
    ])
  })
})

describe('parseOverlayRequest', () => {
  it('accepts each modal kind with its fields', () => {
    expect(parseOverlayRequest({ kind: 'settings' })).toEqual({ kind: 'settings' })
    expect(parseOverlayRequest({ kind: 'edit', id: 3 })).toEqual({ kind: 'edit', id: 3 })
    expect(parseOverlayRequest({ kind: 'confirmRemove', id: 2 })).toEqual({
      kind: 'confirmRemove',
      id: 2,
    })
  })

  it('accepts a volume request with its anchor rectangle', () => {
    const anchor = { x: 10, y: 20, width: 34, height: 34 }
    expect(parseOverlayRequest({ kind: 'volume', id: 1, anchor })).toEqual({
      kind: 'volume',
      id: 1,
      anchor,
    })
  })

  it('rejects an unknown kind', () => {
    expect(() => parseOverlayRequest({ kind: 'nope' })).toThrow(/unknown overlay kind/)
    expect(() => parseOverlayRequest('edit')).toThrow(/must be an object/)
  })

  it('rejects a bad slot id or a malformed anchor', () => {
    expect(() => parseOverlayRequest({ kind: 'edit', id: 0 })).toThrow(/positive integer/)
    expect(() => parseOverlayRequest({ kind: 'volume', id: 1 })).toThrow(/anchor must be an object/)
    expect(() =>
      parseOverlayRequest({ kind: 'volume', id: 1, anchor: { x: -1, y: 0, width: 1, height: 1 } }),
    ).toThrow(/x must be an integer/)
  })
})

describe('parseScreenLayout', () => {
  it('accepts placements with client-area bounds', () => {
    const input = [
      { id: 1, bounds: { x: 0, y: 0, width: 960, height: 540 } },
      { id: 2, bounds: { x: 960, y: 0, width: 960, height: 540 } },
    ]
    expect(parseScreenLayout(input)).toEqual(input)
  })

  it('accepts a placement with no bounds, which means hidden', () => {
    // A focused screen shows the main area; the others send no bounds and the
    // orchestrator hides their windows. Modal-open hides everything the same way.
    expect(parseScreenLayout([{ id: 3 }])).toEqual([{ id: 3 }])
  })

  it('accepts an empty layout', () => {
    expect(parseScreenLayout([])).toEqual([])
  })

  it.each([
    ['not an array', { id: 1 }],
    ['a bad id', [{ id: 0, bounds: { x: 0, y: 0, width: 10, height: 10 } }]],
    ['bounds missing a field', [{ id: 1, bounds: { x: 0, y: 0, width: 10 } }]],
    ['a non-integer coordinate', [{ id: 1, bounds: { x: 0.5, y: 0, width: 10, height: 10 } }]],
    ['a zero width', [{ id: 1, bounds: { x: 0, y: 0, width: 0, height: 10 } }]],
    ['a negative height', [{ id: 1, bounds: { x: 0, y: 0, width: 10, height: -10 } }]],
    ['a negative coordinate', [{ id: 1, bounds: { x: -1, y: 0, width: 10, height: 10 } }]],
  ])('rejects %s', (_case, input) => {
    expect(() => parseScreenLayout(input)).toThrow()
  })
})

describe('parseSlotRename', () => {
  it('accepts an id and a name within the cap', () => {
    expect(parseSlotRename({ id: 2, name: 'Fazenda' })).toEqual({ id: 2, name: 'Fazenda' })
  })

  it('accepts an empty name, which the orchestrator reads as "revert to default"', () => {
    // The edit modal clears the field to go back to the "Tela {N}" placeholder,
    // so an empty string is a valid rename, not a rejected one.
    expect(parseSlotRename({ id: 1, name: '' })).toEqual({ id: 1, name: '' })
  })

  it('rejects a name past 24 characters', () => {
    expect(() => parseSlotRename({ id: 1, name: 'x'.repeat(25) })).toThrow(/24/)
  })

  it.each([
    ['a non-string name', { id: 1, name: 5 }],
    ['a missing name', { id: 1 }],
    ['a zero id', { id: 0, name: 'a' }],
    ['not an object', 'nope'],
  ])('rejects %s', (_case, input) => {
    expect(() => parseSlotRename(input)).toThrow()
  })
})

describe('parseSlotVolume', () => {
  it('accepts an id and a 0-100 volume', () => {
    expect(parseSlotVolume({ id: 3, volume: 0 })).toEqual({ id: 3, volume: 0 })
    expect(parseSlotVolume({ id: 3, volume: 100 })).toEqual({ id: 3, volume: 100 })
  })

  it.each([
    ['a volume above 100', { id: 1, volume: 101 }],
    ['a negative volume', { id: 1, volume: -1 }],
    ['a fractional volume', { id: 1, volume: 50.5 }],
    ['a non-number volume', { id: 1, volume: '50' }],
    ['a missing id', { volume: 50 }],
  ])('rejects %s', (_case, input) => {
    expect(() => parseSlotVolume(input)).toThrow()
  })
})

describe('parseSlotMuted', () => {
  it('accepts an id and a boolean', () => {
    expect(parseSlotMuted({ id: 1, muted: true })).toEqual({ id: 1, muted: true })
    expect(parseSlotMuted({ id: 1, muted: false })).toEqual({ id: 1, muted: false })
  })

  it.each([
    ['a truthy non-boolean', { id: 1, muted: 1 }],
    ['a missing flag', { id: 1 }],
    ['a bad id', { id: -2, muted: true }],
  ])('rejects %s', (_case, input) => {
    expect(() => parseSlotMuted(input)).toThrow()
  })
})

describe('parseTheme', () => {
  it('accepts the two themes', () => {
    expect(parseTheme('dark')).toBe('dark')
    expect(parseTheme('light')).toBe('light')
  })

  it.each([
    ['an unknown theme', 'sepia'],
    ['a non-string', 1],
    ['undefined', undefined],
  ])('rejects %s', (_case, input) => {
    expect(() => parseTheme(input)).toThrow(/theme/i)
  })
})

describe('parseAudioFollowsFocus', () => {
  it('accepts a boolean', () => {
    expect(parseAudioFollowsFocus(true)).toBe(true)
    expect(parseAudioFollowsFocus(false)).toBe(false)
  })

  it.each([
    ['a truthy number', 1],
    ['a string', 'true'],
    ['null', null],
    ['undefined', undefined],
    ['an object', {}],
  ])('rejects %s', (_case, input) => {
    // The renderer is a separate process, so what arrives is `unknown`; only a
    // real boolean flips the setting, a stray truthy value must not.
    expect(() => parseAudioFollowsFocus(input)).toThrow(/audioFollowsFocus/i)
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
