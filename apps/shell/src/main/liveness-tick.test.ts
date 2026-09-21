import { describe, expect, it } from 'vitest'
import { runDetachedWindowSweep, runLivenessTick } from './liveness-tick.js'

describe('the periodic liveness tick', () => {
  it('does not push an unchanged state to either renderer', async () => {
    let pushes = 0
    let desktopSweeps = 0

    const source = {
      revealDetachedWindows: async () => {
        desktopSweeps++
        return false
      },
      checkLiveness: async () => false,
    }

    await runLivenessTick(source, () => pushes++)

    expect(pushes).toBe(0)
    expect(desktopSweeps).toBe(0)
  })

  it.each([false, true])('pushes only when liveness changes: %s', async (livenessChanged) => {
    let pushes = 0

    await runLivenessTick(
      {
        checkLiveness: async () => livenessChanged,
      },
      () => pushes++,
    )

    expect(pushes).toBe(livenessChanged ? 1 : 0)
  })
})

describe('a focus-triggered detached-window sweep', () => {
  it.each([false, true])('pushes only when the window count changes: %s', async (changed) => {
    let pushes = 0

    await runDetachedWindowSweep({ revealDetachedWindows: async () => changed }, () => pushes++)

    expect(pushes).toBe(changed ? 1 : 0)
  })
})
