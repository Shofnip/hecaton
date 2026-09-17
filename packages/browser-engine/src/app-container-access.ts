/**
 * Reads and writes the one ACE Chromium's own sandbox needs on the browser tree.
 *
 * Why it exists at all is `browser-access.ts` in the core: Chromium runs its
 * network service in an AppContainer, an AppContainer can only open files whose
 * ACL admits `ALL APPLICATION PACKAGES`, and without that the service never
 * starts and no page ever loads. This file is only the hands.
 *
 * Two shell-outs rather than one, and by SID rather than by name in both. The
 * read goes through PowerShell because `Get-Acl` can hand back identities in SID
 * form, which `icacls` output cannot be parsed for reliably: it prints the
 * *localized* account name — on the machine this was written, "TODOS OS PACOTES
 * DE APLICATIVOS" — so matching text would work here and fail on the next
 * person's Windows. The write goes through `icacls` with the `*S-1-15-2-1` form,
 * which takes a SID directly and needs no translation of its own.
 *
 * **`GetAccessRules(…, [SecurityIdentifier])`, never `.Access` plus `Translate`.**
 * The obvious version of the read walks `$acl.Access` and translates each
 * `IdentityReference` to a SID, and it fails on the one ACE this whole file is
 * about: measured 2026-09-17, `Translate` on the AppContainer group throws
 * "could not translate some or all identity references", so a version that
 * skipped un-translatable entries reported a granted tree as missing and the
 * grant ran on every launch. Asking for the rules in SID form does no
 * translation at all.
 *
 * Neither call goes through a shell: `execFile` with an argument array, so a
 * path with a space, an ampersand or a quote in it is an argument and never
 * syntax. The PowerShell script is the exception that proves it — the path has
 * to be inside the script text, so it is embedded as a single-quoted literal
 * with its apostrophes doubled, the same rule `browser-process-query.ts` states.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AppContainerReadState, BrowserAccess } from '@hecaton/core'

const execFileAsync = promisify(execFile)

/**
 * `ALL APPLICATION PACKAGES`, the group every AppContainer process belongs to.
 *
 * A well-known SID, identical on every Windows and in every language, which is
 * the whole reason this file speaks SIDs. `S-1-15-2-2` — the *restricted*
 * packages group — is deliberately not granted: Chrome's installer sets both,
 * and the network service's AppContainer is not a restricted one, so the second
 * ACE would widen the ACL without being needed. Measured: the grant below is
 * enough for the network service to start.
 */
const ALL_APPLICATION_PACKAGES = 'S-1-15-2-1'

/** How long either call gets. Both are local and finish in well under a second. */
const TIMEOUT_MS = 30_000

/**
 * Whether the ACL carries an Allow ACE for that SID with read-and-execute.
 *
 * `-band` on the rights rather than equality: the ACE the grant writes is
 * `ReadAndExecute, Synchronize`, and an ACL that already carried something wider
 * would still be perfectly readable. What is being asked is "can an AppContainer
 * read this", not "does this ACL look exactly like ours".
 */
const READ_STATE_SCRIPT = (path: string): string => `
$ErrorActionPreference = 'Stop'
$acl = Get-Acl -LiteralPath '${path.replace(/'/g, "''")}'
$rules = $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
$wanted = [System.Security.AccessControl.FileSystemRights]::ReadAndExecute
$granted = $false
foreach ($ace in $rules) {
  if ($ace.AccessControlType -ne 'Allow') { continue }
  if ($ace.IdentityReference.Value -eq '${ALL_APPLICATION_PACKAGES}' -and ($ace.FileSystemRights -band $wanted) -eq $wanted) {
    $granted = $true
  }
}
[Console]::Out.WriteLine($(if ($granted) { 'granted' } else { 'missing' }))
`

export class IcaclsBrowserAccess implements BrowserAccess {
  /**
   * @param powershell a parameter only so a test can point it at something that
   *   fails. Production never passes one.
   */
  constructor(private readonly powershell: string = 'powershell') {}

  /**
   * Throws when the ACL cannot be read at all — a missing directory, a refused
   * `Get-Acl`, PowerShell not starting. Answering `missing` there would be an
   * adapter inventing evidence; the core turns a throw into `unknown` and grants
   * anyway, which is its rule to make.
   */
  async readState(path: string): Promise<AppContainerReadState> {
    const { stdout } = await execFileAsync(
      this.powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(READ_STATE_SCRIPT(path), 'utf16le').toString('base64'),
      ],
      { windowsHide: true, timeout: TIMEOUT_MS },
    )
    const answer = stdout.trim()
    if (answer === 'granted' || answer === 'missing') return answer
    throw new Error(`could not read the ACL: ${answer || 'no answer'}`)
  }

  /**
   * `(OI)(CI)` makes the ACE inheritable by files and directories created later;
   * `/T` reaches the ones already there, which is the half that matters — the
   * browser tree is unpacked before this ever runs, so without it `chrome.exe`
   * keeps the ACL it was created with and the sandbox still cannot read it.
   *
   * `/C` continues past a file it cannot change instead of stopping at it, and
   * `/Q` keeps the per-file success lines out of the pipe. A tree that is
   * partly refused therefore reports success here and is caught by the next
   * read rather than by an exit code, which is the right way round: the
   * question is whether the browser can start, not whether every file changed.
   */
  async grantRead(path: string): Promise<void> {
    await execFileAsync(
      'icacls',
      [path, '/grant', `*${ALL_APPLICATION_PACKAGES}:(OI)(CI)(RX)`, '/T', '/C', '/Q'],
      { windowsHide: true, timeout: TIMEOUT_MS },
    )
  }
}
