# Releasing

Cutting a release is two commands. This document exists for what comes before them — four steps, of
which the first two are **checks no test performs**. They fail silently between versions, and the
release is where they belong because it is the only moment that already exists: an obligation with
no moment attached is one nobody performs.

A third check used to be on that list and is now enforced instead — see `npm audit` under _The tag_.

## Before the tag

### 1. Raise the pins, deliberately

Three dependencies are pinned exactly, and each pin turns "receive the fix automatically" into
"somebody must bump it":

| Package               | Where                                  | Why it is pinned                                                       |
| --------------------- | -------------------------------------- | ---------------------------------------------------------------------- |
| `electron`            | `apps/shell/package.json`              | the embedded Chromium is a reviewed decision, not an install outcome   |
| `node-window-manager` | `packages/window-manager/package.json` | native, compiles at install, runs in main with full access to profiles |
| `electron-builder`    | `apps/shell/package.json`              | assembles the binary other people execute, and nothing is signed       |

Chromium's security fixes arrive as **Electron patch releases**, and Electron supports only its
three most recent majors — so this is the one on the list with a clock attached. See
[ADR-0007](adr/0007-electron-security-posture.md) decision 1 and
[ADR-0013](adr/0013-a-portable-unsigned-zip-under-apache-2.md).

After any bump: `node node_modules/electron/install.js`, then `npm run check`, then
`npm run test:integration` — a raised `node-window-manager` or Electron changes the ABI the native
modules are built against, and only the integration suite touches that.

### 2. Confirm Chrome is not downloading its 4 GB model again

Open any `%APPDATA%/hecaton/profiles/slot-N` and confirm there is **no `OptGuideOnDeviceModel`
directory**.

Every slot launches with
`--disable-features=OptimizationGuideOnDeviceModel,OptimizationGuideModelDownloading` because
Chrome was otherwise downloading an on-device model **per profile**: 16.3 GB of a 17.4 GB data
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
tag and `apps/shell/package.json` disagree, packages the zip, publishes it with its SHA256, and
generates the release notes from the commits.

**`npm audit --omit=dev` runs in that job**, so an advisory that reaches the **shipped** tree fails
the build. Build-time advisories are accepted deliberately — they are denial-of-service issues in
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
