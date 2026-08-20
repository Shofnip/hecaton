/**
 * Reading the answer to "is there a newer version?", from a document the app did
 * not write.
 *
 * This is the app's **only** network surface (D7, which reverses ADR-0007's
 * decision 4 premise that v1 makes no request at all), and it is reached only
 * when the user asks. Everything here is the untrusted half: what arrives is
 * whatever `api.github.com` returned, or whatever anything between the user and
 * it returned, and the main process is where it lands. So the parsing lives in
 * the core, in the fast suite, next to the IPC validators and for the same
 * reason.
 *
 * Two properties this file exists to hold:
 *
 * 1. **Nothing that looks like a URL leaves here.** The release page the app
 *    opens is a constant in main. The response carries `html_url` and asset
 *    download links, and using any of them would turn `shell.openExternal` into
 *    "open whatever the server says" — the arbitrary-open surface ADR-0007
 *    decision 3 refused for IPC. The fields are not read at all, which is a
 *    stronger guarantee than reading them carefully.
 * 2. **Failure is a normal outcome, not an exception.** No network, GitHub down,
 *    rate limit, nothing published yet: all of these are things that happen, and
 *    each is returned as a state the panel can phrase in Portuguese. Throwing
 *    would push English core text into the UI for the most ordinary case there
 *    is.
 */

/**
 * How much of a changelog is carried into the panel.
 *
 * The response is unbounded and comes from the network. Four thousand characters
 * is far more than any release note here will be, and small enough that a hostile
 * or accidental megabyte cannot be pushed through IPC into the renderer.
 */
export const UPDATE_NOTES_MAX = 4000

export type UpdateCheck =
  | { status: 'update-available'; version: string; notes: string }
  | { status: 'up-to-date'; version: string }
  | { status: 'none-published' }
  | { status: 'unavailable'; reason: UpdateFailure }

/**
 * Why a check did not produce an answer. Distinguished because the user's next
 * move differs: wait an hour, check the connection, or try again later.
 * `offline` is main's to report — it is the case where no response arrives at
 * all, so there is no status code to interpret.
 */
export type UpdateFailure = 'offline' | 'rate-limited' | 'server' | 'malformed' | 'unexpected'

/** `v0.1.0` or `0.1.0`, and nothing else. Tags here are made by the release workflow. */
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/

function parseVersion(value: string): [number, number, number] | undefined {
  const match = VERSION.exec(value.trim())
  if (!match) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/**
 * Whether `candidate` is a later version than `current`.
 *
 * Compared as numbers, field by field. A string compare would put `0.10.0`
 * before `0.9.0` and tell the user their newer build is out of date — once, at
 * the release where nobody would be looking for it.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!
  }
  return false
}

/**
 * Control characters go; `\t`, `\n` and `\r` stay, because a changelog is written
 * with them. Markup is not filtered: the panel sets `textContent`, so a `<script>`
 * in a release note is five words of text and nothing else.
 */
function cleanNotes(value: unknown): string {
  if (typeof value !== 'string') return ''
  let out = ''
  for (const char of value) {
    const code = char.codePointAt(0)!
    const printable = code >= 0x20 && code !== 0x7f
    if (printable || char === '\t' || char === '\n' || char === '\r') out += char
  }
  return out.slice(0, UPDATE_NOTES_MAX)
}

/**
 * Turns an HTTP status and a response body into what the panel should say.
 *
 * `404` is the case worth naming. It was what this repository answered until
 * v0.1.0 was published on 2026-08-20 — before a first release `/releases/latest`
 * answers `404` while `/releases` answers `200 []`, measured 2026-08-09. That is
 * a normal state, not a failure, so it is reported as "nothing published". It
 * would also be the answer if the repository were renamed or removed, and that
 * is accepted: both mean "there is no release to offer you", which is the only
 * thing the user can act on.
 *
 * Since v0.1.0 the live answer is `200` with `tag_name: v0.1.0`, and the shipped
 * parser was run against it: a machine on 0.1.0 gets `up-to-date`, one on 0.0.9
 * gets `update-available`. The `404` branch stays because it is still reachable,
 * and because it is what any fork of this repository answers before its own
 * first release.
 */
export function interpretUpdateCheck(
  httpStatus: number,
  body: unknown,
  currentVersion: string,
): UpdateCheck {
  if (httpStatus === 404) return { status: 'none-published' }
  if (httpStatus === 403 || httpStatus === 429) {
    return { status: 'unavailable', reason: 'rate-limited' }
  }
  if (httpStatus >= 500) return { status: 'unavailable', reason: 'server' }
  if (httpStatus !== 200) return { status: 'unavailable', reason: 'unexpected' }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { status: 'unavailable', reason: 'malformed' }
  }
  const tag = (body as Record<string, unknown>)['tag_name']
  if (typeof tag !== 'string') return { status: 'unavailable', reason: 'malformed' }

  const parsed = parseVersion(tag)
  if (!parsed) return { status: 'unavailable', reason: 'malformed' }
  const version = parsed.join('.')

  if (!isNewerVersion(version, currentVersion)) return { status: 'up-to-date', version }
  return {
    status: 'update-available',
    version,
    notes: cleanNotes((body as Record<string, unknown>)['body']),
  }
}
