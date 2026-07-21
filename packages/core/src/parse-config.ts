/**
 * Turns the raw contents of config.json into the shapes the app runs on.
 *
 * The file is untrusted input. It is hand-editable, it can be half-written by a
 * kill during a save, and it can have been written by a newer version of the
 * app. TypeScript types say nothing about any of that: they vanish at compile
 * time, and what arrives here is `unknown`.
 *
 * The rule this file implements is that **an unparseable config fails the whole
 * load, loudly, and the file is never rewritten from a partial parse**. Dropping
 * the bad part would make a slot disappear with no explanation, and the next
 * save would make the loss permanent. It is the same rule buildRegistry follows,
 * for the same reason.
 *
 * The cross-field rules — id range, game-or-url, https — are not reimplemented
 * here. `resolveSlotConfig` owns them, and calling it is what keeps one
 * implementation of the rules and one place to audit them.
 */
import { DEFAULT_GLOBAL_CONFIG, SCHEMA_VERSION, resolveSlotConfig } from './config.js'
import type { GlobalConfig, SlotOverrides } from './config.js'

export interface ParsedConfig {
  globals: GlobalConfig
  slots: SlotOverrides[]
}

const GLOBAL_KEYS = ['schemaVersion', 'maxSlots', 'persistProfile', 'mute', 'slots'] as const
const SLOT_KEYS = ['id', 'gameId', 'url', 'persistProfile', 'mute'] as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Unknown keys are an error rather than something to ignore.
 *
 * Ignoring one is not neutral: the app would drop it on the next save, so a
 * typo silently deletes the line the user meant to write. Refusing keeps the
 * file exactly as they left it.
 */
function rejectUnknownKeys(
  value: Record<string, unknown>,
  known: readonly string[],
  context: string,
): void {
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) {
      throw new Error(`${context}unknown setting ${JSON.stringify(key)}`)
    }
  }
}

function requireBoolean(value: unknown, field: string, context: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${context}${field} must be true or false, got ${JSON.stringify(value)}`)
  }
  return value
}

function requirePositiveInteger(value: unknown, field: string, context: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`${context}${field} must be a positive integer, got ${JSON.stringify(value)}`)
  }
  return value as number
}

function requireString(value: unknown, field: string, context: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${context}${field} must be a non-empty string, got ${JSON.stringify(value)}`)
  }
  return value
}

/**
 * One slot entry, rebuilt field by field.
 *
 * Rebuilt rather than spread so that nothing unvalidated survives into the
 * running app, which is the same reason validateGameDefinition rebuilds.
 *
 * Exported because the config file is not the only untrusted source of a slot:
 * the panel sends the same shape over IPC. Validating both with this function
 * is what makes them agree by construction — the renderer cannot ask for a slot
 * that could not have been written in config.json, and nobody has to keep two
 * lists of rules in step.
 */
export function parseSlotOverrides(
  input: unknown,
  globals: GlobalConfig,
  where = 'slot entry',
): SlotOverrides {
  if (!isPlainObject(input)) {
    throw new Error(`${where} must be an object, got ${JSON.stringify(input)}`)
  }

  // The id comes first so every later message can name the slot the user has
  // to go and fix, rather than an array index they would have to count out.
  const id = requirePositiveInteger(input['id'], 'id', `${where}: `)
  const context = `slot ${id}: `
  rejectUnknownKeys(input, SLOT_KEYS, context)

  const slot: SlotOverrides = { id }
  if (input['gameId'] !== undefined) slot.gameId = requireString(input['gameId'], 'gameId', context)
  if (input['url'] !== undefined) slot.url = requireString(input['url'], 'url', context)
  if (input['persistProfile'] !== undefined) {
    slot.persistProfile = requireBoolean(input['persistProfile'], 'persistProfile', context)
  }
  if (input['mute'] !== undefined) slot.mute = requireBoolean(input['mute'], 'mute', context)

  // Cross-field rules live in resolveSlotConfig. Calling it here is a
  // validation pass whose result is deliberately discarded: the orchestrator
  // resolves slots itself, and duplicating the rules is how they drift.
  resolveSlotConfig(globals, slot)
  return slot
}

export function parseConfig(input: unknown): ParsedConfig {
  // A missing file is a first run, not a failure.
  if (input === undefined) return { globals: { ...DEFAULT_GLOBAL_CONFIG }, slots: [] }

  if (!isPlainObject(input)) {
    throw new Error(`config must be an object, got ${JSON.stringify(input)}`)
  }
  rejectUnknownKeys(input, GLOBAL_KEYS, 'config: ')

  const schemaVersion = requirePositiveInteger(input['schemaVersion'], 'schemaVersion', 'config: ')
  if (schemaVersion > SCHEMA_VERSION) {
    // Refusing protects the newer file. Reading it with old code risks
    // misreading a field whose meaning changed between versions, and the next
    // save would overwrite everything the newer version had stored.
    throw new Error(
      `config was written by a newer version of the app (schemaVersion ${schemaVersion}); ` +
        `this app understands up to ${SCHEMA_VERSION}. Update the app, or move the file aside.`,
    )
  }
  // Older versions get migrated here when a second schema version exists. There
  // is only one so far, so there is nothing to migrate and nothing to guess at.

  const globals: GlobalConfig = {
    schemaVersion,
    maxSlots: requirePositiveInteger(input['maxSlots'], 'maxSlots', 'config: '),
    persistProfile: requireBoolean(input['persistProfile'], 'persistProfile', 'config: '),
    mute: requireBoolean(input['mute'], 'mute', 'config: '),
  }

  const rawSlots = input['slots']
  if (!Array.isArray(rawSlots)) {
    throw new Error(`config: slots must be an array, got ${JSON.stringify(rawSlots)}`)
  }

  const slots: SlotOverrides[] = []
  const seen = new Set<number>()
  for (const [index, raw] of rawSlots.entries()) {
    const slot = parseSlotOverrides(raw, globals, `config slots[${index}]`)
    if (seen.has(slot.id)) {
      // Which duplicate wins would depend on iteration order, so one of the
      // user's two entries would silently do nothing.
      throw new Error(`config: duplicate slot id ${slot.id}`)
    }
    seen.add(slot.id)
    slots.push(slot)
  }

  return { globals, slots }
}
