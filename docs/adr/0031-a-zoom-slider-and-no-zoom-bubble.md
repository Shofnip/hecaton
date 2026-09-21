# ADR-0031 — A zoom slider per screen, and no zoom bubble

**Status:** Accepted · **Date:** 2026-09-21

## Context

[ADR-0027](0027-card-derived-zoom-and-full-scale-focus.md) gave every screen a zoom the app
derives from its card, 100% in focus, and **no configuration field** — automatic sizing was to
be proved insufficient before a setting was added. Two things then showed up in use.

**The app provokes Chrome's zoom bubble, repeatedly.** Zoom is applied by posting Chrome's own
`WM_COMMAND` ids ([ADR-0026](0026-page-zoom-over-launch-scale.md)), so Chrome answers the way it
answers a user: with a bubble over the top right of the card. Entering focus, leaving focus,
entering fullscreen and leaving it each change factors, so on a wall of six screens the owner saw
a burst of them. `docs/architecture.md` had recorded what that bubble is since 2026-09-20 —
measured, and deliberately left alone at the time.

**Automatic sizing is not always the size the user wants.** The owner asked to be able to set a
screen's zoom by hand, and to turn the app's own choice back on.

A second disposable probe, `spike/bubble`, measured what a suppressor would need. Against the
bundled Chromium: the bubble is a top-level `Chrome_WidgetWin_1` of the browser process, 294×64,
**with a blank window title**; it becomes visible 97 ms after the first command of a session and
15–16 ms after later ones; it dismisses itself after ~1.3 s; `ShowWindow(SW_HIDE)` removes it and
the page keeps the zoom it was given. Every **other** untitled top-level window that process owns
— its status tray, its power-message window, the IME windows, a hidden `Chrome_WidgetWin_0` — was
measured **invisible**. `node-window-manager`, the enumeration the adapter already uses, lists the
bubble with `isVisible() === true` and `getTitle() === ''`.

One correction to the 2026-09-20 note: it recorded that Chrome **reuses the bubble's handle** once
it is hidden. This probe saw three different handles across three commands, so a suppressor must
re-find the window every time and may not remember one.

## Decision

Three things, all chosen by the owner on 2026-09-21 after the trade-offs were put to them.

**1. Hide the bubble, and stop provoking it needlessly.** A bounded sweep hides visible top-level
windows of that screen's browser whose title is blank, for 900 ms after each zoom command the app
sends. Separately, a screen that is merely **hidden** no longer forgets the zoom it was given, so
returning from fullscreen re-sends nothing for the screens whose factor did not change; a reload
and a restart still invalidate it, because there the document or the process is a new one.

**2. A zoom slider per screen, persisted.** The magnifier on the control bar opens a slider in the
overlay window — the same component as the volume popover, and in the same place — with a live
percentage and an `Auto` button. Dragging it turns the automatic mode off. Two optional fields,
`zoomAuto` and `zoom`, join `volume` and `muted` in a slot's overrides; absent means automatic, so
no existing config file needs migrating and `SCHEMA_VERSION` does not move.

**3. A manual factor holds everywhere.** With the automatic mode off, the user's factor applies in
the card, in focus and in fullscreen alike. Manual means the app stops choosing, which also means
those transitions send no zoom command at all.

This reverses two parts of ADR-0027: that there would be no configuration field, and that focus is
always 100%. **Neither is reversed for a screen left on automatic**, which is still every screen
until somebody moves a slider.

## Consequences

**The IPC surface grows by two channels**, `slots:setZoomAuto` and `slots:setZoomRung`, and the
overlay gains a `zoom` request beside `volume`. Neither channel carries a zoom: the slider sends
**which notch**, an index into `MANUAL_ZOOM_PRESETS`, and the core says what that notch is worth.
So a renderer can ask for the fourth notch and never for "400%" — the property the owner chose
when the shape was put to them, and the same reasoning that makes `slots:move` carry one screen
rather than an ordering. The ladder is pushed to the panel in the state, because it is a
measurement against the bundled Chromium and it moves when that pin moves.

**The app now hides windows belonging to the browser**, which it did not before. The rule is
narrow — blank title, visible, not the embedded screen, and only within 900 ms of a command the
app itself sent — and the save-password bubble is _titled_, so it is not touched. The exposure the
owner accepted is that an untitled popup of the page, such as a select dropdown, could be hidden
if it were open in that window; the next interaction brings it back, and no state is lost. One
timer serves the whole wall, so the cost is one desktop enumeration (~7 ms) per tick regardless of
how many screens changed at once.

**The zoom range differs from the automatic one.** Automatic clamps to 25–100%; the slider runs
25–200%, still on the measured preset ladder, so every notch is a factor the native commands can
name. It is not the browser's full 25–500%: a card at 500% shows a handful of pixels of the game.

`spike/bubble` is gitignored like every probe, so its numbers live in this file and in
`docs/architecture.md`. The suppressor and the manual factor are covered against the real bundled
browser in `embedded-zoom.integration.test.ts`; the ladder, the mode and the "a drag that rests on
one notch sends nothing" rule have fast tests.

## Alternatives not chosen

- **Leave the bubbles and stop changing zoom on focus/fullscreen.** The most conservative option —
  the app would never hide a browser window — but it re-opens the small-focused-screen problem
  ADR-0027 was written to fix, and a slider drag would still raise a bubble per notch.
- **Match the bubble by size (294×64) as well as by blank title.** Narrower, at the price of a
  constant that moves with display DPI and with the Chromium pin, and that would fail silently and
  invisibly when it did. The probe showed the title alone already separates it from everything
  else that process owns.
- **One channel carrying a factor.** Less code, and it would let the panel assert a zoom. The
  owner chose the narrow shape.
- **Session-only manual zoom.** No config field, no reversal of ADR-0027 — and the user would
  re-drag every slider at every launch.
