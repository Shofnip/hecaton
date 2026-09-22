# ADR-0039 — Bound native clipping during live resize

**Status:** Accepted · **Date:** 2026-09-22

## Context

A paced 80-frame resize with four embedded screens took 4.878 seconds. The renderer handled all 80
events without a long task; the cost was below it. Disposable worker timing split a four-child
frame into about 0.01 ms of geometry reads, 0.32 ms of `SetWindowPos`, and 20.1 ms in
`SetWindowRgn`. Following the hidden overlay added another measured 4.9 ms per parent event.

Caching frame insets, reducing renderer measurement, replacing only identical regions, and capping
the whole layout stream were considered. The first two target negligible or already-coalesced work;
the third misses a resize where dimensions change every frame; the fourth would make positions
track the hand less often along with the expensive clip.

## Decision

`SetWindowPos` continues to receive every newest layout frame. `SetWindowRgn` is limited per child
to 20 Hz during live movement, with inset changes applied immediately, and the existing quiet-time
settle always applies the exact final region. Region changes use `redraw=false`; the posted resize
already causes painting. The worker reports the number of regions actually replaced for integration
coverage.

The overlay follows move/resize events only while visible. `overlay:open` already synchronizes its
bounds before showing it, so the normal hidden state performs no native bounds work and visible
behavior is unchanged.

## Consequences

- The four-screen probe fell from 4.878 to 4.076 seconds. Screens off took 3.375 seconds, against
  the earlier 3.368-second Electron/native baseline; the added four-screen/overlay cost therefore
  fell from about 1.51 to 0.70 seconds.
- The renderer still received 80/80 resize events, with no long task. A real four-browser test
  checks bounded region replacement and exact final Win32 rectangles for every child.
- During a drag, a clip edge can trail its outer window by at most one 50 ms interval. Position and
  size commands are not throttled, and the final region is exact after the existing settle.
