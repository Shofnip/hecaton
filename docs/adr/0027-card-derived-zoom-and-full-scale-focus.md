# ADR-0027 — Card-derived zoom and full-scale focus

**Status:** Accepted · **Date:** 2026-09-20

## Context

[ADR-0026](0026-page-zoom-over-launch-scale.md) selected page zoom while leaving
factor policy and config exposure open. Part D showed that retaining a small
card's scale in focus mode leaves useful panels unnecessarily hard to read.

## Decision

The owner accepted **zoom derived from the card's size, 100% in focus mode, and
no configuration field initially**. Returning to the card restores its derived
zoom without restarting the screen or deliberately ending its game session.

The scale policy belongs in the pure core; browser control belongs in a thin
adapter. This changes neither grid geometry nor FocusChild. It does not introduce
CDP, an extension, page injection or direct writes to Chromium profiles.

The implementation compares the card's logical dimensions with a 1920×1080 CSS
workspace, selects the nearest measured Chromium preset, breaks ties toward the
smaller preset, and clamps automatic card zoom to 25–100%. Focus is 100%. This is
not a promise that every card can show a 1920×1080 CSS viewport at an arbitrary
exact fractional zoom.

## Consequences

Users do not tune per-screen zoom settings in this first implementation. The
policy is automatic and reversible in code, with no new persisted field or
config migration. ADR-0006 needs no Correction for a field that was not added.

The failed wheel-counter reset from Part D is not used. Production sends measured
native reset/preset commands relative to the profile's read-only default zoom
(ADR-0028). Repeated card → focus → card transitions, reload, cancellation,
non-100% defaults and wrong-PID rejection are covered against the bundled browser;
the factor policy has fast tests.

## Alternatives not chosen

- **One fixed reduced factor:** leaves the focused screen unnecessarily small.
- **A manually configured per-screen factor:** adds a user-facing setting and
  persistence contract before automatic sizing has proved insufficient.
- **Keep card-derived scaling in focus:** uses the extra area for more content
  rather than the full-scale readability the owner requested.
