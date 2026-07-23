# UI rework — implementation plan

> **Working document — scaffolding, not structure.** It guides the rework's execution and is
> deleted when the work lands: everything durable migrates to ADR-0011 and `architecture.md`.
> The decisions recorded here were taken by the project owner on 2026-07-22 and are **not to
> be re-litigated** by an implementing session; anything not decided here follows the usual
> rules (security and product forks stop the work and go to the owner).

## What is changing

The panel becomes a single-window "video wall" — spec in
[docs/design/design.md](../design/design.md), visual prototype in
[helloweb-rework.jsx](../design/helloweb-rework.jsx): sidebar, up to four screen cards, an
in-app focus mode with thumbnails, fullscreen, per-screen volume, light/dark themes. The game
windows are **embedded in the shell window**: Chrome is still spawned exactly as today (no
CDP, per-slot `--user-data-dir`), and its windows are reparented into the panel via Win32
`SetParent`.

## Decisions taken (owner, 2026-07-22)

1. **Architecture B — reparent spawned Chrome; the Electron-webview path is rejected.**
   Webview (which §13 of the design spec assumed) would move logged-in sessions into the
   Electron process (against ADR-0007's posture), lose Chrome's password manager (worse
   re-login, see ADR-0009), and Electron has no per-webContents volume API — while Turnstile
   acceptance inside Electron was never measured. Reparenting keeps everything already
   proven: Turnstile, profile lifecycle (ADR-0005/0008), saved passwords, WASAPI.
   **Consequence: design.md §13's Electron notes (webview events, `page-favicon-updated`,
   `setAudioMuted`) do not apply.** The rest of the spec — visuals, behaviour, official UI
   strings — stands.
2. **Audio-follows-focus changes semantics**: it follows the app's **focus mode**, no longer
   the OS foreground window. Toggle on + no screen in focus mode (normal grid) = **all**
   screens audible at their configured volume; focusing one screen mutes the others;
   leaving focus mode restores all.
3. **Per-screen volume** (new) via WASAPI `ISimpleAudioVolume.SetMasterVolume` — the same
   session interface the mute adapter already drives. The adapter is promoted from a
   per-call PowerShell shell-out (~270 ms) to a **persistent PowerShell worker**
   (stdin-driven, still zero npm dependencies) so slider drags are fluid.
4. **Re-adding a screen gets a fresh profile** — ADR-0008 unchanged; archived profiles stay
   untouched. (The design spec left this open; it is closed here.)
5. **Favicon is bundled** — the Poke IdleWorld icon ships in the app; a generic globe covers
   custom URLs. Zero network: `connect-src 'none'` stands. The Sora font is bundled too
   (SIL OFL); nothing is fetched at runtime.
6. **Background throttling is disabled by default** for embedded screens — the farm must
   keep running while hidden; the resource cost is accepted. Launch flags:
   `--disable-background-timer-throttling --disable-backgrounding-occluded-windows
--disable-renderer-backgrounding`. A **per-screen toggle** in the edit modal (additive
   config field, no schema bump) re-enables throttling for screens where saving resources
   matters; like `--mute-audio`, it applies on the screen's next start and the UI must say
   so. These flags are fragile across Chrome versions (precedent: `--load-extension`), so
   the spike records the Chrome version measured.
7. **Approved IPC channels** — a fixed contract; any channel beyond these stops the work
   (CLAUDE.md rule 2): `slots:rename` (id + name ≤ 24 chars), `slots:setVolume`
   (id + 0–100), `slots:setMuted` (id + bool), `slots:reload` (id), `ui:setTheme`
   (`'light' | 'dark'`). All payloads validated in the main process by core validators, as
   today. **Removed**: `grid:restore` (restore-grid has no purpose in a single window) and
   the save-password panel hint.

## Step 0 — reparenting spike (the gate for everything else)

Disposable probe code, Phase-0 style — outside the packages, no TDD (nothing ships), findings
recorded in this section and later carried into ADR-0011. **Go/no-go is the owner's decision**
on the results.

| #   | Question                                                                                                                                                           | Decision criterion                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 | `SetParent` of a spawned Chrome window into the Electron window: mouse/keyboard input, resize sync, DPI, z-order under panel modals, Chrome popups                 | The embedded game is fully playable; no input loss. This is the highest-risk item — if it fails, the rework stops here                                                      |
| 0.2 | Kill helloweb with children reparented → windows must survive on the desktop → a new helloweb re-resolves PIDs by the `--user-data-dir` tag and **re-adopts** them | If adoption works: reopening recovers the farm. If not: closing helloweb closes the Chromes (`CloseMainWindow`), and the next launch detects orphans by tag and closes them |
| 0.3 | Synthetic F5 (`PostMessage`/`SendInput`) reload without stealing focus from another screen                                                                         | Reload keeps the login (sessionStorage survives a reload — consistent with ADR-0009; field-tested by the owner)                                                             |
| 0.4 | `ISimpleAudioVolume.SetMasterVolume` per slot through a persistent PowerShell worker                                                                               | Latency fluid enough for a drag on the volume slider                                                                                                                        |
| 0.5 | Hidden-window throttling, four cells: hidden × with/without the three flags, measuring rAF/timers in the page                                                      | A background screen must keep running (default). Plan B if the flags fail: position the window off-view instead of `SW_HIDE`                                                |
| 0.6 | Turnstile sanity on a reparented window                                                                                                                            | Login passes (real Chrome, no CDP — expected, but measured, not assumed)                                                                                                    |

**Decision (owner, 2026-07-22): GO.** All six items passed; Step 1 may start.

### Findings

Measured 2026-07-22 on **Chrome 150.0.7871.181**, **Windows 11 Pro 25H2 (build 26200)**,
**Electron 43.2.0**, single monitor 1920×1080 at 96 DPI (100 % scaling — mixed-DPI behaviour
was not measurable on this machine). Probe code in `spike/` (untracked, disposable); telemetry
was read out of the probe page's `document.title` via `GetWindowText` on the hwnd resolved by
PID — zero network, consistent with the no-CDP rule.

**0.1 — SetParent: GO.** All criteria pass (`s01`, failures=0).

- Reparent (`SetParent` + `WS_CHILD`, popup/caption/thickframe styles stripped) takes ~40 ms;
  the child follows panel resizes pixel-exactly; the page relays out and stays interactive;
  survives `SW_HIDE`/`SW_SHOW`; detach + `WM_CLOSE` still closes Chrome cleanly.
- **Real user input all works**: clicks, typed text incl. accents/dead keys (`ççç ã`), wheel,
  arrow keys — verified by hand by the owner in the embedded window.
- Two things the shell MUST do (both cheap, both verified — first synthetically, then live
  against the real game in 0.6, where their absence was reproduced as "can click but not
  type" / "can type but not click" and their application fixed each, immediately):
  1. **Forward keyboard focus** — clicking a foreign-process `WS_CHILD` does not reliably
     move keyboard focus to Chrome, and alt-tabbing away and back always parks it on the
     Electron side. `AttachThreadInput` + `SetFocus` on the child fixes it. Production hooks:
     `WM_PARENTNOTIFY` reaches the parent on every child click (`win.hookWindowMessage`
     exposes it) and the BrowserWindow `focus` event covers re-activation; a 0.8 s-interval
     stand-in loop ("babysitter") validated the behaviour end-to-end during the 0.6 login.
  2. **Re-assert `HWND_TOP` on every bounds sync AND on activation changes** — Electron is
     Chromium too, and its own input hwnd (`Chrome_RenderWidgetHostHWND`) re-raises itself
     on parent resize _and_ on ordinary focus/activation traffic, sitting over the embedded
     child and swallowing every click. One `SetWindowPos(HWND_TOP)` after `MoveWindow` (and
     on the same activation hooks as above) cures it. Symptom to remember: clicks dead but
     painting fine (Electron paints via DirectComposition, so paint order and hwnd z-order
     disagree).
- The child window keeps ~14×37 px of Chrome-internal frame (the `--app` title strip): the
  page viewport is smaller than the cell by that; the strip's ⋯ menu at top-right **captures
  input if clicked** — the shell should overlay or avoid that region.
- **Panel modals paint UNDER the embedded child** (2 % of a magenta test modal visible over
  it). Mitigation verified: `SW_HIDE` the child while a modal is open (modal then 100 %
  visible; page unharmed; input fine after re-show).
- `window.open` popups appear as free top-level windows on the desktop (at the spawned
  window's original position), not inside the panel. Recorded; UX treatment is a design
  decision for the implementation phase.
- DPI: both windows report 96; nothing to observe at 100 % scaling.

**0.2 — kill/orphans: the plan's fallback branch is the reality.** Killing the shell process
with a child reparented **destroys the child window and the Chrome process exits with it**
(verified: process gone, no window left, nothing to re-adopt; `s02a`/`s02b`). So "reopening
recovers the farm" is off the table — but so is the orphan problem: a shell crash cannot leave
strays behind, and the tag-scan cleanup the criterion asked for as plan B has nothing to find.
Consequence worth naming: **a shell crash takes every screen down with it** (today's free
windows survive a panel crash). Since the game's login is tab-bound (ADR-0009), those sessions
would have needed a re-login after any restart anyway; the regression is the lost _uptime_ of
farms left running, not lost sessions. The graceful path (detach → `WM_CLOSE`) is measured
clean in 0.1.

**0.3 — synthetic reload: GO, via `WM_APPCOMMAND`, not F5.** The winning shape:
`SendMessage(hwnd, WM_APPCOMMAND, hwnd, APPCOMMAND_BROWSER_REFRESH<<16)` straight to the
embedded top-level — reloads in **~310 ms**, needs no focus, no clicks, steals nothing
(foreground verified unchanged), repeatable, `sessionStorage` survives (login stays, per
ADR-0009). Everything else measured dead on an embedded window: posted/`SendMessage`'d F5
key events reach the page but Chrome's browser-side accelerator never fires (embedding
starves the window of real activation; the same input reloads a free-standing control window
fine), `WM_ACTIVATE` spoofing does not help, and the detach→click→F5→re-embed workaround
works (~850 ms) but clicks the game — kept only as a fallback note. Caution for the adapter:
the appcommand code is 3; **18 launches the Calculator** (measured the hard way).
Owner-confirmed nuance that raises this item's importance: **an in-tab reload (F5 — what the
appcommand performs) is the ONLY operation that preserves the game's login.** Navigating away
and back, reopening the page, or a new tab all lose the session. So the appcommand reload is
the one session-safe recovery tool the shell has, and any "re-navigate to the URL"
alternative is ruled out.

**0.4 — persistent volume worker: GO.** The mute adapter's C# surface plus
`ISimpleAudioVolume.SetMasterVolume`, compiled once in a persistent PowerShell worker
(stdin line protocol, zero npm deps): **avg 12 ms, p50 12 ms, p95 13 ms, max 19 ms** per
volume change over a 61-step simulated drag — ~20× under the 270 ms/call shell-out and
comfortably fluid. Session found by the same browser-pid → audio-service-child mapping as
the mute adapter; volume readback exact. Worker compile-to-ready is ~680 ms, overlapping
app startup. (Spike-only flag `--autoplay-policy=no-user-gesture-required` used so the probe
tone could start a session; production needs no such flag — the game plays audio after real
user gestures.)

**0.5 — throttling: GO; flags work; plan B also verified.** rAF/s and 100 ms-timer ticks/s
measured in-page, embedded, per cell (~10 s samples after a 12 s settle):

| cell             | no flags                 | with the three flags    |
| ---------------- | ------------------------ | ----------------------- |
| visible embedded | raf ≈ 144, tmr = 10/s    | raf ≈ 144, tmr = 10/s   |
| `SW_HIDE`        | raf = 0, tmr ≈ **1.8/s** | raf = 0, tmr = **10/s** |
| moved off-view   | raf ≈ 144, tmr = 10/s    | raf ≈ 144, tmr = 10/s   |

With the flags, a hidden screen keeps full timer rate (the farm's requirement); rAF stops
either way (`visibilityState` goes `hidden` — expected and harmless for idle games, which
run on timers/workers, but recorded). Off-view positioning keeps even rAF at full rate with
`visibilityState: visible` — a stronger plan B than expected, flags or not. Caveat: Chrome's
_intensive_ throttling (≥5 min hidden) was not held long enough to observe; if it ever bites,
plan B sidesteps it entirely. rAF ≈ 144 (not 60) on this machine's uncapped compositor —
values are rates, not vsync-locked.

**0.6 — Turnstile on a reparented window: GO.** Owner-verified live, on a **throwaway temp
profile** (worst case: no device-trust cookie): Turnstile passed inside the embedded window,
login completed, and the game was played normally — clicks, typing, paste, and returning
after alt-tab all fine once the focus/z-order forwarding above was active. One environmental
note: the login flow involves alt-tabbing to fetch the password, which is exactly what
exercises finding 0.1-(1)/(2); without the forwarding hooks the window degrades to
"click-only" or "type-only", so those hooks are a hard prerequisite, not a polish item.

## Step 1 — core (fast suite, strict TDD)

- Config: additive per-slot fields `name`, `volume`, `muted`, `backgroundThrottling`
  (no schema bump — absent fields get today's behaviour, except `backgroundThrottling`
  which defaults to **off** per decision 6).
- The audio policy rewritten for the new semantics (decision 2): inputs are focus-mode
  state, the global toggle and per-slot volume/mute; outputs are per-slot commands. A slot
  is touched only when its effective state changes, as today.
- Grid math becomes bounds-in-a-container computation (`computeGrid` likely survives with a
  new container origin); restore-grid removed from core, orchestrator and IPC contract.
- Ports extended: `AudioController.setVolume`; `WindowManager` reparent/hide/show; a reload
  capability. Fakes in `core/src/testing/` updated with them.

## Step 2 — adapters (integration tests, real Chrome / windows / disk)

- window-manager: reparent, bounds sync on shell resize, and orphan adoption **or** cleanup
  (whichever Step 0.2 established).
- The persistent WASAPI worker replaces the per-call shell-out (mute + volume).
- The reload sender, in the shape 0.3 validated: `WM_APPCOMMAND` with
  `APPCOMMAND_BROWSER_REFRESH` (code **3** — 18 opens the Calculator).

## Step 3 — renderer

- The design.md UI in plain HTML/TS, zero dependencies, CSS in files — the CSP is unchanged
  (no `unsafe-inline`; the prototype's inline styles are **not** ported as inline).
- Sora and the favicon bundled; theme persisted; focus mode with the draggable thumbnail
  divider, fullscreen, volume popover, toasts, and the official strings from design.md §9.

## Step 4 — documentation

- **ADR-0011**: embedding reverses the presentation half of ADR-0002 (real windows remain,
  but inside the shell window rather than free on the desktop); ADR-0007's posture is
  intact — the renderer still hosts no remote content. Written with the spike measurements
  inside, as ADR-0003 was for Phase 0.
- `architecture.md` body updated in the same commits that change behaviour; README updated;
  troubleshooting entries for anything the spike made expensive to diagnose.
- Delete this file once all of the above has landed.
