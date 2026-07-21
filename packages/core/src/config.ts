/**
 * Configuration: shipped defaults, global settings, per-slot overrides.
 *
 * Pure merge logic. Reading and writing the files is the storage adapter's job;
 * config and logs live in %APPDATA%/helloweb in every environment, including
 * development, so the repository never becomes a place real state can land.
 */
import { slotProfileDirName } from './slot-profile.js'

/**
 * Bumped whenever the persisted shape changes, with a migration step on load.
 * Present from the first commit: nearly free now, expensive to retrofit once
 * users have saved files.
 */
export const SCHEMA_VERSION = 1

export interface GlobalConfig {
  schemaVersion: number
  maxSlots: number
  persistProfile: boolean
  mute: boolean
}

/** What a slot may override. Everything except the id is optional. */
export interface SlotOverrides {
  id: number
  gameId?: string
  url?: string
  persistProfile?: boolean
  mute?: boolean
}

export interface ResolvedSlotConfig {
  id: number
  gameId?: string
  url?: string
  persistProfile: boolean
  mute: boolean
  profileDir: string
}

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  schemaVersion: SCHEMA_VERSION,
  maxSlots: 4,
  // Persistent by default: Turnstile is interactive, so a slot that lost its
  // session on every restart would demand a human before it could play again.
  persistProfile: true,
  // Audio on by default. Muting is the game's own setting, which persists in
  // the profile; --mute-audio is offered per slot as a fallback.
  mute: false,
}

export function resolveSlotConfig(globals: GlobalConfig, slot: SlotOverrides): ResolvedSlotConfig {
  if (!Number.isInteger(slot.id) || slot.id < 1) {
    throw new Error(`slot id must be a positive integer, got ${slot.id}`)
  }
  if (slot.id > globals.maxSlots) {
    throw new Error(`slot id ${slot.id} exceeds maxSlots (${globals.maxSlots})`)
  }
  if (slot.gameId !== undefined && slot.url !== undefined) {
    throw new Error(`slot ${slot.id} must name either a game or a url, not both`)
  }
  if (slot.url !== undefined) {
    // Same rule as the registry: a custom slot is not a way around it.
    let parsed: URL
    try {
      parsed = new URL(slot.url)
    } catch {
      throw new Error(`slot ${slot.id} url is not a valid URL: ${JSON.stringify(slot.url)}`)
    }
    if (parsed.protocol !== 'https:') {
      throw new Error(`slot ${slot.id} url must use https, got ${JSON.stringify(parsed.protocol)}`)
    }
  }

  const resolved: ResolvedSlotConfig = {
    id: slot.id,
    persistProfile: slot.persistProfile ?? globals.persistProfile,
    mute: slot.mute ?? globals.mute,
    profileDir: slotProfileDirName(slot.id),
  }
  if (slot.gameId !== undefined) resolved.gameId = slot.gameId
  if (slot.url !== undefined) resolved.url = slot.url
  return resolved
}
