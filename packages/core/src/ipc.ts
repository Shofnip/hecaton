/**
 * The IPC contract: every channel the panel may call, and the validation of
 * what it sends.
 *
 * It lives in the core because it is a decision, not plumbing. Adapters hold no
 * business rules, and "what may the renderer ask for" is the most consequential
 * rule in the app — the renderer talks to a process that launches browsers and
 * owns logged-in sessions.
 *
 * The reason this validation is real code rather than a type annotation: the
 * renderer is a separate process. TypeScript types are erased at compile time,
 * so a payload that the signature says is a number arrives as `unknown` and may
 * be anything at all. Validating in the main process is the only check there
 * is; the renderer's own is a convenience for honest callers.
 *
 * Channels are enumerated rather than dispatched by name from a payload. A
 * generic invoke(method, args) would be less code today and an
 * arbitrary-call surface the first time someone forwards a method name.
 */
import { MAX_SLOT_NAME_LENGTH } from './config.js'
import type { GlobalConfig, SlotOverrides, Theme } from './config.js'
import { parseSlotOverrides } from './parse-config.js'

/**
 * Every channel, in one place, so preload and main cannot drift apart.
 *
 * `logs:reveal` takes no argument on purpose. The main process computes the
 * logs directory itself; a channel that accepted a path would be "open an
 * arbitrary file" wearing a friendly name. It is the app's only handoff to the
 * OS shell.
 */
export const IPC_CHANNELS = [
  'slot:start',
  'slot:stop',
  'slot:focus',
  'slot:add',
  'slot:remove',
  'config:read',
  'config:updateSlot',
  'config:setAudioFollowsFocus',
  'logs:reveal',
  'profiles:clearArchives',
  'profiles:clearSlotCache',
  'profiles:clearAllCaches',
  // The video-wall runtime controls (UI rework, decision 7): a fixed contract —
  // any channel beyond these stops the work for the owner (CLAUDE.md rule 2).
  'slots:rename',
  'slots:setVolume',
  'slots:setMuted',
  'slots:reload',
  'ui:setTheme',
] as const

export type IpcChannel = (typeof IPC_CHANNELS)[number]

export function parseSlotId(input: unknown): number {
  if (!Number.isInteger(input) || (input as number) < 1) {
    throw new Error(`slot id must be a positive integer, got ${JSON.stringify(input)}`)
  }
  return input as number
}

/**
 * For channels that take nothing.
 *
 * Refusing an unexpected payload rather than ignoring it: ignoring would mean a
 * renderer could send an argument for years and the day someone adds a
 * parameter, old callers start being honoured. The channels that take no
 * argument are the ones where that would matter most.
 */
export function parseNoPayload(input: unknown): void {
  if (input !== undefined) {
    throw new Error(`this channel takes no arguments, got ${JSON.stringify(input)}`)
  }
}

/**
 * The audio-follows-focus toggle, as the panel flips it.
 *
 * A single boolean, validated as one: the renderer is a separate process, so a
 * stray truthy value must not be read as "on". This is the whole payload of a
 * dedicated channel rather than a field on a generic config-write, so the IPC
 * surface stays a list of specific things the renderer may do.
 */
export function parseAudioFollowsFocus(input: unknown): boolean {
  if (typeof input !== 'boolean') {
    throw new Error(`audioFollowsFocus must be true or false, got ${JSON.stringify(input)}`)
  }
  return input
}

/**
 * A slot change requested by the panel.
 *
 * Deliberately the same validator the config file goes through, so the two can
 * never disagree about what a slot may be — including the https rule, which is
 * a security boundary rather than a style preference, and which a custom slot
 * is not a way around.
 */
export function parseSlotUpdate(input: unknown, globals: GlobalConfig): SlotOverrides {
  return parseSlotOverrides(input, globals, 'slot update')
}

/** The `{id, ...}` shape the runtime slots:* channels carry, before its field. */
function requireIdObject(
  input: unknown,
  where: string,
): { id: number; rest: Record<string, unknown> } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error(`${where} must be an object, got ${JSON.stringify(input)}`)
  }
  const rest = input as Record<string, unknown>
  return { id: parseSlotId(rest['id']), rest }
}

/**
 * A rename from the edit modal: a slot id and its new display name.
 *
 * An empty name is valid, not rejected — the modal clears the field to revert
 * to the "Tela {N}" placeholder, and the orchestrator reads "" as that revert.
 * The 24-char cap is the same constant the config file and the slot parser use.
 */
export function parseSlotRename(input: unknown): { id: number; name: string } {
  const { id, rest } = requireIdObject(input, 'slot rename')
  const name = rest['name']
  if (typeof name !== 'string') {
    throw new Error(`slot name must be a string, got ${JSON.stringify(name)}`)
  }
  if (name.length > MAX_SLOT_NAME_LENGTH) {
    throw new Error(`slot name must be at most ${MAX_SLOT_NAME_LENGTH} characters`)
  }
  return { id, name }
}

/** A volume change from the popover: a slot id and a 0-100 integer. */
export function parseSlotVolume(input: unknown): { id: number; volume: number } {
  const { id, rest } = requireIdObject(input, 'slot volume')
  const volume = rest['volume']
  if (!Number.isInteger(volume) || (volume as number) < 0 || (volume as number) > 100) {
    throw new Error(`volume must be an integer between 0 and 100, got ${JSON.stringify(volume)}`)
  }
  return { id, volume: volume as number }
}

/** A mute toggle from the popover: a slot id and a boolean. */
export function parseSlotMuted(input: unknown): { id: number; muted: boolean } {
  const { id, rest } = requireIdObject(input, 'slot muted')
  const muted = rest['muted']
  if (typeof muted !== 'boolean') {
    throw new Error(`muted must be true or false, got ${JSON.stringify(muted)}`)
  }
  return { id, muted }
}

/** The theme toggle: one of the two shipped themes, validated as a literal. */
export function parseTheme(input: unknown): Theme {
  if (input !== 'dark' && input !== 'light') {
    throw new Error(`theme must be "dark" or "light", got ${JSON.stringify(input)}`)
  }
  return input
}

// A slot the panel wants to add carries no id — the orchestrator assigns it —
// so its validator lives beside the config one and is surfaced here as part of
// the IPC contract.
export { parseSlotAddition } from './parse-config.js'
