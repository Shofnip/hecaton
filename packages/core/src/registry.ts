/**
 * Game registry: the contract between the core and each integrated game.
 *
 * Deliberately tiny. The core knows id, name, url and an optional viewport, and
 * nothing else — with a single game any larger schema is a guess. Promote a
 * field here only when a second game proves the need.
 *
 * Definitions ship only in the repository, so they carry the same trust level
 * as hardcoded values. A user-supplied games folder is rejected by design: a
 * dropped-in file would run against other people's logged-in sessions.
 */

export interface Viewport {
  width: number
  height: number
}

export interface GameDefinition {
  id: string
  name: string
  url: string
  viewport?: Viewport
}

/** Lowercase words joined by single hyphens. The id becomes a directory name and a config key. */
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Whether a string is shaped like a game id.
 *
 * Exported because `parse-config.ts` applies the same rule to the `gameId` a
 * user's config names, and a second copy of this regex is a rule that drifts.
 * The direction of the dependency is the right way round: a `gameId` refers to a
 * game, and what a game id looks like is this module's to say.
 */
export function isGameId(value: string): boolean {
  return KEBAB_CASE.test(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireNonBlankString(value: unknown, field: string, context: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${context}${field} must be a non-empty string, got ${JSON.stringify(value)}`)
  }
  return value
}

function validateViewport(value: unknown, context: string): Viewport {
  if (!isPlainObject(value)) {
    throw new Error(`${context}viewport must be an object, got ${JSON.stringify(value)}`)
  }
  for (const side of ['width', 'height'] as const) {
    const measure = value[side]
    if (!Number.isInteger(measure) || (measure as number) < 1) {
      throw new Error(`${context}viewport ${side} must be a positive integer, got ${measure}`)
    }
  }
  return { width: value['width'] as number, height: value['height'] as number }
}

/**
 * Only https is accepted.
 *
 * This is a security boundary, not a style preference: it keeps game sessions
 * encrypted, and it keeps `javascript:`, `file:` and `data:` out — each of
 * which would turn a configuration field into code execution or disk access.
 */
function validateUrl(value: unknown, context: string): string {
  const raw = requireNonBlankString(value, 'url', context)
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`${context}url is not a valid URL: ${JSON.stringify(raw)}`)
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`${context}url must use https, got ${JSON.stringify(parsed.protocol)}`)
  }
  return raw
}

export function validateGameDefinition(input: unknown): GameDefinition {
  if (!isPlainObject(input)) {
    throw new Error(`game definition must be an object, got ${JSON.stringify(input)}`)
  }

  // Validate the id first so every later message can name the offending game.
  const id = requireNonBlankString(input['id'], 'id', 'game definition ')
  if (!isGameId(id)) {
    throw new Error(`game id must be kebab-case, got ${JSON.stringify(id)}`)
  }

  const context = `game "${id}": `
  const name = requireNonBlankString(input['name'], 'name', context)
  const url = validateUrl(input['url'], context)

  // Rebuilt field by field rather than spread: unknown keys must not survive
  // into the core, which would not know what to do with them anyway.
  const definition: GameDefinition = { id, name, url }
  if (input['viewport'] !== undefined) {
    definition.viewport = validateViewport(input['viewport'], context)
  }
  return definition
}

/**
 * Validates every definition and indexes them by id.
 *
 * An invalid or duplicated entry fails the whole registry. Loading it partially
 * would make a game disappear from the panel with no explanation — the kind of
 * silent failure this project treats as a bug.
 */
export function buildRegistry(definitions: readonly unknown[]): Map<string, GameDefinition> {
  const registry = new Map<string, GameDefinition>()
  for (const candidate of definitions) {
    const definition = validateGameDefinition(candidate)
    if (registry.has(definition.id)) {
      throw new Error(`duplicate game id ${JSON.stringify(definition.id)}`)
    }
    registry.set(definition.id, definition)
  }
  return registry
}
