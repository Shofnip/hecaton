# ADR-0001 — Electron for the shell, not Tauri

**Status:** Accepted · **Date:** 2026-07-21 (recorded retroactively)

## Context

The app needs a desktop shell to host the control panel. A browser page alone cannot do this:
launching OS processes requires a local privileged process, so "a web app" would really mean
"a web UI plus a local service" either way.

Two candidates: Electron (bundled Chromium) and Tauri (system WebView2, Rust backend).

On paper Tauri wins the shell comparison — much smaller binary, much lower baseline RAM — and
that was the initial recommendation. The panel itself is simple, so the lighter option looked
like the obvious one.

## Decision

**Electron**, with the whole stack in Node/TypeScript.

What flipped it was [ADR-0002](0002-real-windows-over-thumbnails.md). Once the app had to
arrange real OS windows in a grid and bring them to front on demand, it needed to manipulate
windows **it did not create** — the browser runs in a separate process, and Chrome's
`--window-position` only sets initial state.

`node-window-manager` (npm) does exactly that and is already written. On the Rust side there is
no equally mature equivalent, so Tauri would have meant hand-writing Win32 bindings
(`SetWindowPos`, `SetForegroundWindow`) for the app's central interaction.

Trading a smaller binary for hand-rolled bindings to the feature the product is built around was
not a good trade.

## Consequences

- Larger binary and higher baseline RAM than Tauri. Acceptable: the spike measured 4 idle Chrome
  instances at 1.72 GB, and the shell is a rounding error next to the browsers it orchestrates.
- One language across the whole project. No Rust/TypeScript boundary to maintain.
- Electron's security surface becomes mandatory work rather than optional — see the Electron
  security section of `architecture.md`. This is a real cost of the choice, not a footnote.

## Alternatives rejected

**Tauri** — smaller and lighter, but no mature story for driving external windows on Windows.

**Web UI + local service** — same privileged local process, plus a second deployment unit and an
HTTP surface to secure. All of the cost, none of the benefit, for a single-user desktop tool.
