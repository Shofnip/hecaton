# Releasing

Cutting a release is two commands. This document exists for what comes before them — four steps, of
which the first two are **checks no test performs**. They fail silently between versions, and the
release is where they belong because it is the only moment that already exists: an obligation with
no moment attached is one nobody performs.

A third check used to be on that list and is now enforced instead — see `npm audit` under _The tag_.

## Before the tag

### 1. Raise the pins, deliberately

Four things are pinned exactly, and each pin turns "receive the fix automatically" into "somebody
must bump it":

| Pin                   | Where                                  | Why it is pinned                                                       |
| --------------------- | -------------------------------------- | ---------------------------------------------------------------------- |
| `electron`            | `apps/shell/package.json`              | the embedded Chromium is a reviewed decision, not an install outcome   |
| `node-window-manager` | `packages/window-manager/package.json` | native, compiles at install, runs in main with full access to profiles |
| `electron-builder`    | `apps/shell/package.json`              | assembles the binary other people execute, and nothing is signed       |
| **the game browser**  | `scripts/fetch-chromium.mjs`           | the app ships its own Chromium, so nothing else will ever update it    |

Chromium's security fixes arrive as **Electron patch releases**, and Electron supports only its
three most recent majors — so that one has a clock attached. See
[ADR-0007](adr/0007-electron-security-posture.md) decision 1 and
[ADR-0013](adr/0013-a-portable-unsigned-zip-under-apache-2.md).

After any of the three npm bumps: `node node_modules/electron/install.js`, then
`node scripts/fetch-chromium.mjs`, then `npm run check`, then `npm run test:integration` — a raised
`node-window-manager` or Electron changes the ABI the native modules are built against, and only the
integration suite touches that. The fetch script is on that list because a reinstalled `electron`
takes the development link to the bundled browser with it, and the integration suite then fails at
`beforeAll` with `bundled browser missing at ...`, pointing at the browser rather than at the bump
that removed it.

#### The fourth pin is different, and it is the heaviest thing on this page

The browser the **games** run in is bundled ([ADR-0016](adr/0016-ship-our-own-chromium.md)). It used
to be the user's Google Chrome, updating itself weekly with nobody's attention. It does not any
more: **this release is the only thing that will ever move it.** The app's release cadence is now
the browser's patch cadence, and the browser is the largest attack surface in the product.

It is also worse than that pin sounds, and the ADR says so at length: the source is the
`chromium-browser-snapshots` bucket, which is **trunk**, not a release channel. It gets no
stable-branch security backports. Raising it often is a mitigation, not a fix.

Currently pinned, in `scripts/fetch-chromium.mjs`:

|          |                                                                    |
| -------- | ------------------------------------------------------------------ |
| Revision | `1699959`                                                          |
| Version  | `156.0.8065.0`                                                     |
| SHA256   | `e26d2f77c37e98e2d537cc550b0cd04e7e456e74340f4db1ffb20db820bb8d08` |

`tests/bundled-browser.test.ts` holds this table to the script, so the two cannot describe different
revisions.

Raising it starts by downloading the candidate **by hand**, because the pin has to be the hash of
the build you then verified — not whatever the bucket serves the day it is fetched. The script
refuses to unpack anything whose hash it does not already know, which is what makes that ordering
enforced rather than merely intended.

```powershell
# -UseBasicParsing is not optional: without it, Windows PowerShell 5.1 - the shell this
# project uses everywhere - refuses the first call with a *non-terminating* error, leaving
# $rev empty. The next two lines then build a 404 url that reads like a bucket problem.
$rev = (Invoke-WebRequest 'https://storage.googleapis.com/chromium-browser-snapshots/Win_x64/LAST_CHANGE' -UseBasicParsing).Content.Trim()
$zip = "vendor\chromium\chrome-win-$rev.zip"
New-Item -ItemType Directory -Force vendor\chromium | Out-Null
Invoke-WebRequest "https://storage.googleapis.com/chromium-browser-snapshots/Win_x64/$rev/chrome-win.zip" -OutFile $zip -UseBasicParsing
$rev; (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
```

Put that revision and hash into `REVISION` and `SHA256` in `scripts/fetch-chromium.mjs` and into the
table above. `VERSION` is the name of the `*.manifest` file inside the archive. Then remove the old
`vendor/chromium/chrome-win` — the script will not unpack over a tree it did not just create — and:

```
node scripts/fetch-chromium.mjs   # verifies the hash, unpacks, strips, relinks
npm run check
npm run test:integration
```

The download stays where it is until the hash matches, so this costs one download, not two.

**Then re-measure the three things that have each already changed under this project once.** Two of
them are checked by no test and fail quietly; the third now has one, and got it the hard way:

1. **Turnstile.** Launch a slot on the target game with a throwaway profile and log in. This is the
   gate the whole decision rests on, and a browser that cannot log in is not shippable.
2. **The seven files the fetch script removes.** A snapshot could move something load-bearing into
   one of them. Launch a slot, confirm the window embeds, and confirm audio still follows focus —
   that exercises the renderer, GPU and audio-service children together.
3. **The window geometry.** `win32-worker.ts` carries frame maths measured against a specific
   browser-drawn title bar (`APP_TITLE`). If embedded screens sit a few pixels wrong, this is why.
   **Run `npm run test:integration` and read `embedded-clip.integration.test.ts`**: it photographs a
   page with a band of known height and fails when the allowance no longer matches the browser. Its
   failure message names the number to change.

   This step used to say "check it by eye", and by eye is how it was checked when the pin went to
   `156.0.8065.0` — the note in `architecture.md` recorded screens sitting in their cards _to the
   pixel_. They were seven pixels out, on every screen, and had been since the pin moved. Nothing on
   a game page looks wrong when its top seven rows are missing, which is the whole argument for the
   test: this is not a check a person can perform.

### 2. Confirm the browser is not downloading its 4 GB model again

**Check the size, not the presence.** It creates `OptGuideOnDeviceModel` and
`OptGuideOnDeviceClassifierModel` in every profile whether or not the feature is on; what the flag
stops is the **download** that fills them. Measured 2026-08-18, with the flag working: both
directories present in all four slots, **zero files, zero bytes**, whole profiles at 238–387 MB.
Measured again for 0.3.0: same answer, zero files in both, profiles at 19–283 MB.

**Both layouts, until every installed base has opened a version with accounts.** Profiles moved
under `accounts/<id>/profiles` in 0.3.0, and a machine still on 0.2.0 keeps them at
`hecaton/profiles` until its first launch of the new version. Cutting 0.3.0 found exactly that on
the author's own machine: the `accounts/` command enumerated nothing and would have read as a pass —
the same trap this step already warned about, from the other side.

```powershell
# Per account since ADR-0021, plus the pre-accounts path an installed base still
# uses until it first opens a version with accounts. A command pointed at only one
# of the two enumerates nothing on the other and reads as a pass.
$roots = @()
$roots += Get-ChildItem "$env:APPDATA\hecaton\accounts" -Directory -ErrorAction SilentlyContinue |
  ForEach-Object { [pscustomobject]@{ Name = $_.Name; Path = Join-Path $_.FullName 'profiles' } }
$roots += [pscustomobject]@{ Name = 'pre-accounts'; Path = "$env:APPDATA\hecaton\profiles" }
foreach ($root in $roots) {
  if (-not (Test-Path $root.Path)) { continue }
  foreach ($slot in Get-ChildItem $root.Path -Directory) {
    foreach ($d in Get-ChildItem $slot.FullName -Directory -Filter 'OptGuide*' -ErrorAction SilentlyContinue) {
      $f = @(Get-ChildItem $d.FullName -Recurse -File -ErrorAction SilentlyContinue)
      '{0}/{1,-8} {2,-38} {3,4} files {4,10:N2} MB' -f $root.Name, $slot.Name, $d.Name, $f.Count, (($f | Measure-Object Length -Sum).Sum / 1MB)
    }
  }
}
```

Anything but ~0 MB means the switch has stopped working. An earlier version of this step said to
confirm the directory was absent, which fired on the first release that ran it — and a check that
cries wolf is worse than none, because the next person learns to wave it through and waves the real
regression through with it.

Every slot launches with
`--disable-features=OptimizationGuideOnDeviceModel,OptimizationGuideModelDownloading` because the
browser was otherwise downloading an on-device model **per profile**: 16.3 GB of a 17.4 GB data
directory, arriving roughly two days after a profile is created. Chromium **ignores feature names
it does not recognise**, so a rename upstream turns the switch into a no-op whose only symptom is
the disk filling again, two days at a time. There is no test for it; this check is the whole
control.

### 3. Write the changelog entry

`CHANGELOG.md`, a `## <version>` section, in Portuguese and for whoever uses the app rather than
whoever wrote it. The app shows this section once after updating, and it ships beside the exe as
`CHANGELOG.txt` — so an empty or missing section is not an error, it is simply silence where there
could have been an explanation.

### 4. Bump the version

Two files carry the number and they must agree: `apps/shell/package.json`, which the release
workflow checks the tag against and which `app.getVersion()` returns, and the root `package.json`.
`tests/repo-consistency.test.ts` holds them together, and holds both to the changelog.

**Which number to raise, from 0.3.0 on.** Until then the answer was precedent and nothing else — the
step said where to edit and never what to write. These rules are the precedent made explicit, and
[ADR-0024](adr/0024-what-each-version-number-means.md) carries why they are these and not
strict SemVer's.

| Number         | Raise it when                                                                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PATCH** `.Z` | Nothing the user can name is new. Fixes, wording, performance, and **the pins on their own** — a release whose whole content is a newer Electron or a newer bundled browser is a patch. |
| **MINOR** `.Y` | Anything the user can point at: a capability, a control, a game in the registry. **And anything that moves their data**, while the major is 0 — see below.                              |
| **MAJOR** `X.` | Stays at 0 today. Raising it to 1 is the owner's call and means one specific promise, stated below, not "we think it is good now".                                                      |

**A data migration is a MINOR while the major is 0, and a MAJOR after 1.0.0.** The migration in
0.3.0 is the case to reason from: it moved `config.json` and `profiles/` into `accounts/1/`, and the
consequence is not that something broke but that **the previous version cannot be gone back to** —
0.2.0 looks in the old paths, finds nothing, and opens as if it were a first run. A zip that the
user extracted beside the old one makes that an easy mistake to make. While the major is 0 there is
no number to spend on it, which is exactly what a leading 0 is for; from 1.0.0 on it costs a major.

**What 1.0.0 will mean here.** Not stability in general — one promise: **from 1.0.0 on, a release
that moves, renames or reinterprets anything under `%APPDATA%/hecaton` is a major.** That is the
only property of this app whose breakage a user cannot undo by extracting the previous zip again,
and tying the first digit to it is what makes the digit worth reading. Everything else — signing,
the browser pin, the game list — can change under a minor.

**Three rules with no judgement in them:**

1. **No suffixes.** `v0.4.0`, never `v0.4.0-rc1`. Two reasons, both in code rather than taste: the
   app's own parser is `^v?(\d+)\.(\d+)\.(\d+)$` (`packages/core/src/update.ts`), so a suffixed tag
   fails to parse and every installation quietly reports "up to date"; and `/releases/latest`
   excludes prereleases by construction, so the check would not even see it.
2. **Every released version has its `## X.Y.Z` section in `CHANGELOG.md`**, written before the tag.
   The app selects the section by exact version, so a missing one is not a gap in a file — it is an
   update that announces itself and then has nothing to say.
3. **A number that never becomes a tag does not keep its section.** 0.2.1 is the precedent and the
   reason this is written down: the version was bumped for the off-screen login fix, the tag was
   never cut, and the fix shipped inside 0.3.0 — leaving a `## 0.2.1` section that no installation
   will ever display, describing a fix the 0.3.0 notes do not mention. Fold it into the section that
   ships it, before that release goes out.

Numbers only ever go up, and are never reused. Skipping one is allowed and costs nothing.

## The tag

```
git tag v0.1.0
git push origin v0.1.0
```

The workflow then builds on a clean `windows-latest` checkout, runs `npm run check`, refuses if the
tag and `apps/shell/package.json` disagree, **fetches the pinned Chromium and verifies its SHA256**,
packages the zip ([ADR-0020](adr/0020-a-zip-the-user-extracts-not-an-installer.md)), and publishes
it with its SHA256 plus `LICENSE.txt`, `NOTICE.txt` and `CHANGELOG.txt` loose beside it, generating
the release notes from the commits. A hash mismatch fails the job with nothing unpacked, so a bad
download cannot become a release. It also refuses if `release/` holds anything but exactly one
`*-win-*.zip`. The checked path is then carried to the publish step through `GITHUB_ENV`, so "which
file is the release" is decided once.

**That guard earned its keep under a format this project no longer ships, and it stays.** While the
artifact was an NSIS installer the second match was a real file — electron-builder writes the
uninstaller stub beside it as `<name>.__uninstaller.exe`, deleted again only on the success path —
and a failed build left both. The zip target writes nothing else into that glob, so today the guard
guards the ordinary case instead: a `release/` that is not empty, which is true on any machine that
has built before and false only on a clean checkout. It also cost this document a correction worth
keeping in view — it claimed the stub "sorts before" the artifact, reasoned from code points, and
NTFS measured the opposite. Counting is the fix for both.

**`npm audit --omit=dev` runs in that job**, so an advisory that reaches the **shipped** tree fails
the build. Note what it does not see: 445 MB of bundled Chromium is not an npm dependency, and its
security posture is step 1's pin and nothing else. Build-time advisories are accepted deliberately — they are denial-of-service issues in
tooling that runs on the build machine, over patterns the build itself supplies — and that
acceptance is what this step keeps honest rather than remembered. If it fails, read what it is
before reaching for `npm audit fix --force`, which would move `electron-builder` off the exact pin.

## After

Tell the friends anyway, but they will also be told: since
[ADR-0023](adr/0023-an-update-check-at-launch.md) the app asks GitHub once at every launch and
offers the release page, unless that person answered "não lembrar mais" for this version. There is
still no auto-update and no installer — the download and the extraction are theirs.

Say the two things they will otherwise discover: **SmartScreen warns on first run** (_More info_ →
_Run anyway_), because nothing is signed, and the **SHA256 published beside the zip** is the only
thing that distinguishes an authentic build from a lookalike anyone could compile from the public
source. Checking the hash before extracting is worth saying out loud: after _Run anyway_ the thing
has already run.

And say the third, because it is the one they cannot discover: **deleting the folder leaves their
logins alone.** `%APPDATA%/hecaton` is not beside the exe (ADR-0004), so there is no route — not
even an uninstaller, since there is no uninstaller — by which removing the app removes a session. A
newer folder finds every login where it was. Removing them is _Configurações → Zona de risco →
Apagar todos os perfis_ inside the app — the **Seus dados** section above it only opens the
folder.
