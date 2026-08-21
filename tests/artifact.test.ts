/**
 * Holds the four places that describe the artifact to each other.
 *
 * ADR-0019 made the release an assisted NSIS installer, reversing the zip of
 * ADR-0013. Four files have to agree about that without any of them being able
 * to see the others:
 *
 *   - `apps/shell/electron-builder.yml` decides what is built;
 *   - `.github/workflows/release.yml` hashes, uploads and publishes it;
 *   - `README.md` tells the user what to do with what they downloaded;
 *   - `docs/releasing.md` describes what the tag produces.
 *
 * The zip lived through one release, `v0.1.0`, with all four agreeing by hand.
 * Nothing would have caught it when they disagreed, because a document describing
 * the wrong artifact still renders and a workflow globbing the wrong extension
 * fails only on the tag, after `npm run check` has already gone green.
 *
 * Deliberately string-matching against the real files rather than parsing them,
 * for the reason `bundled-browser.test.ts` gives: the yml and the workflow have
 * no exports, and a test that parsed them properly would be a second
 * implementation to keep correct.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8')

/**
 * One `- name:`-delimited step of a workflow, so an assertion can say *where* a
 * string has to appear rather than only that it appears somewhere.
 */
function section(workflow: string, stepName: string): string {
  const start = workflow.indexOf(`- name: ${stepName}`)
  expect(start, `no step named ${stepName}`).toBeGreaterThan(-1)
  // A step ends at the next list item *or* at the comment block introducing it,
  // whichever comes first. Without the comment, a section swallows the prose
  // above the following step, and an assertion about what a step contains goes
  // vacuous the day somebody names a file in that prose.
  const ends = [workflow.indexOf('\n      - ', start + 1), workflow.indexOf('\n      #', start + 1)]
  const next = Math.min(...ends.filter((at) => at !== -1))
  return Number.isFinite(next) ? workflow.slice(start, next) : workflow.slice(start)
}

/**
 * The custom NSIS script with its `;` comments removed.
 *
 * The assertions about it are all of the form "this construct is/is not there",
 * and the file's comments name both constructs in order to explain them — so
 * matching the raw text would forbid the explanation, which is the mistake
 * `bundled-browser.test.ts` names when it refuses to ban the words "Program
 * Files" from a comment that says what the code used to do.
 */
function installerScript(): string {
  return read('apps/shell/build-resources/installer.nsh')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith(';'))
    .join('\n')
}

const builderConfig = read('apps/shell/electron-builder.yml')
const releaseWorkflow = read('.github/workflows/release.yml')
const readme = read('README.md')
const releasing = read('docs/releasing.md')

describe('the artifact is an assisted, per-user NSIS installer', () => {
  it('builds one target, and it is nsis', () => {
    expect(builderConfig).toMatch(/^ {2}target: nsis$/m)
  })

  it('builds exactly one target', () => {
    // Not style. Probe P8 measured that the NSIS-family targets drop
    // `resources\elevate.exe` into `win-unpacked`, which every target then
    // packages - so a `[zip, nsis]` list would put an elevation helper inside
    // the zip as a side effect of building both. One value, one payload.
    expect(builderConfig.match(/^ {2}target: /gm)).toHaveLength(1)
    expect(builderConfig).not.toMatch(/^ {2}target:\s*$/m)
    expect(builderConfig).not.toMatch(/^ {2}target: \[/m)
  })

  it('is assisted rather than one-click, which is what gives it a licence page', () => {
    // Apache-2.0 §4 obliges the distributor to hand over the License. A
    // one-click installer has no page to show it on - that is the whole reason
    // this one is assisted, and ADR-0013 recorded it when the installer was
    // first built and then dropped.
    expect(builderConfig).toMatch(/^ {2}oneClick: false$/m)
    expect(builderConfig).toMatch(/^ {2}license: \.\.\/\.\.\/LICENSE$/m)
  })

  it('installs per user and asks for no elevation', () => {
    // per-machine *and unsigned* is the worst pairing Windows offers: the
    // yellow "Unknown publisher" dialog on every install and every update, to
    // protect a binary a handful of people will install. ADR-0013 reversed it
    // within the session it was proposed; the reversal survives here.
    expect(builderConfig).toMatch(/^ {2}perMachine: false$/m)
    expect(builderConfig).toMatch(/^ {2}allowElevation: false$/m)
  })

  it('never lets electron-builder delete the user data on uninstall', () => {
    // The single most dangerous line that could appear in this file. Probe P1
    // measured that an update runs the *previous* release's uninstaller in
    // silent mode, so a delete branch is frozen into every uninstaller already
    // handed out and can never be repaired for whoever installed. Setting this
    // false is not the whole story and ADR-0019 says so: the generated
    // uninstaller still honours `--delete-app-data` typed by hand. What this
    // assertion protects is the branch that would fire without anyone typing
    // anything.
    expect(builderConfig).not.toMatch(/deleteAppDataOnUninstall:\s*true/)
  })
})

describe('the release workflow publishes what the config builds', () => {
  it('hashes and uploads the installer, not a zip', () => {
    expect(releaseWorkflow).not.toContain('*-win-*.zip')
    expect(releaseWorkflow).toContain('release/*-win-*.exe')
  })

  it('the glob can only match what artifactName produces', () => {
    // The one assertion this file exists for. `release/*-win-*.exe` matches
    // nothing unless the artifact is named the way the config names it, and
    // electron-builder's own conventional default (`\${productName} Setup
    // \${version}.\${ext}`) does not match it. Change one without the other and
    // `npm run check` stays green while the tag fails at the SHA step, which is
    // exactly the failure this file was written to prevent.
    expect(builderConfig).toMatch(/^artifactName: .+-win-\$\{arch\}\.\$\{ext\}$/m)
    // At column 0 and nowhere else: a nested `win.artifactName` or
    // `nsis.artifactName` overrides the top-level one, and the assertion above
    // would not see it.
    expect(builderConfig).not.toMatch(/^\s+artifactName:/m)
  })

  it('refuses to publish unless exactly one installer is there', () => {
    // Not decoration. electron-builder writes the uninstaller stub beside the
    // installer as `<name>.__uninstaller.exe`, which matches the glob. It is
    // unlinked again on the success path, so today the count is one — by the
    // lifetime of a temp file inside a dependency, which is not a guarantee to
    // rest a release on.
    //
    // The count, never the order. An earlier version of this comment said the
    // stub sorts first, from code points; measured on NTFS, `Get-ChildItem`
    // returns the real installer first in both creation orders. So
    // `Select-Object -First 1` was not picking the stub — it was resting on an
    // ordering nobody had measured, which is the defect either way. The workflow
    // comment carries the numbers.
    // Scoped to the step rather than the file: the property is that the check
    // runs where the path is resolved, and before it is handed on.
    const sha = section(releaseWorkflow, 'Compute the SHA256')
    expect(sha).toContain('$found.Count -ne 1')
    expect(sha.indexOf('$found.Count -ne 1')).toBeLessThan(sha.indexOf('GITHUB_ENV'))
  })

  it('resolves the installer once and reuses it, rather than globbing again', () => {
    // The guard above only protects the step it runs in. Publishing re-derived
    // the path with its own glob until 2026-08-21; now the checked path travels
    // through GITHUB_ENV, so there is one place where "which file is the
    // release" is decided.
    //
    // The absence is half the assertion. Checking only that the fix is present
    // leaves re-adding `Get-ChildItem … | Select-Object -First 1` to the publish
    // step green, and that is the regression itself.
    const publish = section(releaseWorkflow, 'Publish the release')
    expect(publish).toContain('$env:HECATON_INSTALLER')
    expect(publish).not.toContain('Get-ChildItem')
  })

  it('still publishes the SHA256 beside it, under the name it wrote', () => {
    // Nothing is signed, so this is the only thing that separates an authentic
    // build from a lookalike anyone could compile from the public source. Both
    // spellings are asserted because they are different expressions of the same
    // file: the workflow writes `$($installer.FullName).sha256` and publishes
    // `$env:HECATON_INSTALLER.sha256`, and only the upload path spells it out in
    // full.
    expect(releaseWorkflow).toContain('.exe.sha256')
    expect(releaseWorkflow).toContain('.FullName).sha256')
    expect(releaseWorkflow).toContain('$env:HECATON_INSTALLER.sha256')
  })

  it('publishes the licence, the notice and the changelog loose beside the artifact', () => {
    // They travel inside the installer as well, and land in the install
    // directory. Loose on the release page is the copy somebody can read
    // *before* running an unsigned executable, which is when it is worth
    // reading.
    //
    // Collected *and* published, checked separately. Each name appears in the
    // workflow three times, so a `toContain` over the whole file stays green
    // while `gh release create` quietly stops carrying one - which is the only
    // distinction this test's own reasoning cares about.
    const collect = section(releaseWorkflow, 'Collect the licence')
    const publish = section(releaseWorkflow, 'Publish the release')
    for (const file of ['LICENSE.txt', 'NOTICE.txt', 'CHANGELOG.txt']) {
      expect(collect).toContain(file)
      expect(publish).toContain(file)
    }
  })

  it('collects them from the names electron-builder actually writes', () => {
    // The collect step reads `release/win-unpacked/<name>`, which is only true
    // because of these three `to:` targets. They are the step's precondition and
    // nothing else holds them to it.
    const extraFiles = builderConfig.indexOf('extraFiles:')
    expect(extraFiles).toBeGreaterThan(-1)
    for (const file of ['LICENSE.txt', 'NOTICE.txt', 'CHANGELOG.txt']) {
      expect(builderConfig).toMatch(new RegExp(`^\\s+to: ${file.replace('.', '\\.')}$`, 'm'))
      // Under `extraFiles`, which is what puts them in the app root. Moving them
      // to `extraResources` — which sits right above, with its own `to:` — reads
      // like tidying and would land them in `resources/`, where the collect step
      // does not look.
      expect(builderConfig.indexOf(`to: ${file}`)).toBeGreaterThan(extraFiles)
    }
  })

  it('deletes the copy of itself that the installer would otherwise leave behind', () => {
    // electron-builder copies the running installer to
    // %LOCALAPPDATA%\<pkg>-updater\installer.exe (installer.nsh:93) for
    // electron-updater's reinstall flow, which ADR-0014 rejected. Nothing in
    // uninstaller.nsh removes it, so without this it is ~200 MB per install that
    // outlives the app — and it lands on the profile's drive even when the user
    // moved the install directory off it, which makes the README's "put it
    // somewhere else if C: is tight" only half true.
    expect(builderConfig).toMatch(/^ {2}include: build-resources\/installer\.nsh$/m)
    const script = installerScript()
    expect(script).toContain('!macro customInstall')
    // Derived from the define, never spelled out. The directory name comes from
    // the *workspace package* name (`@hecaton/shell` → `@hecatonshell-updater`),
    // not from the product name — probe P1 predicted `hecaton-updater` and was
    // wrong, which is the whole argument against writing it by hand.
    expect(script).toContain('!ifdef APP_INSTALLER_STORE_FILE')
    // `-updater`, not just `@hecatonshell`: the mistake this guards against is
    // hardcoding *a* directory name, and P1 hardcoded the wrong one. Banning only
    // the right spelling would let the wrong one through.
    expect(script).not.toMatch(/-updater/)
  })

  it('resolves $LOCALAPPDATA in the same shell-var context that wrote the file', () => {
    // The one way this cleanup can fail with no symptom at all. $LOCALAPPDATA is
    // context-sensitive in NSIS — under `SetShellVarContext all` it is
    // C:\ProgramData, not the user's directory — which is why electron-builder
    // brackets its own copy (`include/installer.nsh:89-96`, "electron always uses
    // per user app data"). Unbracketed, a per-all-users install writes to the
    // user's directory and this looks in the machine's: Delete no-ops, RMDir
    // no-ops, the 200 MB stays, and nothing anywhere says so.
    //
    // `perMachine: false` does not make that unreachable: `!oneClick` compiles
    // `setInstallModePerAllUsers` in, and `/allusers` on the command line, an
    // HKLM InstallLocation, or a silent upgrade of a per-machine install all
    // reach it.
    const script = installerScript()
    expect(script).toContain('SetShellVarContext current')
    expect(script).toContain('SetShellVarContext all')
  })

  it('leaves the stack and the error flag as it found them', () => {
    // It runs between `installApplicationFiles` and `StartApp`, so it borrows
    // registers and must give them back. Counting the pairs pins the part a
    // future edit is most likely to break silently.
    const script = installerScript()
    const pushes = script.match(/Push \$R/g) ?? []
    const pops = script.match(/Pop \$R/g) ?? []
    expect(pushes.length).toBe(pops.length)
    expect(pushes.length).toBeGreaterThan(0)
    // Delete and RMDir both set the error flag on failure, and failing is an
    // expected outcome here rather than a problem — see the comments in the file.
    expect(script).toContain('ClearErrors')
  })

  it('the delete it does is not recursive', () => {
    // `RMDir /r` inside an installer running on someone else's machine is the
    // one construct this repository will not carry. `Delete` on the one file and
    // a bare `RMDir` on its parent — which removes nothing unless the directory
    // is already empty — is the whole operation.
    const script = installerScript()
    expect(script).not.toMatch(/RMDir\s+\/r/)
    expect(script).toContain('Delete ')
  })

  it('generates no blockmap, which would advertise an update channel', () => {
    // ADR-0014 rejected electron-updater; `publish: null` is the same decision
    // applied to the other file that would claim one. It is also what took the
    // installer from 226.4 MiB to 200.1 MiB - measured, probe P8.
    expect(builderConfig).toMatch(/^ {2}differentialPackage: false$/m)
  })

  it('still fetches and verifies the bundled Chromium before packaging', () => {
    // ADR-0016. The order is the property: a hash mismatch has to fail the job
    // with nothing unpacked, so a bad download cannot become a release.
    const fetchAt = releaseWorkflow.indexOf('node scripts/fetch-chromium.mjs')
    // `run: npm run package`, not the bare command: the bare form also appears
    // in a prose comment further down, so deleting the step entirely left this
    // assertion green - measured. The `run:` prefix appears only in the step.
    const packageAt = releaseWorkflow.indexOf('run: npm run package')
    expect(fetchAt).toBeGreaterThan(-1)
    expect(packageAt).toBeGreaterThan(fetchAt)
  })
})

describe('the documents describe the artifact that is actually built', () => {
  it('the README does not tell the user to extract a zip', () => {
    // The Install section is the first thing a friend reads, and it was written
    // for a zip. `.zip` may still appear elsewhere - the point is that the
    // instruction is gone.
    const install = readme.slice(readme.indexOf('## Install'))
    const section = install.slice(0, install.indexOf('\n## ', 1))
    expect(section).not.toMatch(/extract it anywhere/)
    expect(section).toContain('.exe')
  })

  it('docs/releasing.md says the tag produces an installer', () => {
    expect(releasing).not.toMatch(/packages the zip/)
    expect(releasing).toMatch(/installer/)
  })
})
