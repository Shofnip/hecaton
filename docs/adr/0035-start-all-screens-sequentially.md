# ADR-0035 — Start all screens sequentially

**Status:** Accepted · **Date:** 2026-09-21

## Context

Starting every screen simultaneously froze the computer in July 2026. A 250 ms stagger still let
the launches overlap; waiting for each launch plus a 1.8 second settle interval kept the machine
responsive. That sequence was later removed after synchronous PowerShell process queries were made
asynchronous, because those shell-outs were then believed to be the whole cause.

The launch path has since gained real work: each browser is embedded, reloaded, given its initial
page zoom and watched briefly for Chromium's zoom bubble. With four live accounts the owner again
measured computer-wide lag when using **Ligar todas**. The bubble watch alone enumerated 435 desktop
windows in the current session: 7.17 ms median and 18.1 ms p95, every 40 ms while active. Async I/O
prevents an event-loop block; it does not make four Chromium process trees and their native setup
cheap when they run together.

## Decision

**Ligar todas** starts screens strictly one at a time. It awaits the browser pid returned by each
start, then gives that process 1.8 seconds to settle before starting the next. There is no wait
after the last screen. A failed screen is reported and does not prevent the remaining screens from
starting. A second global-power click is ignored while the sequence is running.

**Desligar todas** stays concurrent. Closing a browser is cheap, the adapter now posts `WM_CLOSE`
before forgetting its handle, and serial shutdown would multiply the graceful-close wait the user
just asked to avoid.

## Consequences

Turning on four screens takes longer wall-clock time, by design, while the computer remains usable.
Individual power buttons are unchanged. Shutdown stays fast. A fast test holds each synthetic
start unresolved and proves that the next one cannot begin before both the start and settle steps.

The disposable four-screen panel probe measured the live sequence after this change. Each browser
resolved its pid in 0.54â€“0.77 seconds; the following `slot.start` arrived 1.808â€“1.810 seconds after
the preceding `slot.ready`, and all four were ready 8.00 seconds after the first start. The panel's
250 ms state sampler kept answering throughout. Concurrent **Desligar todas** then completed in
966 ms. The probe is discarded; these timings are the durable finding.

## Alternatives rejected

- **Start all at once.** Fastest completion on an idle machine, but it reproduces the reported lag
  now that launch includes embed, repaint, zoom and bubble suppression.
- **Stagger by 250 ms without awaiting.** Previously measured and rejected: the browser startups
  still overlap, spreading the spike rather than removing it.
- **Remove initial zoom or bubble suppression.** That changes user-visible decisions from
  ADR-0027 and ADR-0031. Serialising the heavy operation fixes scheduling without removing either.
