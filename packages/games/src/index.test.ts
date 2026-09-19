/**
 * The shipped registry, checked against the core's own contract.
 *
 * These tests exist because a game definition is data that nothing type-checks
 * at runtime: it is edited by hand, in the repository, and a typo in a url or a
 * duplicated id would only surface when a slot failed to launch. Running the
 * real validator over the real data is what turns that into a build failure.
 */
import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { buildRegistry } from '@hecaton/core'
import { GAME_DEFINITIONS, buildGameRegistry } from './index.js'

describe('the shipped game registry', () => {
  it('passes the core validator', () => {
    // buildRegistry throws on a malformed definition or a duplicate id, so this
    // covers the whole shipped set rather than one game at a time.
    expect(() => buildRegistry(GAME_DEFINITIONS)).not.toThrow()
  })

  it('ships at least one game', () => {
    // Guards the test above: an empty array validates happily and would make
    // every other assertion here vacuous.
    expect(GAME_DEFINITIONS.length).toBeGreaterThan(0)
  })

  it('indexes games by id', () => {
    const registry = buildGameRegistry()
    expect(registry.get('poke-idleworld')).toEqual({
      id: 'poke-idleworld',
      name: 'Poke IdleWorld',
      // /play, not the root: it goes straight to the game when a session
      // exists, and falls back to /login by the game's own redirect when it
      // does not, so it is correct in both states.
      url: 'https://poke.idleworld.online/play',
    })
  })

  it('returns a registry the caller cannot corrupt', () => {
    // Every caller builds its own map. A shared mutable singleton would let one
    // consumer's mistake change what another consumer sees.
    expect(buildGameRegistry()).not.toBe(buildGameRegistry())
  })
})

describe('every shipped url', () => {
  // The https rule is enforced by the core validator, so this cannot fail while
  // the validator works. It is here as a canary on the validator itself: if the
  // rule were ever loosened, the shipped data is what would carry the damage.
  it.each(GAME_DEFINITIONS.map((game) => [game.id, game.url] as const))(
    '%s uses https',
    (_id, url) => {
      expect(new URL(url).protocol).toBe('https:')
    },
  )
})

describe('Tibidle', () => {
  it('is in the registry, at its own root', () => {
    // The root, not a deeper path: /play, /game, /login and /dashboard all
    // answer 404 (measured 2026-09-19), so the entry point is the page the site
    // itself serves, which handles both the logged-in and logged-out states.
    expect(buildGameRegistry().get('tibidle')).toEqual({
      id: 'tibidle',
      name: 'Tibidle',
      url: 'https://tibidle.com/',
    })
  })
})

describe('every shipped game', () => {
  // The renderer draws a slot's favicon from `./assets/<id>.ico`, with no
  // registry field and no mapping table - the id is the file name. A game added
  // without its icon would silently fall back to the generic globe, which is
  // also what a broken image looks like.
  it.each(GAME_DEFINITIONS.map((game) => [game.id] as const))('%s ships an icon', (id) => {
    const icon = new URL(`../../../apps/shell/src/renderer/assets/${id}.ico`, import.meta.url)
    expect(existsSync(icon), `missing assets/${id}.ico`).toBe(true)
  })
})
