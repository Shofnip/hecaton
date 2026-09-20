/** Chromium's measured preset ladder; revalidate when the bundled pin changes. */
const PRESETS = [0.25, 1 / 3, 0.5, 2 / 3, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]
const EPSILON = 0.001
const LEVELS = PRESETS.map((factor) => Math.log(factor) / Math.log(1.2))

/**
 * Approximate a 1920x1080 CSS workspace inside a card, using Chromium presets.
 * Bounds are physical pixels; divide by the display scale before comparing.
 * Nearest preset (ties favour the smaller one), clamped to 25..100%. This is
 * not a promise of exactly 1920 CSS pixels at every card size. Focus is 100%.
 */
export function screenZoomFactor(
  bounds: { width: number; height: number },
  dpiScale: number,
  focused: boolean,
): number | undefined {
  if (
    ![bounds.width, bounds.height, dpiScale].every((value) => Number.isFinite(value) && value > 0)
  )
    return undefined
  if (focused) return 1
  const desired = Math.min(1, bounds.width / (1920 * dpiScale), bounds.height / (1080 * dpiScale))
  return PRESETS.filter((factor) => factor <= 1).reduce((best, factor) =>
    Math.abs(factor - desired) < Math.abs(best - desired) ? factor : best,
  )
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validLevel(level: unknown): level is number {
  if (typeof level !== 'number' || !Number.isFinite(level)) return false
  return level >= LEVELS[0]! && level <= LEVELS[LEVELS.length - 1]!
}

/**
 * Interpret only the normal storage partition's default zoom. Missing is the
 * browser's level zero; malformed/unsupported is unknown, never an assumed 100%.
 * No per-host values, identifiers or other profile fields leave this function.
 */
export function defaultZoomLevel(preferences: unknown): number | undefined {
  if (!record(preferences)) return undefined
  const partition = preferences['partition']
  if (partition === undefined) return 0
  if (!record(partition)) return undefined
  const defaults = partition['default_zoom_level']
  if (defaults === undefined) return 0
  if (!record(defaults)) return undefined
  const level = defaults['x']
  if (level === undefined) return 0
  return validLevel(level) ? level : undefined
}

/**
 * Signed single-preset commands AFTER resetting to the known profile default.
 * The default can be a custom value inserted in Chromium's preset ladder.
 * This is not a delta from a remembered current zoom or a wheel-event count.
 */
export function zoomStepsFromDefault(level: number, target: number): number | undefined {
  if (!validLevel(level)) return undefined
  const targetIndex = PRESETS.findIndex((factor) => Math.abs(factor - target) < EPSILON)
  if (targetIndex < 0) return undefined
  const ladder = [...LEVELS]
  if (!ladder.some((preset) => Math.abs(preset - level) <= EPSILON)) {
    ladder.push(level)
    ladder.sort((a, b) => a - b)
  }
  const from = ladder.findIndex((preset) => Math.abs(preset - level) <= EPSILON)
  const to = ladder.indexOf(LEVELS[targetIndex]!)
  return to - from
}
