# ADR-0016 — The app ships its own Chromium

**Status:** Accepted · **Date:** 2026-08-20

Supersedes, in part, the "drives your installed Chrome" half of
[ADR-0003](0003-spawn-over-cdp.md) — its substance, that the browser is spawned rather than driven
over CDP, is untouched and load-bearing.

## Context

`v0.1.0` shipped as a portable zip that launches the **Google Chrome installed on the user's
machine**, discovered through three search paths. `README.md` said so out loud: "it does not ship a
browser". Handing the zip to another person made three costs of that visible at once.

**It is a prerequisite the user has to satisfy.** No Chrome, no app — and the failure was a message
about an executable, at the moment they expected a game.

**The browser is not a pin, so the app has no version to be correct against.** Every flag this app
depends on is a bet on a browser somebody else updates weekly. That is not hypothetical here:
`--load-extension` stopped working in Chrome 137 and took a feature with it, and the three
background-throttling switches that keep hidden screens running were measured against one specific
Chrome build precisely because they are fragile.

**The user's browser and the app's browser are the same program.** A profile the app opens is
opened by the same binary the user browses with, whose updates, policies and enterprise
configuration the app neither chooses nor sees.

Against that, a bundled browser had one blocking unknown, and it was the same one that overturned
Playwright in Phase 0: the target game's **Cloudflare Turnstile**. ADR-0003's evidence table
concluded the binary was never the variable — the CDP connection was — but that was an inference,
and being wrong meant a browser that could not log in.

## Decision

**The app ships its own Chromium and launches nothing else.**

**The source is the `chromium-browser-snapshots` bucket, pinned to revision `1682878`
(`154.0.8014.0`), verified by SHA256.** The owner chose that source knowing what it is: **trunk**,
some 14,000 commits ahead of the stable channel at the time of pinning, and **not a release channel
— it receives no stable-branch security backports.** The alternatives are in the last section.

**There is no fallback to an installed Chrome.** This is the part that had to be chosen rather than
fallen into, because a fallback looks purely like kindness. It would put back the dependency the
bundling exists to remove, and it would make the app's most important failure mode ambiguous: when
Turnstile next rejects a browser, "which browser actually ran?" must have one answer.

**One load path, no `app.isPackaged` branch.** `bundledBrowserPath()` joins `process.resourcesPath`
with `chromium\chrome-win\chrome.exe`. In the package, `extraResources` puts the tree there; in
development, `scripts/fetch-chromium.mjs` links it under Electron's own resources directory —
measured 2026-08-20 to be `node_modules/electron/dist/resources`, with a junction under it resolving
for `existsSync` and `spawn` without elevation. The load path that is tested is the load path that
ships (ADR-0007 decision 2, applied to a 440 MB binary).

**The binary is never committed.** It is fetched from the pinned revision and **verified against the
pinned SHA256 before a single byte is unpacked** — in development and in the release workflow alike.
For an unsigned download of somebody else's build over HTTPS, that hash is what makes the artefact
the one probe P5 measured rather than whatever the bucket serves today.

**Seven of the snapshot's 261 files are not shipped**, listed by name with a reason each in
`scripts/fetch-chromium.mjs`: `interactive_ui_tests.exe` (358 MB, Chromium's own UI test binary),
`setup.exe` (Chrome's installer and updater), `elevation_service.exe` and
`elevated_tracing_service.exe` (services built to run elevated), `notification_helper.exe`,
`chrome_pwa_launcher.exe` and `chrome_proxy.exe`. That is 798 MB → **440 MB**, and it applies the
rule `electron-builder.yml` already states for the app's own files: the package must never carry a
file nobody chose to ship. The stripping happens in the fetch script rather than in a packaging
filter, so the browser a developer runs is byte-identical to the one that ships.

**Three switches state that the browser is ours** (`chrome-args.ts`): `--disable-component-update`,
`--no-service-autorun`, `--disable-extensions`. They are switches rather than `--disable-features`
names on purpose — Chromium ignores feature names it does not recognise, so that kind of flag can
become a silent no-op, which is exactly how `--load-extension` failed.

## What probe P5 measured, 2026-08-20

The gate, first: **Turnstile passed**, verified live by the owner on a throwaway profile with the
pinned snapshot launched by plain `spawn`. ADR-0003's inference was right.

Every assumption [ADR-0011](0011-embed-spawned-chrome-into-the-shell.md) makes about the browser
measured **identical or better**: the browser-drawn `--app` title bar starts at the same row, same
8 px bottom margin, same window and client rects at 900×600; reparenting took **7 ms** against
Chrome's ~40 ms; reload via `WM_APPCOMMAND` 3 works; `utility:audio.mojom.AudioService` appears as
a direct child, which is what `wasapi-audio-controller` maps; the process closes cleanly with
`exit_type: Normal`; and the executable is still called `chrome.exe`, so the WMI filter's shape does
not change. The geometry being _identical_ is the load-bearing result — `APP_TITLE` and the frame
maths in `win32-worker.ts` transfer unchanged.

**Existing profiles survive the swap with no re-login.** A profile written by Chrome 150 opened in
154 and again in 150, with no downgrade refusal in either direction. The decisive part is cookies:
the owner's real `slot-1` and `slot-2` were inspected read-only, without copying or decrypting, and
have **no** `app_bound_encrypted_key` — every `encrypted_value` carries the **`v10`** prefix, the
DPAPI-wrapped shared key that any Chromium running as the same Windows user can unwrap. App-Bound
Encryption (`v20`, bound to the Chrome executable through its elevation service) is not in play.
**This finding has a shelf life:** it holds for the profiles as they are. If the user's Chrome starts
writing `v20` before a migration runs, the sessions would not carry over. Re-measure immediately
before switching, not once.

**Bundling does not reopen extensions.** The snapshot ignores `--load-extension` too, and
`--disable-features=DisableLoadExtensionCommandLineSwitch` changes nothing — which **contradicts the
upstream PSA** that said the removal applied only to branded builds. The instrument was checked
before the conclusion: the same unpacked extension loaded fine in this repo's Electron 43. This
corrects what an earlier session had asserted from memory.

Measured for this ADR, on the stripped tree: it launches, is found by the production WMI filter,
keeps the geometry to the pixel, spawns its renderer, GPU and audio-service children, and exits
`Normal` in 326 ms.

## Consequences

- **The browser holding the logged-in sessions no longer updates itself.** It updated silently
  before; now it moves only when a Hecaton release moves it. **The app's release cadence has become
  the browser's patch cadence** — and the browser is the largest attack surface in the product by a
  wide margin. `docs/releasing.md` carries this as the fourth pin, with the ritual attached, because
  an obligation with no moment attached is one nobody performs.
- **Trunk receives no stable-branch security backports.** A fix that lands in a Chrome stable patch
  release is not backported into a snapshot; it arrives whenever trunk moves past it, which may be
  before or after. The mitigation is to raise the revision often, and it is a mitigation, not a fix.
  This is the single largest cost of the decision and the owner accepted it explicitly.
- **`--disable-component-update` freezes the security data the component updater also carries**,
  CRLSet (certificate revocation) chief among it, at whatever the packaged revision shipped. The
  owner weighed this on 2026-08-20 against the alternative — a pinned browser that fetches and loads
  payloads from Google at runtime, which is also a network request the app makes and therefore a
  rule-2 trigger of its own — and chose to keep the flag.
- **`npm audit --omit=dev` does not see the browser.** The release workflow refuses to publish an
  advisory that reaches the shipped tree, and 440 MB of Chromium is not an npm dependency. Its
  posture is the revision pin and the release ritual, nothing else.
- **Dropping `elevation_service.exe` means the bundled browser can never write App-Bound-Encryption
  (`v20`) cookies.** That is the property this app wants rather than a loss: `v20` is precisely what
  would bind a profile to one executable and stop the sessions carrying over. It is written here
  because it is not obvious, and a future session restoring the file "for completeness" would be
  changing something real.
- **Raising the revision is not routine.** The stripped file list, the flag behaviour and Turnstile
  all have to be re-measured, because each has already changed under this project once.
- **The artefact grows by roughly 440 MB.** The v0.1.0 zip was 134 MB over 352 MB unpacked; the
  bundle projects to about 790 MB unpacked. The final numbers and the artefact format are probe P8's
  question, not this one's. A second cost is **unmeasured and worth measuring before shipping**: a
  snapshot is not an official build — no PGO, no LTO — and an unoptimised Chromium is also slower,
  in an app that runs four or more at once.
- **`npm install` wipes the development link**, since it lives under `node_modules`. The remedy is
  to re-run the fetch script, which relinks in a second without re-downloading — the unpacked tree
  lives in `vendor/`, which survives. This joins `node node_modules/electron/install.js` as a
  post-install step, and it is documented in the same place for the same reason.

## Alternatives rejected

**Keep driving the user's installed Chrome.** The status quo, and the thing every cost above
describes. It also leaves the app unable to state which browser ran.

**Bundle a stable-channel Chrome or Chrome for Testing instead.** This is the serious alternative
and the one a future reader will ask about. Chrome for Testing is a real release-channel build,
versioned against stable, with security fixes on the stable cadence — strictly better on the axis
that costs the most here. It was not taken because the owner chose the snapshot bucket explicitly
after the trade was put to them, and because the Turnstile verification that opened this gate was
performed on **this** snapshot: switching the binary reopens the one question that had to be
answered live. If the trunk cost ever bites, this is where to start, and re-running P5's Turnstile
check is the price of the move.

**Ship a browser and fall back to the installed Chrome when it is missing.** Rejected above; it
recreates the dependency and destroys the one-answer property for the failure that matters most.

**Commit the binary.** 440 MB of third-party build output, permanent in git history, and a worse
record of what shipped than a pinned revision plus a SHA256 in a file anyone can read.

**Strip the snapshot with `electron-builder`'s `filter` instead of in the fetch script.** It would
have made the developer's browser differ from the shipped one — the exact class of bug this
repository keeps finding, and the reason `apps/shell/scripts/copy-renderer-assets.mjs` exists.

**Expose an environment variable or setting to point at another browser.** It is the obvious way to
make the no-fallback rule survivable, and it is a stop-and-ask decision rather than a convenience:
an env var naming an executable that the app then spawns is arbitrary external code execution. Not
taken, and not to be added without the owner deciding it.
