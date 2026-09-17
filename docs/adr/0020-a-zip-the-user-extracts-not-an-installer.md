# ADR-0020 — A zip the user extracts, not an installer

**Status:** Accepted · **Date:** 2026-09-17

Supersedes [ADR-0019](0019-an-assisted-installer-for-a-792-mb-app.md) entirely and restores the
format [ADR-0013](0013-a-portable-unsigned-zip-under-apache-2.md) chose. Everything else in
ADR-0013 — Apache-2.0, the public repository, nothing signed, GitHub Releases, the exact pins, the
terms warning — was never in question and still stands. ADR-0019 shipped in no release: the
installer existed for 27 days, between `7dadd29` and this decision, and every published artifact so
far has been a zip.

## Context

ADR-0019 reasoned from size. The bundled Chromium took the artifact to 792 MiB unpacked, and
"extract it anywhere and run `Hecaton.exe`" was judged too much to ask of a friend at that size —
so the artifact became an assisted NSIS installer, per user, with a licence page, a Start-menu
entry, an uninstaller and an entry in _Apps & features_.

The owner reversed that on 2026-09-17, and the reason is the user rather than the byte count: **the
person this is built for downloads a zip, extracts it, and double-clicks an executable.** They have
no npm, no terminal, and no interest in either. Measured against that person, an installer is not a
convenience — it is a wizard, a publisher warning on a page that asks them to agree to something,
an entry in a system list, and an uninstaller that can be pointed at their data. A folder they can
delete is smaller in every sense that matters here.

Nothing in the size argument was wrong; it was answering a question the owner had not asked.

## Decision

**`win.target: zip`, and no `nsis:` configuration at all.** The user downloads
`Hecaton-<version>-win-x64.zip`, extracts it wherever they like, and runs `Hecaton.exe`. Updating is
replacing the folder. Uninstalling is deleting the folder.

The custom NSIS script is **deleted rather than left unused**, and that is deliberate:
electron-builder picks `build-resources/installer.nsh` up by convention, with or without the
`include:` line, so a file left on disk is a macro armed for whoever next adds an NSIS target.
`tests/artifact.test.ts` asserts its absence for that reason, alongside the absence of the `nsis:`
block.

`win.target` stays a **single value**, which was ADR-0019's finding and survives the reversal: every
target packages the same `win-unpacked`, so a list is how one target's by-products end up inside
another's artifact.

## Consequences

- **The download grows by ~117 MiB.** Probe P8 measured the identical payload at 316.7 MiB as the
  zip's deflate and 199.9 MiB as the installer's LZMA. That is the price of the format and it is
  paid knowingly; a 7z target would recover it and is rejected, because Windows cannot extract
  `.7z` without extra software, which defeats the point of handing somebody a zip.
- **What the installer added, the zip removes**: no registry key, no Start-menu entry, no desktop
  shortcut, no _Apps & features_ entry, no uninstaller — and therefore **no `--delete-app-data`
  flag**. ADR-0019's first consequence was an unguarded branch in somebody else's uninstaller that
  would have erased `%APPDATA%\hecaton` with no confirmation; the owner accepted it as a declared
  consequence on 2026-08-21, and this decision retires it instead. Nothing a user can click or type
  at the artifact touches a logged-in session now.
- **`resources\elevate.exe` goes too.** The NSIS-family targets put that 107,520-byte elevation
  helper into `win-unpacked`, which every target then packages. An app with no elevation path of its
  own stops shipping a general-purpose one.
- **The ~200 MB orphan and the machinery that removed it both go.** electron-builder copied the
  running installer into `%LOCALAPPDATA%\@hecatonshell-updater` on every install and never removed
  it; `installer.nsh` undid that from `customInstall`, and `docs/releasing.md` carried a check tied
  to the `electron-builder` pin for it. With no installer there is no copy, so the check is deleted
  rather than left as a ritual nobody can fail.
- **Apache-2.0 §4 is met by files rather than by a page.** The licence page is gone, so `LICENSE.txt`
  and `NOTICE.txt` travelling beside the exe stop being belt-and-braces and become the obligation
  itself — as they were under ADR-0013, which is where the first zip was caught shipping neither.
  `release.yml` also publishes them loose on the release page, with `CHANGELOG.txt`, and those are
  the copies readable **before** running an unsigned executable.
- **SmartScreen warns on the extracted exe instead of on an installer**, which makes checking the
  published SHA256 before extracting the thing worth saying out loud: after _Run anyway_ the thing
  has already run. `README.md` and `docs/releasing.md` both say it.
- **`portable` remains rejected, on ADR-0019's measurements.** This is not a return to the question
  P8 answered: a `portable` exe re-extracts 792 MiB on every launch — 14.7 s against 3.2 s, peaking
  at 1.74 GiB of `%TEMP%` — and two launches share one unpack path, so the second deletes the first
  app's files, bundled browser included, while its window is still on screen. An extracted folder
  has none of that.
- **The AppContainer grant loses its natural home, and moves into the app.** This is the one thing
  the reversal made harder rather than simpler. Chromium's network service runs in an AppContainer
  and cannot start unless the browser's own files are readable by `ALL APPLICATION PACKAGES`;
  without that, **every screen opens grey and no page ever loads** — measured 2026-09-17 on both
  pinned revisions, in three locations, with the grant flipping it in both directions. Google
  Chrome's installer grants that ACE explicitly; an extracted folder inherits nothing of the sort,
  and a folder in `%LOCALAPPDATA%\Programs` was measured inheriting nothing of the sort either, so
  the installer would have had to grant it too. With no installer, the app grants it for its own
  browser tree at startup, which also covers the development tree and any folder the user extracts
  into. See `architecture.md`, _The browser ships with the app_.

## Alternatives rejected

**Keeping the installer and granting the ACE from `customInstall`.** It was the owner's choice for
about an hour, before the format itself was reversed — an installer is the natural place to set file
permissions once. Rejected with the format, for the reason at the top: the installer is the part the
user was never asking for.

**A self-extracting exe (7-Zip SFX).** It is "extract once to a folder you choose and run from
there" without NSIS, and it recovers the 117 MiB. ADR-0019 already weighed it and did not take it:
it adds a third-party `7zSD.sfx` stub to the build, which is the surface ADR-0013 called the largest
new one of its phase, and it makes the artifact an executable rather than an archive — the opposite
direction from "download a zip and look inside before running anything".

**Signing.** Unchanged from ADR-0013 and unchanged by the format: a certificate is issued to a
verified legal identity that every user then sees, which is what the owner's stated intent rules
out.
