# Architecture Decision Records

`architecture.md` describes how the system works **now**. It is edited freely and always
reflects the present.

These files do the opposite job: each one records **one decision, the reasoning behind it, and
what was rejected** — and is then never edited. When a decision is replaced, the old file stays
and gains a `Superseded by` line at the top. Nothing is deleted, because the value is precisely
in the trail.

Why both: a document edited toward the present loses the past by construction. Six months from
now "why not Playwright?" has an answer only if that answer lives somewhere an edit will not
quietly tidy away. ADR-0003 exists because that already happened once.

## When to write one

Not for every decision — most belong in a commit message, and implementation detail belongs in
the code.

Write an ADR when the decision **reverses an earlier one**, or when **alternatives were
seriously weighed** and someone will later ask why the other one was not taken.

## Format

Numbered `NNNN-short-title.md`, sequential, never reused. Keep them short — a page at most.
Status is one of `Accepted`, `Superseded by ADR-NNNN`, or `Deprecated`.

English, like the rest of the repository. The app's UI is the only Portuguese surface.

## Index

| ADR                                               | Decision                          | Status   |
| ------------------------------------------------- | --------------------------------- | -------- |
| [0001](0001-electron-over-tauri.md)               | Electron for the shell            | Accepted |
| [0002](0002-real-windows-over-thumbnails.md)      | Real OS windows, not a video wall | Accepted |
| [0003](0003-spawn-over-cdp.md)                    | Spawn Chrome instead of using CDP | Accepted |
| [0004](0004-appdata-over-repo-dir.md)             | All app state in `%APPDATA%`      | Accepted |
| [0005](0005-never-delete-a-persistent-profile.md) | The app never deletes a profile   | Accepted |
| [0006](0006-games-ship-only-in-the-repository.md) | No user-supplied game definitions | Accepted |

Most of these are retroactive: the decisions were made before this directory existed, and are
recorded here because the reasoning was still recoverable. Later ones are written as the
decision is taken.

0005 and 0006 are the two most likely to be undone by someone acting reasonably. Both protect a
property that is invisible in the code — that no code path can delete a logged-in session, and
that the registry is not a plugin API — and in both cases the shorter, friendlier
implementation is the dangerous one.
