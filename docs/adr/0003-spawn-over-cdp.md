# ADR-0003 — Spawn Chrome directly instead of controlling it over CDP

**Status:** Superseded in part by [ADR-0016](0016-ship-our-own-chromium.md) · **Date:** 2026-07-21

> **Superseded in part by [ADR-0016](0016-ship-our-own-chromium.md) (2026-08-20):** the _installed_
> half is reversed — the app now spawns **a Chromium it ships itself**, with no fallback to a browser
> on the machine. The substance of this ADR is untouched and still load-bearing: the browser is
> spawned like a shortcut would, never driven over CDP. ADR-0016 also settles the open question this
> one left, that the binary was never the variable — Turnstile was measured accepting the bundled
> browser before anything was built on the assumption.

## Context

The plan called for Playwright's `chromium.launchPersistentContext`: a real headed window per
slot, an isolated `userDataDir`, and a live handle for crash detection, CSS injection, in-page
actions and future automation. Playwright was chosen precisely because it kept the door open.

Phase 0 existed to validate that assumption before building on it. It did not survive.

**The target game's login page is protected by Cloudflare Turnstile, which rejects any
CDP-controlled browser.** Four tests, changing one variable at a time:

| Browser          | Profile              | CDP     | Turnstile  |
| ---------------- | -------------------- | ------- | ---------- |
| Installed Chrome | personal (incognito) | no      | passes     |
| Installed Chrome | fresh                | no      | **passes** |
| Installed Chrome | fresh                | **yes** | fails      |
| Bundled Chromium | fresh                | **yes** | fails      |

Not the IP address, not a cold profile, not the browser binary. The CDP connection itself.

## Decision

**The app spawns the installed Chrome directly**, the way a desktop shortcut would:
[see Correction (2026-07-21)]

```
chrome.exe --user-data-dir=<per-slot dir> --no-first-run --no-default-browser-check
           --window-position=x,y --window-size=w,h --new-window <url>
```

No remote debugging port is opened anywhere, and none should be added later.

**Anti-detection is out of scope** — evading the check was never on the table. The plan excluded
fingerprint evasion from the start, and since the app is distributed, a terms-of-service ban
would land on the end user rather than the author. Never weaken this to unblock a feature.

## Consequences

**Kept, because none of it depended on CDP:** session isolation (`--user-data-dir` is the same
mechanism Playwright used), grid layout and focus, crash detection and auto-restart, the game
registry, per-slot configuration.

**Lost, because all of it did:** CSS injection, in-page actions, screenshots, and any in-page
automation. `injectCss` and `actions` were therefore **removed from the game-definition
contract**, not merely left unimplemented — the core now knows `{id, name, url, viewport}` and
nothing else. Keeping fields nothing can consume would contradict the standing rule to keep the
shared layer minimal, and would have made the contract look like a promise the app cannot keep.
They return if the extension route is taken.

**Audio became a second casualty.** Muting unfocused instances needed CDP. Without it Chrome only
accepts `--mute-audio` at launch: a slot is born muted or not and cannot change afterwards. v1
relies on profiles being persistent, so the game's own audio setting sticks — mute once per slot
and it survives restarts — with `--mute-audio` per slot as a fallback for games that have no
audio control. Writing the preference directly into the profile's LevelDB was considered and
rejected: undocumented format, and a bad write costs the login, not just the volume.

**Process identity became non-trivial.** The PID `spawn` returns is a launcher stub
[see Correction (2026-08-20)]; the real
browser is the process whose command line has no `--type=`. Resolve it once at launch via
`Win32_Process.CommandLine` (the WMI query is far too slow to poll) and check liveness with
`process.kill(pid, 0)`.

**Resource cost went down.** Four idle instances: 1.72 GB and ~1% of one core, against 2.29 GB
and ~294% under Playwright, which injects flags that disable Chrome's background throttling.

## Alternatives rejected

**Keep Playwright and defeat Turnstile** — out of scope by an existing decision, and the risk
falls on end users.

**Keep Playwright for non-protected games only** — two launch paths, two window-management
paths, two liveness models, to serve a capability set that v1 does not ship. The narrow port
interface meant the switch cost the core nothing; a fork would have cost it permanently.

**Browser extension for HUD and actions** — verified working during the spike: an MV3 extension
injects CSS and JS, reads the game DOM, and Turnstile accepts it. But **Chrome 150 ignores
`--load-extension`**; it only loads via manual "Load unpacked". For a distributed app that means
the Web Store or enterprise policy, each with its own cost. Deferred, not dead.

## Correction (2026-07-21)

The command block shows `--new-window <url>`. The app now launches in app-window mode with
`--app=<url>`, and passes no `--new-window` and no trailing URL — see
`packages/browser-engine/src/chrome-args.ts`.

This changed after the ADR was written. Once `stop()` began closing Chrome cleanly (via
`CloseMainWindow`, so the profile is not left marked as a crash), a normal window offered to
restore the previous tabs on the next launch, which accumulated tabs across restarts. An app
window does not take part in session restore, which removes that.

The decision this ADR records — spawn Chrome directly, no CDP, no remote-debugging port — is
unchanged; only the window-mode flag differs. Found by the documentation auditor (`/audit-docs`);
the body is left as written per the convention in [README](README.md), with only the inline
`[see Correction]` marker added.

## Correction (2026-08-20)

"The PID `spawn` returns is a launcher stub" was true of the installed Google Chrome and is not
true of the browser the app launches now. Probe P5 measured the bundled Chromium snapshot returning
the **real** pid, because it ships no launcher stub. Verify in
`packages/browser-engine/src/chrome-launcher.ts` (the comment above the `spawn` call) and in
`chrome-launcher.integration.test.ts`, which records that a test asserting the two pids differ
would now fail.

**The instruction in that paragraph is unchanged, only its premise.** Resolve the pid once at
launch through `Win32_Process.CommandLine` — matching this slot's `--user-data-dir` with no
`--type=` — and check liveness with `process.kill(pid, 0)`. That is correct for both browsers,
where trusting the spawned pid would be a bet on somebody else's packaging. This appeared when the
code changed; see [ADR-0016](0016-ship-our-own-chromium.md).
