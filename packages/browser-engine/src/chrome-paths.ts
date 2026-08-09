/**
 * Where Chrome installs itself on Windows, in the order worth trying.
 *
 * Pure, and separate from the launcher, so the list is a decision the fast suite
 * holds rather than something only a machine with Chrome on it can check. The
 * `existsSync` that picks one of these lives in the adapter, where the I/O
 * belongs.
 */
const MACHINE_WIDE = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
]

/**
 * The candidates, machine-wide first.
 *
 * The per-user path is the one that was missing, and its absence is what stopped
 * this being something to hand to another person: Chrome's installer falls back
 * to `%LOCALAPPDATA%` for anyone who cannot elevate, so a user in that (common)
 * position met "Chrome executable not found" with no way to point at their own
 * copy.
 *
 * **Machine-wide keeps priority**, which is the part that had to be chosen rather
 * than fallen into. Anyone the app already works for must not find it launching a
 * different browser after an update, and where both exist the administrator's
 * install is the one somebody managed deliberately.
 *
 * A missing or empty `LOCALAPPDATA` drops the candidate instead of appending to
 * nothing: that would yield a drive-relative path, which would send an
 * `existsSync` — and then a spawn — at a directory nobody chose.
 *
 * The separator is a literal backslash rather than `node:path.join`, which is
 * the platform's joiner and not Windows's. Every path here is a Windows install
 * location whatever machine the code runs on, and CI type-checks and tests on
 * Linux — where `join` produced forward slashes and turned this into a function
 * whose output depended on where it was called.
 */
export function chromeSearchPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const localAppData = env['LOCALAPPDATA']?.replace(/[\\/]+$/, '')
  if (!localAppData) return [...MACHINE_WIDE]
  return [...MACHINE_WIDE, `${localAppData}\\Google\\Chrome\\Application\\chrome.exe`]
}
