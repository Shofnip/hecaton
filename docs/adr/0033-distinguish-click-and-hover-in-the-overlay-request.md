# ADR-0033 — Distinguish click and hover in the overlay request

**Status:** Accepted · **Date:** 2026-09-21

## Context

The volume and zoom popovers can open either by click or after a short hover. Those two gestures
need different lifetimes: a click is deliberate and stays open until an outside click or `Escape`;
a hover should close if the pointer never reaches the popover or leaves it. The wall and overlay
are separate renderer processes, so the overlay cannot reliably reconstruct which gesture caused
an `overlay:open` request.

This changes an IPC payload, one of the project's security decision triggers. The options were to
add a discriminator to the existing validated request, add separate hover-specific IPC channels,
or make the overlay infer intent from pointer timing.

## Decision

The existing `overlay:open` payload carries `trigger: 'click' | 'hover'` for the `volume` and
`zoom` variants. The core validator refuses missing or unknown values. The discriminator changes
only renderer lifetime; it adds no operation, target or privilege to the channel.

A click-opened popover closes on an outside click or `Escape`. A hover-opened popover starts a
bounded close timer immediately, cancels it when entered, and rearms it after leaving. An active
slider drag postpones rather than loses that close.

## Alternatives and consequences

- **Separate click and hover channels.** This makes the origin visible in the channel name, but
  duplicates handlers and expands the IPC surface for two requests with identical authority and
  data. It was rejected as extra security surface without extra isolation.
- **Infer the gesture in the overlay.** This keeps the payload smaller, but the overlay does not
  receive the wall's initiating pointer event. Timing inference would be ambiguous and would make
  click-opened popovers disappear unexpectedly. It was rejected.
- **One validated discriminator.** This protects the existing narrow channel and exposes only the
  initiating gesture. It is the smallest implementation and is reversible: a later interaction
  model can remove the field without migrating stored data. This was the recommended and selected
  option.
