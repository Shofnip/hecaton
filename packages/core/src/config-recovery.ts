/**
 * What to do with a `config.json` the app cannot read at all.
 *
 * The rule, decided 2026-08-09: **set it aside, never overwrite it, never delete
 * it**, start from defaults, and say so. A friend whose config was truncated by
 * a kill during a save was otherwise simply stuck — the app named the file and
 * refused to start its slots, which is good diagnostics and no way out.
 *
 * It applies to a file that is not JSON **at all**, and deliberately not to one
 * that is valid JSON with something wrong in it. A rejected setting means the
 * user hand-edited a line and got it slightly wrong; setting their file aside
 * over a typo would throw away the intent along with the mistake. That case
 * keeps the older behaviour — the error is shown, the file is left exactly as
 * they wrote it, and one line has to be fixed.
 *
 * Only the *name* is decided here. The rename is I/O and belongs to the adapter,
 * which resolves this beside the original file.
 */

/** Characters Windows refuses in a file name, plus the separators. */
const ILLEGAL = /[:*?"<>|]/g

export function quarantineFileName(fileName: string, isoTimestamp: string): string {
  if (fileName === '' || /[/\\]/.test(fileName)) {
    throw new Error(
      `"${fileName}" is a path, not a file name: this returns a name to place beside the original`,
    )
  }

  // A colon is legal in an ISO timestamp and not in a Windows file name, where
  // it names an alternate data stream instead. The whole point of setting a file
  // aside is that it still exists afterwards, so the stamp is flattened.
  const stamp = isoTimestamp.replace(ILLEGAL, '-').replace(/\./g, '-')

  const dot = fileName.lastIndexOf('.')
  if (dot <= 0) return `${fileName}.bad-${stamp}`
  return `${fileName.slice(0, dot)}.bad-${stamp}${fileName.slice(dot)}`
}
