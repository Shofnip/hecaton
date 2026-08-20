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
| Revision | `1682878`                                                          |
| Version  | `154.0.8014.0`                                                     |
| SHA256   | `ca3ee2bc84c81de987d7a9091e0bfe5024d905838c06429a4f3732e9d9d5e4a2` |

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

**Then re-measure the three things that have each already changed under this project once.** None of
them is checked by any test, and all three fail quietly:

1. **Turnstile.** Launch a slot on the target game with a throwaway profile and log in. This is the
   gate the whole decision rests on, and a browser that cannot log in is not shippable.
2. **The seven files the fetch script removes.** A snapshot could move something load-bearing into
   one of them. Launch a slot, confirm the window embeds, and confirm audio still follows focus —
   that exercises the renderer, GPU and audio-service children together.
3. **The window geometry.** `win32-worker.ts` carries frame maths measured against a specific
   browser-drawn title bar. If embedded screens sit a few pixels wrong, this is why.

### 2. Confirm the browser is not downloading its 4 GB model again

**Check the size, not the presence.** It creates `OptGuideOnDeviceModel` and
`OptGuideOnDeviceClassifierModel` in every profile whether or not the feature is on; what the flag
stops is the **download** that fills them. Measured 2026-08-18, with the flag working: both
directories present in all four slots, **zero files, zero bytes**, whole profiles at 238–387 MB.

```powershell
Get-ChildItem $env:APPDATA\hecaton\profiles -Directory | ForEach-Object {
  $slot = $_.Name
  Get-ChildItem $_.FullName -Directory -Filter 'OptGuide*' | ForEach-Object {
    $f = @(Get-ChildItem $_.FullName -Recurse -File -ErrorAction SilentlyContinue)
    '{0,-8} {1,-38} {2,4} files {3,10:N2} MB' -f $slot, $_.Name, $f.Count, (($f | Measure-Object Length -Sum).Sum / 1MB)
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

`apps/shell/package.json` is the one the release workflow checks the tag against, and the one
`app.getVersion()` returns. The root `package.json` carries the same number.

## The tag

```
git tag v0.1.0
git push origin v0.1.0
```

The workflow then builds on a clean `windows-latest` checkout, runs `npm run check`, refuses if the
tag and `apps/shell/package.json` disagree, **fetches the pinned Chromium and verifies its SHA256**,
packages the zip, publishes it with its SHA256, and generates the release notes from the commits. A
hash mismatch fails the job with nothing unpacked, so a bad download cannot become a release.

**`npm audit --omit=dev` runs in that job**, so an advisory that reaches the **shipped** tree fails
the build. Note what it does not see: 440 MB of bundled Chromium is not an npm dependency, and its
security posture is step 1's pin and nothing else. Build-time advisories are accepted deliberately — they are denial-of-service issues in
tooling that runs on the build machine, over patterns the build itself supplies — and that
acceptance is what this step keeps honest rather than remembered. If it fails, read what it is
before reaching for `npm audit fix --force`, which would move `electron-builder` off the exact pin.

## After

Tell the friends. There is no automatic check and no notification: the app only looks for an update
when somebody presses the button ([ADR-0014](adr/0014-the-apps-first-network-request.md)), so the
author saying so is the distribution channel.

Say the two things they will otherwise discover: **SmartScreen warns on first run** (_More info_ →
_Run anyway_), because nothing is signed, and the **SHA256 published beside the zip** is the only
thing that distinguishes an authentic build from a lookalike anyone could compile from the public
source.
