# ADR-0023 — The app checks for updates at launch, and asks once

**Status:** Accepted · **Date:** 2026-09-18

Supersedes in part [ADR-0014](0014-the-apps-first-network-request.md), whose Decision is "only when
the user presses the button" and whose rejected alternatives include the one taken here.

## Context

[ADR-0014](0014-the-apps-first-network-request.md) gave the app its only network request and put it
behind a click: **Procurar atualizações** in Configurações. It named the automatic check among the
alternatives rejected — "an **opt-in** variant (a setting, default off, checking once per launch)
would make updates discoverable without the user remembering to look, at the cost of a periodic
request carrying IP, version and timing. It is not planned; turning it on would amend this ADR."
This is that amendment, and the variant taken is not the opt-in one.

The cost side is unchanged and was accepted knowingly. What the owner weighed against it is the
consequence ADR-0014 itself wrote down: "**the app cannot know an update exists until the user
asks**, so surfacing is exactly one thing: the check action, plus the author telling friends." With
no auto-update, no installer and no kill switch, a defect fixed in a release reaches a user only if
that user happens to open a settings modal and press a button. In practice nobody does, and the
distribution is a handful of people the author tells by hand — which does not scale past the handful.

## Decision

**Every launch asks GitHub once whether there is a newer release, after the panel is on screen, and
offers it in a modal with three answers.** The request is the same one the button makes: the same
constant URL, the same `Hecaton` User-Agent, the same core parser, the same two ceilings on the
body, and the same rule that no url is ever read out of the response.

The three answers differ in what they persist, and that is the whole interaction design:

- **Atualizar agora** opens the release page with `shell.openExternal` and records nothing. Somebody
  who opens the page and does not install is asked again next launch, which is correct — they have
  not updated.
- **Lembrar depois** writes nothing at all. "Later" is the absence of an answer, and the absence is
  what brings the offer back.
- **Não lembrar mais** writes `updateDismissedFor: <version>` into the account's config. A version,
  never a flag: the next release is news again. `shouldOfferUpdate` in the core owns that rule, and
  reads a value that is not a version as no answer rather than as silence for ever.

The check runs **after** `createPanel()` and is not awaited, so a slow or hanging request delays
nothing the user is waiting for. `checkForUpdates` already answers failure as a state rather than
throwing, so an offline launch says nothing at all.

The owner chose this over the once-a-day variant on 2026-09-18, presented as the more conservative
option, and over keeping the manual-only check.

## Consequences

- **`api.github.com` sees an address every time a Hecaton opens**, and two windows are two requests.
  That is the telemetry-shaped cost ADR-0014 refused to pay for discoverability, now paid
  deliberately and named here so nobody has to infer it. What the request carries is unchanged: no
  version, no machine id, no account, no clock beyond the connection itself.
- **The claim "the app makes exactly one request, only when asked" is no longer true**, and the
  first half survives: still one call site, still one `fetch` in the whole main process, verifiable
  by grep. What changed is who triggers it.
- **The rate limit is 60 requests/hour per IP.** One per launch, with two or three windows, is not
  near it; a script relaunching the app in a loop would be, and would get `rate-limited`, which the
  panel already phrases.
- **No new setting.** An opt-out switch was considered and not added: the offer already carries its
  own opt-out ("não lembrar mais"), and a second, duplicate control in Configurações would be two
  states to reason about for the same question.
- **`update:dismiss` is a new IPC channel and carries no payload**, like `notes:acknowledge`. Which
  version was on offer is main's own knowledge; a channel that accepted a version string would let
  the renderer silence any release.
- **The offer waits for the first-run gate and for the release notes**, so a first launch after an
  update never stacks two modals. It waits only for notes that will actually open — a version the
  changelog has no section for leaves `needsReleaseNotes` true for ever, and waiting on a modal that
  never appears is how the offer went missing on its first live run (measured, and fixed before
  shipping).

## Alternatives rejected

**Once a day, cached in the config.** Presented as the conservative option and not chosen: it keeps
the same interruption with roughly a tenth of the requests, at the cost of a stored timestamp and of
announcing a release up to a day late. Worth revisiting only if the request itself ever becomes a
problem.

**A setting, default off** — ADR-0014's own opt-in variant. A check nobody enables is the situation
this ADR exists to end.

**Checking on a timer while the app runs.** The app is meant to stay open for hours; a timer would
turn one request per launch into many, and an update is not urgent enough to interrupt a session
that is already running.

**Downloading the release in the background.** Rejected for the same reason ADR-0014 rejected
`electron-updater`: with nothing signed, the app would be fetching an unsigned binary and putting it
where a user might run it, on the strength of the same feed that described it.
