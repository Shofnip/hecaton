# ADR-0025 — A layout frame is the unit of window movement

**Status:** Accepted · **Date:** 2026-09-20

## Context

Entering and leaving focus mode felt slow, and dragging the focus divider felt slower still: the
thumbnails kept moving for a visible beat after the pointer stopped. Nothing in the DOM explains
it — there is no `transition` on `.grid`, `.thumb-row`, `.focus-main` or `#board`, and the panel
redraws in one frame. What lags is the real browser window catching up, down the chain
`pointermove` → `requestAnimationFrame` → `screens:layout` → orchestrator → Win32 worker →
one `movechild` per screen.

So the milliseconds were measured rather than guessed, with six real bundled-Chromium windows
embedded in a real Electron panel on a page that draws every frame (`spike/relayout`, disposable).
Median of six transitions and of a sixty-frame drag:

| path                                                                | one focus transition | after the last `pointermove` |
| ------------------------------------------------------------------- | -------------------- | ---------------------------- |
| **what shipped in 0.3.0** — `MoveWindow`, one command per screen    | 75 ms (110 max)      | **2207 ms**                  |
| `SetWindowPos` + `SWP_ASYNCWINDOWPOS`, still one command per screen | 31 ms                | 1358 ms                      |
| one command carrying the whole frame                                | 36 ms                | 742 ms                       |
| the same, sending only the newest frame                             | **36 ms**            | **84 ms**                    |

Three things came out of it, and only the first was expected.

**The drag was not slow, it was behind.** The renderer emits one layout per animation frame —
about sixty a second — and Win32 serves fifteen to twenty-five of them. Every emitted frame was
being executed, so when the divider stopped, the worker was still working through positions it had
passed seconds earlier. More frames did not mean smoother tracking: dropping superseded ones
applied **more** of them, 39 of 60 against 22, because none of the worker's time went to frames
nobody would ever see.

**`MoveWindow(repaint: true)` waits for the browser.** It dispatches the resize to the target
window's thread, and the target is a browser in the middle of drawing a game: 11 ms per screen,
against 3.5 ms for the same move posted with `SWP_ASYNCWINDOWPOS`. The posted move was measured to
land on the identical pixel across six screens and to leave the identical z-order.

**`DeferWindowPos` is a dead end, and it lied convincingly.** Batching the frame into one
`BeginDeferWindowPos`/`EndDeferWindowPos` chain timed four times faster than anything that worked —
because it moved nothing at all. The chain fails on a window owned by another process, and a failed
`DeferWindowPos` frees the whole chain and returns `NULL`. What looked like a placed frame was the
clip region echoing back the requested size while every window stayed where it was. The probe only
caught it because it read the positions back and compared them against the path already in
production; timing alone called it the winner.

There was also a cost nobody was looking for: the panel redraws and re-emits its layout on every
state push, and the liveness sweep pushes every two seconds. Every screen was being moved to where
it already was, for ever, each move costing a reflow inside the page.

## Decision

**The frame, not the screen, is the unit.** `WindowManager` gains
`setLayout(placements)` beside `setBounds`, and the orchestrator hands over every screen that moved
in one call. The adapter turns that into one worker command, `movechildren`, which loops
`SetWindowPos` with `HWND_TOP` and `SWP_ASYNCWINDOWPOS` — the top of the sibling z-order re-asserted
by the move itself, rather than by a second call, so Electron's own input hwnd still cannot cover a
screen and swallow its clicks. `setBounds` on an embedded window is a frame of one, so the embedded
path has a single implementation.

**Only the newest frame is sent.** While a layout command is in flight the adapter keeps the newest
frame and nothing older. This is safe precisely because a frame is complete in itself: it carries
every screen that moved, so the newest one is never missing something an older one would have
applied.

**An unchanged rectangle is not sent at all.** The core remembers where it put each pid and skips a
screen that is already there. A hidden screen is forgotten, so coming back always places it again —
one move, and the question of whether a window drifted while hidden never arises. A pid that stops
running is forgotten too, because Windows reuses process ids and a new browser at an old pid is a
new window in the wrong place.

**Who decides what.** Which screen goes where stays the renderer's, relayed by the core — that half
of [ADR-0011](0011-embed-spawned-chrome-into-the-shell.md) is untouched. What is new is that the
core states a frame rather than a sequence of screens, and that the adapter is allowed to drop a
frame it has been overtaken on. Dropping is scheduling, not policy, which is why it sits in the
adapter and not in the core.

## Consequences

Entering and leaving focus costs half of what it did, and the divider drag stops trailing the
pointer: 84 ms of catch-up instead of 2.2 s, on six screens. The two-second background churn is
gone entirely — an idle wall now sends no window commands at all.

A screen's position is applied a few milliseconds after the worker says `OK`, because the move is
posted rather than performed. Nothing in the app reads a position back, and the integration tests
that check placement already poll, so this costs nothing — but it is why
`window-manager.integration.test.ts` must keep polling and must never assert a rectangle
immediately after asking for it.

The corollary of the drop rule is the rule itself: **a frame must always be complete.** A future
change that sends partial frames — only the screens that moved _since the last frame the worker
accepted_, say — would break silently, because the dropped frames are exactly the ones whose
contents would be missing. The core's "skip what did not change" check compares against the last
frame it **emitted**, which is the invariant that keeps this true.

`MoveWindow` left the Win32 worker with `movechild`; both are gone.

## Alternatives rejected

**Leave the port alone and coalesce per window inside the adapter.** No `ports.ts` change, no
cascade into the fakes. Measured at 55 ms per transition and 97 ms of drag catch-up — it fixes the
backlog, which was the worse half, and leaves the focus transition at double what it can be. The
owner chose the full change on 2026-09-20 with both sets of numbers in hand.

**`DeferWindowPos` for the whole frame.** Rejected on measurement: it does not work across
processes. Recorded above rather than merely dropped, because it is the API this problem looks like
it wants and the next person will reach for it.

**An animation to cover the delay.** Explicitly out of scope: masking a latency that had not been
measured yet was the one thing the owner ruled out at the start, and after the measurement there is
little left to mask.
