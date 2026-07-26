# ADR-0010 — Audio follows focus by shelling out to WASAPI, not through a native dependency

**Status:** Accepted · **Date:** 2026-07-22

## Context

Making audio follow focus — only the game in the OS foreground is audible, the rest muted [see Correction] —
needs per-process muting, which Chrome cannot do after launch (`--mute-audio` is launch-only,
and there is no CDP, see [ADR-0003](0003-spawn-over-cdp.md)). The Windows Core Audio API
(WASAPI) can mute one process's audio session at a time. `architecture.md` had recorded this as
"deferred to phase 2 — another native module." The owner reopened it in phase 2 and asked which
way to reach WASAPI.

A phase 1.5 spike first proved the feature is even possible here: each Chrome slot, launched
with its own `--user-data-dir`, opens a **distinct** audio session, and muting one leaves the
others — and the user's own Chrome — untouched. The nuance the spike surfaced: the session's pid
is not the slot's browser pid but its **audio-service child** process (Chrome renders each
instance's sound in a utility child), whose parent is the browser pid.

## Decision

**Reach WASAPI by shelling out to PowerShell with the Core Audio interfaces declared inline as
C#, adding no npm dependency and no native build.** The adapter maps the slot's main pid to its
audio-service child (via a Toolhelp parent-pid snapshot) and mutes that session.

Three ways to call WASAPI were weighed, as _what it protects · what it exposes · cost ·
reversibility_:

- **A — shell out to PowerShell + inline C# (chosen).** Protects: adds zero supply-chain
  surface, zero `allowScripts`, no compiled binary to ship. Exposes: a `child_process` spawn per
  mute change, ~270ms measured. Cost: wrap the proven spike script as an adapter with error
  handling. Reversibility: highest — delete the adapter, nothing installed remains.
- **B — a native npm module (`native-sound-mixer`, MIT).** Would give an in-process call at
  sub-10ms with no subprocess. But its API **does not expose a session's pid** — sessions carry
  only `name` (the window title) and `appName`/`path` (`chrome.exe`, identical across slots), so
  it **cannot tell two Chrome slots apart** by the pid this app tracks, and matching by title is
  the one thing this project forbids ([no CDP / identify by pid, never title](0003-spawn-over-cdp.md)).
  Every pid-capable form of B (fork the module to expose the pid it reads internally, or write
  our own N-API addon) means **maintaining native code** — the very cost that made B look better
  than A.
- **C — our own N-API addon.** In-process and pid-capable, but we maintain C++ plus a build
  toolchain in CI and packaging.

Only A resolves the pid requirement without maintaining native code or adding supply-chain
surface, so the owner chose A, accepting its latency.

## Consequences

- A global **`audioFollowsFocus`** setting (on by default) gates the feature; it is additive to
  the v1 config, so a file written before it simply defaults to on — no schema bump.
- The mute policy lives in the **core** (`Orchestrator.updateAudioFocus`): the foreground pid
  comes from the `WindowManager` port, and every running slot whose pid is not the foreground is
  muted through a new `AudioController` port. [see Correction] One rule, no special case — a non-slot foreground
  (the panel, the user's own browser) matches no slot, so all slots mute; the toggle off unmutes
  all. A slot is touched only when its state changes, so a quiet focus tick shells out to nothing.
- The WASAPI adapter is the **only** implementer of `AudioController`. The port is why the switch
  to B or C later is a one-adapter change the core never sees — the same narrowness that let the
  Playwright→spawn switch land invisibly.
- Latency is the accepted weakness. If ~270ms per switch proves uncomfortable, the door to an
  in-process addon (C) stays open behind the port. There is **no commitment** to make that move.

## Alternatives rejected

- **`native-sound-mixer` as-is** — cannot distinguish slots by pid (see above); it would mute by
  window title, which this project does not do.
- **Write the game's volume preference into the profile's LevelDB** — undocumented format, and a
  bad write loses the login rather than just the volume (already rejected in `architecture.md`).
- **Poll the foreground on the slow liveness timer** — up to 2s to notice a focus change, longer
  than the mute itself; a separate ~300ms timer drives the focus check instead.

## Verification

The distinct-session premise and the audio-service-child mapping were field-measured in the
phase 1.5 spike against real Chrome slots, not derived from code. The adapter is covered by a
Windows-only integration test (`wasapi-audio-controller.integration.test.ts`) that mutes one
tone-playing slot and confirms a second is untouched; the core policy is covered in the fast
suite against a fake `AudioController`.

## Correction (2026-07-26)

Two descriptions here became false when the UI rework ([ADR-0011](0011-embed-spawned-chrome-into-the-shell.md))
changed how "follow focus" works. This is a code/semantic change, not a mistake that was here from
the start — the **decision** (reach WASAPI by shelling out to inline C#, no dependency) is
unchanged, and per-screen volume was added through the same session interface.

- Context: "**only the game in the OS foreground is audible, the rest muted**" — audio now follows
  the app's **own focus mode**, not the OS foreground window (owner decision, 2026-07-22). With the
  toggle on and no screen focused (the normal grid), **every** running screen is audible at its
  configured volume; focusing one screen mutes the others; leaving focus restores all.
- Consequences: "**the mute policy lives in the core (`Orchestrator.updateAudioFocus`): the
  foreground pid comes from the `WindowManager` port**" — there is no `updateAudioFocus` method, and
  the `WindowManager` port never gained a foreground query. The policy is
  `Orchestrator.applyAudio()` reading a `focusedSlotId` the app sets (via `slot:focus`), gated by
  `setAudioFollowsFocus()`; verify in `packages/core/src/orchestrator.ts` (`applyAudio`,
  `focusedSlotId`). The `AudioController` port is real and now also carries `setVolume`.

The rest holds: the WASAPI-shell-out **approach** (PowerShell + inline C#, no native module, no npm
dependency), the additive `audioFollowsFocus` toggle (default on, no schema bump), and the port
keeping a later move to an in-process addon a one-adapter change. One implementation change worth
naming, though — **both** mute and volume now ride a **persistent** worker (~12 ms per change)
rather than the fresh ~270 ms spawn per call this ADR measured; verify in
`packages/browser-engine/src/wasapi-audio-controller.ts`. So the accepted-latency caveat above is
no longer the operating cost.
