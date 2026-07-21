/**
 * Directory name holding a slot's browser profile.
 *
 * Pure string work on purpose: it touches no disk, so it stays testable and the
 * core stays free of I/O. The caller joins it onto the data directory.
 *
 * Stability matters more than prettiness here — a slot that resolves to a
 * different name after a restart would silently lose its logged-in session.
 */
export function slotProfileDirName(slotId: number): string {
  if (!Number.isInteger(slotId) || slotId < 1) {
    throw new Error(`slot id must be a positive integer, got ${slotId}`)
  }
  return `slot-${slotId}`
}
