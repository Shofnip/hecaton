# Architecture

Living document. Started as the pre-implementation plan; updated with what the Phase 0 spike
actually proved. When a decision changes, change it here in the same commit.

This file describes the system as it is **now**. The reasoning behind decisions that reversed
an earlier one, or where alternatives were seriously weighed, lives in
[`docs/adr/`](adr/README.md) — one immutable file per decision, so that editing this document
toward the present cannot quietly erase why the past was rejected.

## Context

Run several web games at once, each in its own isolated session, with a control-room feel:
see every screen simultaneously, interact with any without selecting first, focus one for
visibility. Doing this by hand — opening windows, arranging them, juggling separate logins —
is repetitive and error-prone.

First target game: **Poke IdleWorld** (https://poke.idleworld.online/), an idle game. The
architecture must absorb more games without rework.

The app **will be distributed** to other people. That raises the bar on security, packaging
and error handling throughout.

## Settled decisions

1. **Manual play.** The user plays with their own hands. Automation is a later phase.
2. **Real OS windows**, not a single panel of live thumbnails. CDP screencast with forwarded
   input was considered and dropped — with real windows, "see all at once" and "interact without
   selecting" come for free. The windows are now **embedded into one shell window** (a video
   wall) rather than arranged free on the desktop — [ADR-0002](adr/0002-real-windows-over-thumbnails.md),
   superseded in part by [ADR-0011](adr/0011-embed-spawned-chrome-into-the-shell.md).
3. **Session isolation is mandatory.** Any slot can point at any game, including the same
   game on different accounts. Separate profiles from v1.
4. **Shell: Electron.** Node/JS end to end.
5. **Per-slot profile is configurable**, editable at any time, not fixed at slot creation.
6. **TypeScript**, so the registry contract and adapter interfaces — the boundaries that
   matter most — are checked at compile time.
7. **Strict TDD** everywhere (see `CLAUDE.md`).
8. **Games live in a registry** with a narrow contract; a custom slot (URL only) is the
   alternative. Definitions ship **only in the repository**.
9. **Language:** everything in English except the app UI, which is Portuguese.
10. **Security decisions stop implementation** and go to the project owner with trade-offs.
11. GitHub + CI (typecheck, lint, format check, tests) on pushes to `main` and on every pull
    request. The integration suite is manual — it needs an interactive desktop.

## Browser control: `spawn`, not CDP

This is the decision the Phase 0 spike overturned, and the most important one here.

The original plan was Playwright's `chromium.launchPersistentContext`. **It does not work for
the target game.** Its login page is protected by Cloudflare Turnstile, which rejects any
CDP-controlled browser — not the IP, not a fresh profile, not the binary, but the CDP
connection itself.

The four tests that isolated that, and the alternatives weighed, are recorded in
[ADR-0003](adr/0003-spawn-over-cdp.md). They are not repeated here: this document is edited
toward the present, and evidence belongs somewhere edits cannot quietly tidy it away.

**So the app spawns Chrome directly**, like a desktop shortcut would:

```
chrome.exe --user-data-dir=<per-slot dir> --no-first-run --no-default-browser-check
           --hide-scrollbars
           --disable-features=OptimizationGuideOnDeviceModel,OptimizationGuideModelDownloading
           --window-position=x,y --window-size=w,h --app=<url>
           --disable-background-timer-throttling         # unless backgroundThrottling
           --disable-backgrounding-occluded-windows      # is set on the screen
           --disable-renderer-backgrounding
           --mute-audio                                  # only when the slot is muted
```

**The whole list, deliberately.** `CLAUDE.md` makes "Chromium flags that weaken protections" a
security-review trigger, so an abridged list here would be worse than none: a reviewer would audit
what is shown and stop. None of these weakens a protection, and `chrome-args.test.ts` holds that as
a test rather than a claim — it parses the feature names out of `--disable-features` so a protection
cannot be smuggled into the comma list, and pins the number of `--disable-features` switches at one,
because Chromium honours a single value per switch.

The three throttling flags are on **by default** (`backgroundThrottling` defaults to `false`), which
is worth noticing next to the Playwright measurement below: the cost attributed there to "Playwright
injects flags that disable Chrome's background throttling" is a cost this app now chooses to pay, on
purpose, because an embedded screen must keep running while it is not on top.

`--app=<url>` opens an app window rather than a normal tabbed one, which keeps the slot out of
Chrome's session restore — so it never reopens last time's tabs and never accumulates them (this
matters once `stop()` closes cleanly; see [ADR-0003](adr/0003-spawn-over-cdp.md)).

What this keeps: session isolation (`--user-data-dir` is the same mechanism), window layout
and focus, crash detection and auto-restart, the registry, per-slot config, mute.

What it costs: no CSS injection, no in-page actions, no screenshots, no in-page automation.
Those depended on CDP.

### Audio, a second casualty of dropping CDP

The plan called for muting unfocused instances, which needed CDP. Without it Chrome only
accepts `--mute-audio` **at launch** — a slot is born muted or not, and cannot change later.

v1 handles this without any new dependency: **profiles are persistent, so the game's own audio
setting sticks.** Mute inside the game once per slot and it survives closing and reopening.
The app additionally offers `--mute-audio` per slot as a fallback for games with no audio
control of their own.

The app makes audio **follow the app's own focus mode** (not the OS foreground window): with the
global `audioFollowsFocus` setting on (the default) and no screen in focus mode, every running
slot plays at its configured volume; focusing one screen mutes the others; leaving focus restores
all. Each slot also has its own **volume** (0–100) and mute, set from the panel. It is all done
per process through the Windows audio session API (WASAPI), reaching a slot's sound through the
_audio-service_ child Chrome renders it in — mapped back from the slot's main pid — and it adds
**no dependency**: the Core Audio interfaces are declared inline as C# and driven through a
**persistent PowerShell worker** (stdin line protocol), fast enough for a volume-slider drag
(~12 ms per change; the mute path began as a ~270 ms per-call shell-out and was promoted to the
worker for volume). The off-the-shelf native module was rejected because it identifies sessions by
window title, not pid, so it cannot tell two Chrome slots apart; the full trade-off is
[ADR-0010](adr/0010-audio-follows-focus-without-a-dependency.md) (whose Correction records the
foreground→focus-mode change). The mute/volume policy lives in the core behind an
`AudioController` port, so a later move to an in-process addon would be a one-adapter change.
Writing the game's preference straight into the profile's LevelDB was considered and rejected:
undocumented format, and a bad write loses the login rather than just the volume setting.

**Anti-detection is out of scope.** The plan excluded fingerprint evasion from the start, and
since the app is distributed, a terms-of-service ban would land on the end user, not the
author. Never weaken this to unblock a feature.

### Verified spike findings

Measured on Windows 11, Chrome 150, Ryzen 9 9950X3D, dual 1920×1080.

- **Slot → PID → window mapping works without CDP.** Launch with a unique tag in
  `--user-data-dir`, then resolve PIDs via `Win32_Process.CommandLine`. 4/4 exact.
- The PID `spawn` returns is a **launcher stub**, not the browser process. The real one is the
  process whose command line has no `--type=`.
- **The WMI query is too slow for polling.** Resolve the PID once at launch; check liveness
  with `process.kill(pid, 0)`.
- **Never identify a window by title.** During the spike a title filter matched the user's own
  Chrome window — same game open — and moved it. Match on `processId`.
- `node-window-manager` 2.2.4 builds on Node 24 and drives windows the app did not create:
  `setBounds`, `bringToTop`, `getActiveWindow` all confirmed.
- **Resource cost is low:** 4 idle instances = 1.72 GB and ~1% of one core. Under Playwright
  the same 4 cost 2.29 GB and ~294% of one core, because Playwright injects flags that disable
  Chrome's background throttling. Default of 4 slots has ample headroom.
- **Disk cost per slot is ~300 MB — but Chrome tries to make it 4.3 GB.** Chrome downloads
  Gemini Nano into `OptGuideOnDeviceModel` inside **each** profile, about two days after the
  profile is created rather than at first launch. Measured at Chrome 150.0.7871.187: 4,072 MB per
  slot, 16.3 GB across four, the same model version duplicated each time. The app therefore
  launches every slot with `--disable-features=OptimizationGuideOnDeviceModel,OptimizationGuideModelDownloading`.
  Because Chromium silently ignores feature names it does not recognise, that switch can become a
  no-op in a future version with no symptom but the disk filling again — so it is checked at every
  release ([`releasing.md`](releasing.md)). **The check is on the directory's size, not on whether it
  exists:** measured 2026-08-18, with the flag working, `OptGuideOnDeviceModel` and
  `OptGuideOnDeviceClassifierModel` were present in all four slots and **empty** — Chrome creates the
  shell regardless, and what the flag stops is the download that fills it. Whole profiles were
  238–387 MB, which is the ~300 MB figure above holding a month on.
- **Extensions work, but cannot be auto-installed.** An MV3 extension injects CSS/JS and reads
  the game DOM fine, and Turnstile accepts it — but **Chrome 150 ignores `--load-extension`**;
  it only loads via manual "Load unpacked". For a distributed app that pushes HUD/actions
  toward the Web Store or browser policy, each with its own cost. Deferred, not dead.

## Structure

```
hecaton/
  apps/
    shell/              # Electron: main (orchestrator) + preload + renderer
                        #   (panel + an always-on-top overlay window for modals over the games)
  packages/
    core/               # PURE CORE - grid, state machine, registry, config, orchestrator.
                        #   No I/O, enforced by ESLint rather than by convention.
                        #   src/testing/ holds the fakes; excluded from the build.
    browser-engine/     # process adapter: Chrome via spawn, PID resolution, liveness,
                        #   profile archiving, and per-process audio mute + volume (WASAPI)
    window-manager/     # embeds spawned Chrome into the shell (Win32 SetParent) and drives
                        #   it — move/hide/show/reload/close — applying the layout the renderer sends
    storage/            # disk adapter: JSON files and rotated logs under %APPDATA%/hecaton
    games/              # registry - one file per integrated game
  tests/                # checks on the repository itself, not on any package
  docs/architecture.md
```

Packages are created when they are implemented, not up front — the same restraint the game
contract gets. Two placements worth explaining: config lives in the core because it is pure
merge logic rather than I/O, and the fakes live in the core because the core is what defines
the ports. A separate `test-fakes` package was considered and dropped: it would add a build
cycle for no benefit while there is a single consumer.

Tests live beside the code they test, with one exception: `tests/` at the root holds checks
about the repository itself rather than about any package — see `tests/repo-consistency.test.ts`,
which verifies that `check` covers every CI step, that no test file falls outside every Vitest
config, and that no package is missing from the root `tsconfig` references.

`*.test.ts` is the fast suite and must stay free of I/O; `*.integration.test.ts` drives real
processes, windows and disk and runs separately.

## The pure core

Every decision is a pure function; I/O lives in thin adapters with no logic. This is what
makes strict TDD practical rather than theatre.

- **Grid math:** `(slot count, screen dimensions, layout) → positions/sizes`, exhaustively
  testable. Since the embedding rework the live wall layout is the **renderer's** — it measures
  the DOM viewports and sends per-screen rectangles over `screens:layout` — and `computeGrid` now
  only seeds a window's launch size ([ADR-0011](adr/0011-embed-spawned-chrome-into-the-shell.md)).
- **Slot state machine:** `stopped → starting → running → crashed → restarting`, with valid
  and invalid transitions.
- **Registry validation:** well/badly formed game definition, required fields, duplicate ids.
- **Config merge:** global defaults + per-slot overrides, including `mute` and `persistProfile`.
- **`userDataDir` path resolution** per slot — pure string work, no disk access.

Adapters get integration tests, never unit tests, and each sits behind a narrow interface
(`BrowserLauncher` with `launch/stop/isAlive`, `WindowManager`, `AudioController`, `Storage`,
`ProfileArchive`) with a fake for core tests. Auto-restart-on-crash is testable against the fake
without launching a browser.

That narrowness is what absorbed the Playwright→spawn switch without the core noticing. Keep
it that way.

## Game registry

The core knows the **minimum**: a small stable common layer. Differences between games live
in a free layer the core does not interpret.

```ts
const game: GameDefinition = {
  id: 'poke-idleworld',
  name: 'Poke IdleWorld',
  url: 'https://poke.idleworld.online/play',
  // viewport is optional and the shipped Poke definition omits it — nothing
  // consumes it, window size comes from computeGrid. Shown here only to name
  // the field.
}
```

`injectCss` and `actions` were in the original design and are **not in v1** — without CDP
there is no way to implement them. They return if the extension path is taken later.

**Keep the common layer tiny.** With one game the contract is a guess; promote a field only
when a second game proves the need. The `name` field is UI text, therefore Portuguese.

**Custom slot:** URL plus generic options only. No game-specific anything.

**Only `https:` URLs are accepted**, in the registry and in custom slots alike. This is a
security boundary, not a style rule: it keeps game sessions encrypted, and it keeps
`javascript:`, `file:` and `data:` out — each of which would turn a configuration field into
code execution or disk access. A custom slot is not a way around it.

**Security:** definitions ship only in the repository — same trust level as hardcoded, since
all code is versioned and reviewed. A user-supplied games folder is **rejected, not deferred**:
letting anyone drop in a `.js` file that runs against logged-in sessions would expose third
parties to arbitrary code execution. If that feature is ever wanted, the only acceptable form
is **declarative actions** (`{ selector, op: 'click' }`) interpreted by the core — data, not code.

## Data locations

Everything the app **persists** goes to `%APPDATA%/hecaton`, **always, including development**:

|                         |                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `config.json`           | global config and slot overrides, with `schemaVersion`                                  |
| `logs/`                 | rotated structured logs (one JSONL file per day)                                        |
| `profiles/slot-N`       | per-slot browser profile — the isolation mechanism                                      |
| `profiles/slot-N.old-*` | an archived profile from a removed slot (see ADR-0008)                                  |
| `shell/`                | Electron's own userData/cache, kept here rather than in the shared `%APPDATA%/Electron` |

Writing any of it into the repo directory would make `.gitignore` the only line of defense
against committing real state. Logs can carry page URLs with session tokens in query strings,
and a profile does not merely _risk_ holding credentials — it **is** the logged-in session.
An early draft of this document claimed profiles lived in `data/` inside the repository; that
was never decided and is now explicitly rejected. Same path in dev and prod also removes a
class of packaging bug.

**One kind of state deliberately lives elsewhere.** A clean-session slot
(`persistProfile: false`) gets a throwaway profile under the **OS temp directory**, deleted on
`stop()` — see [ADR-0005](adr/0005-never-delete-a-persistent-profile.md). Temp is the correct
home for discardable data: backup tools skip it and Windows reclaims it, neither of which is
true of `%APPDATA%`. Moving it under the app directory would put throwaway sessions into users'
backups and would need cleanup code to compensate. The consequence worth remembering is that
session data can exist in two places, so "where can cookies land on this machine?" has two
answers, and an orphaned throwaway profile survives an abrupt kill until Windows reclaims it.

Paths come from `@hecaton/storage` (`appDataDir`, `configFilePath`, `logsDir`,
`profilesDir`, `electronUserDataDir`) and are never assembled by hand.

Every persisted config file carries `schemaVersion` from the first commit, with a migration
step on load. Nearly free now; expensive to retrofit once users have saved files.

## Errors and logging

A long-running orchestrator with child processes fails silently by default. Actively fight it:

- Structured, rotated logs in `%APPDATA%/hecaton/logs` — one file per day, and **the newest 14
  kept**, pruned once at startup (decided 2026-08-09). Startup is the only safe moment: today's file
  is open for appends the rest of the time. Which names may go is `expiredLogFiles` in the core, and
  it returns only files the logger itself could have written — the panel opens this directory for
  the user, so anything at all can be sitting in it.
- Infrastructure errors (Chrome did not start, corrupt profile) surface on the slot's card,
  with the log reachable from the UI.
- A failing game action fails **visibly and by name**, never silently, and never takes the
  slot down.
- An error in one slot never affects another. (Verified in the spike: killing one slot left
  the others untouched.)
- **No URL survives into a log message, and that is enforced rather than advised.** Page URLs can
  carry session tokens in query strings, so `redactUrls` in `packages/core/src/log.ts` strips them
  and `formatLogRecord` applies it at the logger boundary — on the way in, not on the way out, so a
  redacted line is the only kind that can be written. `LogEntry` has no url field, and
  `formatLogRecord` rebuilds the record field by field, so one cannot be smuggled on.

  **The precise scope, because the looser version of this sentence is dangerous:** `redactUrls` is
  applied to `message` and to nothing else. What makes the other fields safe is their **type**, not
  where they come from — a distinction worth keeping, because `slotId` does come from the user's
  `config.json`. `level` and `event` are literals in the app's own code; `pid` comes from the
  launcher; `slotId` is read from config but forced through `requirePositiveInteger`, so no string
  can ride there. There are exactly two emitters: `Orchestrator.emit` for every lifecycle entry, and
  `apps/shell/src/main/main.ts` for one more, `config.error`, whose `message` is whatever
  `loadConfiguration` threw — usually the config parser's text, sometimes a filesystem error — and is
  redacted like any other. **`gameId` is safe by type too, since 2026-08-09**, and it is the field
  that shows why the distinction is worth stating: it used to accept any non-blank string, so a
  hand-edited `config.json` naming a URL there wrote that URL — query string and all — into a log
  line, and the following `slot.crash` showed the same URL redacted in `message` and in the clear in
  `gameId`. It is now held to the registry's own kebab-case rule at the config boundary
  (`requireGameId` in `parse-config.ts`, calling `isGameId` from `registry.ts` so there is one copy
  of the rule).

  Constraining it was chosen over redacting it: it is the smaller change, it keeps the invariant
  sayable in one sentence, and it fails at the moment the user can act — a named error on load rather
  than a slot that crashes later. The cost is that a config with a malformed `gameId` no longer
  loads at all, which is this file's rule for every other field.

  So the guarantee that holds is: the app's own inputs cannot put a URL in a log, and anything a URL
  could hide inside — `message` — is redacted. It is a tested control and it is what makes a log file
  safe to send to the author by hand, which is the whole diagnostic path now that the bug-report tool
  was cancelled. Two things would undo it quietly: adding a url field to `LogEntry`, and adding
  another free-string field on the assumption that everything beside `message` is safe by
  construction — which is exactly the assumption `gameId` had been quietly breaking. CLAUDE.md makes
  log contents a rule-2 trigger, so a new field on a log record is the owner's call, not a detail.

## Electron security (mandatory, because it is distributed)

The full posture, and why each part was chosen, is [ADR-0007](adr/0007-electron-security-posture.md);
the five decisions were taken together at the phase-1.5 security gate. In short:

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` in the renderer;
  communication only through `contextBridge` with a fixed set of named methods.
- **Enumerated IPC channels**, every payload validated in the main process by calling the core's
  pure validators — never trust the renderer, whose input arrives as `unknown`.
- **Restrictive CSP** (`default-src 'none'`, no `unsafe-inline`, `connect-src 'none'` so **the
  renderer** reaches nothing — not the app, which makes one main-process request; see the update
  check below), delivered by **header from the `file://` renderer**. The
  header is _merged_ with the headers `file://` already returns, never replaced — replacing drops
  the implicit `Content-Type` and fails the load. (A custom `app://` scheme was chosen first and
  reversed by measurement; see the ADR.)
- **All navigation and all permissions denied**: `will-navigate`/`will-redirect` prevented,
  `window.open` denied, and all three permission handlers deny. A game url opens in the user's
  Chrome, never inside Electron.
- **Single-instance lock**: a second launch quits and surfaces the existing panel, so two
  panels cannot orchestrate the same slots or race the config and profiles.
- **Electron's own userData/cache** is set under `%APPDATA%/hecaton/shell`, not the shared
  `%APPDATA%/Electron` — consistent with ADR-0004, and it removes a cache-contention error.

## Privacy

The app never stores passwords — logins live only inside the Chrome profile in `userDataDir`.
No profile data leaves the machine. No telemetry (if ever, explicit opt-in).

The app makes **exactly one** network request, and only when the user asks for it: the update check
above. It sends nothing but the request itself — no identifier, no version, no usage — and it is the
only line to cross the machine's edge in either direction.

## Phases

**Phase 0 — feasibility spike.** Done. Overturned the browser control decision; validated the
replacement. Code discarded, findings recorded above.

**Phase 1 — v1. Done**, all under TDD, core before adapters:

1. Monorepo + Vitest, validated by a trivial red→green test.
2. `core`: grid math · slot state machine · config merge · registry validation · mute policy.
3. Interfaces + fakes, with the orchestrator tested entirely against fakes, auto-restart included.
4. Real adapters (spawn, node-window-manager, disk) with integration tests.
5. Electron UI wiring it together · registry with Poke IdleWorld · custom slot · dynamic
   add/remove/edit of slots · profile archiving · structured logging. See
   [ADR-0007](adr/0007-electron-security-posture.md) for the security posture and
   [ADR-0008](adr/0008-archive-a-removed-slot-profile.md)/[ADR-0009](adr/0009-login-is-bound-to-the-tab.md)
   for the profile and session decisions.

**Phase 2 — playing comfort. Done.** Narrowed from the automation phase it was first sketched
as: the extension path, per-slot proxy and declarative actions were dropped, to return only if a
future need makes them worth it. What landed instead removes friction while playing — **clearing
a slot's cache** without ending its session, and making **audio follow the app's focus mode** so
the games outside focus fall silent ([ADR-0010](adr/0010-audio-follows-focus-without-a-dependency.md)),
a global toggle on by default.

### Resetting a slot profile — implemented by archiving

Removing a slot resets its profile, in the archive-by-renaming shape ADR-0005 recommended:
`removeSlot` renames `profiles/slot-N` to `profiles/slot-N.old-<timestamp>` after stopping the
browser, so the removed slot's session stops being used but stays recoverable, and no code path
deletes a live profile. **Clear archives** then permanently deletes the `.old-` archives — the
one deletion of a **persistent** session's data in the app (the browser adapter also deletes
throwaway clean-session profiles on `stop()`, but never a persistent one), guarded to touch only
archives and gated behind an in-app confirmation. See
[ADR-0008](adr/0008-archive-a-removed-slot-profile.md); the property that still holds is that no
live profile is ever deleted **by a lifecycle path** — only an archived one, and only by an
explicit user action. Deleting live profiles is possible in exactly one place, the panel action
described under Phase 3 below.

A separate **cache clear** frees disk without logging anyone out, and is distinct from the
session-discarding reset above: it deletes only a profile's cache sub-directories
(`Default/Cache`, `Default/Code Cache`, `GPUCache`), never `Cookies` or `Login Data`. It is
offered per slot and as a "clear every slot" action, both refused for a **running** slot —
Chrome holds its cache files open, so the guard lives in the orchestrator (`clearSlotCache`
skips nothing and throws; `clearAllCaches` skips the running slots), and the panel disabling
the per-slot button is only its UX echo. Routed through the orchestrator rather than the
archive adapter directly, since mapping a slot id to its profile directory is the core's job and
the id never carries a path. Because it discards no session, it needs no confirmation, unlike
**clear archives**. Two validated IPC channels back it: `profiles:clearSlotCache` (a slot id)
and `profiles:clearAllCaches` (no payload).

**Phase 2.5 — UI rework (embedded screens). Done.** The panel is a single-window "video wall"
(spec: [docs/design/design.md](design/design.md)) — a thin sidebar, up to four screen cards, an
in-app focus mode with thumbnails, fullscreen, per-screen rename/volume/reload, light/dark themes.
The full decision record and the spike measurements are [ADR-0011](adr/0011-embed-spawned-chrome-into-the-shell.md).
The load-bearing points:

- Chrome is spawned exactly as before (no CDP, per-slot `--user-data-dir`); its window is then
  **reparented into the panel** via Win32 `SetParent`. The Electron-webview alternative was
  rejected (sessions into Electron, no password manager, no per-screen volume).
- **Geometry is the renderer's**: it measures the DOM viewports and sends per-screen rectangles
  over the `screens:layout` channel; the core relays them and no longer tiles (the `grid:restore`
  channel is gone). The window-manager fits the **game** to the viewport and clips Chrome's
  `--app` title bar and frame away with `SetWindowRgn` — which also stops the user dragging a
  screen out of place.
- Modals and the volume popover render in a **second, always-on-top, transparent overlay window**,
  because a child Chrome window always paints over the panel's DOM. Both windows share the same
  locked-down `webPreferences`; the bundled Sora font and Poke favicon keep `connect-src 'none'`.
- The window-manager and audio adapters run **persistent PowerShell workers** (Win32 and WASAPI),
  disposed on quit; keyboard focus is forwarded on a `WM_PARENTNOTIFY` click hook; the launcher's
  shell-outs are async so they never freeze the main thread; a screen closes gracefully by a
  `WM_CLOSE` posted to the embedded child.
- **Disposal is bounded, and that is load-bearing.** `before-quit` defers the quit until both
  workers are disposed, so an unbounded wait there is not a slow shutdown but a permanent one:
  the app stays alive with its windows already hidden, holding the single-instance lock, and the
  next launch quits silently against it. Each worker gives its polite `exit` a deadline and kills
  the process either way. Found in the wild on 2026-08-09, and covered by an integration test per
  worker that drives a real PowerShell which prints READY and then ignores stdin forever.

Config gained additive per-slot fields (`name`, `volume`, `muted`, `backgroundThrottling`) and a
global `theme`, no schema bump. The IPC surface gained `slots:rename/setVolume/setMuted/reload`,
`ui:setTheme`, `screens:layout` and `overlay:open`/`overlay:close`.

**Phase 3 — distribution. Done, and released: `v0.1.0`, 2026-08-20.** `electron-builder` producing
a **portable zip** (an assisted NSIS installer was built and then dropped) · unsigned, with a
published SHA256 · Apache-2.0, public repository · releases built by GitHub Actions on a tag · a
user-initiated update check, which is the app's only network request · no telemetry, no accounts,
no monetization. The security review of the surfaces this phase created was done on 2026-08-09 and
its findings are below.

**There is an installed base now, and two decisions change character because of it.** Renaming
`APP_DIR_NAME` again is no longer free — [ADR-0012](adr/0012-hecaton-and-the-data-directory.md)
says outright that its "no migration code, ever" held only because nothing had shipped, and that
window is closed. And a defect that reaches a friend's machine can only be fixed by a release they
choose to install, since there is no forced update and no kill switch by design
([ADR-0014](adr/0014-the-apps-first-network-request.md)).

The published artifact was verified as a friend would: downloaded from the release page,
`sha256sum -c` against the published hash (OK), extracted, and found to carry `Hecaton.exe`,
`LICENSE.txt`, `NOTICE.txt` and `CHANGELOG.txt`, with the exe reporting `NotSigned` — which is the
decision rather than an accident.

The planning document that carried the phase was deleted when it landed, as it said it would be.
What survives is four ADRs — [0012](adr/0012-hecaton-and-the-data-directory.md) (the name and the
data directory), [0013](adr/0013-a-portable-unsigned-zip-under-apache-2.md) (the distribution
posture), [0014](adr/0014-the-apps-first-network-request.md) (the update check) and
[0015](adr/0015-what-the-app-deliberately-does-not-collect.md) (the three non-goals) — plus this
document. Each ADR carries the alternatives that were rejected, which is the part a commit message
would have lost.

### The update check — the app's only network request

Reached only when the user presses **Procurar atualizações** in Configurações. Nothing runs at
launch, on a timer, or in the background: an automatic check would carry the user's IP, version and
clock to a server without them asking, which is telemetry whatever it is called (D7/D8). There is no
enforcement and no remote kill switch — declining an update simply opens the version already
installed.

This reverses the premise of [ADR-0007](adr/0007-electron-security-posture.md) decision 4, and it
does **not** touch the renderer's CSP. `connect-src 'none'` stands exactly as it was, because the
request is a `fetch` in the main process where no CSP applies. Anyone reading the header as proof
the app is offline is reading it wrong, and anyone relaxing it to add a request is relaxing the
wrong thing.

`main.ts` holds two constants and no logic: the API address
(`api.github.com/repos/Shofnip/hecaton/releases/latest`) and the release page that
`shell.openExternal` receives. **No url is ever read out of the fetched document** — the core
validator does not carry one at all, which is a stronger guarantee than carrying one carefully.
`packages/core/src/update.ts` owns the rest: what a status code means, whether a tag is newer
(numerically, so `0.10.0` beats `0.9.0`), and a 4000-character cap with control characters stripped
on the notes. Markup is not filtered because the panel sets `textContent`.

Failure is an ordinary outcome, not an exception: offline, rate-limited, GitHub unavailable,
malformed and "nothing published yet" are all states the panel phrases. The last of those was the
live answer until **v0.1.0 was published on 2026-08-20**; since then the API answers `200` with
`tag_name: v0.1.0`, and the shipped parser was run against the real document — a machine on 0.1.0
gets `up-to-date`, one on 0.0.9 gets `update-available`. The request identifies itself as
`Hecaton` — measured to be _less_ than Electron's default User-Agent, which names the Windows
build, the Chromium version and the Electron version.

### The terms warning, on first run

The product's central capability — several accounts of one game side by side — is what most game
terms restrict, and the ban lands on the user rather than on the author (D3b). So the first launch
opens on a gate over the whole panel, sidebar included, carrying that warning and one button. It was
to appear in three places; the installer's licence page was the one that could not be skipped, and a
zip carries no README, so this is the only one left that a user cannot miss. The same text stays
reachable from Configurações afterwards.

The rule lives in `packages/core/src/terms.ts` — `TERMS_VERSION` and `needsTermsAcknowledgement` —
and the text, being UI, lives in the renderer in Portuguese. What is persisted is
`termsAcknowledged`, the **version** last acknowledged rather than a flag, so a materially changed
warning can be shown again; absent reads as 0, because absence means nobody was ever shown it. Main
sends the panel the answer, not the number: comparing versions is the core's rule.

Beside it, in Configurações → Seus dados, the app discloses what letting Chrome save a game password
buys and costs — restored there on 2026-08-08 after going missing in the UI rework
([ADR-0009](adr/0009-login-is-bound-to-the-tab.md), second Correction).

### Deleting everything, from the panel

Choosing the zip removed the only moment the app could ever ask "and your logins?": an uninstaller
runs, an extracted folder deleted in Explorer does not. So the settings modal carries a **Seus
dados** section — naming both places session data can land, `%APPDATA%/hecaton` and the OS temp
directory of a clean-session screen, with a button that opens the first — and, in the risk zone,
**Apagar todos os meus dados**. It is the only action in the app that deletes a live profile;
[ADR-0005](adr/0005-never-delete-a-persistent-profile.md)'s 2026-08-08 Correction records why it
exists and why the property that ADR protects is unharmed.

Two channels back it, both taking no payload for the same reason `logs:reveal` does not:
`data:reveal` and `data:deleteAll`. The rules are in the core and the I/O is not:
`requireEveryScreenStopped` refuses while any screen is anything but stopped, `planUserDataDeletion`
still checks the path ends in the app's own directory name, and `verifyUserDataDeletion` judges what
survived. The panel greying the button out while a screen is open is the UX echo of the first of
those, exactly as with cache clearing.

**The app cannot delete all of its own directory, and the design accounts for it rather than
hiding it.** Electron holds `%APPDATA%/hecaton/shell` — its own cache, which contains no game
session — open until the process exits, so `rmSync` removes config, logs and profiles and then
raises `EPERM`. Measured (probe P4), twice, including after the window was destroyed. The adapter
therefore reports what survived instead of throwing, the core tolerates exactly that one entry and
names any other as a failure, and the app **quits** once the deletion is done — staying open would
mean writing config.json straight back into the directory the user just emptied.

### The pre-release security review, 2026-08-09

It covered the surfaces this phase created, not the whole app, and it was run against the **built
artifact** wherever the question was about what ships. Recorded here because a review whose result
lives only in a session transcript is a review nobody can re-run.

What was checked and held: the app's main process contains **exactly one** `fetch`, at one call site,
reached only from `update:check`, with both urls as constants and no url read out of the response.
`shell.openExternal` has one call site and receives a constant. `deleteUserData` has one call site in
the whole product. `data:deleteAll`, `data:reveal`, `logs:reveal` and `terms:acknowledge` all reject
any payload, and **no argv branch has crept back into `main.ts`** — the comment saying why is still
there. The preload exposes a fixed set of named methods and no channel taken from the caller.
Nothing in the app reads a log file, and nothing sends one anywhere: the diagnostic path is a friend
attaching a file by hand, which is safe because redaction is at the logger boundary rather than in
any feature.

In the packaged zip (`electron-builder` 26.15.3, Electron 43.2.0, 339 asar entries): no `src/`, no
`*.test.ts`, no `core/src/testing/` fakes, no `spike/` — the exclusions
[ADR-0007](adr/0007-electron-security-posture.md) decision 2 rests on, verified in the artifact
because the source tree looked perfect on the build where they _were_ shipping. The packaged
`index.html` carries the identical CSP, the packaged main still uses `loadFile`, `LICENSE.txt` and
`NOTICE.txt` are present at the archive root, and `Hecaton.exe` reports `NotSigned`, which is the
decision and not an accident. The packaged app was launched with `APPDATA` redirected to a throwaway
directory — asserted, not assumed, before it ran — showed its window, wrote only inside that
directory, and exited on `WM_CLOSE` leaving no process and no orphaned worker behind.

Two things it found, both documentation rather than code, both fixed in the same commit: an
`architecture.md` bullet still said `connect-src 'none'` meant the app made no network request, four
lines above the section describing the request, and a test in `security.test.ts` was still **named**
"forbids the app from making network requests at all" while asserting something narrower and true.
Neither weakened a control; both are exactly the confusion ADR-0014 exists to prevent, arriving
within a day of the decision it describes.

## Verification

- The test suite is the primary check. `npm test` runs the core in seconds and stays green.
- **Isolation:** log two slots into different accounts of the same game; close and reopen;
  confirm sessions neither mix nor leak.
- **Wall and focus:** launch 4 slots, confirm they tile in the panel; enter and leave focus mode;
  resize the panel and confirm the screens re-tile live and stay clipped to their cards.
- **Crash:** kill a Chrome from Task Manager; confirm the panel notices and restarts.
- **Registry:** add a second fictitious game pointing elsewhere and confirm it shows up
  **without touching the core** — the real test of the contract.

### Checks no test performs, and the moment they belong to

Some obligations have no failing test to hold them, and each fails the same way — silently, between
versions. **They are tied to cutting a release** (decided 2026-08-09), because that is the cheapest
moment that already exists and an obligation with no moment attached is one nobody performs. The
list, and what to do about each, is [`docs/releasing.md`](releasing.md): raising the three exact
pins, and confirming Chrome has not started re-downloading its on-device model into every profile.

One of them stopped being a reminder and became a check: **`npm audit --omit=dev` runs in the
release job**, so an advisory reaching the **shipped** tree fails the build. Build-time advisories
stay accepted deliberately ([ADR-0013](adr/0013-a-portable-unsigned-zip-under-apache-2.md)). It is
in that job rather than in `npm run check` because `tests/repo-consistency.test.ts` requires `check`
to cover everything CI runs, `check` is offline today, and a registry outage must not turn into a
red local run — while the release job already needs the network.

### Open decisions left by Phase 3

All four were taken on 2026-08-09, so nothing is left open here: `gameId` in log lines and log
retention (both under _Errors and logging_), corrupt-config recovery and the release notes (both
below). The heading stays because the next phase will leave its own, and because a section that once
listed four open decisions and now lists none is worth seeing rather than deleting.

### What changed, shown once after updating

Decided 2026-08-09. The update check shows a changelog **before** updating, to help the user decide;
this is the other half, and the design was settled by a constraint rather than by taste. Notes for
the version **already running** could only come from a request at launch, and
[ADR-0014](adr/0014-the-apps-first-network-request.md) is precisely the decision that the app makes
no request the user did not ask for. So they come from a file.

`CHANGELOG.md` travels twice and the copies do different jobs: inside the asar, copied into `dist/`
by the build, which is what the app reads — one path, identical in development and in the package,
no `app.isPackaged` branch — and beside the exe as `CHANGELOG.txt`, readable without opening the app
at all, which matters for a zip that has no store page.

`changelogSection` in the core takes the body under the heading for the running version;
`needsReleaseNotes` says whether it is still owed. **Absent reads as unseen**, the same choice
`termsAcknowledged` makes and for the same reason: nobody running today carries
`releaseNotesShownFor`, so reading its absence as "already seen" would skip the notes for exactly
the release that introduces them. The cost is one dismissal on a fresh install.

A **modal, not a gate**: the terms warning precedes a decision the user is about to take, and this
precedes nothing — it is news. It waits until the terms gate is answered, and dismissing it is what
marks it read, so closing the app without opening it leaves the notes owed. `notes:acknowledge`
carries no payload for the reason `terms:acknowledge` does not: which version was on screen is
main's knowledge, since main is what read the file.

Missing file, unreadable file, or a version nobody wrote notes for are all the same ordinary answer
— nothing to show. That is what keeps the changelog optional rather than a file the app depends on.

### A config that cannot be read at all

Decided 2026-08-09. `JsonFileStorage.load` named the file and threw, which is good diagnostics and
left a friend with a truncated `config.json` no way out from inside the app. Now that file is
**renamed beside itself** — `config.bad-<timestamp>.json`, the name computed by `quarantineFileName`
in the core — and the app starts from defaults and says so in the panel.

Renamed, never deleted or overwritten: the bad file is the only copy of what the user had
configured, and anyone who can read JSON gets it back from there. The same posture as archiving a
removed slot's profile ([ADR-0008](adr/0008-archive-a-removed-slot-profile.md)). If that name is
somehow already taken the recovery refuses rather than clobbering, because the file already sitting
there is evidence too.

**Only a file that is not JSON at all.** A config that parses but carries a rejected setting still
stops the load and is left exactly as the user wrote it — setting the whole file aside over a typo
would throw away their intent along with the mistake, and one line is what they have to fix. The
distinction is carried by a type, `CorruptJsonError`, so it cannot be lost by a caller catching too
broadly.

Two consequences the panel states rather than leaving to be discovered: the screens are back to one,
and the terms warning appears again, because `termsAcknowledged` was in the file that went. Sessions
are untouched — the profiles are not in `config.json`.

## Open risks

- **Re-login after restart — confirmed, not mitigable, for the target game.** Measurement
  showed Poke IdleWorld binds its login to the browser tab (closing the tab logs out, even with
  the browser still open), so a restarted slot always returns to the login page: no profile
  persistence can preserve a session that lives in the tab, not on disk. Auto-restart brings the
  window back but a human must pass Turnstile and sign in again. See
  [ADR-0009](adr/0009-login-is-bound-to-the-tab.md). Persistent profiles stay the default not to
  avoid re-login (nothing can) but to make it faster — a persistent Cloudflare device-trust
  cookie and a password saved in Chrome survive, which a clean session loses every launch.
- **Chrome dependency.** The app now requires installed Chrome rather than shipping a browser.
  A Chrome update could change flag behaviour, as it already did with `--load-extension`.
  **Discovery searches three places since 2026-08-09**, in `chromeSearchPaths`: the two machine-wide
  directories (`C:\Program Files\...` and its `(x86)` sibling) and then
  `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`, which is where Chrome's installer puts
  itself for a user who cannot elevate. Only the first two were searched before, so that user — a
  common case, and the one thing that blocked handing the zip to anyone else — met "Chrome executable
  not found" with nowhere to point the app. Machine-wide keeps priority deliberately, so nobody the
  app already works for finds it launching a different browser. There is still **no way to name a
  path by hand**: `ChromeLauncher` takes an optional one and nothing passes it, so a Chrome installed
  somewhere else entirely is still not found.
- **Terms of service.** Anything injected runs in the user's logged-in session; a ban lands on
  them. Verify each integrated game's terms and be explicit in the UI/README.
- **Disk.** Persistent profiles accumulate cache, once per slot.
- **Isolation by mistake.** Make sure no directory or cache is ever shared between slots.
