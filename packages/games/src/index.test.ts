/**
 * The shipped registry, checked against the core's own contract.
 *
 * These tests exist because a game definition is data that nothing type-checks
 * at runtime: it is edited by hand, in the repository, and a typo in a url or a
 * duplicated id would only surface when a slot failed to launch. Running the
 * real validator over the real data is what turns that into a build failure.
 */
import { describe, expect, it } from 'vitest'
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
