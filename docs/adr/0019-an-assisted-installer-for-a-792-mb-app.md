# ADR-0019 — An assisted installer for a 792 MB app

**Status:** Accepted · **Date:** 2026-08-21

Supersedes in part [ADR-0013](0013-a-portable-unsigned-zip-under-apache-2.md), which chose a
portable zip. Everything else in that ADR — Apache-2.0, the public repository, nothing signed,
GitHub Releases, the exact pins, the terms warning — stands untouched.

## Context

Phase 4 changed the two facts ADR-0013's format rested on.

The app now **ships its own Chromium** ([ADR-0016](0016-ship-our-own-chromium.md)), so the artifact
went from 134 MB zipped over 352 MB unpacked to **316.7 MiB over 792 MiB in 470 files**. "Extract it
anywhere and run `Hecaton.exe`" was a reasonable thing to ask of a friend at the first size and is
not at the second.

And it allows **one instance per machine** ([ADR-0018](0018-one-instance-per-machine.md)), which
makes a second launch an ordinary event rather than a mistake — something that has to fail
gracefully, quickly, and without damaging the copy that is already running.

Probe P8 measured the three candidate formats against exactly that. Its findings are the whole
basis for what follows.

## Decision

**An assisted NSIS installer, per user, asking for no elevation.** `apps/shell/electron-builder.yml`
carries the shape and the reasoning line by line: `oneClick: false` (a licence page needs one),
`perMachine: false` and `allowElevation: false`, `license: ../../LICENSE`,
`allowToChangeInstallationDirectory: true`, `deleteAppDataOnUninstall: false`,
`differentialPackage: false`.

**The directory is the user's choice.** 792 MB installed is enough that somebody with a small `C:`
has to be able to put it elsewhere — which the zip allowed by construction and an installer takes
away unless it is turned on.

**Apache-2.0 §4 is met twice over.** The licence page satisfies the obligation at install time, the
way it did before the zip existed; `LICENSE.txt` and `NOTICE.txt` still travel beside the exe,
because a page clicked through once is not a copy that was kept; and `release.yml` publishes
`LICENSE.txt`, `NOTICE.txt` and `CHANGELOG.txt` loose on the release page, which is the copy that
can be read **before** running an unsigned executable.

## What P8 measured, because the decision is not defensible without it

|                | zip (v0.1.0)               | portable `.exe`    | installer |
| -------------- | -------------------------- | ------------------ | --------- |
| download       | 316.7 MiB                  | 199.9 MiB          | 200.1 MiB |
| unpack, once   | 4.74 s / 7.78 s (Explorer) | —                  | 7.04 s    |
| **per launch** | 3.2 s                      | **14.7 s**         | 3.2 s     |
| peak `%TEMP%`  | —                          | **1.74 GiB**       | —         |
| second launch  | harmless                   | **guts the first** | harmless  |

**`portable` was ruled out on those numbers, not on taste.** The plan had assumed a fixed
`portable.unpackDirName` would make the unpack persist. It does not:
`app-builder-lib/templates/nsis/portable.nsi` opens its section with `RMDir /r $INSTDIR` and closes
it with another, unconditionally. So every launch re-extracts 792 MB, and the option only changes
where. Leaving it unset does not help either — electron-builder generates a fixed name at build
time regardless, so the path is shared either way.

That shared path is the disqualifying part. A second launch deletes the running app's files before
extracting its own: measured, the tree went from 470 files to **10**, everything except the six
binaries Windows refused to unlink because they were mapped. `resources/` went whole — `app.asar`,
`resources.pak`, `locales/`, and all 254 files of the bundled browser. The first Hecaton kept its
window, kept answering, and could no longer launch a single screen. An app that looks healthy and is
not is the failure this repository keeps writing rules against.

**LZMA turned out to be worth a third of the download**, which ADR-0013's 2026-08-20 Correction had
predicted it would not be: the identical payload is 316.7 MiB as deflate and 199.9 MiB as LZMA. An
unoptimised Chromium snapshot compresses well. That is the one respect in which every non-zip option
beats the zip.

## Consequences

Line numbers into `node_modules/app-builder-lib` below were read against
**electron-builder 26.15.3**, the pinned version. A bump is the moment to re-check them.

- **The uninstaller accepts `--delete-app-data`, and that branch has no guard.**
  `app-builder-lib/templates/nsis/uninstaller.nsh:220-231` sets `isDeleteAppData` from the command
  line whatever `deleteAppDataOnUninstall` says, and `:237` then does
  `RMDir /r "$APPDATA\${APP_FILENAME}"` — with `APP_FILENAME` the product name, so
  `%APPDATA%\hecaton`, every logged-in game profile, no confirmation anywhere. It is the same bare argv flag ADR-0013 removed
  from the app itself, reappearing inside somebody else's uninstaller where it cannot be removed.
  It needs deliberate invocation: neither the update path (which passes `--updated`) nor clicking
  Uninstall reaches it. **A supported fix was offered and declined** — `customUnInit` is inserted at
  the end of `un.onInit`, before any section runs, so a six-line `nsis.include` could `Quit` on that
  parameter. The owner accepted the flag as a declared consequence on 2026-08-21 rather than carry
  the include. Read from the template, **not executed**: NSIS resolves `$APPDATA` from the shell
  folder rather than the environment variable, so the redirect this project uses to make destructive
  probes safe would not have protected the real profiles.
- **Whatever an uninstaller does is frozen in every copy already distributed.** Probe P1 measured
  that an update silently runs the _previous_ release's uninstaller. So the guard above, if it is
  ever added, protects only the installs that come after it — which is why it had to be decided now
  and not later.
- **The artifact carries `resources\elevate.exe`** (107,520 bytes), added by the NSIS-family targets
  in electron-builder. An app with no elevation path of its own ships a general-purpose elevation
  helper. Named here so it is a decision. It is also why `win.target` must stay a single value: the
  targets share `win-unpacked`, so a `[zip, nsis]` list would put it inside the zip too.
- **There is a registry key, a Start-menu entry and a desktop shortcut now**, and an entry in _Apps
  & features_. ADR-0013 listed the absence of the Start-menu entry and the uninstall registry key as
  a feature of the zip; the desktop shortcut is new surface it never had to mention. What
  that route does was measured on 2026-08-21: the registry records `UninstallString` as
  `"<dir>\Uninstall Hecaton.exe" /currentuser` — with **no `_?=`** — and running exactly that removed
  the install directory whole, the uninstaller included, and took the registry entry with it. The
  switch is worth naming because it inverts the outcome and any probe will meet the other side of
  it: with `_?=` NSIS runs the uninstaller in place and cannot delete its own image, so an
  `Uninstall Hecaton.exe` survives; without it, it copies itself to `%TEMP%` first and can. `_?=` is
  also the form the _installer_ uses when it runs the previous release's uninstaller during an
  update, which is where probe P1 met it.
- **The installer would leave a ~200 MB copy of itself behind, so the build deletes it.**
  `installer.nsh:93` runs `copyFile "$EXEPATH" "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"` on the
  embedded-payload path this build takes; the define resolves to `@hecatonshell-updater\installer.exe`
  — from the **workspace package** name via `AppInfo.updaterCacheDirName`, not from the product name.
  Three things made it worth undoing rather than documenting: it is a quarter again of the app's
  footprint, it lands on the profile's drive **even when the user moves the install directory off
  it**, and nothing in `uninstaller.nsh` references it, so it outlives the app. It exists for
  electron-updater's reinstall flow, which ADR-0014 rejected — nothing here will ever read it.
  `apps/shell/build-resources/installer.nsh` removes it from `customInstall`, which
  `installSection.nsh:82` inserts after the copy at line 66.
  **Both halves were measured rather than inferred.** That the macro is _inserted_, because
  `!ifmacrodef` fails silently: putting an undefined macro inside the body made makensis abort with
  `Error in macro customInstall on macroline 6 / !include: error in script: "installSection.nsh" on
line 82`. A size comparison had been tried first and was useless — 191 bytes of delta against ~96
  bytes of build nondeterminism. And that it _works_, as a controlled pair on 2026-08-21: the build
  from before the include left `%LOCALAPPDATA%\@hecatonshell-updater\installer.exe` at **209,820,253
  bytes** — its own size to the byte, so it is literally a copy of itself — and **uninstalling did
  not remove it**; the build with the include (209,835,964 bytes) left nothing, before or after
  uninstalling. Both halves are named by size on purpose, so the record says which binaries were
  run. Without the control the absence would have proved nothing, being also what a copy that never
  happened looks like. The pair was a per-user silent install, so it does not exercise the
  `$installMode == "all"` branch of the shell-var bracket — the tests pin that branch's presence,
  and this pins the per-user result.
  Probe P1 measured the same orphan at 99 MB while the first NSIS installer existed, and predicted
  the directory would be `hecaton-updater`. It was recorded only in gitignored `spike/`, which is why
  it had to be found twice.
- **SmartScreen now warns on an installer rather than on an extracted folder.** The warning is the
  same; what changes is that clicking through it runs something. So the SHA256 has to be checked
  first to be worth anything, and `docs/releasing.md` and the README both say so in those words.
- **Nothing about where data lives changes.** [ADR-0004](0004-appdata-over-repo-dir.md) is what made
  every one of these formats viable: no user data sits beside the binary, so the install directory is
  disposable and the uninstaller has nothing of the user's to remove. _Apagar todos os meus dados_
  in the panel remains the only route the **app** offers, and the only one reachable without typing
  the uninstaller's `--delete-app-data` flag by hand (first consequence above). It is behind a
  confirmation and behind every screen being stopped first.
- **The blockmap was costing 26 MiB, and turning it off is what closed the gap to the portable
  build.** `nsis.differentialPackage` defaults to true and makes electron-builder compress in blocks
  so the artifact can be differentially updated — which is worth nothing here, because ADR-0014
  rejected electron-updater. With it on the installer was 226.4 MiB in 44 s; with it off, **200.1
  MiB in 210 s**, within 250 KB of the portable build. That is what the 26 MiB costs: build time.
  `compression: maximum` on top of it was then measured rather than argued about, which this
  project's history with that option earns: **98 bytes larger** — 209,820,351 against 209,820,253.
  Turning the blockmap off already puts the payload through solid LZMA, so there is nothing left for
  it to win. It stays unset, now for a measured reason.

## Alternatives rejected

**Keeping the zip.** It costs **117 MiB** more per download and leaves "extract this somewhere" as
the install instruction for 470 files. Its one remaining advantage was that no uninstaller existed to
get the user-data question wrong — a real argument, strengthened by the `--delete-app-data` finding
above, and the owner weighed it against the installer knowing that finding. It is the most
conservative option and was not taken.

**A 7-Zip SFX**, which is what "extract once to a folder you choose and run from there" means
without NSIS. Same decompression cost, same per-launch cost, and none of the registry, shortcut,
uninstaller or `elevate.exe` surface. It was not measured directly — the NSIS installer stood in for
its LZMA cost — and it adds a third-party `7zSD.sfx` stub to the build, which is the surface
ADR-0013 called the largest new one of its phase.

**`portable`**, on the measurements above.

**Signing.** Unchanged from ADR-0013 and unchanged by the format: a certificate is issued to a
verified legal identity that every user then sees, which is what the owner's stated intent rules
out. An installer does not move that trade.
