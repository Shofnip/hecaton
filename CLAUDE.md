# CLAUDE.md

Decisions that are invisible in the code and that future sessions must respect.
Full rationale lives in `docs/architecture.md` — read it before changing architecture.

## Non-negotiable rules

**1. Strict TDD.** No production code without a failing test first. Red-green-refactor,
every phase, no exceptions. Pure logic goes in `packages/core` and is tested directly;
I/O goes in thin adapters tested through fakes. If an `if` encoding a business rule shows
up inside an adapter, that rule belongs in the core.

**2. Security decisions stop the work.** On hitting any trigger below, stop and present
options as _what it protects · what it exposes · implementation cost · reversibility_,
with an explicit recommendation and a note on which option is the most conservative.
Never pick the safest option and move on — the project owner decides.

Triggers: session data / `userDataDir` / cookies · external code execution · Electron
security config (`webPreferences`, CSP, navigation allowlist) · IPC surface · network
requests the app itself makes · Chromium flags that weaken protections · filesystem access
outside the app's own data dir · credentials · injection scope on game pages · npm
dependencies · packaging and distribution · log contents.

Two principles that need no asking: never weaken an existing control to unblock a problem,
and the app never stores passwords.

**3. `.gitignore` before the first `git add`.** In place, covering `data/`, signing certs,
tokens and screenshot output.

## Architecture boundaries

- **`packages/core` has no I/O.** No `fs`, no `child_process`, no network. Pure functions
  and state machines only. This is not a convention: ESLint fails the build on those
  imports. If a decision needs I/O, the decision stays in the core and the I/O moves to an
  adapter.
- **Adapters are thin and hold no business rules.** Each sits behind a narrow interface
  declared in `core/src/ports.ts` (`BrowserLauncher`, `WindowManager`, `Storage`). Fakes for
  them live in `core/src/testing/`, excluded from the build so they never ship.
- **Keep the game registry contract tiny.** The core knows `{id, name, url, viewport}` and
  nothing else. URLs are **https only**, in the registry and in custom slots alike. Do not
  grow the shared layer speculatively — with one game, any bigger schema is a guess. Promote
  a field only when a second game proves the need.

## Browser control: no CDP

The target game (Poke IdleWorld) rejects CDP-controlled browsers — its Cloudflare Turnstile
fails for Playwright regardless of binary or profile. **Chrome is launched with `spawn` and
`--user-data-dir` per slot, never through Playwright.** Verified in the Phase 0 spike.

Consequences: identify windows by **PID, never by title** (a title filter grabs the user's
own browser windows); the PID `spawn` returns is a launcher stub, not the browser process;
resolve the real PID once at launch and check liveness with `process.kill(pid, 0)` rather
than polling WMI. Anti-detection is out of scope — the app is distributed, and a ban would
land on the end user.

## Language

Code, filenames, comments, commits and docs in **English**. **App UI in Portuguese** —
including `label` fields in game definitions, which are UI text.

## Data locations

Everything the app writes goes under `%APPDATA%/helloweb`, **including in development** —
config, logs, and the per-slot browser profiles under `profiles/`. Never the repo directory:
logs can contain page URLs with session tokens in query strings, and a profile _is_ a
logged-in session, so a single ignore-rule mistake would leak a real account. Same path in
dev and prod also kills a class of packaging bug.

Use `appDataDir()`, `configFilePath()`, `logsDir()` and `profilesDir()` from
`@helloweb/storage`. Never build these paths by hand.

## Commands

```
npm test                  # fast suite, no I/O - must be green at all times
npm run typecheck         # tsc --build, plus tsconfig.test.json for test files
npm run lint              # eslint
npm run check             # all three, what CI runs
npm run test:integration  # real Chrome/windows/disk, Windows only, not in check
```

Native modules (`node-window-manager` and its transitive `extract-file-icon`) need
explicit `allowScripts` entries in the root `package.json`. Approving the parent does
not cover the transitive one, and the install succeeds either way — it only fails at
runtime, so it is easy to miss.

## Definition of done

Test was red before the implementation · core still has no I/O · no adapter gained a
business rule · `tsc` clean · suite green · docs updated if a decision changed.
