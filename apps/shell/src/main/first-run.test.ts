import { describe, expect, it } from 'vitest'
import { firstRunSlots } from './first-run.js'

describe('firstRunSlots', () => {
  it('fills the grid with the given game', () => {
    // Four is the default maxSlots and the 2x2 grid the product is built
    // around - the panel should open usable rather than empty, because v1 has
    // no way to add a slot from the UI.
    expect(firstRunSlots('poke-idleworld', 4)).toEqual([
      { id: 1, gameId: 'poke-idleworld' },
      { id: 2, gameId: 'poke-idleworld' },
      { id: 3, gameId: 'poke-idleworld' },
      { id: 4, gameId: 'poke-idleworld' },
    ])
  })

  it('numbers slots from one', () => {
    // Slot ids are also profile directory names (slot-N), so starting anywhere
    // else would silently change where a session lives.
    expect(firstRunSlots('g', 1)).toEqual([{ id: 1, gameId: 'g' }])
  })

  it('sets nothing else', () => {
    // Every other setting is left to the global defaults, so a seeded slot and
    // a slot the user adds later behave identically.
    for (const slot of firstRunSlots('g', 2)) {
      expect(Object.keys(slot).sort()).toEqual(['gameId', 'id'])
    }
  })

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 2.5],
  ])('refuses a %s count', (_case, count) => {
    expect(() => firstRunSlots('g', count)).toThrow(/count/i)
  })

  it('refuses a blank game id', () => {
    // A seeded slot pointing at nothing would crash on start with "no game or
    // url", which reads like a bug in the app rather than an empty registry.
    expect(() => firstRunSlots('', 4)).toThrow(/game/i)
  })
})
