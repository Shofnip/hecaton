import { describe, expect, it } from 'vitest'
import { powerAction, wallPowerAction } from './slot-actions.js'

describe('slot power actions', () => {
  it('retries a crashed screen directly and disables one still stopping', () => {
    expect(powerAction('crashed')).toBe('start')
    expect(powerAction('stopping')).toBe('disabled')
  })

  it('starts the incomplete wall when any screen is stopped or crashed', () => {
    expect(wallPowerAction(['running', 'crashed'])).toBe('start')
    expect(wallPowerAction(['running', 'stopped'])).toBe('start')
  })

  it('stops only a wall whose screens are all live and not stopping', () => {
    expect(wallPowerAction(['running', 'starting', 'restarting'])).toBe('stop')
    expect(wallPowerAction(['running', 'stopping'])).toBe('disabled')
  })
})
