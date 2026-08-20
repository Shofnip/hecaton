# ADR-0012 — The product is Hecaton, and the data directory was renamed without a migration

**Status:** Accepted · **Date:** 2026-07-29

## Context

`helloweb` was a scaffold name from the first commit, and it reached further than a name usually
does: `APP_DIR_NAME` in `packages/storage/src/app-paths.ts` (and therefore `%APPDATA%/helloweb`,
where the **logged-in browser profiles** live), the `electron-builder` `appId` and `productName`,
the subject name on any code-signing certificate, and the host of an update feed. Phase 3 turns the
repository into something other people install, so choosing the name late is strictly more expensive
than choosing it first — which is why this was the phase's first decision.

Two questions hide inside one rename, with very different risk, and answering them as one is the
mistake this ADR exists to prevent. The **code-level** name (`@helloweb/*` across six workspace
packages, the root `package.json`, the repo) is a loud diff and no user-visible risk. The **data
directory** is one constant off which `config.json`, `logs/`, `profiles/slot-N` and the archived
`profiles/slot-N.old-*` all hang, and changing it changes where the app looks for real sessions.

## Decision

**The product is `Hecaton`**, short for the _Hecatoncheires_, the hundred-handed giants. The name
was reached by way of Argus, the hundred-eyed watchman, and the **hands** were preferred because
they describe the product more exactly: the differentiator is not that the user _watches_ every
session at once but that they can **act on any one without selecting it first**. It also avoids
Argus's one real weakness, a crowded trademark space in monitoring software.

**`APP_DIR_NAME` becomes `hecaton`, and no migration code is ever written.** The app looks only at
`%APPDATA%/hecaton`. `%APPDATA%/helloweb` is left exactly where it is, untouched, for the owner to
move by hand once — `docs/troubleshooting.md` carries that step, written as a **move** and never a
delete.

The fact that permits this: **the app had never been distributed.** No tag existed, so there was no
installed base to migrate — and that is only true until the first release, which is what made it the
moment to choose.

The property bought is worth stating in full, because it is invisible in the code: **no code path
in the shipped product moves, copies or deletes a directory of logged-in sessions.**
[see Correction (2026-08-20)] That is the
strongest available reading of [ADR-0005](0005-never-delete-a-persistent-profile.md).

**Everything at the code level was renamed at once**, in one mechanical commit before Phase 3 wrote
any real code: `@helloweb/*` → `@hecaton/*`, the root package name, the GitHub repository. The
packages are private and never published, so no npm namespace is claimed.

## Consequences

- [ADR-0004](0004-appdata-over-repo-dir.md) describes a path that no longer exists and carries a
  Correction of 2026-07-30 saying so; [ADR-0007](0007-electron-security-posture.md) carries the same
  one for `%APPDATA%/hecaton/shell`. Neither decision changed — only the name.
- `packages/storage/src/app-paths.test.ts` pins the directory name, and the rename was red there
  first.
- A user who ran the pre-rename build sees what looks like a fresh install until they perform the
  manual move. `docs/troubleshooting.md` leads with that symptom, because it is alarming and
  reversible.
- Apache-2.0's trademark clause protects the name only insofar as the project is entitled to use it.
  **A trademark check for `Hecaton` in software has not been done**; it no longer gates anything
  (nothing is signed, no domain is registered) but it is not the same as having been cleared.

## Alternatives rejected

**An automatic first-run migration.** This reads as the friendly option and is the dangerous one —
precisely the shape ADR-0005's README warns about. It would create, permanently, a code path that
moves live session data, with partial-failure states (Chrome running, file locked, permission
denied) that leave a split directory, and it would stay in the product forever to solve a problem
that existed for one day and one user.

**Freezing `helloweb` as the directory name.** The most conservative option for the data, and
rejected anyway: it leaves a product called Hecaton storing sessions under a name that appears
nowhere in it, which breaks the property CLAUDE.md requires — that "where can cookies land on this
machine?" has an answerable answer.

**Other names:** `Argus`, `Argus Arcade`, `Play Argus` (reads as though Argus were the game rather
than the orchestrator), `Panoptes` (the cleanest of the Argus family, but the `panopt-` root carries
the panopticon's surveillance connotation — wrong for an app whose privacy promise is that nothing
leaves the machine), `Heimdall`, `Lynceus`, `Ophanim`, `Hydra`, and the earlier non-mythic
shortlists (`Colmeia`/`Atalaia`/`Mosaico`/`Idlewall`, then `Watchwall`/`Playwall`/`Crowsnest`/
`Perch`).

## Correction (2026-08-20)

**The absolute above is broader than the property that actually holds**, in two ways, and a reader
starting from it would conclude the app structurally cannot destroy a logged-in game account.

- **"deletes"** stopped being true on 2026-08-08, when `data:deleteAll` gave the panel a confirmed
  "delete all my data" action — a portable zip has no uninstaller to ask the question in. It removes
  `%APPDATA%/hecaton` whole, and `profiles/slot-N` is inside it. Verify in
  `apps/shell/src/main/main.ts` (the `data:deleteAll` handler) and
  `packages/storage/src/delete-user-data.ts`.
- **"moves"** was over-broad from the start: `FileProfileArchive.archive` renames a live profile
  aside when a slot is removed, and that predates this ADR — it is [ADR-0008](0008-archive-a-removed-slot-profile.md),
  decided 2026-07-21. Verify in `packages/browser-engine/src/profile-archive.ts`.

The property that does hold is the one stated in ADR-0005's second Correction: no live profile is
deleted by any lifecycle path, any flag, any crash or any re-used id — the user can delete all of
them at once, from one place in the panel, having been told what it costs.

**The decision this ADR records is untouched.** No migration code exists, none is planned, and the
reasoning for that is unaffected. What is corrected is a supporting claim about a neighbouring
guarantee. `packages/core/src/ports.ts` already carries the narrowed wording, and this brings the
ADR into line with it.
