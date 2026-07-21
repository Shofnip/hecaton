import { describe, expect, it } from 'vitest'
import { slotProfileDirName } from './slot-profile.js'

describe('slotProfileDirName', () => {
  it('derives a stable directory name from the slot id', () => {
    expect(slotProfileDirName(1)).toBe('slot-1')
    expect(slotProfileDirName(4)).toBe('slot-4')
  })

  it('is stable across calls, so a slot always finds its own session again', () => {
    expect(slotProfileDirName(2)).toBe(slotProfileDirName(2))
  })

  it('never lets two slots resolve to the same directory', () => {
    const names = [1, 2, 3, 4].map(slotProfileDirName)
    expect(new Set(names).size).toBe(names.length)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects %p, which would otherwise produce a bogus path',
    (bad) => {
      expect(() => slotProfileDirName(bad)).toThrow(/positive integer/i)
    },
  )
})
