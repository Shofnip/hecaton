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
Status is one of `Accepted`, `Superseded by ADR-NNNN`, or `Deprecated` — or `Superseded in part by
ADR-NNNN` when a later decision reverses only part of one (ADR-0002 is the case: its presentation
half is superseded, its substance stands).

English, like the rest of the repository. The app's UI is the only Portuguese surface.

## Correcting a factual error

A decision that changes gets a new ADR and a `Superseded by` line. But an ADR can also simply
be **wrong about the code** — stating that a field exists when it does not, or describing
behaviour it never had. That is a bug, not a decision, and the two need different handling.

Immutability protects the reasoning and the rejected alternatives. It was never meant to
preserve a mistaken description, and leaving one in place misleads every future reader.

So, for a factual error in a committed ADR:

1. **Leave the body untouched.** Do not reword the mistaken sentence.
2. Append a `## Correction (YYYY-MM-DD)` section at the end, stating what was wrong, what is
   true, and where in the code to verify it. Say whether the error was there from the start or
   appeared when the code changed — they mean different things.
3. Add an inline `[see Correction]` marker next to the mistaken sentence, so a reader of the
   body is never misled by it.

Nothing else in the body changes, and the decision itself is not revisited — if the _decision_
turned out wrong, that is a new ADR, not a correction.

Only for factual errors. An ADR whose historical context has since changed is not wrong: it
records what was true when the decision was taken, which is the point of the format.

ADR-0003, ADR-0004, ADR-0005, ADR-0006, ADR-0007, ADR-0008, ADR-0009 and ADR-0010 carry corrections and show the shape. ADR-0004 and ADR-0006 carry
two each, which is what a dated `[see Correction (YYYY-MM-DD)]` marker is for: with more than one, an
undated marker no longer says which.

## Index

| ADR                                                      | Decision                                 | Status                                                                    |
| -------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| [0001](0001-electron-over-tauri.md)                      | Electron for the shell                   | Accepted                                                                  |
| [0002](0002-real-windows-over-thumbnails.md)             | Real OS windows, not a video wall        | Superseded in part by [0011](0011-embed-spawned-chrome-into-the-shell.md) |
| [0003](0003-spawn-over-cdp.md)                           | Spawn Chrome instead of using CDP        | Accepted (with Correction)                                                |
| [0004](0004-appdata-over-repo-dir.md)                    | All app state in `%APPDATA%`             | Accepted (with Correction)                                                |
| [0005](0005-never-delete-a-persistent-profile.md)        | The app never deletes a profile          | Accepted (with Correction)                                                |
| [0006](0006-games-ship-only-in-the-repository.md)        | No user-supplied game definitions        | Accepted (with Correction)                                                |
| [0007](0007-electron-security-posture.md)                | The Electron security posture            | Accepted (with Correction)                                                |
| [0008](0008-archive-a-removed-slot-profile.md)           | Archive a removed slot's profile         | Accepted (with Correction)                                                |
| [0009](0009-login-is-bound-to-the-tab.md)                | The game's login is bound to the tab     | Accepted (with Correction)                                                |
| [0010](0010-audio-follows-focus-without-a-dependency.md) | Audio follows focus via WASAPI shell-out | Accepted (with Correction)                                                |
| [0011](0011-embed-spawned-chrome-into-the-shell.md)      | Embed spawned Chrome into the shell      | Accepted                                                                  |

Most of these are retroactive: the decisions were made before this directory existed, and are
recorded here because the reasoning was still recoverable. Later ones are written as the
decision is taken.

0005 and 0006 are the two most likely to be undone by someone acting reasonably. Both protect a
property that is invisible in the code — that no code path deletes a _live_ logged-in session
(0005, now with the narrowing in its Correction and in 0008), and that the registry is not a
plugin API (0006) — and in both cases the shorter, friendlier implementation is the dangerous
one. 0009 is the other easily-undone one: it records that persistent profiles do **not** avoid
re-login for the target game, so "switch the default to clean sessions" reads reasonable and is
wrong.
