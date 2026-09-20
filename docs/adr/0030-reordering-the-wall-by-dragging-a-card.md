# ADR-0030: Reordering the wall by dragging a card's head

Status: Accepted
Date: 2026-09-20

## Context

The order of the screens on the wall was fixed. `parseConfig` preserved the
order of the `slots` array and the renderer drew `state.slots` as given, so the
order looked like a contract — but `Orchestrator.slotConfigs()` and
`layoutIds()` both sorted by id, so what came back out was the id order and any
arrangement was undone at the next save. The owner asked for the wall to be
reorderable.

Two things made this more than a UI question. A screen's id is its profile
directory name (`slot-N`), so anything that reorders by renumbering swaps
logged-in game sessions between cards. And the cards are not ordinary DOM: each
running screen's viewport is covered by a reparented Chromium window belonging
to another process, so it was not known whether a drag could cross one at all,
or whether drop feedback could be drawn under one.

## Evidence

Probe `spike/scenarios/s07.cjs`, run 2026-09-20 on Windows 11 26200 at 96 dpi
with the bundled Chromium and a throwaway profile. Each mode twice. The setup
was verified before anything was concluded from it: the child's rectangle equals
the cell's exactly, its style carries `WS_VISIBLE`, and `WindowFromPoint` at the
drop point returns a window owned by the Chromium pid.

An earlier version of the probe classified that window by `GA_ROOT` and window
class. Both are wrong here: after `SetParent` the child's root _is_ the panel,
and both windows report `Chrome_RenderWidgetHostHWND`. It reported "panel" for
every mode and the whole run passed for free. Only the owning pid separates
them.

Input, comparing a plain drag, `setPointerCapture`, and hiding the embedded
windows for the duration:

| mode    | under the drop | moves / inside the covered cell | `pointerup` | drop target |
| ------- | -------------- | ------------------------------- | ----------- | ----------- |
| plain   | child          | 24 / 8                          | yes         | correct     |
| capture | child          | 24 / 8                          | yes         | correct     |
| hidden  | panel          | 24 / 8                          | yes         | correct     |

No difference. Windows gives the panel implicit mouse capture for as long as the
button is down, so every `WM_MOUSEMOVE` reaches the widget that took the press,
across a child window owned by another process. `document.elementFromPoint`
resolves the correct card throughout, because the embedded window is not in the
document.

Painting, counting a flat fill inside the covered cell and inside a free one:

| child  | covered cell | free cell |
| ------ | ------------ | --------- |
| shown  | 0 / 2312     | 2312/2312 |
| hidden | 2312/2312    | 2312/2312 |

A native child HWND always paints over the host's DOM. What stays visible is the
card head — 32px in the probe's own page, ~22px in the app — which the child does
not cover.

The gesture was then measured against the running application: dragging the
first card onto the fourth reordered the wall and persisted `[2, 3, 4, 1]`;
dragging it back restored `[1, 2, 3, 4]`; a press that did not travel still
toggled focus.

## Decision

**Interaction.** A card is dragged by its head, with no pointer capture and
without hiding anything, and the feedback — "this one is moving", "it would land
here" — is drawn in the card heads. Two alternatives were weighed and declined:
move arrows in the head (the most conservative option, no pointer machinery and
no contact with native glass, but N−1 clicks to cross the wall), and an explicit
"Organizar" mode that hides the screens for the duration (a clearer state
boundary, at the cost of a mode that blanks live sessions and must never stick).
The owner chose the drag.

**Channel.** One new IPC channel, `slots:move`, carrying `{id, toIndex}` and no
ordering of its own. The panel names the screen that moved and where it landed;
the new arrangement is computed in the core from the order it already holds.
`parseSlotMove` validates the shape, the orchestrator validates the range —
it is the only thing that knows how long the wall is. Arrows, if they are ever
added, are this same channel with `toIndex = index ± 1`.

**Ordering.** The wall order is the insertion order of the orchestrator's slot
map, and it is what `slotConfigs()` writes to the config file. The sorts in
`slotConfigs()` and `layoutIds()` are removed. This reverses the unstated
earlier decision that the wall was ordered by id.

**Ids are never renumbered.** `moveSlot` moves positions and touches no field of
any slot.

## Alternatives and consequences

A channel carrying the whole arrangement would be one idempotent write, and was
rejected: it lets the panel assert an order, where `{id, toIndex}` lets it name
a move. The damage either way is bounded — validation forces the same set of ids
— but the smaller authority costs nothing here.

Putting the drop-target rule in the core was considered and dropped. The
renderer reaches it by `elementFromPoint`, which is a DOM lookup rather than a
rule; a core module for it would have had to be copied into the renderer bundle,
since the renderer has no bundler and loads plain ES modules under
`script-src 'self'`. The rules that are rules — the range check and the
no-renumbering guarantee — are in the core and tested there.

Declining pointer capture is measured but not free. A capture would guarantee a
`pointercancel` when the gesture is interrupted; without one, a release the
window never sees leaves the drag live, which freezes the wall and would commit
a move on the user's next click. The gesture therefore ends itself on a move
with no button held and on the window losing focus. Both were added after
review; neither was reproduced on a live desktop, because staging a lost release
proved unreliable — the probe that tried it hung with the button down. They
guard a path the code plainly allows rather than one that was observed.

Adding a screen now appends it to the end of the wall rather than placing it by
id. That follows from the order no longer being the id order, and it is the
behaviour a user arranging cards would expect.

Reversible: removing the head's `pointerdown` handler disables the gesture, and
restoring the two sorts restores the old behaviour. The config file needs no
migration in either direction — an array it already had simply stops being
re-sorted.
