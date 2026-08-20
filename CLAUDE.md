# CLAUDE.md

Decisions that are invisible in the code and that future sessions must respect.
Full rationale lives in `docs/architecture.md` — read it before changing architecture.

**Recording new decisions.** `docs/architecture.md` always describes the present, so update it
in the same commit that changes behaviour. On top of that, write an ADR in `docs/adr/` when the
decision **reverses an earlier one** or when **alternatives were seriously weighed** — those
files are never edited, so the reasoning survives later cleanups of the main document. Most
decisions need neither: a commit message is enough.

## Non-negotiable rules

**1. Strict TDD.** No production code without a failing test first. Red-green-refactor,
every phase, no exceptions. If an `if` encoding a business rule shows up inside an adapter,
that rule belongs in the core.

Where each kind of test goes: pure logic in `packages/core` is tested directly, in the fast
suite. **Adapters are covered by `*.integration.test.ts` against the real thing** — real
Chrome, real windows, real disk — never by fakes, which would test the fake. The fakes exist
so the **core** can be tested without I/O, including auto-restart on crash.

**Never `--no-verify`, and never commit around a red test.** The pre-commit hook running
`npm run check` is what turns this rule from discipline into a guarantee; bypassing it removes
the guarantee and leaves only the discipline, which is what fails. If a hook blocks you, the
thing it caught is the work.

**Measure platform behaviour; never assert it from memory.** Electron, Chrome and Win32 behave in
version-dependent ways this project has been repeatedly wrong about, and every time the fix came
from a disposable probe rather than from reasoning: `--app=` instead of `--new-window` (tabs
accumulate otherwise), `CloseMainWindow` instead of `taskkill /F` (Chrome offers to restore pages
otherwise), a CSP header working over `file://` when an intermediate probe had "proved" it does
not, `--load-extension` silently ignored, `openExternal` firing no navigation handler, and
`rmSync` deleting most of a tree and _then_ throwing `EPERM`. Write the probe under `spike/`
(gitignored, never shipped) and carry the finding into the ADR or `architecture.md`; the code stays
out of git because the measurement, not the script, is what is durable.

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

**Stage explicit paths.** A `PreToolUse` hook (`.claude/hooks/block-blind-git-add.mjs`) refuses
`git add -A`, `git add .`, `git add -u` and `git commit -a`. It exists because a blind `-A` once
swept in files nobody had read and pushed them. No shell check can tell "reviewed" from "swept
up" — naming each path is what forces the list to be looked at. Read `git status --short` first,
then stage by name.

## Architecture boundaries

- **`packages/core` has no I/O.** No `fs`, no `child_process`, no network. Pure functions
  and state machines only. This is not a convention: ESLint fails the build on those
  imports. If a decision needs I/O, the decision stays in the core and the I/O moves to an
  adapter.
- **Adapters are thin and hold no business rules.** Each sits behind a narrow interface
  declared in `core/src/ports.ts` (`BrowserLauncher`, `WindowManager`, `AudioController`,
  `Storage`, `ProfileArchive`). Fakes for them live in `core/src/testing/`, excluded from the build so
  they never ship.
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
including the `name` field in game definitions, which is UI text.

## Data locations

Everything the app **persists** goes under `%APPDATA%/hecaton`, **including in development** —
config, logs, and the per-slot browser profiles under `profiles/`. Never the repo directory:
logs can contain page URLs with session tokens in query strings, and a profile _is_ a
logged-in session, so a single ignore-rule mistake would leak a real account. Same path in
dev and prod also kills a class of packaging bug.

**One exception, deliberate:** a clean-session slot (`persistProfile: false`) gets a throwaway
profile under the OS temp directory, deleted on `stop()` — see
[ADR-0005](docs/adr/0005-never-delete-a-persistent-profile.md). Temp is the right home for
discardable data: backup tools skip it and Windows reclaims it, neither of which is true of
`%APPDATA%`. So session data can exist in two places, and an audit of "where do cookies land"
must cover both.

Use `appDataDir()`, `configFilePath()`, `logsDir()`, `profilesDir()` and `electronUserDataDir()`
from `@hecaton/storage`. Never build these paths by hand. The last one is Electron's own cache,
kept under the app's directory rather than the shared `%APPDATA%/Electron`, and it is the single
entry allowed to survive the "delete all my data" action — the running process holds it open.

**Never run anything destructive against the real `%APPDATA%/hecaton`.** It holds the owner's
logged-in game accounts. Redirect `APPDATA` to a throwaway directory **and assert that
`appDataDir()` resolved inside it before acting** — the variable passes through several processes
(shell → npm → Electron → a PowerShell worker), and inferring that it survived is not the same as
knowing. The probes that exercised the delete path refuse to run when that assertion fails, which
is the shape to copy.

## Commands

```
node node_modules/electron/install.js   # after any npm install - see below
npm test                  # fast suite, no I/O - must be green at all times
npm run test:watch        # the same suite in watch mode, for the red-green loop
npm run typecheck         # tsc --build, plus tsconfig.test.json for test files
npm run lint              # eslint
npm run format:check      # prettier --check
npm run format            # prettier --write
npm run check             # the four above that CI runs: typecheck, lint, format:check, test
npm run test:integration  # real Chrome/windows/disk, Windows only, manual, not in check
```

The husky `pre-commit` hook runs `lint-staged` and then `npm run check`, so a commit that
passes locally passes CI.

`tests/repo-consistency.test.ts` checks the verification machinery itself: that `check` runs
everything CI runs, that no `*.test.ts` falls outside every Vitest config, that no package is
missing from the root `tsconfig` references, and that no workspace escapes the test type-check. Each of those failed silently here at least
once — a green signal that covered less than it appeared to. If you add a CI step, a package,
or a test directory, these will tell you what else needs updating.

`npm install` does **not** fetch the Electron binary. Electron ships no install script — it exposes
the downloader as a bin — so `node_modules/electron/dist/` stays empty and the app fails to start
with `Electron failed to install correctly`. Run `node node_modules/electron/install.js` after any
install that touched it. This is the step most often missed on a fresh clone.

Native modules (`node-window-manager` and its transitive `extract-file-icon`) need
explicit `allowScripts` entries in the root `package.json`. Approving the parent does
not cover the transitive one, and the install succeeds either way — it only fails at
runtime, so it is easy to miss.

## Definition of done

Test was red before the implementation · core still has no I/O · no adapter gained a
business rule · `tsc` clean · suite green · docs updated if a decision changed.
