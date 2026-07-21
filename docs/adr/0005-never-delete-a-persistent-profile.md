# ADR-0005 — The app never deletes a persistent profile

**Status:** Accepted · **Date:** 2026-07-21

## Context

A slot can be configured as persistent (keep the session) or clean (start logged out every
time). Clean sessions are the reason this decision exists: implementing them the obvious way
means deleting the slot's profile directory when the slot stops.

That obvious way puts a recursive delete of `profiles/slot-N` into the codebase. From then on,
the distance between a working app and a destroyed account is one wrong boolean — a bug in the
`persistProfile` flag, a corrupted config file that reads as `false`, a refactor that swaps two
branches. And "destroyed account" is not hyperbole for this app: recovering a session means
passing an interactive Cloudflare Turnstile again, by hand, per slot.

The asymmetry is what settles it. A persistent profile deleted by accident cannot be recovered
by the app, by the user, or by a backup nobody made.

## Decision

**A clean session gets a throwaway directory created under the OS temp directory, and that
directory is the only thing `stop()` ever deletes.** `profiles/slot-N` is never the target of
removal code.

Guarded twice, because deleting profile data is the most destructive thing this app can do:

1. Only paths the adapter itself created as ephemeral are tracked for deletion.
2. Before deleting, the path must still sit under `tmpdir()` and not be `tmpdir()` itself.

The result is a property, not a promise: **no code path in the app can delete a logged-in
session**, so no bug in the flag can either.

## Consequences

- Clean sessions cost nothing extra in practice — the profile was going to be discarded anyway,
  and Chrome does not care where it lives.
- If the app is killed before `stop()` runs, a throwaway directory is left in `%TEMP%`. That is
  the intended trade, and Windows reclaims it.
- **There is no way for a user to clear or reset a slot profile from the app.** Deliberate for
  v1, but it leaves two real gaps — a corrupt profile has no in-app recovery, and per-slot cache
  cannot be reclaimed. Deferred to phase 2, with the recommended shape recorded in
  `architecture.md`: clearing the _cache_ frees disk without logging anyone out, and a reset
  should **archive by renaming** to `slot-N.old-<timestamp>` rather than delete, which preserves
  the property this ADR establishes.
- A future contributor reading `chrome-launcher.ts` will find `mkdtemp` where a plain
  `rmSync(profilePath)` would be shorter. That asymmetry is the point of this file.

## Alternatives rejected

**Delete `profiles/slot-N` when the slot is not persistent** — the direct implementation, and
the one that creates the failure mode above. Confirmation dialogs and "only when stopped"
guards reduce the odds of a wrong click; they do nothing about a wrong boolean.

**Move the profile to the Windows Recycle Bin** — reversible, which is genuinely better than
deleting. Rejected for two reasons: it needs a new dependency or shell interop, and it leaves
session cookies sitting in the Recycle Bin, a place nobody thinks to empty. Recoverable by the
user also means recoverable by whoever else uses the machine.

**Archive by renaming instead of deleting** — the strongest option, and the one recommended for
the phase-2 reset feature. Not used for clean sessions because they run on every launch: the
disk would fill with `slot-N.old-*` directories, each holding a session.
