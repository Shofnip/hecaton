# ADR-0008 — A removed slot's profile is archived, and archives can be cleared

**Status:** Accepted · **Date:** 2026-07-21

## Context

[ADR-0005](0005-never-delete-a-persistent-profile.md) deferred a slot reset/clear feature to a
later phase and recorded the shape it should take if built: **archive by renaming**
(`slot-N` → `slot-N.old-<timestamp>`) rather than delete, so that no code path in the app
deletes a live profile. Phase 1.5's panel added add/remove/edit of slots, which made removal a
real, frequent action and brought that deferred feature forward.

Removing a slot now needs to reset it — the user's intent is that the removed slot's cache,
cookies and saved passwords stop being used. And accumulated archives need a way to be reclaimed.
The second half is where deletion enters the app, so it was decided by the project owner rather
than settled in passing.

## Decision

**Removing a slot archives its profile by renaming, exactly the shape ADR-0005 recommended.**
`removeSlot` stops the browser, then `ProfileArchive.archive` renames `profiles/slot-N` to
`profiles/slot-N.old-<timestamp>` (`packages/browser-engine/src/profile-archive.ts`). The rename
happens after the stop so it does not race an open profile, and retries on `EPERM` because
Chrome holds handles briefly after exit. A slot removed before it ever launched has nothing to
archive, and that is a no-op.

**`clearArchives` permanently deletes archived profiles, and only those.** It is the one deletion
of session data in the whole app. It is guarded to touch only directories carrying the `.old-`
marker; a live `slot-N`, whatever it is named, never carries the marker and is never a candidate.
It is reached from the panel through the `profiles:clearArchives` IPC channel, behind an in-app
confirmation that states the deletion cannot be undone.

**The property, in its now-true and narrower form:** _no live profile is ever deleted; a removed
slot's archived session can be deleted only by an explicit, confirmed user action — never by a
flag, a crash, or a re-used id._ The load-bearing guarantee of ADR-0005 — that a wrong
`persistProfile` boolean cannot destroy a working session — is unchanged, because that path
still only renames.

Because a slot's id is its profile directory name, and removal archives that profile, a slot
re-added with a re-used id gets a **fresh** profile, not the removed slot's session — which the
earlier "re-add reuses the profile" reasoning no longer describes.

## Consequences

- The user gets the full path they asked for: reset a slot now (archive), erase the leftovers
  when sure (clear), with no delete ever standing between a working app and a live session.
- Archives accumulate under `profiles/` until cleared. Removal is user-initiated and rare, so
  they grow slowly; `clearArchives` is the reclaim.
- Recovering an archived session means renaming its `.old-` directory back by hand before it is
  cleared. After a clear it is gone, and re-login means passing an interactive Turnstile again.
- The confirmation for removal lives in the renderer (an in-app modal), not the main process.
  That is sound because the confirmation is UX, not the safeguard: removal archives rather than
  deletes, so a confirmation a buggy renderer skipped costs an archived, recoverable session at
  worst. The one real deletion — `clearArchives` — is still gated by its own confirmation and by
  the `.old-` guard.

## Alternatives rejected

- **Delete the profile on removal** — truly erases and frees disk immediately, but reintroduces
  the delete-a-live-profile code path ADR-0005 removed, so a bug in the id or the flag could then
  destroy the wrong session on a distributed user's machine. Archiving reaches the same
  user-visible result (the slot is reset) without that path.
- **Never reclaim archives** — leaves discarded sessions on disk forever. `clearArchives` exists
  precisely so the user can erase them deliberately, which is a different act from removing a
  slot and is gated separately.

## Relationship to ADR-0005

This does not supersede ADR-0005; it implements the phase-2 reset feature ADR-0005 deferred, in
the archive-by-renaming shape ADR-0005 recommended, and adds the deliberate `clearArchives`
deletion on top. ADR-0005 stays Accepted; its absolute wording ("no code path can delete a
logged-in session", "no way for a user to reset a profile from the app") is now narrower and
carries a Correction pointing here.
