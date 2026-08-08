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
import type { GridCell } from './grid.js'
import { parseSlotOverrides } from './parse-config.js'

/**
 * One screen's place in the video wall, as the renderer computes it.
 *
 * `bounds` is the screen's rectangle in the panel's client area (the coordinates
 * MoveWindow wants for an embedded child). Absent bounds means the screen is
 * hidden — a non-focused screen in focus mode, or every screen while a panel
 * modal is open. Only the renderer knows these rectangles, since they depend on
 * the card layout, the focus divider and the DOM.
 */
export interface ScreenPlacement {
  id: number
  bounds?: GridCell
}

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
  // "Your data": where it is, and removing it. Both take no argument, for the
  // same reason `logs:reveal` does not — the directory comes from
  // `@hecaton/storage`'s own path functions, never from the renderer. A channel
  // that accepted a path would be "delete an arbitrary directory" wearing a
  // friendly name, which is the one thing this app must never expose.
  //
  // `data:deleteAll` is the only way to delete a *live* profile in this app, and
  // deliberately the only one: it exists because a portable zip has no
  // uninstaller to ask the question in (D4, reversed 2026-08-08). There is no
  // command-line equivalent — see the note in main.ts about the flag that was
  // removed.
  'data:reveal',
  'data:deleteAll',
  // The terms warning (D3b), acknowledged once. No payload: what version was
  // read is the main process's to know, not the renderer's to assert — a channel
  // that accepted a number would let the panel claim any of them.
  'terms:acknowledge',
  // The video-wall runtime controls (UI rework, decision 7): a fixed contract —
  // any channel beyond these stops the work for the owner (CLAUDE.md rule 2).
  'slots:rename',
  'slots:setVolume',
  'slots:setMuted',
  'slots:reload',
  'ui:setTheme',
  // The renderer-owned geometry channel (UI rework, Option 1, approved by the
  // owner): the renderer sends where each embedded screen goes, main relays it.
  'screens:layout',
  // The overlay window (UI rework, approved by the owner): modals and the volume
  // popover render in a separate always-on-top window so they paint above the
  // embedded game windows without hiding any screen. `open` asks main to show it
  // with a request; `close` asks main to hide it.
  'overlay:open',
  'overlay:close',
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

/** A coordinate or size field of a placement's bounds. */
function requireBoundsInteger(value: unknown, field: string, min: number): number {
  // Capped as well as floored: an absurd value is a bug or an attack, not a
  // window position, and unbounded integers reach the child-move worker.
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > 100_000) {
    throw new Error(
      `screen bounds ${field} must be an integer >= ${min}, got ${JSON.stringify(value)}`,
    )
  }
  return value as number
}

/**
 * The full video-wall layout the renderer sends: where each screen goes, or that
 * it is hidden. Structural validation only — main clamps the rectangles to the
 * panel's actual content size, which is its to know, not the core's.
 */
export function parseScreenLayout(input: unknown): ScreenPlacement[] {
  if (!Array.isArray(input)) {
    throw new Error(`screen layout must be an array, got ${JSON.stringify(input)}`)
  }
  return input.map((raw) => {
    const { id, rest } = requireIdObject(raw, 'screen placement')
    const rawBounds = rest['bounds']
    if (rawBounds === undefined) return { id }
    if (typeof rawBounds !== 'object' || rawBounds === null || Array.isArray(rawBounds)) {
      throw new Error(`screen bounds must be an object, got ${JSON.stringify(rawBounds)}`)
    }
    const b = rawBounds as Record<string, unknown>
    return {
      id,
      bounds: {
        x: requireBoundsInteger(b['x'], 'x', 0),
        y: requireBoundsInteger(b['y'], 'y', 0),
        width: requireBoundsInteger(b['width'], 'width', 1),
        height: requireBoundsInteger(b['height'], 'height', 1),
      },
    }
  })
}

/**
 * What the wall asks the overlay to show. A discriminated union, validated as
 * one: the overlay is a second renderer, so what arrives is `unknown` and a
 * stray kind must be refused, not guessed. `volume` carries the anchor — the
 * volume button's rectangle in the wall's client area — because the overlay
 * covers the same client area, so the same coordinates place the popover.
 */
export type OverlayRequest =
  | { kind: 'edit'; id: number }
  | { kind: 'volume'; id: number; anchor: GridCell }
  | { kind: 'settings' }
  | { kind: 'confirmRemove'; id: number }

export function parseOverlayRequest(input: unknown): OverlayRequest {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error(`overlay request must be an object, got ${JSON.stringify(input)}`)
  }
  const rest = input as Record<string, unknown>
  const kind = rest['kind']
  switch (kind) {
    case 'settings':
      return { kind }
    case 'edit':
      return { kind, id: parseSlotId(rest['id']) }
    case 'confirmRemove':
      return { kind, id: parseSlotId(rest['id']) }
    case 'volume': {
      const raw = rest['anchor']
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error(`volume anchor must be an object, got ${JSON.stringify(raw)}`)
      }
      const a = raw as Record<string, unknown>
      return {
        kind,
        id: parseSlotId(rest['id']),
        anchor: {
          x: requireBoundsInteger(a['x'], 'x', 0),
          y: requireBoundsInteger(a['y'], 'y', 0),
          width: requireBoundsInteger(a['width'], 'width', 1),
          height: requireBoundsInteger(a['height'], 'height', 1),
        },
      }
    }
    default:
      throw new Error(`unknown overlay kind ${JSON.stringify(kind)}`)
  }
}

// A slot the panel wants to add carries no id — the orchestrator assigns it —
// so its validator lives beside the config one and is surfaced here as part of
// the IPC contract.
export { parseSlotAddition } from './parse-config.js'
