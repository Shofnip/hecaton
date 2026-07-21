/**
 * The shipped game registry.
 *
 * Definitions live only here, in the repository, at the same trust level as
 * hardcoded values — there is no user-supplied games folder, and adding one
 * would mean running other people's code inside strangers' logged-in sessions.
 * That is a decision, not an omission: see ADR-0006.
 *
 * This package holds data and nothing else. Validation belongs to the core, so
 * there is one implementation of the rules and one place to audit them.
 */
import { buildRegistry } from '@helloweb/core'
import type { GameDefinition } from '@helloweb/core'
import { pokeIdleWorld } from './poke-idleworld.js'

/**
 * Every game the app ships with.
 *
 * Typed as `GameDefinition` so a malformed entry fails to compile, and passed
 * through the core validator at build time so the rules the type cannot express
 * — kebab-case ids, https urls, unique ids — fail too.
 */
export const GAME_DEFINITIONS: readonly GameDefinition[] = [pokeIdleWorld]

/**
 * The shipped games, indexed by id and validated.
 *
 * Returns a fresh map per call rather than a shared singleton: the registry is
 * handed to the orchestrator, and a mutable module-level map would let one
 * consumer's mistake change what every other consumer sees.
 */
export function buildGameRegistry(): Map<string, GameDefinition> {
  return buildRegistry(GAME_DEFINITIONS)
}

export { pokeIdleWorld } from './poke-idleworld.js'
