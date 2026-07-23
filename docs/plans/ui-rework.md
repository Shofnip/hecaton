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

### Findings

_To be filled by the spike session, per item, with the Chrome and Windows versions measured._

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
- The F5 sender, in the shape 0.3 validated.

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
