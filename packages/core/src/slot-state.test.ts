import { describe, expect, it } from 'vitest'
import { SLOT_STATES, isLive, transition } from './slot-state.js'
import type { SlotEvent, SlotState } from './slot-state.js'

describe('transition', () => {
  describe('the happy path', () => {
    it('walks stopped -> starting -> running', () => {
      expect(transition('stopped', 'start')).toBe('starting')
      expect(transition('starting', 'ready')).toBe('running')
    })

    it('walks a crash through to running again', () => {
      expect(transition('running', 'crash')).toBe('crashed')
      expect(transition('crashed', 'restart')).toBe('restarting')
      expect(transition('restarting', 'ready')).toBe('running')
    })
  })

  describe('failure paths', () => {
    it('treats a browser that never came up as crashed', () => {
      expect(transition('starting', 'crash')).toBe('crashed')
    })

    it('goes back to crashed when a restart also fails', () => {
      expect(transition('restarting', 'crash')).toBe('crashed')
    })

    it('lets the user give up on a crashed slot', () => {
      expect(transition('crashed', 'stop')).toBe('stopped')
    })

    it('lets the user start a crashed slot again', () => {
      // The panel's retry button. Without this, a slot that failed to launch
      // could only be revived by stopping it first, and the panel would have to
      // know that - a business rule leaking into the UI. `restart` is not the
      // same event: it is the automatic path, and it spends the restart budget
      // that a deliberate start resets.
      expect(transition('crashed', 'start')).toBe('starting')
    })
  })

  describe('stopping', () => {
    it.each<SlotState>(['starting', 'running', 'crashed', 'restarting'])(
      'can always stop from %s',
      (from) => {
        expect(transition(from, 'stop')).toBe('stopped')
      },
    )

    it('ignores a stop that arrives when already stopped', () => {
      expect(transition('stopped', 'stop')).toBe('stopped')
    })
  })

  describe('invalid transitions', () => {
    it.each<[SlotState, SlotEvent]>([
      ['stopped', 'ready'],
      ['stopped', 'crash'],
      ['stopped', 'restart'],
      ['running', 'start'],
      ['running', 'ready'],
      ['running', 'restart'],
      ['starting', 'start'],
      ['starting', 'restart'],
      ['crashed', 'ready'],
      ['crashed', 'crash'],
      ['restarting', 'start'],
      ['restarting', 'restart'],
    ])('refuses %s + %s', (state, event) => {
      expect(() => transition(state, event)).toThrow(/cannot .* from/i)
    })

    it('names both the state and the event, so a log line is actionable', () => {
      expect(() => transition('running', 'ready')).toThrow(/running/)
      expect(() => transition('running', 'ready')).toThrow(/ready/)
    })
  })

  it('only ever returns a known state', () => {
    const events: SlotEvent[] = ['start', 'ready', 'crash', 'stop', 'restart']
    for (const state of SLOT_STATES) {
      for (const event of events) {
        try {
          expect(SLOT_STATES).toContain(transition(state, event))
        } catch (error) {
          if (!(error instanceof Error) || !/cannot/i.test(error.message)) throw error
        }
      }
    }
  })
})

describe('isLive', () => {
  it('reports which states mean a browser process should exist', () => {
    expect(isLive('running')).toBe(true)
    expect(isLive('starting')).toBe(true)
    expect(isLive('restarting')).toBe(true)
  })

  it('reports no process for stopped and crashed', () => {
    // Nothing to kill, and nothing to watch: crashed means the process is gone.
    expect(isLive('stopped')).toBe(false)
    expect(isLive('crashed')).toBe(false)
  })
})
