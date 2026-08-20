/**
 * The WMI query that finds running browser processes.
 *
 * Pure, and in its own file, because it is a shell string built from a path the
 * process resolved at startup — the one part of the launcher worth holding in
 * the fast suite rather than only in a Windows-only integration run.
 *
 * The name is a parameter rather than the literal `'chrome.exe'` it used to be.
 * That matters now the app ships its own browser: the executable is whatever
 * `bundledBrowserPath` resolved, and a filter that disagrees with it produces no
 * rows at all — which the launcher reports as "the browser did not start within
 * 20000ms", a message pointing nowhere near the cause. Today both names are
 * `chrome.exe` (measured on the snapshot in probe P5), so this changes no
 * behaviour; it removes the way the two could drift apart in silence.
 *
 * The real discriminator between one slot and another is still
 * `--user-data-dir=<profile>` without `--type=`, in the launcher. This narrows
 * the rows; it does not identify a slot.
 */

/**
 * @param executableName a file name such as `chrome.exe` — `Win32_Process.Name`
 *   is a file name, and a whole path would match nothing at all, silently.
 */
export function browserProcessQuery(executableName: string): string {
  if (!executableName || /[\\/]/.test(executableName)) {
    throw new Error(
      `process filter needs an executable name, not ${JSON.stringify(executableName)}`,
    )
  }
  // A path can hold an apostrophe. Doubling it is how PowerShell escapes one
  // inside a single-quoted literal; leaving it raw would close the string and
  // hand the remainder to the parser as code.
  const quoted = executableName.replace(/'/g, "''")
  // No double quote anywhere: PowerShell eats those out of a -Command string,
  // which docs/troubleshooting.md records the hard way. The @() keeps the shape
  // constant — ConvertTo-Json emits a bare object for a single row, and the
  // caller parses an array.
  return (
    `@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq '${quoted}' } ` +
    '| Select-Object ProcessId,CommandLine) | ConvertTo-Json -Compress'
  )
}
