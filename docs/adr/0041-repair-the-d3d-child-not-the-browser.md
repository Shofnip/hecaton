# ADR-0041: Repair the displaced D3D child, not the browser

**Status:** Accepted · **Date:** 2026-09-22

## Context

Starting all four screens could leave one card black even though its browser process, document,
outer HWND, parent, clipping region and layout rectangle were all healthy. Reload, hide/show,
restacking, redraw, an outer-window size nudge, `--disable-direct-composition`, `--kiosk`, a normal
`--new-window`, and the Chromium 156.0.8065.0 revision shipped by Hecaton 0.2.0 all failed in
repeated real-window runs.

A live failing screen exposed the one structural difference: its direct child named
`Intermediate D3D Window` was still at the off-screen launch coordinate. The same child covered
the complete outer client area on every healthy screen. Moving only that child to `(0,0)` and
sizing it to `GetClientRect(outer)` restored the existing page within 500 ms, without navigation,
process replacement or profile change.

This agrees with Chromium's DirectComposition path: `ChildWindowWin` owns that child and
`DCompPresenter::Resize` normally follows a reshape. Hecaton reparents and sizes the outer HWND
from another process, so Chromium does not always run the internal reshape that would move its
presentation child.

## Decision

Keep the bundled Chromium revision and the existing `--app=` launch model. On the quiet-time
layout pass and immediately before `SW_SHOW`, the Win32 worker finds only the direct child whose
class is exactly `Intermediate D3D Window`. If its screen rectangle is not the outer HWND's client
rectangle, it calls `MoveWindow(child, 0, 0, clientWidth, clientHeight, true)`.

The check is conditional and absent from live resize frames. Healthy screens do no extra native
move; a displaced screen is repaired without reloading its document or changing its session.
The existing post-embed reload remains because it addresses ADR-0017's separate surface-loss
failure.

## Consequences

- Browser version, window type, URLs, profiles and user-visible behaviour stay unchanged.
- The implementation depends on a private Chromium window class. A raised browser pin must run the
  real four-screen pixel test and the deterministic displaced-child integration test.
- A GPU-process restart may recreate the child. The next reveal or settled layout checks the new
  handle rather than caching one.
- The worker uses the measured client rectangle; there is no revision-specific height constant.

## Alternatives rejected

- **Downgrade to the 0.2.0 browser:** revision 1699959 / Chromium 156.0.8065.0 failed at wave 15.
  It also gives up browser fixes without removing the race.
- **Move to Chrome for Testing or another window mode:** broader packaging and behaviour changes
  for a defect isolated to one child HWND; `--kiosk` and `--new-window` also failed.
- **Reload or restart the GPU process:** reload did not move the child, and killing the GPU process
  affects every surface and may discard canvas state.
- **Disable DirectComposition:** failed at wave 9 and would trade the accelerated presentation path
  for a broader rendering change even if it had worked.
- **Periodic repair:** unnecessary native work. Reveal plus the already-existing quiet-time settle
  cover creation and resize without adding another timer.

## Verification

The integration suite first moves a real bundled Chromium's D3D child to `(32000,32000)` and
requires an ordinary layout pass to restore the exact client rectangle. The four-screen probe then
launched four simultaneous real HTTP app windows for 30 consecutive waves and read exact RGB
pixels from the desktop; all 120 surfaces painted their expected colours.
