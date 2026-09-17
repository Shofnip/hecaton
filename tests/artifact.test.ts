/**
 * Holds the four places that describe the artifact to each other.
 *
 * ADR-0020 made the release a zip the user extracts, reversing the assisted NSIS
 * installer of ADR-0019 and restoring what ADR-0013 chose. Four files have to
 * agree about that without any of them being able to see the others:
 *
 *   - `apps/shell/electron-builder.yml` decides what is built;
 *   - `.github/workflows/release.yml` hashes, uploads and publishes it;
 *   - `README.md` tells the user what to do with what they downloaded;
 *   - `docs/releasing.md` describes what the tag produces.
 *
 * The zip lived through one release, `v0.1.0`, with all four agreeing by hand.
 * Nothing would have caught it when they disagreed, because a document describing
 * the wrong artifact still renders and a workflow globbing the wrong extension
 * fails only on the tag, after `npm run check` has already gone green. That is
 * what this file is for, and it is worth more now than it was then: the format has
 * changed twice in a month.
 *
 * Deliberately string-matching against the real files rather than parsing them,
 * for the reason `bundled-browser.test.ts` gives: the yml and the workflow have
 * no exports, and a test that parsed them properly would be a second
 * implementation to keep correct.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
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

const builderConfig = read('apps/shell/electron-builder.yml')
const releaseWorkflow = read('.github/workflows/release.yml')
const readme = read('README.md')
const releasing = read('docs/releasing.md')

describe('the artifact is a zip the user extracts', () => {
  it('builds one target, and it is zip', () => {
    expect(builderConfig).toMatch(/^ {2}target: zip$/m)
  })

  it('builds exactly one target', () => {
    // Not style. Every target packages the same `win-unpacked`, so a list is how
    // one target's by-products end up inside another target's artifact - probe P8
    // measured the NSIS family dropping `resources\elevate.exe` in there, which a
    // `[zip, nsis]` list would then have zipped up. One value, one payload.
    expect(builderConfig.match(/^ {2}target: /gm)).toHaveLength(1)
    expect(builderConfig).not.toMatch(/^ {2}target:\s*$/m)
    expect(builderConfig).not.toMatch(/^ {2}target: \[/m)
  })

  it('carries no installer configuration at all', () => {
    // The whole `nsis:` block went with ADR-0020, and a leftover key is not
    // inert: electron-builder reads `nsis:` whenever an NSIS-family target is
    // built, so a half-removed block is a decision that comes back the moment
    // somebody adds a target to the list above.
    expect(builderConfig).not.toMatch(/^nsis:$/m)
    expect(builderConfig).not.toMatch(/^ {2}oneClick:/m)
    expect(builderConfig).not.toMatch(/^ {2}include: build-resources/m)
  })

  it('ships no custom NSIS script', () => {
    // electron-builder picks `build-resources/installer.nsh` up **by convention**,
    // with or without an `include:` line. So the file's absence is the assertion,
    // not the missing key above: leaving it on disk would arm a macro that only
    // runs under a target this project no longer builds.
    expect(existsSync(join(ROOT, 'apps/shell/build-resources/installer.nsh'))).toBe(false)
  })

  it('never lets electron-builder delete the user data', () => {
    // The single most dangerous line that could appear in this file. It belonged
    // to the uninstaller, and with ADR-0020 there is no uninstaller - which is the
    // reason to keep asserting rather than to stop: the way this comes back is
    // somebody restoring an installer and carrying the convenient default with it.
    // Probe P1 measured that an update runs the *previous* release's uninstaller
    // in silent mode, so such a branch is frozen into every copy already handed
    // out and can never be repaired for whoever installed.
    expect(builderConfig).not.toMatch(/deleteAppDataOnUninstall:\s*true/)
  })
})

describe('the release workflow publishes what the config builds', () => {
  it('hashes and uploads the zip, not an installer', () => {
    expect(releaseWorkflow).not.toContain('*-win-*.exe')
    expect(releaseWorkflow).toContain('release/*-win-*.zip')
  })

  it('the glob can only match what artifactName produces', () => {
    // The one assertion this file exists for. `release/*-win-*.zip` matches
    // nothing unless the artifact is named the way the config names it, and
    // electron-builder's own conventional default (`\${productName}-\${version}
    // -\${arch}.\${ext}`) does not match it. Change one without the other and
    // `npm run check` stays green while the tag fails at the SHA step, which is
    // exactly the failure this file was written to prevent.
    expect(builderConfig).toMatch(/^artifactName: .+-win-\$\{arch\}\.\$\{ext\}$/m)
    // At column 0 and nowhere else: a nested `win.artifactName` overrides the
    // top-level one, and the assertion above would not see it.
    expect(builderConfig).not.toMatch(/^\s+artifactName:/m)
  })

  it('refuses to publish unless exactly one zip is there', () => {
    // Under the installer the second match was a real file, not a worry: the
    // uninstaller stub electron-builder writes beside it. With the zip target
    // nothing else writes to this glob, and the guard stays anyway - a release
    // must not silently pick one of several files, and `release/` is only
    // guaranteed empty on a clean checkout.
    //
    // Scoped to the step rather than the file: the property is that the check
    // runs where the path is resolved, and before it is handed on.
    const sha = section(releaseWorkflow, 'Compute the SHA256')
    expect(sha).toContain('$found.Count -ne 1')
    expect(sha.indexOf('$found.Count -ne 1')).toBeLessThan(sha.indexOf('GITHUB_ENV'))
  })

  it('resolves the zip once and reuses it, rather than globbing again', () => {
    // The guard above only protects the step it runs in. Publishing re-derived
    // the path with its own glob until 2026-08-21; now the checked path travels
    // through GITHUB_ENV, so there is one place where "which file is the
    // release" is decided.
    //
    // The absence is half the assertion. Checking only that the fix is present
    // leaves re-adding `Get-ChildItem … | Select-Object -First 1` to the publish
    // step green, and that is the regression itself.
    const publish = section(releaseWorkflow, 'Publish the release')
    expect(publish).toContain('$env:HECATON_ZIP')
    expect(publish).not.toContain('Get-ChildItem')
  })

  it('still publishes the SHA256 beside it, under the name it wrote', () => {
    // Nothing is signed, so this is the only thing that separates an authentic
    // build from a lookalike anyone could compile from the public source. Both
    // spellings are asserted because they are different expressions of the same
    // file: the workflow writes `$($zip.FullName).sha256` and publishes
    // `$env:HECATON_ZIP.sha256`, and only the upload path spells it out in full.
    expect(releaseWorkflow).toContain('.zip.sha256')
    expect(releaseWorkflow).toContain('.FullName).sha256')
    expect(releaseWorkflow).toContain('$env:HECATON_ZIP.sha256')
  })

  it('publishes the licence, the notice and the changelog loose beside the artifact', () => {
    // They travel inside the zip as well, and land in the extracted folder. Loose
    // on the release page is the copy somebody can read *before* running an
    // unsigned executable, which is when it is worth reading - and with a zip
    // there is no licence page anywhere else.
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

  it('generates no blockmap, which would advertise an update channel', () => {
    // ADR-0014 rejected electron-updater; `publish: null` is the decision, and a
    // blockmap is the other file that would claim a channel that does not exist.
    // The zip target writes none, so this is an absence rather than a setting -
    // asserted because `differentialPackage` is the kind of option that arrives
    // with a target change.
    expect(releaseWorkflow).not.toContain('.blockmap')
    expect(builderConfig).not.toMatch(/differentialPackage:\s*true/)
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
  it('the README tells the user to extract the zip and run the exe', () => {
    // The Install section is the first thing a friend reads, and it is written
    // for somebody who does not program: download, extract, double-click. It said
    // "run the installer" for one month and no test caught it changing back.
    const install = readme.slice(readme.indexOf('## Install'))
    const section = install.slice(0, install.indexOf('\n## ', 1))
    expect(section).toMatch(/\.zip/)
    expect(section).toMatch(/Hecaton\.exe/)
    expect(section).toMatch(/extract/i)
    // Link *targets* are stripped before the last two assertions: ADR-0020's
    // filename is `…-not-an-installer.md`, so a naive search for the word finds
    // the citation that says the installer is gone.
    const prose = section.replace(/\]\([^)]*\)/g, ']')
    expect(prose).not.toMatch(/installer/i)
    expect(prose).not.toMatch(/Apps & features/i)
  })

  it('docs/releasing.md says the tag produces a zip', () => {
    expect(releasing).toMatch(/packages the zip/)
    expect(releasing).not.toMatch(/assisted installer/)
  })
})
