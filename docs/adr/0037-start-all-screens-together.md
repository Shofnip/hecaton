# ADR-0037 — Start all screens together

**Status:** Accepted · **Date:** 2026-09-21 · **Supersedes:** ADR-0035

## Context

ADR-0035 made **Ligar todas** strictly sequential after four Chromium launches were associated
with computer-wide lag. Each browser had to become ready and then settle for 1.8 seconds before
the next request, so four screens took 8.64 seconds to become ready.

That decision reused an older diagnosis. The original freeze came from synchronous PowerShell
process queries on Electron's main thread; those queries have since become asynchronous. A
disposable four-screen probe repeated the production action both ways. Dispatching the four
existing `startSlot` operations together made every screen ready in 1.26 seconds, with no long task,
an 8.7 ms maximum animation-frame gap and a 17.8 ms maximum 16 ms-heartbeat gap. The sequential run
also remained responsive, but paid the launch and settle cost four times.

## Decision

**Ligar todas** dispatches every eligible screen start in the same turn and waits for them
concurrently. A failed screen is reported independently and does not cancel the others. A second
global power action is ignored until the first launch wave has resolved.

**Desligar todas** remains concurrent. Individual screen power buttons are unchanged.

## Consequences

Every eligible card enters its loading state together instead of progressing across the wall over
eight seconds. Four browser process trees may consume CPU and GPU at once, but the measured cause of
the old input freeze is no longer on the main thread. If a lower-end machine later shows a system
spike, only measured expensive post-spawn native work should be scheduled; the user-visible start
requests do not become serial again without new evidence.

The fast test holds all starts unresolved and proves same-turn dispatch, independent failure and
duplicate rejection. A Windows integration test starts four copies of the bundled Chromium with
temporary profiles, checks request spread and an independent heartbeat, embeds all four into a real
host HWND, and confirms final process cleanup.

## Alternatives rejected

- **Keep ADR-0035's strict sequence.** It avoids overlapping work but preserves a measured 8.64
  second delay whose original blocking cause is gone.
- **Restore a short stagger.** It neither means one action starts together nor guarantees that the
  expensive work will not overlap; the earlier 250 ms stagger already failed at that compromise.
- **Remove zoom or bubble suppression from launch.** Those are separate user-visible decisions.
  Scheduling the launch wave does not require removing either one.
