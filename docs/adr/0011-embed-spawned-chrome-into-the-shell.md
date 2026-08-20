# ADR-0011 — Embed the spawned Chrome windows into the shell (video wall)

**Status:** Accepted · **Date:** 2026-07-26

## Context

The panel was redesigned into a single-window "video wall" (spec:
[docs/design/design.md](../design/design.md)) — a thin sidebar, up to four screen cards, an
in-app focus mode, per-screen rename/volume/reload, light/dark themes. The question this ADR
settles is how the game surfaces appear inside that one window.

Two ways to put a game inside the panel:

- **Reparent the spawned Chrome window** into the shell window with Win32 `SetParent`, so it
  becomes a child of the panel. Chrome is still spawned exactly as before (no CDP, per-slot
  `--user-data-dir`).
- **An Electron `<webview>`** loading the game url inside the Electron process.

This reopens the presentation half of [ADR-0002](0002-real-windows-over-thumbnails.md), which
chose real OS windows arranged **on the desktop** and noted "the app cannot render anything over
the game." A single-window wall with an in-app HUD needs both halves reconsidered.

## Decision

**Reparent the spawned Chrome windows into the shell window.** Real Chrome windows remain — the
core of ADR-0002 stands — but they live embedded in the panel rather than free on the desktop.
The Electron-webview path is **rejected**.

This **supersedes the presentation half of ADR-0002** (windows are embedded, not free; and the
app now _can_ render over a game — see the overlay below) while keeping its substance: these are
real Chrome windows, not a screencast, so "see all at once" and "interact without selecting"
still come for free.

The webview was rejected because it would move logged-in sessions into the Electron process
(against [ADR-0007](0007-electron-security-posture.md)'s posture), lose Chrome's password
manager (worse re-login, [ADR-0009](0009-login-is-bound-to-the-tab.md)), and Electron has no
per-`webContents` volume API — while Turnstile acceptance inside Electron was never measured.
Reparenting keeps everything already proven: Turnstile, the profile lifecycle (ADR-0005/0008),
saved passwords, and the WASAPI audio path (ADR-0010).

A Phase-0-style reparenting spike gated the decision; all six items passed and the owner decided
**go** (2026-07-22). The findings are folded into Verification below, as ADR-0003 did for Phase 0.

## Consequences

- **Geometry is the renderer's, not the core's.** Only the DOM knows where each card's viewport
  sits, so the renderer measures the viewports and sends per-screen rectangles over a validated
  `screens:layout` IPC channel; the core relays them (`Orchestrator.applyScreenLayout`) and no
  longer tiles. `retile()`/grid-driving and the `grid:restore` channel are gone (a single window
  has no grid to drag out of place). `computeGrid` survives only to seed a launch size.
- **The app can now render over a game.** Modals and the volume popover are DOM, and a child
  Chrome window always paints over the panel's DOM — so they live in a **second, always-on-top,
  transparent overlay `BrowserWindow`** that mirrors the panel's content rectangle. This directly
  reverses ADR-0002's "cannot render anything over the game," and it is why the in-app HUD did
  not need the deferred extension route. Two IPC channels drive it: `overlay:open`/`overlay:close`.
- **Audio follows the app's own focus mode, not the OS foreground** (owner decision, 2026-07-22).
  With the toggle on and no screen focused, every running screen plays at its configured volume;
  focusing one mutes the others; leaving focus restores all. This changes the semantics
  [ADR-0010](0010-audio-follows-focus-without-a-dependency.md) described (see its Correction), not
  the WASAPI-shell-out decision itself. **Per-screen volume** is added, through the same
  `ISimpleAudioVolume` session, and the mute/volume adapter is promoted from a per-call shell-out
  (~270 ms) to a **persistent PowerShell worker** (stdin line protocol, still zero npm deps) so
  slider drags are fluid (~12 ms/change). The window-manager gets the same persistent-worker
  treatment for its Win32 calls, for live resize.
- **Launch off-screen, reveal in place.** Without CDP the window is born top-level and shown
  before it can be embedded, so it is launched far off-screen (`-32000`); the adapter hides it on
  reparent and the renderer's first layout shows it already positioned — no desktop flash.
- **Fit the game, clip Chrome's chrome.** The `--app` window keeps a Chrome-drawn title bar and a
  ~7 px invisible frame that no flag or style-strip removes. `movechild` sizes the window so the
  **game** (client minus title bar) fills the viewport and then `SetWindowRgn` clips the window to
  just that game area — the title bar and frame become invisible and, since a clipped region takes
  no input, the screen can no longer be dragged out of place. Also launched with `--hide-scrollbars`
  (cosmetic) and the three background-throttling flags (decision 6), with a per-screen toggle to
  re-enable throttling.
- **Keyboard focus and z-order need active help.** A `WS_CHILD` in another process does not take
  keyboard focus from a click, and Electron's own input hwnd re-raises itself over the child. The
  shell forwards focus on a `WM_PARENTNOTIFY` click hook (`AttachThreadInput` + `SetFocus`, done on
  the click — **not** on reparent, where attaching to four launching Chromes froze the cursor), and
  `movechild` re-asserts `HWND_TOP` after every move.
- **Closing must be graceful through the child.** `CloseMainWindow` cannot reach a reparented
  child (it has no top-level main window), so the window-manager posts `WM_CLOSE` to the child
  (`WindowManager.close`, called before the launcher stops the process) — otherwise the launcher's
  grace period elapses and the browser lingers seconds before a force-kill.
- **Never block the main thread.** The launcher's PowerShell/`taskkill` shell-outs are `execFile`
  (async), not `execFileSync` — a synchronous PowerShell start (~300 ms) on Electron's main thread,
  once per pid poll on launch and once on stop, froze the cursor.
- **A shell crash takes every screen down with it** (0.2). Today's free windows survive a panel
  crash; an embedded child dies with its parent. Since the game's login is tab-bound (ADR-0009) a
  restart needs a re-login anyway, so the regression is lost _farm uptime_, not lost sessions. The
  two persistent workers (Win32, WASAPI) are disposed on quit so no orphaned `powershell.exe` is
  left behind.
- **Config gains additive per-slot fields** — `name`, `volume`, `muted`, `backgroundThrottling`
  (and a global `theme`) — absent fields keep today's behaviour, so no schema bump.
- The renderer stays within [ADR-0007](0007-electron-security-posture.md): both windows load
  local files under the same locked-down `webPreferences`, no `unsafe-inline`, `connect-src 'none'`
  — so the bundled Sora font (SIL OFL) and Poke favicon ship with the app, never fetched.

## Alternatives rejected

- **Electron `<webview>`** — the design spec's §13 first assumed it. Rejected for the reasons
  above: sessions into Electron, no password manager, no per-webContents volume, Turnstile
  unmeasured. §13 was rewritten on 2026-07-22 for the reparenting equivalents.
- **Keep windows free on the desktop with an out-of-process HUD** — this is ADR-0002 as written;
  it cannot render over a game and does not give the single-window wall the redesign called for.

## Verification

The reparenting spike (2026-07-22, **Chrome 150.0.7871.181**, Windows 11 Pro 25H2, Electron 43.2.0,
single 1920×1080 at 96 DPI) measured all six gates; the durable results:

- **0.1 SetParent — go.** Reparent (`SetParent` + `WS_CHILD`, popup/caption/thickframe styles
  stripped) ~40 ms; the child follows panel resizes pixel-exactly and stays interactive, incl.
  typed accents/dead keys, wheel, arrows. Two obligations, both since implemented: forward keyboard
  focus (`AttachThreadInput`/`SetFocus`, driven from `WM_PARENTNOTIFY` + the BrowserWindow `focus`
  event) [see Correction (2026-08-20)] and re-assert `HWND_TOP` after moves and on activation, or Electron's
  `Chrome_RenderWidgetHostHWND` swallows clicks (symptom: clicks dead but painting fine). Panel
  modals paint _under_ the child — solved by the overlay window. `window.open` popups appear as
  free desktop windows.
- **0.2 kill/orphans.** Killing the shell destroys the child and Chrome exits with it — no orphan
  problem, but a shell crash takes the farm down (above). The graceful detach → `WM_CLOSE` is clean.
- **0.3 reload — go, via `WM_APPCOMMAND`.** `SendMessage(hwnd, WM_APPCOMMAND, hwnd,
APPCOMMAND_BROWSER_REFRESH<<16)` reloads in ~310 ms, no focus/clicks, steals nothing,
  `sessionStorage` survives (login stays, ADR-0009). The appcommand code is **3**; **18 launches
  the Calculator** (measured the hard way). An in-tab reload is the **only** operation that
  preserves the game's login — navigating away, reopening, or a new tab all lose it.
- **0.4 persistent volume worker — go.** `ISimpleAudioVolume.SetMasterVolume` compiled once in a
  persistent PowerShell worker: avg 12 ms, p95 13 ms per change over a 61-step drag (~20× under the
  270 ms/call shell-out). Session found by the same browser-pid → audio-service-child mapping as the
  mute adapter.
- **0.5 throttling — go.** With the three flags a `SW_HIDE`-hidden screen keeps full timer rate
  (10/s vs ~1.8/s without); rAF stops when hidden either way (`visibilityState: hidden`, harmless
  for timer-driven idle games). Off-view positioning keeps even rAF at full rate — a stronger plan B
  if the flags ever regress across Chrome versions (precedent: `--load-extension`).
- **0.6 Turnstile on a reparented window — go.** Owner-verified live on a throwaway temp profile
  (no device-trust cookie): Turnstile passed inside the embedded window and the game played
  normally, once the focus/z-order forwarding was active — the login's alt-tab-for-password flow is
  exactly what exercises 0.1's two obligations, so they are a hard prerequisite, not polish.

The implementation is covered as usual: the core (renderer-driven layout, the audio policy, the
per-screen setters) in the fast suite against fakes; the window-manager and browser-engine adapters
in the Windows-only integration suite against real Chrome.

## Correction (2026-08-20)

Obligation 0.1 says keyboard focus is forwarded "driven from `WM_PARENTNOTIFY` **+ the BrowserWindow
`focus` event**". Only the first driver was implemented. `hookChildFocus` in
`apps/shell/src/main/main.ts` hooks `WM_PARENTNOTIFY` and is the sole call site of
`focusChildAt`; the main process registers no `focus` or `activate` listener at all.

**The obligation is met for the click path**, which is the one the spike measured and the one that
made the embedded screens usable. What is not covered is reactivation: alt-tabbing back into the
panel does not re-focus the embedded screen, so the first keystroke after that can go nowhere until
the user clicks. Written down because the symptom is confusing and the ADR pointed at a handler
that was never written.

**The second obligation has the same gap, for the same reason.** "Re-assert `HWND_TOP` after moves
**and on activation**" is implemented for moves only: `MoveChild` in
`packages/window-manager/src/win32-worker.ts` ends with a
`SetWindowPos(… SWP_NOMOVE | SWP_NOSIZE)`, and that is the only z-order re-assert in the product.
There is no activation handler to carry the other half. The Consequences section of this ADR states
the narrow version correctly — "`movechild` re-asserts `HWND_TOP` after every move" — so the file
disagreed with itself. Consequence: after alt-tabbing back into the panel, Electron's input hwnd can
sit over a child until the next layout emit moves it.

This was wrong from the start — the sentence describes an implementation that did not exist when it
was written, not one that later changed.
