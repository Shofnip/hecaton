import { describe, expect, it } from 'vitest'
import { defaultZoomLevel, zoomStepsFromDefault, screenZoomFactor } from './zoom.js'

describe('the only preference the zoom reader exposes', () => {
  it('reads the default storage partition, not per-host zoom or other partitions', () => {
    expect(
      defaultZoomLevel({
        partition: {
          default_zoom_level: { x: 2, x1234: 8 },
          per_host_zoom_levels: { x: { example: { zoom_level: -4 } } },
        },
      }),
    ).toBe(2)
  })

  it.each([{}, { partition: {} }, { partition: { default_zoom_level: {} } }])(
    'knows that an absent preference means level zero: %j',
    (preferences) => {
      expect(defaultZoomLevel(preferences)).toBe(0)
    },
  )

  it.each([
    null,
    [],
    'secret',
    { partition: null },
    { partition: { default_zoom_level: [] } },
    ...['2', null, NaN, Infinity, -Infinity, 1e9, -1e9].map((x) => ({
      partition: { default_zoom_level: { x } },
    })),
  ])('does not turn malformed data into a claim of 100%%: %j', (preferences) => {
    expect(defaultZoomLevel(preferences)).toBeUndefined()
  })

  it('does not traverse unrelated profile data', () => {
    expect(
      defaultZoomLevel({
        partition: { default_zoom_level: { x: 0 } },
        get otherData() {
          throw new Error('must not read other fields')
        },
      }),
    ).toBe(0)
  })
})

describe('preset commands after reset to the profile default', () => {
  const level = (factor: number) => Math.log(factor) / Math.log(1.2)

  it('reaches 100%, rather than stopping at a 125% default', () => {
    expect(zoomStepsFromDefault(level(1.25), 1)).toBe(-2)
  })

  it('accounts for a non-preset default inserted in the ladder', () => {
    expect(zoomStepsFromDefault(level(0.85), 1)).toBe(2)
    expect(zoomStepsFromDefault(level(0.85), 0.5)).toBe(-4)
    expect(zoomStepsFromDefault(level(1.2), 1)).toBe(-2)
  })

  it('uses the measured single-command ladder, not wheel counts', () => {
    expect(
      [1, 0.9, 0.8, 0.75, 2 / 3, 0.5, 1 / 3, 0.25].map((target) => zoomStepsFromDefault(0, target)),
    ).toEqual([0, -1, -2, -3, -4, -5, -6, -7])
  })

  it('tolerates floating point noise around an existing preset', () => {
    expect(zoomStepsFromDefault(level(1.25) + 1e-9, 1)).toBe(-2)
    expect(zoomStepsFromDefault(level(1 / 3), 1 / 3)).toBe(0)
  })

  it('compares logarithmic levels, not factor differences, like Chromium', () => {
    expect(zoomStepsFromDefault(level(1.1008), 1)).toBe(-2)
    expect(zoomStepsFromDefault(level(0.9005), 1)).toBe(1)
  })

  it.each([
    [NaN, 1],
    [Infinity, 1],
    [1e9, 1],
    [0, 0],
    [0, 0.32],
    [0, NaN],
  ])('refuses an unknown plan instead of guessing: %s -> %s', (from, to) => {
    expect(zoomStepsFromDefault(from, to)).toBeUndefined()
  })
})

describe('card-derived scale, without changing its rectangle', () => {
  it.each([
    [620, 350, 1, 1 / 3],
    [960, 540, 1, 0.5],
    [1920, 1080, 1, 1],
    [3840, 2160, 1, 1],
    [100, 80, 1, 0.25],
    [930, 525, 1.5, 1 / 3],
    [1920, 270, 1, 0.25],
    [480, 1080, 1, 0.25],
  ])('%s×%s at %sx gives %s', (width, height, dpiScale, expected) => {
    expect(screenZoomFactor({ width, height }, dpiScale, false)).toBe(expected)
  })
  it('uses 100% in focus regardless of the card-derived factor', () => {
    expect(screenZoomFactor({ width: 620, height: 350 }, 1, true)).toBe(1)
  })
  it.each([0, -1, NaN, Infinity])('rejects invalid scale/geometry (%s)', (bad) => {
    expect(screenZoomFactor({ width: 620, height: 350 }, bad, false)).toBeUndefined()
    expect(screenZoomFactor({ width: bad, height: 350 }, 1, false)).toBeUndefined()
  })
})
