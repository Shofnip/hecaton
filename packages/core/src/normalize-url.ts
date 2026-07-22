/**
 * Fills in a missing scheme on a slot url, so the user can type google.com
 * instead of https://www.google.com.
 *
 * Only a bare host is touched. Anything already carrying `scheme://…` is left
 * exactly as typed — including `http://` — so the https check downstream still
 * rejects what should be rejected rather than this quietly coercing insecure or
 * dangerous input into looking like an https url.
 */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '') return trimmed
  if (trimmed.includes('://')) return trimmed
  return `https://${trimmed}`
}
