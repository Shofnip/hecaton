/**
 * Tibidle — the second integrated game, and the one that proved the registry
 * contract was right to stay small.
 *
 * Nothing about it needed a new field. The core still knows `{id, name, url}`,
 * the icon is found by id (`apps/shell/src/renderer/assets/<id>.ico`), and the
 * window size still comes from `computeGrid`, so `viewport` stays unfilled here
 * for the same reason it is unfilled for Poke IdleWorld: a number nothing reads
 * would look like a promise the app keeps.
 */
import type { GameDefinition } from '@hecaton/core'

export const tibidle: GameDefinition = {
  id: 'tibidle',
  // UI text, so it is the name the game gives itself.
  name: 'Tibidle',
  // The root. Measured on 2026-09-19: `/play`, `/game`, `/login` and
  // `/dashboard` all answer 404, and the page served at `/` is the application
  // in both states - it shows the game to a session that exists and the entry
  // screen to one that does not. A deeper path would be a guess that breaks
  // quietly the day the site adds it for something else.
  url: 'https://tibidle.com/',
}
