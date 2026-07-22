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
import type { GlobalConfig, SlotOverrides } from './config.js'
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
  'layout:apply',
  'config:read',
  'config:updateSlot',
  'logs:reveal',
  'profiles:clearArchives',
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

// A slot the panel wants to add carries no id — the orchestrator assigns it —
// so its validator lives beside the config one and is surfaced here as part of
// the IPC contract.
export { parseSlotAddition } from './parse-config.js'
