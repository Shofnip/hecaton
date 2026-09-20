# ADR-0026 — Page zoom over launch-time device scale

**Status:** Accepted · **Date:** 2026-09-20

## Context

An embedded Poke IdleWorld screen at normal scale does not fit its useful HUD into
a small card. Two mechanisms were measured with the bundled Chromium
156.0.8065.0: page zoom and `--force-device-scale-factor` at launch. The disposable
probe is `spike/scale`; its A–C results are in `out/page.txt` and real-game Part D
in `out/part-d-status.md`. The findings below survive those ignored artifacts.

Part D used one screen, a 620×350 card and a 1500×800 focus rectangle, with one
completed login per mechanism after a network-limit interruption. Hunt Analyzer
and its Capture Log were opened in both sessions; a Caterpie hunt was exercised
in the zoom session. At 100% the card clipped the Analyzer. Page zoom at 25% and
50%, and launch factor 1/3, accommodated both panels. A coordinate click selected
the visible Shiny filter in each mechanism. These are not equal-factor tests or
a full click-coordinate calibration.

The launch factor also scales Chromium's own UI and its title-strip allowance.
It remains fixed when the card grows into focus: at 1/3, the HUD stayed tiny in
the larger rectangle. Page zoom leaves that native allowance unchanged and can
change within the running session. Avoiding a relaunch matters because the game
requires another login after its tab closes (ADR-0009).

## Decision

**Use page zoom as the screen-scaling mechanism, not a launch-time device-scale
factor.** The owner chose zoom after reviewing the practical difference in focus
mode. ADR-0027 subsequently selected the factor policy, and ADR-0028 authorized
the restricted preference read needed by the implementation.

The implemented policy derives zoom from each card, restores 100% in focus mode,
and adds no configuration field. It preserves readable UI in focus without
ending the game session.

## Consequences and implementation

Posted Ctrl+wheel changed zoom, but counting commands was not an invertible
control: Part D's supposed reset to 100% produced 150%, verified against the
browser's persisted host zoom level. The probe's button label was corrected;
that mechanism was not promoted into production. Follow-up measurement selected
native reset/preset commands, with the reset planned relative to the profile's
read-only default zoom preference (ADR-0028).

The pure policy, bounded preference reader and native adapter are wired into the
shell and covered by fast and real-browser integration tests. No config, grid,
CDP, extension, profile write or renderer IPC change was added. Because there is
no config field, ADR-0006 needs no Correction.

The later reproducible cursor/click failure was a separate native stacking defect
and is fixed by ADR-0029, with the owner's exact PokeIdle sequence passing after
the change. That does not establish input-queue topology: the non-reproducing
transient-attach claim still does not justify changing FocusChild.

## Alternative rejected

**Launch-time device-scale factor.** A precise scale was measured, including 1/3,
but it also changes browser chrome and cannot change with card/focus transitions
without restarting the screen. Its fixed tiny HUD in focus is the practical
cost the owner chose to avoid. It is not rejected on a claim that zoom has better
legibility at an identical scale; that comparison was not measured.
