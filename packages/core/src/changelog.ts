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
 * the package costs one request less than zero.
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

/** A line that starts a block of its own: a bullet, a number, or a heading. */
const BLOCK_START = /^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s)/

/**
 * Turns note text into what the panel should actually put on screen.
 *
 * Found by looking at the running app rather than at the code, which is where
 * this project keeps finding its layout defects. The notes are written as
 * Markdown and hard-wrapped at ~95 columns by the formatter; the panel renders
 * them in a ~440px box with `white-space: pre-wrap`, which **keeps those
 * newlines**. So every line soft-wrapped at the box width and then broke again
 * at the source's own newline, with the continuation indented two spaces — one
 * sentence arriving as three ragged lines.
 *
 * Two jobs, both of which exist because the panel renders **text, not markup**:
 *
 * 1. **Unwrap.** A line that does not start a block is a continuation of the one
 *    before it and is joined with a space. Blank lines stay, because they are the
 *    paragraph breaks the author meant; bullets and headings stay on their own
 *    lines, because they are structure rather than wrapping.
 * 2. **Drop emphasis markers.** `**bold**` arrives as literal asterisks
 *    otherwise. The renderer sets `textContent` — which is what makes a
 *    `<script>` in a GitHub release note five words of plain text, and is not up
 *    for negotiation — so the markers have to go here instead.
 *
 * It runs on both note sources: this project's own `CHANGELOG.md`, and the
 * release body fetched from GitHub, which is Markdown too.
 */
export function displayNotes(text: string): string {
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const previous = out[out.length - 1]
    const continues =
      line !== '' && !BLOCK_START.test(line) && previous !== undefined && previous.trim() !== ''
    if (continues) out[out.length - 1] = `${previous} ${line}`
    else out.push(line)
  }

  return out
    .map(stripEmphasis)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Removes the markers, keeps the words.
 *
 * Each pattern requires a non-space character next to the marker, so a bullet
 * (`* item`) and arithmetic (`2 * 3`) survive: what is stripped is a marker that
 * actually wraps something.
 */
function stripEmphasis(line: string): string {
  return line
    .replace(/\*\*(\S(?:.*?\S)?)\*\*/g, '$1')
    .replace(/(?<!\*)\*(\S(?:.*?\S)?)\*(?!\*)/g, '$1')
    .replace(/(?<![\w_])_(\S(?:.*?\S)?)_(?![\w_])/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
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
