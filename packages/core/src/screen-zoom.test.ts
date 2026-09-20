import { describe, expect, it } from 'vitest'
import { ScreenZoom } from './screen-zoom.js'

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
function setup() {
  const reads: number[] = []
  const applied: { pid: number; steps: number }[] = []
  let level: number | undefined = 0
  let success = true
  const zoom = new ScreenZoom(
    {
      defaultZoomLevel: async (pid) => {
        reads.push(pid)
        return level
      },
    },
    {
      applyZoom: async (pid, steps) => {
        applied.push({ pid, steps })
        return success
      },
    },
  )
  return {
    zoom,
    reads,
    applied,
    setLevel: (v: number | undefined) => {
      level = v
    },
    fail: () => {
      success = false
    },
  }
}

describe('zoom scheduling is per live screen, not per layout tick', () => {
  it('applies card/focus/card, without resending unchanged targets', async () => {
    const { zoom, reads, applied } = setup()
    zoom.request(42, 1 / 3)
    await tick()
    zoom.request(42, 1 / 3)
    await tick()
    zoom.request(42, 1)
    await tick()
    zoom.request(42, 1 / 3)
    await tick()
    expect(applied.map((x) => x.steps)).toEqual([-6, 0, -6])
    expect(reads).toHaveLength(3)
  })

  it('uses the actual default and retries unknown on a later frame', async () => {
    const s = setup()
    s.setLevel(undefined)
    s.zoom.request(42, 1)
    await tick()
    expect(s.applied).toEqual([])
    s.setLevel(Math.log(1.25) / Math.log(1.2))
    s.zoom.request(42, 1)
    await tick()
    expect(s.applied).toEqual([{ pid: 42, steps: -2 }])
  })

  it('does not remember a rejected operation as applied', async () => {
    const s = setup()
    s.fail()
    s.zoom.request(42, 1)
    await tick()
    s.zoom.request(42, 1)
    await tick()
    expect(s.applied).toHaveLength(2)
  })

  it('forgets on hide, reload or stop even if the pid/target is reused', async () => {
    const s = setup()
    s.zoom.request(42, 0.5)
    await tick()
    s.zoom.forget(42)
    s.zoom.request(42, 0.5)
    await tick()
    expect(s.applied).toHaveLength(2)
  })

  it('coalesces a target changed during preference reading', async () => {
    let finish!: (v: number) => void
    const applied: number[] = []
    const zoom = new ScreenZoom(
      {
        defaultZoomLevel: () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      },
      {
        applyZoom: async (_pid, steps) => {
          applied.push(steps)
          return true
        },
      },
    )
    zoom.request(42, 0.5)
    zoom.request(42, 1 / 3)
    zoom.request(42, 1)
    finish(0)
    await tick()
    expect(applied).toEqual([0])
  })

  it('drops a preference result from a stopped/reused pid', async () => {
    const finish: ((v: number) => void)[] = []
    const applied: number[] = []
    const zoom = new ScreenZoom(
      { defaultZoomLevel: () => new Promise((resolve) => finish.push(resolve)) },
      {
        applyZoom: async (_pid, steps) => {
          applied.push(steps)
          return true
        },
      },
    )
    zoom.request(42, 0.5)
    zoom.forget(42)
    zoom.request(42, 1)
    finish[0]!(0)
    await tick()
    expect(applied).toEqual([])
    finish[1]!(0)
    await tick()
    expect(applied).toEqual([0])
  })

  it('sends only the latest target after an in-flight operation', async () => {
    const finish: ((v: boolean) => void)[] = []
    const applied: number[] = []
    const zoom = new ScreenZoom(
      { defaultZoomLevel: async () => 0 },
      {
        applyZoom: async (_pid, steps) => {
          applied.push(steps)
          return new Promise((resolve) => finish.push(resolve))
        },
      },
    )
    zoom.request(42, 0.5)
    await tick()
    zoom.request(42, 0.25)
    zoom.request(42, 1)
    finish[0]!(true)
    await tick()
    expect(applied).toEqual([-5, 0])
    finish[1]!(true)
    await tick()
  })

  it('contains read/apply exceptions without holding the next request', async () => {
    let attempts = 0
    const applied: number[] = []
    const zoom = new ScreenZoom(
      {
        defaultZoomLevel: async () => {
          if (++attempts === 1) throw new Error('read')
          return 0
        },
      },
      {
        applyZoom: async (_pid, steps) => {
          applied.push(steps)
          throw new Error('apply')
        },
      },
    )
    zoom.request(42, 1)
    await tick()
    zoom.request(42, 1)
    await tick()
    zoom.request(42, 1)
    await tick()
    expect(applied).toEqual([0, 0])
  })
})
