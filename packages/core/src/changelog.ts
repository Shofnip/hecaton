/**
 * Reading "what changed" out of the changelog that ships beside the app.
 *
 * The update check shows a changelog **before** updating, to help the user
 * decide. This is the other half, decided 2026-08-09: showing it once **after**
 * the new version starts, which closes the loop.
 *
 * It reads a file in the package rather than asking the network, and that is the
 * whole design constraint rather than a preference. The notes for the version
 * already running would have to come from a request at launch, and
 * [ADR-0014](../../docs/adr/0014-the-apps-first-network-request.md) is exactly
 * the decision that the app makes no request the user did not ask for. A file in
 * the zip costs one request less than zero.
 *
 * Parsing is deliberately small: headings and the lines under them. A markdown
 * library would be a dependency in the main process to read a file this project
 * writes itself.
 */

/** `## 0.2.0` or `## v0.2.0`, and nothing else counts as a version heading. */
const HEADING = /^##\s+v?(\d+\.\d+\.\d+)\s*$/

/**
 * The body under the heading for `version`, or nothing.
 *
 * Nothing is a normal answer, and it is what keeps the file optional: a release
 * whose notes nobody wrote says nothing at all rather than showing another
 * version's. The match is on the whole version, so `0.1.0` never matches
 * `0.10.0` or `0.1.0-beta`.
 */
export function changelogSection(markdown: string, version: string): string | undefined {
  const lines = markdown.split(/\r?\n/)
  const start = lines.findIndex((line) => HEADING.exec(line)?.[1] === version)
  if (start === -1) return undefined

  const body: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (HEADING.test(line)) break
    body.push(line)
  }

  const text = body.join('\n').trim()
  return text === '' ? undefined : text
}

/**
 * Whether the notes for the running version are still owed.
 *
 * Absent reads as **unseen**, the same choice `termsAcknowledged` makes and for
 * the same reason: nobody running today carries this field, so reading its
 * absence as "already seen" would skip the notes for exactly the release that
 * introduces them. The cost is one dismissal on a fresh install, by someone who
 * has no previous version to compare against.
 */
export function needsReleaseNotes(shownFor: string | undefined, version: string): boolean {
  return shownFor !== version
}
