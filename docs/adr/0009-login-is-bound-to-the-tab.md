# ADR-0009 — The target game binds its login to the tab, so a restart always re-logs in

**Status:** Accepted · **Date:** 2026-07-21

## Context

Several earlier decisions leaned on an assumption: that a **persistent profile keeps the login**,
so an auto-restarted or reopened slot comes back signed in. ADR-0003's audio discussion, ADR-0004,
ADR-0005 and the `persistProfile: true` default all rest on it, and `architecture.md`'s "Open
risks" stated it outright — "persistent profiles keep the session cookie and mostly avoid" the
interactive re-login.

Phase 1.5's manual verification tested that assumption against the live game, and it did not
survive.

## The measurement

Logging into Poke IdleWorld, then closing and reopening the slot, returned to `/login`. The
decisive test was narrower: **closing just the tab** — with the browser still open — and
reopening `/play` also returned to `/login`, as did opening `/play` in a fresh tab. That rules
out a cookie and `localStorage`, both of which survive a tab close in a running browser. The
authentication is bound to the **tab**: `sessionStorage`, or in-memory SPA state, which is gone
the moment the tab closes. It lives nowhere in the profile, so no amount of profile persistence
can preserve it. The same behaviour reproduced in an ordinary browser, so it is the game's
design, not an artifact of this app.

## Decision

**Treat re-login after any restart as inherent to this game, and record why the profile-keeps-
the-login assumption is false — so it is not re-assumed.**

- **`persistProfile: true` stays the default, for a different reason than was written.** It no
  longer "avoids re-login," because nothing can. It stays default because a persistent profile
  keeps whatever _can_ be kept — a Cloudflare device-trust cookie (`cf_clearance`, which is
  persistent) and a password saved in Chrome's own manager — so re-login is _faster_, never
  skipped. A clean session would lose all of that on every launch. Persistent ≥ clean for
  re-login speed, always; that inequality is the real justification and does not depend on the
  false premise.
- **Auto-restart does not restore playability.** It repositions the window and re-launches the
  game, but a human must pass Turnstile and enter credentials again. Auto-restart is still worth
  having — the window returns to its cell — but it is not "the slot is playing again."

## Consequences

- The "Open risks — re-login after restart" item in `architecture.md` is no longer a risk to
  mitigate but a confirmed, unfixable property of this game; the document is updated to say so.
- Password help is the browser's own manager, not app-stored credentials (the app never stores
  passwords, and without CDP it could not fill a login form anyway). A one-line panel hint tells
  the user that saving the password in Chrome speeds re-login, with the risk disclosed. [see Correction (2026-08-08)]
- A future game whose login _is_ cookie-based would come back signed in with no change here —
  the profile is preserved regardless. This finding is specific to a tab-bound game, not a
  property of the app.

## Alternatives rejected

- **Keep the assumption and document nothing** — leaves every future contributor to re-derive,
  or worse re-assume, that persistence avoids re-login, and to reasonably conclude "then switch
  the default to clean sessions," which is wrong (clean is strictly worse for re-login speed).
- **Record only in `architecture.md`** — that document is edited toward the present and would
  lose the refuted premise on a later cleanup. The whole point of this record is that the
  reasoning "why persistent is still the default even though it does not preserve the login"
  survives an edit. That is what the ADR format is for.

## Verification

Field-observed against the live game, not derivable from the code (the app cannot see the game's
`sessionStorage`). Recorded here because a premise the codebase leaned on was tested and refuted,
which is exactly what an ADR should preserve.

## Correction (2026-08-08)

**The panel hint no longer exists.** It was removed with the video-wall rework (decision 7, commit
`2aefb4d`, whose message says so outright), and neither
[ADR-0011](0011-embed-spawned-chrome-into-the-shell.md) nor this file recorded it. Verify by
searching `apps/shell/src/renderer/` — there is no such string.

What still holds: password help is the browser's own manager, the app stores no passwords, and
without CDP it could not fill a login form anyway. What no longer holds is the last clause — **the
app now discloses nothing** about the risk of letting Chrome save a game password. The removed text
said the password is kept on the user's machine inside the Chrome profile, and that a compromised
machine can leak it.

**This is not only a documentation defect.** Whether that disclosure should come back is a decision
about UI text describing a credential risk, and it belongs to the project owner rather than to
whoever notices the gap. Recorded here so the question survives being noticed once. The absence is
listed in `docs/plans/phase-3-distribution.md` as an open item for the first-run screen, which is
where a disclosure would now naturally live. [see Correction (2026-08-08, second)]
[see Correction (2026-08-20)]

## Correction (2026-08-08, second)

**The disclosure is back**, so the sentence above — "the app now discloses nothing" — is true only
of the period between the video-wall rework and this. The owner decided it on 2026-08-08 with the
first-run screen (step 7 of the phase-3 plan), and chose **Configurações → Seus dados** over the
first-run gate the correction above expected: the choice it describes is one the user makes at every
login rather than once, and that section is already where the app explains what a profile holds.

The text says what the removed hint said and a little more: saving the password in Chrome speeds the
re-login this ADR shows is unavoidable; in exchange the password sits on the machine inside the
Chrome profile, where anyone with access to the machine can extract it; and the app itself never
stores a password or fills a form — the browser's own manager does. Verify in
`apps/shell/src/renderer/renderer.ts`, in `userDataBox`.

## Correction (2026-08-20)

**`docs/plans/phase-3-distribution.md` no longer exists.** The first Correction above points a
reader at it for the open item it was tracking; the file was deleted when Phase 3 landed, exactly as
it said it would be, and what survived it is [ADR-0012](0012-hecaton-and-the-data-directory.md)
through [ADR-0015](0015-what-the-app-deliberately-does-not-collect.md).

Nothing is lost by the deletion here: the item that pointer was tracking is the password disclosure,
and the second Correction above records it being decided and built. This note exists so a reader
following the path does not conclude the record is missing.
