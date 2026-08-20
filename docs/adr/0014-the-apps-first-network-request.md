# ADR-0014 — The app's first network request: an update check, only when the user asks

**Status:** Accepted · **Date:** 2026-07-29 (implemented 2026-08-09)

Supersedes in part [ADR-0007](0007-electron-security-posture.md), decision 4.

## Context

[ADR-0007](0007-electron-security-posture.md) decision 4 reads: "`connect-src 'none'`, so the app
makes no network request at all in v1 — no update check, no telemetry, no remote asset." Phase 3
hands the app to other people, and an app nobody can update is one that keeps a defect forever.

**The distinction that decides how this is weighed, because it is otherwise got wrong.** The
_conclusion_ in that ADR is a property of the whole app; the _mechanism_ it names covers only the
renderer. A Content-Security-Policy governs a page. An update check runs in the **main process**, in
Node, where no CSP applies. So the question is not "loosen a header" — the header is untouched — but
"**the privileged process gains a network surface**": it can reach the internet, parse a remote
response, and potentially run what it downloads. That is strictly more serious than a CSP edit.

The owner set the shape of this before it was designed: **there is no forced update.** Enforcement
of a minimum version is rejected, not deferred. What that buys is large enough to name — **the app
never gains a remote kill switch**: no fail-open/fail-closed dilemma, and no scenario where a dead
or hijacked feed host bricks or takes over installations holding logged-in sessions.

## Decision

**The app checks for updates only when the user presses the button.** A `fetch` from the main
process asks the GitHub Releases API what the latest release is, the panel shows the changelog for
anything newer, and — if the user wants it — `shell.openExternal` opens the release page in their
own browser. The download and the install are the user's, by hand.

Three properties this shape has, each of which was the reason for a rejection below:

- **It adds no dependency.** ADR-0007 decision 1 kept the shipped supply chain small and pinned
  deliberately; nothing new enters the main process, which is the process with full access to the
  disk and the profiles.
- **The app never downloads or executes an installer.** With nothing signed
  ([ADR-0013](0013-a-portable-unsigned-zip-under-apache-2.md)), an in-app updater would be
  auto-executing an unsigned binary whose only integrity check came from the same feed that served
  it. Handing the user a browser and a release page keeps that step where they can see it.
- **No silent ping.** Because the request happens only on an explicit action, the app never contacts
  a server carrying the user's IP, version and clock without them asking — which would be telemetry
  regardless of intent, and would contradict a promise made in two places.

**Everything that decides anything is in `packages/core/src/update.ts`**, in the fast suite: what a
status code means, whether a tag is newer (compared numerically, because a string compare puts
`0.10.0` before `0.9.0` and would tell the user their newer build is out of date, once, at a release
where nobody is looking for it), and what may be carried out of the body. `main.ts` turns the
network into a status code and a parsed value and **always returns rather than throwing**, because
failure is an ordinary outcome here: offline, rate-limited, GitHub down and malformed are four
states the panel phrases in Portuguese, not four errors.

**Both URLs are constants in the main process, and no url is ever read out of the fetched
document** — the core validator does not carry one at all, which is a stronger guarantee than
carrying one carefully. A url arriving from the renderer, or out of the response, would make
`shell.openExternal` "open whatever someone else says": the arbitrary-open surface ADR-0007
decision 3 refused for IPC, and the reason `logs:reveal` takes no argument either.

**Two ceilings on untrusted input**: release notes are capped at 4000 characters with control
characters stripped (`\t`, `\n`, `\r` kept — a changelog is written with them), and the response
body is refused past 1 MB. Markup is deliberately _not_ filtered: the panel sets `textContent`, so a
`<script>` in a release note is five words of text.

## Consequences

- **ADR-0007 decision 4's conclusion is no longer true, and its mechanism is untouched.**
  `default-src 'none'` / `connect-src 'none'` stand exactly as they were. Nobody should read that
  header as proof the app is offline, and nobody should relax it to add a request that never needed
  it.
- **The claim is checkable rather than asserted:** "the app makes exactly one request, only when
  asked" is verified by grepping the main process for `fetch` and finding a single call site.
- **A user can stay on a version with a known defect indefinitely**, and the only lever left is how
  visibly the update is surfaced. That cost is accepted, and it is the price of having no kill
  switch.
- **The app cannot know an update exists until the user asks**, so surfacing is exactly one thing:
  the check action, plus the author telling friends.
- Rate limiting is 60 requests/hour per IP, and a `404` means both "nothing published yet" and "no
  such repository". Today it means the first, and the panel says so rather than reporting a failure.
  [see Correction (2026-08-20)]
- `shell.openExternal` was measured against ADR-0007's navigation handlers before it shipped: it
  works, throws nothing, and **not one handler fires** — the call runs in main and hands the url to
  the OS shell, while those handlers govern renderer-initiated navigation. The deny-everything
  posture needed no weakening.

## Alternatives rejected

**`electron-updater`**, the obvious tool. It brings a dependency tree into the main process — a
rule-2 trigger on its own, before the network is discussed — and its whole value is the
download-and-run step this decision refuses to have.

**Minimum-version enforcement / a forced update.** Rejected outright rather than deferred: it is a
remote kill switch, and this app holds logged-in sessions.

**An automatic check at launch.** Named here so it is a decision and not a drift: an **opt-in**
variant (a setting, default off, checking once per launch) would make updates discoverable without
the user remembering to look, at the cost of a periodic request carrying IP, version and timing. It
is not planned; turning it on would amend this ADR.

**A static `latest.json` maintained by the release workflow**, instead of the Releases API. The API
cannot drift from reality because it _is_ the release list, and it excludes drafts and prereleases
by construction.

**Sending the running version with the request.** The comparison happens on the user's machine, so
it would buy nothing and leave "this IP runs version X" in a log the owner never sees. For the same
reason the User-Agent is a bare `Hecaton`: measured, that is a **reduction** — Electron's default
names the Windows build, the architecture, the Chromium version and the Electron version, which pins
the app's version range anyway.

## Correction (2026-08-20)

**"Today it means the first" stopped being true on 2026-08-20**, when `v0.1.0` was published.
`/releases/latest` now answers `200` with `tag_name: v0.1.0`, so a `404` from **this** repository
would today mean the second reading — renamed or removed — rather than "nothing published yet".

This appeared when the world changed, not when the ADR was written, and the decision is untouched.
The `404` branch stays and is not dead code: it is what any fork of this repository answers until
its own first release, and what this one answered for the eleven days between the check shipping and
the tag.

Verify in `packages/core/src/update.ts` — `interpretUpdateCheck`, whose own docblock carries the
measurement of both states.
