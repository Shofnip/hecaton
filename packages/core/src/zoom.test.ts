import { describe, expect, it } from 'vitest'
import {
  defaultZoomLevel,
  manualZoomAtRung,
  manualZoomFactor,
  manualZoomRungOf,
  MANUAL_ZOOM_MAX,
  MANUAL_ZOOM_MIN,
  MANUAL_ZOOM_PRESETS,
  screenZoomFactor,
  zoomStepsFromDefault,
} from './zoom.js'

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

describe('the manual zoom ladder', () => {
  it('is the measured preset ladder, clamped to the manual range', () => {
    expect(MANUAL_ZOOM_PRESETS[0]).toBe(MANUAL_ZOOM_MIN)
    expect(MANUAL_ZOOM_PRESETS[MANUAL_ZOOM_PRESETS.length - 1]).toBe(MANUAL_ZOOM_MAX)
    expect([...MANUAL_ZOOM_PRESETS]).toEqual([...MANUAL_ZOOM_PRESETS].sort((a, b) => a - b))
  })

  it('never offers a rung the native adapter cannot reach', () => {
    // The slider can only ever land on one of these, so every one of them has
    // to be nameable in the signed preset commands the adapter posts.
    for (const factor of MANUAL_ZOOM_PRESETS) {
      expect(zoomStepsFromDefault(0, factor)).toBeDefined()
    }
  })

  it('turns a rung the panel sends into the factor the core chose for it', () => {
    expect(manualZoomAtRung(0)).toBe(MANUAL_ZOOM_MIN)
    expect(manualZoomAtRung(MANUAL_ZOOM_PRESETS.length - 1)).toBe(MANUAL_ZOOM_MAX)
  })

  it.each([-1, MANUAL_ZOOM_PRESETS.length, 1.5, NaN, Infinity, '2', null, undefined, {}])(
    'refuses a rung that is not one: %j',
    (rung) => {
      expect(manualZoomAtRung(rung)).toBeUndefined()
    },
  )

  it('finds the rung a factor sits on, so the slider opens where the screen is', () => {
    expect(manualZoomRungOf(MANUAL_ZOOM_MIN)).toBe(0)
    expect(MANUAL_ZOOM_PRESETS[manualZoomRungOf(1)]).toBe(1)
    // A factor between two rungs - a hand-edited config, or a preset dropped
    // when the Chromium pin moves - snaps rather than falling off the ladder.
    expect(MANUAL_ZOOM_PRESETS[manualZoomRungOf(0.52)]).toBeCloseTo(0.5)
    expect(manualZoomRungOf(99)).toBe(MANUAL_ZOOM_PRESETS.length - 1)
    expect(manualZoomRungOf(0.01)).toBe(0)
  })

  it.each([0, -1, NaN, Infinity, 1e9])('refuses a factor that is not one: %j', (factor) => {
    expect(manualZoomFactor(factor)).toBeUndefined()
  })

  it('accepts only ladder factors inside the manual range', () => {
    expect(manualZoomFactor(0.5)).toBeCloseTo(0.5)
    expect(manualZoomFactor(2)).toBe(2)
    expect(manualZoomFactor(3)).toBeUndefined()
    expect(manualZoomFactor(0.2)).toBeUndefined()
    expect(manualZoomFactor(0.55)).toBeUndefined()
  })
})
