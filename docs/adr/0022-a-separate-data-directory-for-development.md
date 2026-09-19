# ADR-0022 — A separate data directory for development

**Status:** Accepted · **Date:** 2026-09-18

Reverses one sentence of [ADR-0004](0004-appdata-over-repo-dir.md), repeated in `CLAUDE.md` and
`architecture.md`: that the app persists everything under `%APPDATA%/hecaton` **including in
development**. Everything else in ADR-0004 stands, and the reason that sentence existed is kept
rather than traded away.

## Context

ADR-0004 gave two reasons for one path in both environments. The first is about where data must not
go — never the repository directory, because a profile _is_ a logged-in session and `.gitignore`
would be the only thing between it and a stray `git add -f`. The second is narrower and is the one
at stake here: **one path in development and production kills a class of packaging bug**, the kind
where the app works from the source tree and writes somewhere else once packaged.

What it also did, unintentionally, was make it impossible to run a development build while the real
app was open: same config file, same profiles, same Electron cache. That was tolerable while the
app allowed one instance per machine anyway. [ADR-0021](0021-several-windows-one-account-each.md)
made several windows the point of the product, and testing accounts means opening windows — which
the owner cannot do without closing the app they actually use, whose screens are logged in.

## Decision

**The directory name comes from the environment, with the production name as the default.**
`appDirName()` in `@hecaton/storage` returns `hecaton` unless `HECATON_APP_DIR` names something
else; `npm start` sets it to `hecaton-dev`. Every path in the app — config, logs, profiles, the
panel caches, and the machine seal under `%ProgramData%` — is built from it, and so is the account
lock prefix, so a development window and a real one never contend for the same account.

**There is still no `app.isPackaged` branch, and that is the whole point.** A packaged app never
has the variable set, so it resolves the production name through the same line of code a
development run uses for the other one. The packaging bug ADR-0004 was guarding against needs two
code paths; there is still one.

**The variable names a directory, never a path.** `^[a-z0-9-]{1,32}$` and nothing else: anything
with a separator, a dot or a drive letter is ignored and the production name is used. Accepting a
path would turn a stray environment variable into "write the user's logged-in sessions anywhere",
which is the surface ADR-0007 refuses for IPC. An unusable value is ignored rather than rejected,
because this is read while resolving paths before the panel exists and a throw there is a window
that never opens.

## Consequences

- **A development run starts empty**, in `%APPDATA%/hecaton-dev`, and never migrates or touches the
  real data. First launch there behaves like a fresh install: one account, one screen, the terms
  gate.
- **It writes a second machine seal**, `C:\ProgramData\hecaton-dev\machine.json`. That follows from
  the name and is the safer half of the trade: a development run cannot brick the seal the real app
  depends on.
- **The two never share an account lock**, because the prefix carries the directory name. Without
  that, a development window would claim the account the real app was running — different profiles,
  same lock — and each would push the other onto accounts it did not want.
- **`npm start` is the only thing that sets the variable**, through `apps/shell/scripts/dev.mjs`
  rather than a `set X=… &&` line in `package.json`: that syntax is cmd.exe's, behaves differently
  under PowerShell, and has put a trailing space inside a value here before. `electron .` run by
  hand still uses the production directory, which is correct — it is not a development _run_, it is
  the packaged behaviour exercised from the source tree.
- **The old guarantee is weaker by exactly one step.** "Development writes where production writes"
  was a property you could check by reading one constant; now it is a property of an environment
  variable being unset, which a packaged app cannot set for itself but a confused shell could.
  `app-paths.test.ts` holds the default and the rejection rules.

## Alternatives rejected

**`app.isPackaged ? 'hecaton' : 'hecaton-dev'`.** The obvious one line, and it is the exact shape
ADR-0004 was written against: two code paths, one of which only ever runs where nobody is watching.

**Redirecting `APPDATA` for development**, which is what this project's own probes do. It works and
is what the throwaway test directories use, but it moves _everything_ Electron and Chromium write,
including paths this app does not own, and it has to be set by whoever launches — so it cannot be
the ordinary `npm start`.

**Leaving it as it was and closing the real app to test.** What the owner was doing, and the reason
this ADR exists: with accounts, testing means several windows, and the cost landed on the one person
who tests most.
