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

| ADR                                          | Decision                          | Status   |
| -------------------------------------------- | --------------------------------- | -------- |
| [0001](0001-electron-over-tauri.md)          | Electron for the shell            | Accepted |
| [0002](0002-real-windows-over-thumbnails.md) | Real OS windows, not a video wall | Accepted |
| [0003](0003-spawn-over-cdp.md)               | Spawn Chrome instead of using CDP | Accepted |
| [0004](0004-appdata-over-repo-dir.md)        | Config and logs in `%APPDATA%`    | Accepted |

The first four are retroactive: the decisions were made before this directory existed, and are
recorded here because the reasoning was still recoverable. Later ones are written as the
decision is taken.
