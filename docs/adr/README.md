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

English, like every ADR. Elsewhere in the repository the Portuguese surfaces are the app's UI and
the two documents that are UI text: `docs/design/design.md` and `CHANGELOG.md`.

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

ADR-0002, ADR-0003, ADR-0004, ADR-0005, ADR-0006, ADR-0007, ADR-0008, ADR-0009, ADR-0010, ADR-0011, ADR-0012, ADR-0013, ADR-0014, ADR-0015, ADR-0018, ADR-0021 and ADR-0022 carry corrections and show the shape. ADR-0003, ADR-0004, ADR-0005, ADR-0006, ADR-0007, ADR-0008, ADR-0009, ADR-0011, ADR-0013, ADR-0014, ADR-0018 and ADR-0021 carry
two or more each, which is what a dated `[see Correction (YYYY-MM-DD)]` marker is for: with more than one, an
undated marker no longer says which.

## Index

| ADR                                                        | Decision                                      | Status                                                                                                     |
| ---------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [0001](0001-electron-over-tauri.md)                        | Electron for the shell                        | Accepted                                                                                                   |
| [0002](0002-real-windows-over-thumbnails.md)               | Real OS windows, not a screencast             | Superseded in part by ADR-0011 · w/ Correction                                                             |
| [0003](0003-spawn-over-cdp.md)                             | Spawn Chrome instead of using CDP             | Superseded in part by [0016](0016-ship-our-own-chromium.md) · w/ Corrections                               |
| [0004](0004-appdata-over-repo-dir.md)                      | All app state in `%APPDATA%` (one file aside) | Superseded in part by ADR-0018 · w/ Corrections                                                            |
| [0005](0005-never-delete-a-persistent-profile.md)          | The app never deletes a profile               | Accepted · w/ Corrections                                                                                  |
| [0006](0006-games-ship-only-in-the-repository.md)          | No user-supplied game definitions             | Accepted · w/ Corrections                                                                                  |
| [0007](0007-electron-security-posture.md)                  | The Electron security posture                 | Superseded in part by [0014](0014-the-apps-first-network-request.md) · w/ Corrections                      |
| [0008](0008-archive-a-removed-slot-profile.md)             | Archive a removed slot's profile              | Accepted · w/ Corrections                                                                                  |
| [0009](0009-login-is-bound-to-the-tab.md)                  | The game's login is bound to the tab          | Accepted · w/ Corrections                                                                                  |
| [0010](0010-audio-follows-focus-without-a-dependency.md)   | Audio follows focus via WASAPI shell-out      | Accepted (with Correction)                                                                                 |
| [0011](0011-embed-spawned-chrome-into-the-shell.md)        | Embed spawned Chrome into the shell           | Accepted · w/ Corrections                                                                                  |
| [0012](0012-hecaton-and-the-data-directory.md)             | The product is Hecaton; no migration          | Its "no migration" half reversed by [0021](0021-several-windows-one-account-each.md) · w/ Correction       |
| [0013](0013-a-portable-unsigned-zip-under-apache-2.md)     | A portable, unsigned zip under Apache-2.0     | Accepted, its format restored by [0020](0020-a-zip-the-user-extracts-not-an-installer.md) · w/ Corrections |
| [0014](0014-the-apps-first-network-request.md)             | The app's first network request               | Superseded in part by [0023](0023-an-update-check-at-launch.md) · w/ Corrections                           |
| [0015](0015-what-the-app-deliberately-does-not-collect.md) | No metrics, no accounts, no monetization      | Superseded in part by ADR-0018 · w/ Correction                                                             |
| [0016](0016-ship-our-own-chromium.md)                      | The app ships its own Chromium                | Accepted                                                                                                   |
| [0017](0017-repaint-an-embedded-screen.md)                 | Reload an embedded screen before showing it   | Accepted                                                                                                   |
| [0018](0018-one-instance-per-machine.md)                   | One instance per machine, bound to hardware   | Superseded in part by [0021](0021-several-windows-one-account-each.md) · w/ Corrections                    |
| [0019](0019-an-assisted-installer-for-a-792-mb-app.md)     | An assisted installer for a 792 MB app        | Superseded by [0020](0020-a-zip-the-user-extracts-not-an-installer.md)                                     |
| [0020](0020-a-zip-the-user-extracts-not-an-installer.md)   | A zip the user extracts, not an installer     | Accepted                                                                                                   |
| [0021](0021-several-windows-one-account-each.md)           | Several windows, one account each             | Accepted · w/ Corrections                                                                                  |
| [0022](0022-a-separate-data-directory-for-development.md)  | A separate data directory for development     | Accepted · w/ Correction                                                                                   |
| [0023](0023-an-update-check-at-launch.md)                  | An update check at launch, asked once         | Accepted, superseding part of [0014](0014-the-apps-first-network-request.md)                               |
| [0024](0024-what-each-version-number-means.md)             | What each version number means                | Accepted                                                                                                   |
| [0026](0026-page-zoom-over-launch-scale.md)                | Page zoom over launch-time device scale       | Accepted; automatic card/focus policy implemented with 0027 and 0028                                       |

Following ADR-0026:

- [0027](0027-card-derived-zoom-and-full-scale-focus.md) — card-derived zoom,
  100% in focus, no config field initially (Accepted).
- [0028](0028-read-only-default-zoom-preference.md) — restricted read-only access
  to the profile's default zoom preference (Accepted).
- [0031](0031-a-zoom-slider-and-no-zoom-bubble.md) — a per-screen zoom slider,
  persisted, holding in focus and fullscreen too; and Chrome's zoom bubble
  suppressed by a bounded blank-title sweep. Reverses 0027's "no configuration
  field" and its "focus is always 100%", for a screen whose slider has been
  moved — and only for that screen (Accepted).

Input recovery: [0029](0029-restore-embedded-stacking-on-reactivation.md) restores
native embedded stacking on panel reactivation, independently of geometry and
without changing FocusChild (Accepted).

Reordering: [0030](0030-reordering-the-wall-by-dragging-a-card.md) makes the wall's
order the order of the `slots` array, dragged by a card's head, over one channel
carrying `{id, toIndex}` — and never by renumbering, since a screen's id is its
profile directory (Accepted).

Sidebar: [0032](0032-keep-sidebar-arrangement-session-only.md) keeps the three
reorderable actions and the collapsed/expanded choice in renderer memory for the
current launch only; focus mode hides the entire bar and restores that session state
when focus ends (Accepted).

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

Phase 3 added two more of the same kind. 0012's "no migration code, ever" is the friendly-looking
feature a future session would write in an afternoon, and writing it would create a permanent code
path that moves live logged-in sessions. 0014's "only when the user asks" lasted until
2026-09-18, when the owner weighed it against the discoverability cost the ADR had written down
itself and took the launch check ([0023](0023-an-update-check-at-launch.md)) — the one thing left
guarding that line is that the check still happens **once, at launch**, and a `setInterval` away
from it is the timer both ADRs refuse.

0018 belongs to that family too, from the other direction: it is the one a future session is most
likely to think it should _strengthen_. Every layer in it has a measured ceiling written into the
ADR, and the obvious improvements have all been tried — `HypervisorPresent` refuses the owner's own
physical desktop, a custom DACL on the mutex is worse than the default and does not work, and a
lock file needs a stale-lock rule that is itself the hole. It also carries the project's single
exception to "the app stores no identifier", which is the sentence in ADR-0015 someone will
eventually quote as still absolute.

0016 is the newest of that family, and in two ways. Its "no fallback to an installed Chrome" reads
as an unkindness a future session would fix in ten minutes, and fixing it destroys the one property
that matters when the game's Turnstile rejects a browser: knowing which browser ran. And its
consequence — that the browser holding every logged-in session now moves only when somebody cuts a
release — is invisible in the code and is the largest standing security obligation in the project.
