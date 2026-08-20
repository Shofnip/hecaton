# ADR-0017 — Reload an embedded screen, and hold it hidden until it has painted

**Status:** Accepted · **Date:** 2026-08-20

## Context

The owner reported it within an hour of first running the bundled build: a screen turned on grey
and stayed grey until they pressed reload by hand.

Fourteen measured runs, each photographed off the real screen, found the cause.

**On the bundled Chromium, `SetParent` on an `--app` window throws away its rendered surface, and
it never comes back on its own.** Chrome 150 does not do this. A normal tabbed window does not do
this. Only the pairing does.

| what was varied                                                            | result     |
| -------------------------------------------------------------------------- | ---------- |
| installed Chrome 150, identical code and page                              | **paints** |
| bundled Chromium 154, production sequence                                  | grey       |
| born on screen instead of at `-32000`                                      | grey       |
| reparented 15 s later, page already painted                                | grey       |
| `--disable-features=…,CalculateNativeWinOcclusion`                         | grey       |
| `--disable-gpu`                                                            | grey       |
| without the three switches [ADR-0016](0016-ship-our-own-chromium.md) added | grey       |
| a size nudge, `SW_HIDE`/`SW_SHOW`, `RedrawWindow`, minimise/restore        | grey       |
| the same bytes over `file://` instead of `http://`                         | **paints** |
| the same `http://` url with `--app=` removed                               | **paints** |
| `--app=` kept, reparented **without** the style strip                      | grey       |

The last three are the chain that names it. `file://` looked like the safe scheme and is not:
`--app=file://…` silently falls back to a normal window, the same fallback probe P5 measured for
`--app=about:blank`. The scheme was a proxy for the window type. And leaving `WS_CAPTION` and
friends intact — title bar visible inside the cell — is still grey, so it is not what ADR-0011
does to the styles afterwards.

A coarse bisection over the snapshot bucket places the regression **inside M151 development**:

| revision | version                | verdict |
| -------- | ---------------------- | ------- |
| 1639827  | 150.0.7871.0           | paints  |
| 1654454  | 151.0.7922.0           | grey    |
| 1669035  | 152.0.7977.0           | grey    |
| 1681099  | 153.0.8010.0           | grey    |
| 1682878  | 154.0.8014.0 (the pin) | grey    |

That an **unbranded trunk snapshot from the 150 era paints** is the part worth keeping: this is a
version regression, not a consequence of shipping an unofficial build.

## Decision

**The window adapter reloads a screen the moment it embeds it, and holds the reveal for one
second while it repaints.**

`WM_APPCOMMAND` reload is the only thing measured that restores the surface, and it is already a
production verb. Timed from the command: a localhost page paints at 200 ms, the target game at
600 ms, complete at 1000 ms. `REPAINT_SETTLE_MS = 1000` is that measurement plus margin, and it is
the ceiling the owner set.

**The order is forced and is the opposite of the obvious one.** Painting first and embedding after
cannot work — that is the fifteen-second row above. It has to be embed, then reload, then reveal.

**It lives in the adapter, not the core.** The core cannot know that this browser loses a surface
when Win32 reparents it; that is a Windows-and-Chromium detail, the same kind as the style strip
and the `HWND_TOP` re-assert beside it. The core still just says "show this screen" and is not told
it waited.

**The panel says `Iniciando a tela…` for that second**, reusing the existing loading cell, so the
user sees a message rather than an empty rectangle and never sees the grey at all.

## Consequences

- **One extra page load per screen start**, and roughly 0.6–1 s added to it. With four screens,
  four extra loads. A reload is safe for a logged-in slot: [ADR-0009](0009-login-is-bound-to-the-tab.md)
  records it as the one operation that keeps the tab-bound login.
- **The reveal is a timer, not an event.** Without CDP nothing can say "painted". On a slow link
  the reveal lands first and the screen is grey for the remainder — chosen deliberately over
  waiting indefinitely, because a screen that never appears is worse than one that appears late.
- **Two constants must agree across a process boundary** — `REPAINT_SETTLE_MS` in the adapter and
  `STARTING_MS` in the renderer — and nothing enforces it. Erring long in the renderer is the safe
  side: the message is covered by the window the moment it appears.
- **This is a workaround for somebody else's bug.** It is written down here so a future session
  does not delete the reload as redundant. `window-manager.integration.test.ts` pins it with a test
  that reads a **pixel off the real screen**, because every other signal — process alive, window
  present, bounds exact, parent correct — stayed green through the whole bug. If a future revision
  stops discarding the surface, that test is what will allow the block to be removed safely.

## Alternatives rejected

**Pinning a pre-regression revision.** The newest good one is `150.0.7871.0` — the same major the
owner already had installed, and about three months of Chromium security fixes behind the current
pin, permanently, since a snapshot never receives any. That trades the largest cost ADR-0016 names
for a cosmetic defect that has a measured workaround. Weighed with the owner and rejected.

**Dropping `--app=`.** It paints, measured. But `--app` is not decoration: ADR-0003's Correction
records that it is what keeps a slot out of Chrome's session restore, and without it a screen
reopens the previous tabs and accumulates them — a bug that was already found and fixed once, and
that only exists _because_ `stop()` closes cleanly. It would also put a tab strip and an omnibox
inside the video wall. Rejected.

**Chrome for Testing**, a release-channel build that might not have the bug and would also settle
ADR-0016's backport debt. The owner ruled it out.

**A cheaper repaint than a reload.** Four were tried — `SW_HIDE`/`SW_SHOW`, `RedrawWindow` with
`RDW_ALLCHILDREN|UPDATENOW`, minimise/restore, and a one-pixel resize. All four left the window
grey five seconds later. Nothing short of a new document repaints it.

**Bisecting to the exact commit.** Roughly fourteen more downloads at 354 MB. It would enable an
upstream report and might name a feature flag, but it cannot improve the pin, so the owner stopped
the search at milestone resolution.

## A note on numbering

The Fase 4 plan reserved 0017 for the one-instance-per-machine decision. This landed first, so that
one takes the next free number. ADR numbers are assigned when a decision is taken, never reserved.
