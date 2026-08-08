# ADR-0004 — Everything the app writes goes to `%APPDATA%`, including in development

**Status:** Accepted · **Date:** 2026-07-21

## Context

The app writes three kinds of state: per-slot configuration, logs, and the browser profiles
that make slots independent. During development the convenient choice is a directory inside
the repository — everything visible in the editor, no hunting through `%APPDATA%` to inspect
state.

This is a security decision under the project's own rules (it touches session data and log
content), so it was raised rather than settled in passing.

Config and logs were decided first. **Profiles were decided separately and later**, and the gap
between the two is worth recording: for a stretch, `README.md`, `CLAUDE.md` and
`architecture.md` all asserted that profiles lived in `data/` inside the repository. Nothing had
decided that — it was inherited from the pre-implementation plan, and `ChromeLauncher` had
always taken the location as a parameter. Documentation had invented an answer, which is a
failure mode worth naming: it looked settled precisely because three files agreed.

## Decision

**`%APPDATA%/helloweb`, always — the same path in development and in production.**
[see Correction (2026-07-21)] [see Correction (2026-07-30)]

|                   |                                                            |
| ----------------- | ---------------------------------------------------------- |
| `config.json`     | global config and slot overrides, carrying `schemaVersion` |
| `logs/`           | rotated structured logs                                    |
| `profiles/slot-N` | per-slot browser profile — the isolation mechanism         |

Three reasons, in order of weight:

1. **A repo-relative directory makes `.gitignore` the only thing standing between real state and
   a public commit.** One missing pattern, one `git add -A`, and slot configuration or logs are
   in the history permanently. Writing outside the repository removes the failure mode instead
   of defending against it.
2. **Logs can carry secrets by accident.** Page URLs may contain session tokens in query
   strings, and a log line is the easiest way for one to end up somewhere it should not be.
3. **One path everywhere removes a class of packaging bug** — the kind that only appears in the
   installed build, where a dev-relative path no longer exists or is not writable.

For profiles the first reason is not a matter of degree but of kind. A log _might_ carry a
token by accident; a profile **is** the logged-in session — the cookies of a real account, for
a game whose re-login is gated behind an interactive Turnstile. The ways a working tree leaks
are ordinary and numerous: `git add -f`, a backup of the project folder, a zip sent to someone
for help, an editor plugin that indexes the directory. None of them is exotic, and each would
hand over an account rather than a hint of one.

Paths are resolved by `@helloweb/storage` — `appDataDir()`, `configFilePath()`, `logsDir()`,
`profilesDir()` — and never assembled by hand, so there is one place to audit.
[see Correction (2026-07-30)]

Every persisted config file carries `schemaVersion` from the first commit, with a migration step
on load: nearly free now, expensive to retrofit once users have saved files.

## Consequences

- Inspecting state during development means opening `%APPDATA%/helloweb` — mildly less
  convenient, and the intended trade. [see Correction (2026-07-30)]
- Logs are structured and rotated under `%APPDATA%/helloweb/logs`.
  [see Correction (2026-07-30)]
- The app never writes user state into the working tree, so a stray `git add -A` cannot leak it.
- `data/` stays in `.gitignore` anyway. It is no longer where anything is written, and the rule
  costs nothing — but a rule that defends a path nothing uses is not what makes this safe.
- Profiles surviving in a stable location is what lets a persistent slot keep its login across
  restarts, which matters more here than usual: see the audio discussion in
  [ADR-0003](0003-spawn-over-cdp.md), and auto-restart, which would otherwise need a human at
  every crash.

## Alternatives rejected

**Repo-relative directory in dev, `%APPDATA%` in production** — the convenient option, and the
one that produces two code paths, a dev-only leak vector, and bugs that only reproduce after
packaging.

**`%APPDATA%` with a dev override flag** — same risk as above, one flag away, with the extra
property that the unsafe mode is the one someone reaches for while debugging.

## Correction (2026-07-21)

"Always" above covers state the app **persists**. It is not literally everything the app writes.

A clean-session slot (`persistProfile: false`) gets a throwaway profile created under the **OS
temp directory**, not under `%APPDATA%/helloweb` — see `ChromeLauncher.launch` and
[ADR-0005](0005-never-delete-a-persistent-profile.md). That was true when this ADR was written
and the ADR did not say so. [see Correction (2026-07-30)]

The decision stands and the placement is deliberate, not an oversight: temp is the correct home
for discardable data, because backup tools skip it and Windows reclaims it, neither of which is
true of `%APPDATA%`. Moving throwaway profiles under the app directory would copy discardable
sessions into users' backups and require cleanup code to compensate.

What the omission cost is precision in the security reasoning this ADR exists to record: a
reader asking "where can session cookies land on this machine?" would get one answer from the
text and needs two. The property that does hold without exception is the narrower one — **the
app never writes state into the repository**.

Found by the documentation auditor (`/audit-docs`) on its first run. The body is left unchanged
per the convention in [README](README.md); only the inline `[see Correction (2026-07-21)]` marker was added.

## Correction (2026-07-30)

**The directory is `%APPDATA%/hecaton`, and the packages are `@hecaton/*`.** Every `helloweb` in
this file — the path in the Decision, `@helloweb/storage`, the two Consequences, and the mention
inside the 2026-07-21 Correction — reads a name that no longer exists anywhere in the code.

**This appeared when the code changed; it was not wrong when written.** `helloweb` was a scaffold
name from the first commit, and the product was named **Hecaton** during Phase 3 planning. The
rename landed in one mechanical commit, red-first in `packages/storage/src/app-paths.test.ts`.
Verify in `packages/storage/src/app-paths.ts` — `APP_DIR_NAME` is the single constant everything
hangs off, which is what made a one-line rename possible.

**The decision itself is untouched.** All persisted state still lives under `%APPDATA%`, in
development and production alike, for exactly the three reasons in the body, and the temp-directory
exception in the Correction above still holds. Only the directory's name changed.

One property of the rename is worth recording here, because it is invisible in the code and belongs
with this ADR rather than in a commit message: **no migration code was written, and none ever will
be.** The app looks only at `%APPDATA%/hecaton`; the old `%APPDATA%/helloweb` was left untouched for
the owner to move by hand, once, before the first release. An automatic first-run migration was
rejected as the friendly-looking, dangerous option — it would create a permanent code path that
moves live logged-in sessions, with partial-failure states, to solve a problem that existed for one
user on one day. That reasoning is the strongest reading of
[ADR-0005](0005-never-delete-a-persistent-profile.md), and it holds only because there was no
installed base at the time.
