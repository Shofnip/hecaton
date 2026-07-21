/**
 * Poke IdleWorld — the first integrated game, and the one the whole
 * architecture was validated against.
 *
 * Its login page is behind Cloudflare Turnstile, which rejects CDP-controlled
 * browsers. That is why the app spawns Chrome directly rather than driving it,
 * and why a slot's session is worth protecting: recovering one means passing an
 * interactive challenge by hand. See ADR-0003 and ADR-0005.
 *
 * No `viewport`: the field is optional and nothing consumes it — window size
 * comes from `computeGrid`. Filling it in would look like a promise the app
 * does not keep.
 */
import type { GameDefinition } from '@helloweb/core'

export const pokeIdleWorld: GameDefinition = {
  id: 'poke-idleworld',
  name: 'Poke IdleWorld',
  url: 'https://poke.idleworld.online/',
}
