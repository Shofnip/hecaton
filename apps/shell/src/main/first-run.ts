/**
 * What the panel shows the first time it opens.
 *
 * `parseConfig` treats a missing file as a first run and returns no slots,
 * deliberately: the core cannot name a game without depending on the registry
 * that depends on it. So the decision of what to seed lives here, in the one
 * place that knows both.
 *
 * `count` is 1 in production (`main.ts`): the panel opens usable with one screen
 * and the user adds more from the sidebar's **+**, at which point the grid
 * splits. This function stays general because the seeding count is a product
 * decision, not a property of the seeding.
 *
 * It used to say "a full grid, because v1 has no UI for adding a slot". Both
 * halves stopped being true: `slot:add` and the + button exist, and an empty grid
 * shows "Use o botao + na lateral para adicionar" rather than opening dead. Left
 * in place, that comment was an argument for seeding four browser profiles onto a
 * fresh install.
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
