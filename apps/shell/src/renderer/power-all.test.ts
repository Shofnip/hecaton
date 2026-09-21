import { describe, expect, it } from 'vitest'
import { startAllSequentially } from './power-all.js'

const tick = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

describe('starting every screen', () => {
  it('waits for each browser and its settle gap before launching the next', async () => {
    const events: string[] = []
    const finish = new Map<number, () => void>()
    const running = startAllSequentially(
      [1, 2, 3],
      (id) => {
        events.push(`start ${id}`)
        return new Promise<void>((resolve) => finish.set(id, resolve))
      },
      async () => {
        events.push('settle')
      },
      () => undefined,
    )

    await tick()
    expect(events).toEqual(['start 1'])
    finish.get(1)!()
    await tick()
    expect(events).toEqual(['start 1', 'settle', 'start 2'])
    finish.get(2)!()
    await tick()
    expect(events).toEqual(['start 1', 'settle', 'start 2', 'settle', 'start 3'])
    finish.get(3)!()
    await running
    expect(events).toEqual(['start 1', 'settle', 'start 2', 'settle', 'start 3'])
  })

  it('reports a failed screen and continues with the next one', async () => {
    const started: number[] = []
    const errors: unknown[] = []
    await startAllSequentially(
      [1, 2],
      async (id) => {
        started.push(id)
        if (id === 1) throw new Error('first failed')
      },
      async () => undefined,
      (error) => errors.push(error),
    )
    expect(started).toEqual([1, 2])
    expect(errors).toHaveLength(1)
  })
})
