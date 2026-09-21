# ADR-0034 — Merge overtaken layout deltas per screen

**Status:** Accepted · **Date:** 2026-09-21

## Context

[ADR-0025](0025-a-layout-frame-is-the-unit-of-window-movement.md) made one Win32 command the unit
of layout and allowed the adapter to replace a queued command with a newer one. It called every
such command a complete frame. The implementation did not, and should not, meet that premise: the
core remembers the last rectangle it emitted for each pid and sends only rectangles that changed.
That removes the permanent browser reflow caused by unchanged two-second state pushes.

Those two valid optimisations conflict during a live resize. If command A is in flight, command B
contains new rectangles for screens 1 and 2, and command C changes only screen 1, replacing B with C
throws away screen 2's last rectangle. Windows then leaves screen 2 at A while the DOM has moved on.
The owner observed the result with four live screens: lag, flicker and screens leaving their cards.
A real two-browser integration test reproduced it as a final `340×250` region where the newest
known target was `380×270`.

## Decision

While a layout command is in flight, the native adapter keeps the latest **unsent delta per pid**.
A newer delta replaces only the pids it names and preserves every other pid from the overtaken
command. When the worker replies, all accumulated deltas leave in one `movechildren` command.

This supersedes ADR-0025's claim that replacing the whole queued command is safe because every
frame is complete. The rest of that ADR stands: one worker command still carries the batch,
`SetWindowPos` remains asynchronous, unchanged rectangles are still absent, and no stale sequence
is replayed.

## Consequences

A resize cannot lose one screen merely because another screen changed again before the worker
answered. The queue still holds at most one target per pid and sends at most one follow-up command,
so it preserves the measured catch-up benefit rather than rebuilding the old backlog.

`window-manager.integration.test.ts` embeds two real bundled-Chromium windows and drives the exact
full-frame/full-frame/partial-delta sequence. It reads both final regions through Win32; a fake
worker could only prove the fake queue.

A disposable four-screen panel probe then drove 60 real window resizes at 16 ms intervals. After
the final resize, the DOM viewports and Win32 visible regions agreed exactly in parent-client
pixels: `(43,29 457Ã—273)`, `(503,29 457Ã—273)`, `(43,356 457Ã—273)` and
`(503,356 457Ã—273)`. The probe is discarded; these measured coordinates are the durable finding.

## Alternatives rejected

- **Have the core resend every visible screen whenever any screen moves.** This would restore the
  complete-frame premise, but it would also move and reflow unchanged game pages during every
  resize and every unrelated state push.
- **Track only worker-acknowledged rectangles in the core.** Worker `OK` means the asynchronous
  `SetWindowPos` requests were posted, not that the browser windows reached them, and exposing
  acknowledgements would turn a synchronous port into layout protocol state.
- **Stop dropping commands.** Already measured in ADR-0025: it left the wall 2.2 seconds behind the
  pointer. Preserving each pid's newest unsent delta fixes correctness without restoring backlog.
