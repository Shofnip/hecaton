/**
 * What the panel shows the first time it opens.
 *
 * `parseConfig` treats a missing file as a first run and returns no slots,
 * deliberately: the core cannot name a game without depending on the registry
 * that depends on it. So the decision of what to seed lives here, in the one
 * place that knows both.
 *
 * A full grid rather than an empty panel, because v1 has no UI for adding a
 * slot: an empty panel would open dead.
 */
import type { SlotOverrides } from '@hecaton/core'

export function firstRunSlots(gameId: string, count: number): SlotOverrides[] {
  if (gameId.trim() === '') {
    throw new Error('cannot seed slots without a game id')
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`slot count must be a positive integer, got ${count}`)
  }
  // Ids start at 1 because a slot id is also its profile directory name
  // (slot-N); numbering from anywhere else would move where a session lives.
  return Array.from({ length: count }, (_unused, index) => ({ id: index + 1, gameId }))
}
