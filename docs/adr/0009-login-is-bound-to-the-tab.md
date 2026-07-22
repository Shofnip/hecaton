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
  the user that saving the password in Chrome speeds re-login, with the risk disclosed.
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
