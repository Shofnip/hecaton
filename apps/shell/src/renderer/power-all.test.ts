import { describe, expect, it } from 'vitest'
import { StartAll } from './power-all.js'

const tick = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

describe('starting every screen', () => {
  it('dispatches every eligible start in the same turn and waits for all of them', async () => {
    const started: number[] = []
    const finish = new Map<number, () => void>()
    const startAll = new StartAll()

    const running = startAll.run(
      [1, 2, 3],
      (id) => {
        started.push(id)
        return new Promise<void>((resolve) => finish.set(id, resolve))
      },
      () => undefined,
    )

    expect(started).toEqual([1, 2, 3])
    let completed = false
    void running.then(() => {
      completed = true
    })
    finish.get(2)!()
    finish.get(1)!()
    await tick()
    expect(completed).toBe(false)
    finish.get(3)!()
    await expect(running).resolves.toBe(true)
  })

  it('reports one failed screen without abandoning the others', async () => {
    const started: number[] = []
    const errors: unknown[] = []
    const startAll = new StartAll()

    await startAll.run(
      [1, 2, 3],
      async (id) => {
        started.push(id)
        if (id === 2) throw new Error('second failed')
      },
      (error) => errors.push(error),
    )

    expect(started).toEqual([1, 2, 3])
    expect(errors).toHaveLength(1)
  })

  it('rejects a duplicate global start while the first one is unresolved', async () => {
    const started: number[] = []
    let finish!: () => void
    const startAll = new StartAll()

    const first = startAll.run(
      [1],
      (id) => {
        started.push(id)
        return new Promise<void>((resolve) => {
          finish = resolve
        })
      },
      () => undefined,
    )
    const duplicate = startAll.run(
      [2],
      async (id) => {
        started.push(id)
      },
      () => undefined,
    )

    await expect(duplicate).resolves.toBe(false)
    expect(started).toEqual([1])
    finish()
    await expect(first).resolves.toBe(true)
  })
})
