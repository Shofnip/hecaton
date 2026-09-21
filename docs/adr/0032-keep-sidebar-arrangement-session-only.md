# ADR-0032 — Keep sidebar arrangement session-only

**Status:** Accepted · **Date:** 2026-09-21

## Context

The sidebar gained two personalisation controls: the three frequent actions can be
reordered by dragging, and the bar can be collapsed to a 16px strip. The owner also
chose to hide the whole bar in focus mode, where leaving focus is the route back.

The order and collapsed state could have joined the persisted config, but that would
turn two small presentation details into a durable product contract: new fields,
validation, IPC, save failures and a policy for applying one profile's arrangement to
another window. The alternative was to keep both in renderer memory, reset them to the
shipped order and expanded state at every launch, and let focus mode hide the current
session's arrangement without destroying it.

## Decision

Sidebar order and collapsed state are **session-only renderer state**. The three
reorderable actions start in the shipped order — power, add, profiles — and the bar
starts expanded on every launch. Settings remains anchored below the spacer and never
participates in the order.

Entering focus hides the entire sidebar, including its expand/collapse arrow. Leaving
focus restores the same order and collapsed state that the current renderer session had
before focus. Fullscreen continues to cover the sidebar with its own layer.

No config field, storage call or IPC channel represents either preference.

## Alternatives and consequences

- **Persist both settings in the account config.** This best respects a user's
  customisation across launches and is the most conservative option for preserving what
  they chose. It also makes a minor layout preference part of the durable schema and
  account semantics. It was declined for now: reopening to a predictable, usable default
  matters more than remembering two quick adjustments.
- **Persist only the order.** Order looks more intentional than a temporary collapse,
  but splitting two controls introduced together creates two different memory rules in
  the same strip. The distinction did not buy enough to justify it.
- **Keep a collapsed strip visible in focus mode.** That preserves direct access to the
  sidebar, but gives focus mode a second exit/control surface and spends width on UI whose
  purpose is to remove distractions. Hiding the bar was chosen instead.

The cost is that somebody who always wants a different order or a collapsed bar repeats
the gesture after every launch. The choice is reversible: persistence can be added later
with explicit config fields and validated channels; no stored data needs migrating away
from this decision.
