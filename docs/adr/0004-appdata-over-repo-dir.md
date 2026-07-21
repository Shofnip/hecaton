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

Every persisted config file carries `schemaVersion` from the first commit, with a migration step
on load: nearly free now, expensive to retrofit once users have saved files.

## Consequences

- Inspecting state during development means opening `%APPDATA%/helloweb` — mildly less
  convenient, and the intended trade.
- Logs are structured and rotated under `%APPDATA%/helloweb/logs`.
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
