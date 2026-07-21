/**
 * Slot lifecycle.
 *
 * A pure state machine, so the orchestrator's behaviour — including
 * auto-restart on crash — is testable without launching a browser.
 *
 *   stopped --start--> starting --ready--> running
 *                          |                  |
 *                        crash              crash
 *                          v                  v
 *                       crashed <-------------+
 *                          |
 *                       restart
 *                          v
 *                     restarting --ready--> running
 *
 * `stop` is accepted from anywhere: the user closing a slot must always work.
 */

export const SLOT_STATES = ['stopped', 'starting', 'running', 'crashed', 'restarting'] as const

export type SlotState = (typeof SLOT_STATES)[number]

export type SlotEvent = 'start' | 'ready' | 'crash' | 'stop' | 'restart'

/**
 * Only the legal moves. Anything absent here is a bug in the caller rather than
 * a condition to handle silently, so `transition` throws instead of returning
 * the current state — a slot that quietly ignores events is how an orchestrator
 * ends up wedged with no trace of why.
 */
const TRANSITIONS: Readonly<Record<SlotState, Partial<Record<SlotEvent, SlotState>>>> = {
  stopped: { start: 'starting', stop: 'stopped' },
  starting: { ready: 'running', crash: 'crashed', stop: 'stopped' },
  running: { crash: 'crashed', stop: 'stopped' },
  crashed: { restart: 'restarting', stop: 'stopped' },
  restarting: { ready: 'running', crash: 'crashed', stop: 'stopped' },
}

export function transition(state: SlotState, event: SlotEvent): SlotState {
  const next = TRANSITIONS[state][event]
  if (next === undefined) {
    throw new Error(`cannot handle "${event}" from "${state}"`)
  }
  return next
}

/**
 * Whether a browser process is expected to exist in this state.
 *
 * `crashed` is false: the process is already gone, which is what made it
 * crashed. Used to decide what to watch and what to clean up.
 */
export function isLive(state: SlotState): boolean {
  return state === 'starting' || state === 'running' || state === 'restarting'
}
