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
session**, so no bug in the flag can either. [see Correction (2026-07-21)] [see Correction (2026-08-08)]

## Consequences

- Clean sessions cost nothing extra in practice — the profile was going to be discarded anyway,
  and Chrome does not care where it lives.
- If the app is killed before `stop()` runs, a throwaway directory is left in `%TEMP%`. That is
  the intended trade, and Windows reclaims it.
- **There is no way for a user to clear or reset a slot profile from the app.** [see Correction (2026-07-21)]
  Deliberate for
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

## Correction (2026-07-21)

Two absolute statements in this ADR are now narrower than written, because the phase-2 reset
feature this ADR deferred has been built — see [ADR-0008](0008-archive-a-removed-slot-profile.md).

- "**no code path in the app can delete a logged-in session**" — a _live_ profile still cannot
  be deleted (removal renames it aside; nothing deletes a `slot-N`). But `clearArchives`
  (`packages/browser-engine/src/profile-archive.ts`) permanently deletes _archived_ profiles,
  and an archived profile is a real logged-in session set aside. So the app now does have a
  deletion path — guarded to touch only `.old-` archives, reached only by an explicit, confirmed
  user action.
- "**There is no way for a user to clear or reset a slot profile from the app**" — removing a
  slot now archives (resets) its profile, and "Clear archives" clears them, both from the panel.

The property that still holds, in its true form: **no live profile is ever deleted; a removed
slot's archived session can be deleted only by an explicit, confirmed user action, never by a
flag, a crash, or a re-used id.** [see Correction (2026-08-08)] The core protection this ADR exists for — a wrong
`persistProfile` boolean cannot destroy a working session — is unchanged.

This ADR is **not superseded**: its decision holds and ADR-0008 implements the reset in exactly
the archive-by-renaming shape recommended below. The body is left as written per the convention
in [README](README.md); only the two `[see Correction]` markers were added. Found while writing
ADR-0008 after the audit.

## Correction (2026-08-08)

**A live persistent profile can now be deleted from the app**, so the statement above — "no live
profile is ever deleted" — is no longer true as written. The change is in the code, not in this
ADR's reasoning: it appeared when the panel gained a **"Apagar todos os meus dados"** action
(`data:deleteAll` in `apps/shell/src/main/main.ts`), which removes `%APPDATA%/hecaton` whole —
`profiles/slot-N` included.

**Why the decision this ADR records is still intact.** What it protects against is a _wrong
boolean_: a `persistProfile` flag that reads `false` and quietly destroys a working session. That
remains impossible — `stop()` still deletes only a directory it created under `tmpdir()`, and no
lifecycle path touches `profiles/slot-N`. What was added is a different thing entirely: a
destination the user has to navigate to, read a warning in, and confirm, whose entire purpose is
to delete their data.

**Why it exists at all**, because "we added a delete-everything button" deserves a reason rather
than a shrug: distribution moved from an NSIS installer to a portable zip on the same day. The
uninstaller had been the one place the question "and your logins?" could be asked, and deleting an
extracted folder asks nothing. Without this action the honest answer would have been "open
`%APPDATA%` and delete a directory by hand", which is worse in every respect — no warning, no
allowlist, no idea what is inside.

Four guards, and none of them is the dialog:

1. **Every screen must be stopped** (`requireEveryScreenStopped`). Chrome holds files open inside
   its profile, so a deletion attempted underneath a running browser removes part of the directory
   and then fails — the user told nothing worked, their logins already gone.
2. **No path crosses IPC.** The channel takes no payload; the directory comes from
   `appDataDir()`, and `planUserDataDeletion` still refuses anything that does not end in the
   app's own directory name.
3. **The result is checked, not the error.** The running app cannot delete Electron's own
   sub-directory, so `verifyUserDataDeletion` tolerates exactly that one survivor and reports any
   other by name.
4. **There is no command-line trigger, and there must never be one.** The `--delete-user-data`
   flag NSIS used was removed the same day for precisely the reason this ADR gives: with the
   installer gone, the confirmation had gone with it and the flag was a bare argument that wiped
   every logged-in profile. `main.ts` carries a comment saying so.

The property in its current true form: **no live profile is deleted by any lifecycle path, any
flag, any crash or any re-used id; the user can delete all of them at once, from one place in the
panel, having been told what it costs.** Found while implementing the panel action, not by an
audit.
