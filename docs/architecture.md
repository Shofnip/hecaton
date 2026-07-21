# Architecture

Living document. Started as the pre-implementation plan; updated with what the Phase 0 spike
actually proved. When a decision changes, change it here in the same commit.

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
2. **Real OS windows in a grid**, not a single panel of live thumbnails. CDP screencast with
   forwarded input was considered and dropped. With real side-by-side windows, "see all at
   once" and "interact without selecting" come for free — move the mouse and click.
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
11. GitHub + CI (typecheck, lint, tests on every push).

## Browser control: `spawn`, not CDP

This is the decision the Phase 0 spike overturned, and the most important one here.

The original plan was Playwright's `chromium.launchPersistentContext`. **It does not work for
the target game.** Its login page is protected by Cloudflare Turnstile, which rejects any
CDP-controlled browser. Four tests, isolating one variable at a time:

| Browser          | Profile              | CDP     | Turnstile  |
| ---------------- | -------------------- | ------- | ---------- |
| Installed Chrome | personal (incognito) | no      | passes     |
| Installed Chrome | fresh                | no      | **passes** |
| Installed Chrome | fresh                | **yes** | fails      |
| Bundled Chromium | fresh                | **yes** | fails      |

Not the IP, not a fresh profile, not the binary — the CDP connection itself.

**So the app spawns Chrome directly**, like a desktop shortcut would:

```
chrome.exe --user-data-dir=<per-slot dir> --no-first-run --no-default-browser-check
           --window-position=x,y --window-size=w,h --new-window <url>
```

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

Making audio follow focus would mean silencing per PID through the Windows audio session API —
another native module, deferred to phase 2. Writing the game's preference straight into the
profile's LevelDB was considered and rejected: undocumented format, and a bad write loses the
login rather than just the volume setting.

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
- **Extensions work, but cannot be auto-installed.** An MV3 extension injects CSS/JS and reads
  the game DOM fine, and Turnstile accepts it — but **Chrome 150 ignores `--load-extension`**;
  it only loads via manual "Load unpacked". For a distributed app that pushes HUD/actions
  toward the Web Store or browser policy, each with its own cost. Deferred, not dead.

## Structure

```
helloweb/
  apps/
    shell/              # Electron: main (orchestrator) + renderer (panel)
  packages/
    core/               # PURE CORE - grid, state machine, registry, config, orchestrator.
                        #   No I/O, enforced by ESLint rather than by convention.
                        #   src/testing/ holds the fakes; excluded from the build.
    browser-engine/     # process adapter: Chrome via spawn, PID resolution, liveness
    window-manager/     # node-window-manager adapter: applies positions computed by core
    storage/            # disk adapter: JSON files under %APPDATA%/helloweb
    games/              # registry - one folder per integrated game (not yet built)
  docs/architecture.md
```

Packages are created when they are implemented, not up front — the same restraint the game
contract gets. Two placements worth explaining: config lives in the core because it is pure
merge logic rather than I/O, and the fakes live in the core because the core is what defines
the ports. A separate `test-fakes` package was considered and dropped: it would add a build
cycle for no benefit while there is a single consumer.

Tests live beside the code they test. `*.test.ts` is the fast suite and must stay free of
I/O; `*.integration.test.ts` drives real processes, windows and disk and runs separately.

## The pure core

Every decision is a pure function; I/O lives in thin adapters with no logic. This is what
makes strict TDD practical rather than theatre.

- **Grid math:** `(slot count, screen dimensions, layout) → positions/sizes`. Exhaustively
  testable: 2 slots, 4, 5, ultrawide, multi-monitor.
- **Slot state machine:** `stopped → starting → running → crashed → restarting`, with valid
  and invalid transitions.
- **Registry validation:** well/badly formed game definition, required fields, duplicate ids.
- **Config merge:** global defaults + per-slot overrides, including `mute` and `persistProfile`.
- **`userDataDir` path resolution** per slot — pure string work, no disk access.

Adapters get integration tests, never unit tests, and each sits behind a narrow interface
(`BrowserLauncher` with `launch/stop/isAlive`, `WindowManager`, `Storage`) with a fake for
core tests. Auto-restart-on-crash is testable against the fake without launching a browser.

That narrowness is what absorbed the Playwright→spawn switch without the core noticing. Keep
it that way.

## Game registry

The core knows the **minimum**: a small stable common layer. Differences between games live
in a free layer the core does not interpret.

```ts
const game: GameDefinition = {
  id: 'poke-idleworld',
  name: 'Poke IdleWorld',
  url: 'https://poke.idleworld.online/',
  viewport: { width: 1280, height: 720 },
}
```

`injectCss` and `actions` were in the original design and are **not in v1** — without CDP
there is no way to implement them. They return if the extension path is taken later.

**Keep the common layer tiny.** With one game the contract is a guess; promote a field only
when a second game proves the need. A `label` is UI text, therefore Portuguese.

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

Config and logs go to `%APPDATA%/helloweb` **always, including development**. Writing to the
repo directory would make `.gitignore` the only line of defense against committing real state,
and logs can carry page URLs with session tokens in query strings. Same path in dev and prod
also removes a class of packaging bug.

Every persisted config file carries `schemaVersion` from the first commit, with a migration
step on load. Nearly free now; expensive to retrofit once users have saved files.

## Errors and logging

A long-running orchestrator with child processes fails silently by default. Actively fight it:

- Structured, rotated logs in `%APPDATA%/helloweb/logs`.
- Infrastructure errors (Chrome did not start, corrupt profile) surface on the slot's card,
  with the log reachable from the UI.
- A failing game action fails **visibly and by name**, never silently, and never takes the
  slot down.
- An error in one slot never affects another. (Verified in the spike: killing one slot left
  the others untouched.)
- Be careful what gets logged — page URLs can contain session tokens.

## Electron security (mandatory, because it is distributed)

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` in the renderer;
communication only through `contextBridge` with a minimal API; every IPC message validated in
the main process — never trust the renderer; restrictive CSP; block navigation and
`window.open` to destinations the panel does not expect.

## Privacy

The app never stores passwords — logins live only inside the Chrome profile in `userDataDir`.
No profile data leaves the machine. No telemetry (if ever, explicit opt-in).

## Phases

**Phase 0 — feasibility spike.** Done. Overturned the browser control decision; validated the
replacement. Code discarded, findings recorded above.

**Phase 1 — v1**, all under TDD, core before adapters:

1. Monorepo + Vitest, validated by a trivial red→green test.
2. `core`: grid math · slot state machine · config merge · registry validation · mute policy.
3. Interfaces + fakes, with the orchestrator tested entirely against fakes, auto-restart included.
4. Real adapters (spawn, node-window-manager, disk) with integration tests.
5. Electron UI wiring it together · registry with Poke IdleWorld · custom slot.

**Phase 2** — revisit automation with the extension path · per-slot proxy · possibly
declarative actions · **profile cache clearing and profile reset** (see below).

### Deferred: clearing and resetting a slot profile

The app currently has no way to clear a slot's profile, by design — no code path can delete
`profiles/slot-N`, so no bug can destroy a logged-in session. That leaves two real gaps,
both of them risks this document already lists:

- **Corrupt profile.** The panel reports it but offers no recovery; the user must delete the
  directory by hand. Poor for a distributed app.
- **Disk.** Persistent profiles accumulate cache, once per slot, with no way to reclaim it.

These are two different needs, and only one is dangerous. **Clearing the cache**
(`Default/Cache`, `Default/Code Cache`, `GPUCache`) frees disk without logging anyone out —
cookies and localStorage are untouched. **Resetting a profile** discards the session, and
recovering it means passing an interactive Turnstile again.

If reset is wanted, the shape that preserves the current guarantee is **archiving rather than
deleting**: rename `slot-N` to `slot-N.old-<timestamp>`. The app gets a fresh profile, the old
one stays on disk, a wrong click is undoable, and no deletion code enters the app.

Deferred deliberately: none of it blocks v1.

**Phase 3 — distribution** — `electron-builder` · Windows installer · code signing decision ·
auto-update · license · Electron security review before the first public release.

## Verification

- The test suite is the primary check. `npm test` runs the core in seconds and stays green.
- **Isolation:** log two slots into different accounts of the same game; close and reopen;
  confirm sessions neither mix nor leak.
- **Grid and focus:** launch 4 slots, confirm auto-placement, focus each by shortcut, restore.
- **Crash:** kill a Chrome from Task Manager; confirm the panel notices and restarts.
- **Registry:** add a second fictitious game pointing elsewhere and confirm it shows up
  **without touching the core** — the real test of the contract.

## Open risks

- **Re-login after restart.** Turnstile is interactive, so an auto-restarted slot may need a
  human. Persistent profiles keep the session cookie and mostly avoid this — a reason to
  default to persistent.
- **Chrome dependency.** The app now requires installed Chrome rather than shipping a browser.
  A Chrome update could change flag behaviour, as it already did with `--load-extension`.
- **Terms of service.** Anything injected runs in the user's logged-in session; a ban lands on
  them. Verify each integrated game's terms and be explicit in the UI/README.
- **Disk.** Persistent profiles accumulate cache, once per slot.
- **Isolation by mistake.** Make sure no directory or cache is ever shared between slots.
