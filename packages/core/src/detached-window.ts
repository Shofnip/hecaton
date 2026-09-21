/**
 * The windows a screen's own browser opens, and why they have to be rescued.
 *
 * A game that signs you in through a provider — "entrar com Google" — opens a
 * second browser window for the login. That window is **not** the screen: it is
 * top-level, it belongs to the same browser process, and nothing in the video
 * wall ever asked for it.
 *
 * It arrives invisible, and the reason is this architecture rather than a bug in
 * the browser. A screen is born at `OFFSCREEN_LAUNCH` (-32000) so it never
 * flashes on the desktop before being embedded, and it is then moved into the
 * panel through the Win32 worker — underneath the browser, which is never told.
 * So when the page opens a window, the browser positions it against where it
 * still believes the opener is: off the left edge of the world. Measured
 * 2026-09-18 with the production sequence: the login window came up **visible**,
 * 700x480, at (-32000,-32000) — present in the taskbar, reachable by nothing.
 *
 * The rule is deliberately narrow: a window that cannot be seen at all is moved
 * into view, once; a window with any part of it on a monitor is left exactly
 * where it is. An app that re-centres a window the user dragged is worse than
 * one that never helped.
 */
import type { GridCell } from './grid.js'

/** Whether two rectangles share at least one pixel. */
function overlaps(a: GridCell, b: GridCell): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/**
 * Whether none of the work areas can show any part of this window.
 *
 * Work areas rather than full monitor bounds: a window hidden behind the taskbar
 * is still draggable, so that is not this function's business.
 *
 * No work areas at all answers `true`, which reads oddly and is the safe way
 * round: the caller does nothing when it has nowhere to move a window to, and
 * the alternative — reporting a window on a desktop that was not there as
 * on-screen — would hide a real off-screen window the moment a session locked.
 */
export function isOffScreen(window: GridCell, workAreas: readonly GridCell[]): boolean {
  return !workAreas.some((area) => overlaps(window, area))
}

/**
 * Where to put a window so it sits in the middle of an area, fully inside it.
 *
 * Position only — the size is the page's business, and a login window resized by
 * us is a login window with a submit button off its own bottom edge. Clamped to
 * the area's top-left when the window is larger than the area, because the one
 * place a window must never land is with its title bar above the top edge: that
 * is the position a user cannot drag it out of.
 */
export function centredOver(window: GridCell, area: GridCell): { x: number; y: number } {
  return {
    x: Math.max(area.x, area.x + Math.round((area.width - window.width) / 2)),
    y: Math.max(area.y, area.y + Math.round((area.height - window.height) / 2)),
  }
}
