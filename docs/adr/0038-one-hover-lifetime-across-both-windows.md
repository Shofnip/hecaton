# ADR-0038 — One hover lifetime across both windows

**Status:** Accepted · **Date:** 2026-09-22

## Context

ADR-0033 made click and hover explicit, but its immediate close timer treated the wall trigger and
the overlay popover as unrelated regions. Opening the overlay takes mouse input from the wall, so a
stationary pointer produced `mouseleave`, the popover closed 260 ms later, and the newly exposed
button opened it again. Volume and zoom repeated that cycle until clicked.

The alternatives were a longer timer, a close acknowledgement over IPC, or representing the
trigger inside the overlay that now owns pointer input.

## Decision

The existing validated request and anchor are unchanged. For a hover request, the overlay creates a
transparent bridge over the trigger rectangle. Trigger and popover are one lifetime: opening while
the pointer is on the bridge is stable; leaving it arms the existing 260 ms gap grace; entering the
popover disarms it; leaving both closes. The first animation frame checks `:hover`, so a pointer
that moved away before the overlay became interactive still closes within the bound. A drag still
postpones closure. Click-opened popovers remain persistent until outside click or `Escape`.

This supersedes only ADR-0033's statement that a hover timer starts immediately. Its discriminator,
validator and rejected extra IPC channels remain unchanged.

## Consequences

- No channel, payload, privilege or timing constant was added.
- The bridge intercepts only the same rectangle already covered by the overlay's outside-click
  catcher.
- The Electron probe held both controls stable for more than two seconds, crossed into the
  popover, dragged outside, closed after release, and preserved click/`Escape` behavior.
