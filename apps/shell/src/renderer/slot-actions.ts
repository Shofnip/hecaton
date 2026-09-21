export type SlotLifecycleState =
  'stopped' | 'starting' | 'running' | 'crashed' | 'restarting' | 'stopping'

export type PowerAction = 'start' | 'stop' | 'disabled'

/** Maps lifecycle state to the only sensible action of a screen's power button. */
export function powerAction(state: SlotLifecycleState): PowerAction {
  if (state === 'stopping') return 'disabled'
  if (state === 'stopped' || state === 'crashed') return 'start'
  return 'stop'
}

/** The global button starts an incomplete wall, stops a wholly live one, and waits for shutdown. */
export function wallPowerAction(states: readonly SlotLifecycleState[]): PowerAction {
  if (states.some((state) => state === 'stopping')) return 'disabled'
  if (states.length > 0 && states.every((state) => powerAction(state) === 'stop')) return 'stop'
  return 'start'
}
