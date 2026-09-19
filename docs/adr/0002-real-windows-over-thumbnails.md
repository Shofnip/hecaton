# ADR-0002 — Real OS windows in a grid, not a panel of live thumbnails

**Status:** Superseded in part by [ADR-0011](0011-embed-spawned-chrome-into-the-shell.md) · **Date:** 2026-07-21 (recorded retroactively)

> **Superseded in part by [ADR-0011](0011-embed-spawned-chrome-into-the-shell.md) (2026-07-26):**
> the _presentation_ half is reversed — the windows are now embedded in a single shell window
> (a "video wall"), not arranged free on the desktop, and "the app cannot render anything over the
> game" (Consequences) no longer holds: an overlay window renders the HUD over the
> games. The substance this ADR exists for — **real Chrome windows, not an NVR-style screencast
> with forwarded input** — still stands, and turned out load-bearing (the screencast path depended
> on CDP, which [ADR-0003](0003-spawn-over-cdp.md) later ruled out). The body below is left as
> written, per the convention in [README](README.md).

## Context

The product goal was described by analogy: a camera controller. Watch every screen at once,
interact with any of them without selecting one first, and focus a single one for a better view.

Read literally, that suggests an NVR-style dashboard — one window, a tile per instance, each tile
showing live video of a browser, with clicks and keystrokes forwarded into it. That is buildable:
CDP exposes `Page.startScreencast` for the frames and `Input.dispatchMouseEvent` for the input.

## Decision

**Real OS windows, auto-arranged in a grid** (2×2 by default), with a "focus slot N" control that
brings one to front, and a way to restore the grid.

The literal reading was the expensive one. With four real windows side by side, "watch all at
once" is free — they are already rendering — and "interact without selecting" is free too, since
moving the mouse into a window and clicking is the whole interaction. There is no selection step
to eliminate because none exists.

The dashboard would have bought the same two properties at the price of a video pipeline and an
input-forwarding layer.

## Consequences

- No screencast, no frame encoding, no input forwarding. A large subsystem never written.
- The app must position and focus windows it does not own, which requires Win32 calls. This is
  what decided [ADR-0001](0001-electron-over-tauri.md).
- Window identity matters: the spike found that matching by window **title** grabbed the user's
  own Chrome window, which had the same game open, and moved it. Match on `processId` only.
- The app cannot render anything _over_ the game. Any HUD would have to live inside the page,
  which is why the extension route appears in the deferred list.

## Alternatives rejected

**Single panel with live tiles (NVR style)** — closer to the original analogy, far more
machinery, and it would have added latency between the player and a game they play by hand.

**Note, in hindsight:** this rejection turned out to be load-bearing. The tile approach depended
entirely on CDP, and [ADR-0003](0003-spawn-over-cdp.md) later established that CDP is unusable
against the target game. Had the dashboard been chosen, the Phase 0 spike would have invalidated
the product's core interaction rather than one implementation detail.

## Correction (2026-09-18)

The supersession note above described the overlay as "always-on-top" when it was written, and that
word has been removed from it rather than left to mislead: since 2026-09-18 the overlay is an
**owned, non-topmost** window. Being owned by the panel is what puts it over the embedded `WS_CHILD`
game windows; the flag additionally put it over every other program on the machine, which is the
defect the owner reported. Measured in `spike/overlay-z` and recorded in
[ADR-0011](0011-embed-spawned-chrome-into-the-shell.md)'s Correction of the same date.

Nothing about this ADR's own decision changes: the HUD still renders over the games, which is what
reversed the "cannot render anything over the game" consequence in the first place.
