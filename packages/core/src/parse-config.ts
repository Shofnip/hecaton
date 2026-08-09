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
import {
  DEFAULT_GLOBAL_CONFIG,
  MAX_SLOT_NAME_LENGTH,
  SCHEMA_VERSION,
  resolveSlotConfig,
} from './config.js'
import type { GlobalConfig, SlotOverrides, Theme } from './config.js'
import { normalizeUrl } from './normalize-url.js'
import { isGameId } from './registry.js'

export interface ParsedConfig {
  globals: GlobalConfig
  slots: SlotOverrides[]
}

const GLOBAL_KEYS = [
  'schemaVersion',
  'maxSlots',
  'persistProfile',
  'mute',
  'audioFollowsFocus',
  'theme',
  'termsAcknowledged',
  'releaseNotesShownFor',
  'slots',
] as const
const SLOT_KEYS = [
  'id',
  'gameId',
  'url',
  'persistProfile',
  'mute',
  'name',
  'volume',
  'muted',
  'backgroundThrottling',
] as const

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

function requireNonNegativeInteger(value: unknown, field: string, context: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(
      `${context}${field} must be a non-negative integer, got ${JSON.stringify(value)}`,
    )
  }
  return value as number
}

function requireTheme(value: unknown, context: string): Theme {
  if (value !== 'dark' && value !== 'light') {
    throw new Error(`${context}theme must be "dark" or "light", got ${JSON.stringify(value)}`)
  }
  return value
}

function requireString(value: unknown, field: string, context: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${context}${field} must be a non-empty string, got ${JSON.stringify(value)}`)
  }
  return value
}

/**
 * A gameId, held to the same shape the registry holds its own ids to.
 *
 * This is the field that made the log guarantee narrower than it read. Every
 * other value on a log record is safe by **type** — `slotId` and `pid` are
 * numbers, `level` and `event` are literals in the app's own code — while
 * `gameId` was any non-blank string, copied through unredacted because redaction
 * only ever applied to `message`. A hand-edited config naming a url here put that
 * url, query string and any session token in it, into a log file, and the same
 * line would show it redacted in `message` and in the clear in `gameId`.
 *
 * Constraining it here rather than redacting it later is the smaller change and
 * the one that keeps the invariant sayable in one sentence: nothing on a log
 * record can hold a url except `message`, which is redacted. It also fails at the
 * moment the user can act on it — a named error on load rather than a slot that
 * crashes later on an unknown game.
 */
function requireGameId(value: unknown, context: string): string {
  const id = requireString(value, 'gameId', context)
  if (!isGameId(id)) {
    throw new Error(`${context}gameId must be kebab-case, got ${JSON.stringify(id)}`)
  }
  return id
}

function requireIntegerInRange(
  value: unknown,
  field: string,
  context: string,
  min: number,
  max: number,
): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(
      `${context}${field} must be an integer between ${min} and ${max}, got ${JSON.stringify(value)}`,
    )
  }
  return value as number
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
  readSlotFields(input, slot, context)

  // Cross-field rules live in resolveSlotConfig. Calling it here is a
  // validation pass whose result is deliberately discarded: the orchestrator
  // resolves slots itself, and duplicating the rules is how they drift.
  resolveSlotConfig(globals, slot)
  return slot
}

/** The optional fields common to every slot form. Mutates `into`. */
function readSlotFields(
  input: Record<string, unknown>,
  into: SlotOverrides,
  context: string,
): void {
  if (input['gameId'] !== undefined) {
    into.gameId = requireGameId(input['gameId'], context)
  }
  if (input['url'] !== undefined) {
    // Normalised here, at the boundary, so the value that is validated, stored
    // and shown is the same one - a bare host the user typed becomes https.
    into.url = normalizeUrl(requireString(input['url'], 'url', context))
  }
  if (input['persistProfile'] !== undefined) {
    into.persistProfile = requireBoolean(input['persistProfile'], 'persistProfile', context)
  }
  if (input['mute'] !== undefined) into.mute = requireBoolean(input['mute'], 'mute', context)
  if (input['name'] !== undefined) {
    const name = requireString(input['name'], 'name', context)
    if (name.length > MAX_SLOT_NAME_LENGTH) {
      throw new Error(`${context}name must be at most ${MAX_SLOT_NAME_LENGTH} characters`)
    }
    into.name = name
  }
  if (input['volume'] !== undefined) {
    into.volume = requireIntegerInRange(input['volume'], 'volume', context, 0, 100)
  }
  if (input['muted'] !== undefined) into.muted = requireBoolean(input['muted'], 'muted', context)
  if (input['backgroundThrottling'] !== undefined) {
    into.backgroundThrottling = requireBoolean(
      input['backgroundThrottling'],
      'backgroundThrottling',
      context,
    )
  }
}

/** The keys an addition may carry — the slot keys minus the id it does not choose. */
const SLOT_ADDITION_KEYS = SLOT_KEYS.filter((key) => key !== 'id')

/**
 * Validates a slot the panel wants to add, which carries no id.
 *
 * The id is the orchestrator's to assign — the renderer cannot know which
 * number is free — so an id in the payload is rejected rather than trusted. The
 * cross-field rules still apply, most of all https: an add channel does not get
 * to skip the boundary a config entry and an update both enforce. A placeholder
 * id runs those checks and is then dropped.
 */
export function parseSlotAddition(
  input: unknown,
  globals: GlobalConfig,
): Omit<SlotOverrides, 'id'> {
  if (!isPlainObject(input)) {
    throw new Error(`new slot must be an object, got ${JSON.stringify(input)}`)
  }
  rejectUnknownKeys(input, SLOT_ADDITION_KEYS, 'new slot: ')

  // Validate through the full slot shape with a placeholder id, then return
  // just the fields — the real id is the orchestrator's to assign.
  const withPlaceholder: SlotOverrides = { id: 1 }
  readSlotFields(input, withPlaceholder, 'new slot: ')
  resolveSlotConfig(globals, withPlaceholder)

  const fields: Omit<SlotOverrides, 'id'> = {}
  if (withPlaceholder.gameId !== undefined) fields.gameId = withPlaceholder.gameId
  if (withPlaceholder.url !== undefined) fields.url = withPlaceholder.url
  if (withPlaceholder.persistProfile !== undefined) {
    fields.persistProfile = withPlaceholder.persistProfile
  }
  if (withPlaceholder.mute !== undefined) fields.mute = withPlaceholder.mute
  if (withPlaceholder.name !== undefined) fields.name = withPlaceholder.name
  if (withPlaceholder.volume !== undefined) fields.volume = withPlaceholder.volume
  if (withPlaceholder.muted !== undefined) fields.muted = withPlaceholder.muted
  if (withPlaceholder.backgroundThrottling !== undefined) {
    fields.backgroundThrottling = withPlaceholder.backgroundThrottling
  }
  return fields
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
    // Additive after v1: a file written before this setting existed omits the
    // key, and its absence means the shipped default (on). Present but not a
    // boolean is still an error — a typo must not be read as "off".
    audioFollowsFocus:
      input['audioFollowsFocus'] === undefined
        ? DEFAULT_GLOBAL_CONFIG.audioFollowsFocus
        : requireBoolean(input['audioFollowsFocus'], 'audioFollowsFocus', 'config: '),
    // Additive like audioFollowsFocus: absent means the shipped default (dark);
    // present but not one of the two themes is a typo, not a silent fallback.
    theme:
      input['theme'] === undefined
        ? DEFAULT_GLOBAL_CONFIG.theme
        : requireTheme(input['theme'], 'config: '),
    // Additive too, and the default matters more than the others': absent means
    // this file predates the warning, so nobody has read it. Reading absence as
    // "acknowledged" would skip the one moment it can still change a decision.
    termsAcknowledged:
      input['termsAcknowledged'] === undefined
        ? DEFAULT_GLOBAL_CONFIG.termsAcknowledged
        : requireNonNegativeInteger(input['termsAcknowledged'], 'termsAcknowledged', 'config: '),
  }

  // Optional with no default: absent is a meaningful value here — nobody has
  // been shown any release notes — and writing a placeholder would make the
  // first version's notes look already seen.
  if (input['releaseNotesShownFor'] !== undefined) {
    globals.releaseNotesShownFor = requireString(
      input['releaseNotesShownFor'],
      'releaseNotesShownFor',
      'config: ',
    )
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
