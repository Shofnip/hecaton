# Three-fix roadmap: launch, hover popovers, and live resize

**Probe date:** 2026-09-21
**Status:** All three stages implemented and verified

This document splits three regressions into independent sessions. Each stage starts with its own
red test, changes only one behaviour, updates the living architecture, and finishes green before
the next stage begins. The disposable probe remains under ignored `spike/`; the measurements below
are the durable result.

The probe used four clean-session slots under the repository's ignored probe data root. It did not
read or write `%APPDATA%/hecaton`, did not use a proxy, and stopped all four Chromium processes
before the probe shell exited.

## Stage 1 — Start every screen together without freezing input

### What was measured

The current global power action is intentionally serial: it awaits one browser and then waits
1.8 seconds before asking for the next. In the real four-slot shell this took **8.64 seconds** from
the click until all four LEDs were on. Individual screens became ready roughly 0.68, 3.33, 6.00,
and 8.64 seconds after the click.

Calling the same four existing `startSlot` operations together, without changing production code,
made all four slots enter loading together and all four were ready in **1.26 seconds**. The panel
recorded no long task; its animation-frame maximum was 8.7 ms and its 16 ms heartbeat maximum was
17.8 ms in this run. The sequential run also had no long task, but repeated the launch cost four
times and had one 33.4 ms animation-frame gap.

Repository history explains the apparent regression:

- `5f61b84` removed the permanent input-queue attachment that froze the cursor and tried a 250 ms
  launch stagger.
- `3ff22ec` replaced the ineffective short stagger with strict sequential launch.
- `236af1c` then removed synchronous PowerShell process queries from the main thread.
- `e198105` restored simultaneous launch because the original blocking cause was gone.
- `a600b34` reinstated strict sequential launch after zoom/bubble work, without re-establishing that
  the old main-thread blocking cause had returned.

The first probe therefore supported restoring a single simultaneous user action, but did not by
itself prove that every machine had enough CPU/GPU headroom. The implementation's real four-browser
integration and repeated launch waves below became that remaining guard; the initial measurement is
kept here because it explains why the change was made.

### Session plan

1. Add a failing fast test stating that one global action dispatches every eligible start in the
   same turn, keeps failures independent, and rejects a duplicate global action while the first is
   unresolved.
2. Add or extend a Windows integration test with four real bundled Chromium instances. Measure
   request spread, total ready time, an independent heartbeat, and final cleanup. The acceptance
   gate is no serial 1.8-second gaps and no input/main-thread stall.
3. Restore simultaneous dispatch. If the independent heartbeat finds a system-wide spike on a
   lower-end machine, schedule only the expensive post-spawn native work; do not make the four
   user-visible start requests serial again.
4. Replace ADR-0035 with a new ADR that records the reversal; ADR-0035 itself remains immutable.
   Update `architecture.md`, design copy, and the toast text in the same commit.

### Done when

All four cards enter loading together, all four real browsers embed correctly, the panel remains
interactive, one failed slot does not prevent the other three, and stop-all still closes
concurrently.

**Implemented and verified — 2026-09-22.** The global action dispatches every eligible start in one
wave, ignores a duplicate request until that wave settles, and keeps failures independent through
`Promise.allSettled`; shutdown remains concurrent. Fast tests pin all three rules. A real four-slot
HTTP integration measured the requests arriving together, kept an independent heartbeat alive and
verified every process was cleaned up. Repeated four-screen pixel waves later exercised the same
launch path while diagnosing the D3D presentation race. See ADR-0037.

## Stage 2 — Make hover-opened volume and zoom popovers stable

### What was measured

Volume and zoom share the same failure. A controlled cross-window event sequence produced this
cycle repeatedly:

1. The wall sees `mouseenter`; its 220 ms intent timer asks main to open the popover.
2. Main makes the full-panel overlay interactive and focuses it.
3. The wall loses the button hover and immediately clears `hoverOpenFor`.
4. `HoverClose.opened()` was armed when the popover appeared. If the pointer has not reached the
   small popover, it closes after about 260 ms.
5. Main hides the overlay and makes it click-through; the stationary pointer can enter the exposed
   wall button again, starting at step 1.

The probe observed each volume popover appearing about 220–225 ms after entry and disappearing
about 267–274 ms later, with overlay focus on open and blur on close. Zoom produced the same
sequence. A click-opened popover does not arm `HoverClose`, which explains why clicking stops the
oscillation.

The existing pure `HoverClose` tests cover its timer in isolation but cannot express the two-window
handoff that clears the wall's hover guard.

### Session plan

1. Add a failing renderer test for the complete cross-window sequence: trigger entered, hover open,
   trigger loses input because the overlay became interactive, popover times out, overlay closes,
   and the unchanged pointer must not open it again.
2. Model one popover lifetime across both windows instead of maintaining unrelated wall and overlay
   guards. Measure whether keeping the trigger latched until a genuine leave is sufficient; if the
   wall cannot distinguish overlay takeover from a real leave, add an explicit bounded close
   acknowledgement rather than another timing heuristic.
3. Preserve all existing interaction variants: hover can travel into the popover, leaving both
   regions closes it, click-open remains persistent until outside click or Escape, and pointer
   capture keeps a drag alive outside the track.
4. Exercise both volume and zoom against the real Electron overlay. They share lifetime mechanics,
   but both controls must be named by the test so a future fork cannot regress only one.

### Done when

A stationary pointer opens at most one popover, it stays visually stable for at least two seconds,
moving into and out of it behaves as designed, click-open still stays open, and both sliders can be
dragged without closure.

**Implemented and verified — 2026-09-22.** The overlay now mirrors the wall button with a bounded,
transparent trigger bridge, so taking input away from the wall does not masquerade as a pointer
departure. Fast tests name volume and zoom independently. A real two-window Electron probe kept
each hover popover stable for two seconds, crossed into it without closure, kept it open through a
drag, preserved click-open behavior, and closed it with Escape. See ADR-0038.

## Stage 3 — Make manual window resize track the hand smoothly

### What was measured

The probe drove 80 real top-level window sizes, 16 ms apart, inside a native enter/exit-size-move
pair. The same run recorded renderer animation frames, heartbeat drift, and long tasks.

| Condition                       | Total probe time | Increment over the next condition |
| ------------------------------- | ---------------- | --------------------------------- |
| Four embedded screens + overlay | 4.878 s          | 1.122 s over screens off          |
| Screens off + hidden overlay    | 3.756 s          | 0.388 s over no overlay           |
| Screens off + overlay closed    | 3.368 s          | baseline Electron/native resize   |

The total includes the intentional 1.28 seconds of 16 ms pacing and a 500 ms observation tail, so
absolute per-frame cost should be re-measured inside main/worker rather than inferred from this
outer timer. The relative result is useful: four embedded children add about **14.0 ms per resize
event**, and synchronously following the hidden overlay adds about **4.9 ms per event** in this run.

The wall renderer was not the stall: with four screens running it processed all 80 resize events,
had 8.5 ms p95 animation-frame gaps, a 8.8 ms maximum, and no long task. The lag is downstream of
DOM measurement. Two additive paths run for every native resize event:

- main synchronously calls `overlay.setBounds`, even while the overlay is hidden;
- the renderer emits a physical layout and the window adapter moves and re-regions every embedded
  Chromium child through `movechildren`.

The adapter already keeps only the newest unsent delta, so the old unbounded backlog is not the
current explanation. `MoveChildren`, however, still reads window/client/origin geometry and creates
a new region for every child on every applied frame.

### Session plan

1. Add disposable timing around four exact boundaries: parent resize event, hidden-overlay
   `setBounds`, `screens:layout` receipt, and `movechildren` reply. Record emitted, coalesced, sent,
   completed, and final-convergence counts during one real manual drag.
2. Turn the finding into failing integration coverage. The test should assert bounded command rate
   during the drag and an immediate final flush after exit-size-move; it must also compare final DOM
   viewports with Win32 child rectangles.
3. Fix the measured dominant cost. Candidate work, in order of evidence to collect:
   - coalesce hidden-overlay bounds updates to the native resize cadence and always flush the final
     rectangle;
   - cap live child layouts at the measured worker capacity rather than producing at every renderer
     frame;
   - cache invariant embedded-window frame insets so every frame does not make three cross-process
     geometry reads per child;
   - avoid replacing an identical clipping region, while still updating it when the viewport size
     changes.
4. Re-run at four screens, at 100% and a non-100% display scale. Verify smooth tracking, no flicker,
   no off-axis result, correct z-order/input, and exact final placement. Remove the stale renderer
   comment that still calls the now-fixed DPI virtualization defect unresolved.

### Done when

The outer panel follows a manual drag without visible resistance, embedded screens track without
flicker or accumulated lag, and the final child rectangles match the DOM exactly on both 100% and
scaled displays.

**Implemented and verified — 2026-09-22.** Worker instrumentation found `SetWindowRgn`, not DOM
measurement or geometry reads, consuming 20.1 ms of a four-child frame. Position follows every
newest frame; clipping is capped per child at 20 Hz and the quiet-time pass flushes the exact final
region. A hidden overlay no longer follows parent resize events and is synchronized immediately
before it is shown. The same 80-event, four-screen probe fell from 4.878 to 4.076 seconds, processed
80/80 renderer events with no long task, and measured 3.375 seconds with screens off. Real Win32
integration coverage bounds region replacement and compares all four final child rectangles with
their requested DOM placements. The interactive rerun was at 100% display scale; the existing
Per-Monitor-DPI worker integration and the earlier measured 125% placement run remain the scaled
display guard. See ADR-0039.

## Recommended order

Do the stages in the order above and keep one fix per session and commit. Stage 1 is both the
smallest and the clearest regression. Stage 2 is logically independent. Stage 3 needs the most
native instrumentation and should not be mixed with either UI-lifetime change.
