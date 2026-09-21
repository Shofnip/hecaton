import { describe, expect, it, vi } from 'vitest'
import { SingleFlightTask } from './periodic-task.js'

describe('a single-flight periodic task', () => {
  it('does not overlap ticks and waits for the active one before stopping', async () => {
    let finish!: () => void
    const work = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const task = new SingleFlightTask(work)

    task.run()
    task.run()
    const stopped = task.stop()

    expect(work).toHaveBeenCalledTimes(1)
    let didStop = false
    void stopped.then(() => {
      didStop = true
    })
    await Promise.resolve()
    expect(didStop).toBe(false)

    finish()
    await stopped
    task.run()

    expect(work).toHaveBeenCalledTimes(1)
  })
})
