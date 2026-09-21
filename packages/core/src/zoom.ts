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

/**
 * What the manual slider may reach.
 *
 * The same measured ladder the automatic policy uses, so every factor the slider
 * produces is one `zoomStepsFromDefault` can name in native commands — the
 * manual control is a different *chooser*, never a different mechanism. The
 * range is wider than the automatic clamp at the top (200% against 100%)
 * because a person asking for more zoom is asking to read something, and
 * narrower than the browser's own 500% because a card at that factor shows a
 * handful of pixels of the game.
 */
export const MANUAL_ZOOM_MIN = 0.25
export const MANUAL_ZOOM_MAX = 2

/**
 * The rungs the zoom slider has, in order.
 *
 * Exported because the panel draws a slider over exactly these and sends back
 * **which rung**, never a factor of its own (ADR-0031). It is the core that
 * says what rung 3 means, so the ladder and its meaning cannot drift apart
 * between two processes.
 */
export const MANUAL_ZOOM_PRESETS: readonly number[] = PRESETS.filter(
  (factor) => factor >= MANUAL_ZOOM_MIN - EPSILON && factor <= MANUAL_ZOOM_MAX + EPSILON,
)

/**
 * A factor a stored preference or an IPC payload may claim.
 *
 * Only the ladder, and only inside the manual range: a value between two
 * presets would be a zoom the adapter cannot post, and it would arrive here
 * from a hand-edited config file or a renderer asserting a number. Undefined
 * means "no manual factor", which the caller reads as automatic.
 */
export function manualZoomFactor(factor: unknown): number | undefined {
  if (typeof factor !== 'number' || !Number.isFinite(factor)) return undefined
  return MANUAL_ZOOM_PRESETS.find((preset) => Math.abs(preset - factor) < EPSILON)
}

/**
 * What the panel's slider is allowed to say: a rung, not a size.
 *
 * The whole payload of the zoom channel goes through here, so a value that is
 * not an index into the ladder above is refused rather than clamped - clamping
 * an arbitrary number would turn a malformed message into a zoom the user did
 * not ask for.
 */
export function manualZoomAtRung(rung: unknown): number | undefined {
  if (!Number.isInteger(rung)) return undefined
  return MANUAL_ZOOM_PRESETS[rung as number]
}

/**
 * Where a factor sits on the ladder, so the slider opens under the screen's
 * current zoom rather than jumping the moment it is first touched.
 *
 * A factor between two rungs snaps to the nearer one: it can arrive from a
 * hand-edited config file, or from a rung that stopped existing when the
 * bundled Chromium pin moved. Ties favour the smaller preset, as the automatic
 * policy does, so the two never disagree about which rung a size sits on.
 */
export function manualZoomRungOf(factor: number): number {
  let best = 0
  for (let i = 1; i < MANUAL_ZOOM_PRESETS.length; i++) {
    if (Math.abs(MANUAL_ZOOM_PRESETS[i]! - factor) < Math.abs(MANUAL_ZOOM_PRESETS[best]! - factor))
      best = i
  }
  return best
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
