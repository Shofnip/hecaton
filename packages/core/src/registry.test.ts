import { describe, expect, it } from 'vitest'
import { buildRegistry, validateGameDefinition } from './registry.js'

const VALID = {
  id: 'poke-idleworld',
  name: 'Poke IdleWorld',
  url: 'https://poke.idleworld.online/',
}

describe('validateGameDefinition', () => {
  it('accepts the minimum viable definition', () => {
    expect(validateGameDefinition(VALID)).toEqual(VALID)
  })

  it('accepts an optional viewport', () => {
    const withViewport = { ...VALID, viewport: { width: 1280, height: 720 } }
    expect(validateGameDefinition(withViewport)).toEqual(withViewport)
  })

  it('drops unknown fields instead of passing them through', () => {
    // The core must not carry game-specific data it does not understand.
    const result = validateGameDefinition({ ...VALID, secretSauce: 'nope' })
    expect(result).not.toHaveProperty('secretSauce')
  })

  describe('id', () => {
    it('requires kebab-case, since the id becomes a directory and a config key', () => {
      expect(() => validateGameDefinition({ ...VALID, id: 'Poke IdleWorld' })).toThrow(
        /kebab-case/i,
      )
      expect(() => validateGameDefinition({ ...VALID, id: 'poke_idleworld' })).toThrow(
        /kebab-case/i,
      )
      expect(() => validateGameDefinition({ ...VALID, id: '../escape' })).toThrow(/kebab-case/i)
    })

    it.each(['', '   '])('rejects a blank id %p', (id) => {
      expect(() => validateGameDefinition({ ...VALID, id })).toThrow(/id/i)
    })
  })

  describe('name', () => {
    it.each(['', '   '])('rejects a blank name %p', (name) => {
      expect(() => validateGameDefinition({ ...VALID, name })).toThrow(/name/i)
    })
  })

  describe('url', () => {
    it('requires https, so session cookies are never sent in the clear', () => {
      expect(() => validateGameDefinition({ ...VALID, url: 'http://example.com/' })).toThrow(
        /https/i,
      )
    })

    it.each(['javascript:alert(1)', 'file:///C:/Windows/System32/', 'data:text/html,<h1>x'])(
      'rejects %p, which would turn a config field into code execution or disk access',
      (url) => {
        expect(() => validateGameDefinition({ ...VALID, url })).toThrow(/https/i)
      },
    )

    it('rejects something that is not a URL at all', () => {
      expect(() => validateGameDefinition({ ...VALID, url: 'not a url' })).toThrow(/url/i)
    })
  })

  describe('viewport', () => {
    it.each([
      { width: 0, height: 720 },
      { width: 1280, height: -1 },
      { width: 1280.5, height: 720 },
    ])('rejects viewport %o', (viewport) => {
      expect(() => validateGameDefinition({ ...VALID, viewport })).toThrow(/viewport/i)
    })
  })

  it.each([null, undefined, 'string', 42, []])('rejects %p as a definition', (input) => {
    expect(() => validateGameDefinition(input)).toThrow()
  })

  it('names the offending game so a broken definition is findable', () => {
    expect(() => validateGameDefinition({ ...VALID, url: 'http://x.com' })).toThrow(
      /poke-idleworld/,
    )
  })
})

describe('buildRegistry', () => {
  it('indexes definitions by id', () => {
    const registry = buildRegistry([VALID])
    expect(registry.get('poke-idleworld')).toEqual(VALID)
    expect(registry.size).toBe(1)
  })

  it('accepts an empty registry', () => {
    expect(buildRegistry([]).size).toBe(0)
  })

  it('rejects duplicate ids, which would silently shadow a game', () => {
    expect(() => buildRegistry([VALID, { ...VALID, name: 'Impostor' }])).toThrow(/duplicate/i)
  })

  it('rejects the whole registry if any definition is invalid', () => {
    // Partially loading the registry would mean a game vanishes from the panel
    // with no explanation. Fail loudly instead.
    expect(() => buildRegistry([VALID, { ...VALID, id: 'other', url: 'http://x.com' }])).toThrow(
      /https/i,
    )
  })
})
