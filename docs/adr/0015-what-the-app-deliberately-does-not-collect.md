# ADR-0015 — No metrics, no accounts, no monetization

**Status:** Accepted · **Date:** 2026-07-29, with the metrics reversal of 2026-07-30

## Context

Phase 3's goal list asked for four things beyond packaging: an update mechanism, a real product
name, a study of user accounts, and operational logging. **Two of the four ended in nothing being
built**, and this ADR is why. It records three non-goals rather than a feature, because each was
examined properly and each could reasonably be reached for again — one of them was designed in full
before it was dropped.

## Decision

**Monetization: never. Distribution is free, permanently.** Not "not now" — a settled property that
other decisions were then allowed to depend on:
[ADR-0013](0013-a-portable-unsigned-zip-under-apache-2.md)'s one-way licence choice and its refusal
to expose an identity both lean on it, as does the absence of accounts below.

**No accounts, and no login.** Every purpose an account could serve is dead or better served
without one. Entitlement and licensing died with monetization. Identifying users in metrics and
attributing a bug report are moot, since neither exists. Restricting use to invited friends is
futile: the source is public under Apache-2.0, so any gate can be removed and rebuilt around.
Syncing configuration is the only genuine use and it is small — `config.json` can be copied by hand,
and **profiles cannot be synced at all**, because uploading one is literally sending a logged-in
session off the machine, which is what the whole architecture exists to prevent. Against that stood
an authentication server, stored credentials, password recovery, and a database of real people's
contact details under Brazil's LGPD.

**No metrics, no telemetry, no analytics endpoint, no installation id, and no in-app bug-report
tool.** This one was **decided in full on 2026-07-29 and reversed on 2026-07-30, before a line was
written** — see the design below, kept so it does not have to be re-derived.

**The local logs stay exactly as they are.** `FileLogger`, the rotation, and the redaction at the
logger boundary were never part of what was proposed; they never leave the machine. Dropping them
was offered and rejected — an app with no local diagnostic leaves nothing to ask a friend for when
something breaks on their machine.

## Consequences

- **The app's only network request is the update check**
  ([ADR-0014](0014-the-apps-first-network-request.md)), which happens only when the user asks. There
  is no second main-process network surface, no endpoint, and no third party storing anything.
- **`architecture.md`'s "no telemetry (if ever, explicit opt-in)" and `README.md`'s "there is no
  telemetry" stay true and stop being conditional.** The "if ever" was opened and closed without
  code. Neither file needed editing, which is the clearest sign the promise held.
- **No pseudonymous id exists**, so the app stores no identifier of any kind, and the LGPD retention
  question the original design had to answer before its first-run text could be written truthfully
  has no subject.
- **CLAUDE.md's "the app never stores passwords" stays absolute**, with no exception to reason
  about.
- **The cost, plainly:** the author will have no idea how the app is used — how many screens people
  run, which features are touched, how often it crashes. Every future decision about what to build
  or simplify will be made on intuition. When a friend reports a problem, the diagnostic path is
  entirely manual: ask them to open `%APPDATA%/hecaton/logs` and send a file.
- That manual path is safe for the same reason the dropped tool would have been: **redaction is at
  the logger boundary, not in any feature.** Nothing was lost on that axis by dropping it.
- **This was a reversal before implementation, which is the cheap kind.** Nothing had to be removed,
  no user data was ever collected, and no promise had to be walked back. Reversed after shipping,
  this ADR would have had to explain a telemetry endpoint that once existed.
- Reopening any of the three is a **decision**, not a resumption.

## The metrics design that was dropped

None of this is built. It is here because it is what the subject costs to work out.

**Consent was a forced choice on first run** — the terms screen would ask, with nothing
pre-selected, changeable later in settings. Asked directly, most people answer; left as a toggle to
discover, almost nobody turns it on and the few who do are a biased sample.

**The transport was a plain HTTPS POST from the main process — no SDK**, keeping the shipped
dependency count unchanged, avoiding a server the author would have to defend, and avoiding a domain
registration (whose WHOIS record is the identity exposure ADR-0013 exists to prevent). The cost that
belonged in the ADR: a third party would store the events and see the friends' IP addresses, and its
retention policy would become the app's.

**The event schema was an allowlist built by a pure function in `packages/core`**, with the adapter
doing nothing but the POST — turning "no sensitive field can leak" into a property of the fast suite
rather than something maintained by review. Allowed: registry game id, `custom` as an opaque marker,
screen count, focus-mode usage, session length, app and Windows version, whether a feature was used,
crash counts. Forbidden, each for a specific reason: **a custom slot's url** (user data that can
carry a token or identify an account), **a screen's name** (free text the user typed), and
**anything from a log line or any file path**. Never a blocklist — a blocklist fails silently on the
first field someone adds.

**The bug-report tool gave consent by showing rather than describing**: the redacted bundle
displayed on screen, scrollable and editable, and the user presses send on what they just read.
Redaction by pattern is never provably complete, so showing the result is what would have made the
consent real.

## Alternatives rejected

**Opt-out telemetry by default.** It would reverse a written promise, and collecting by default from
friends who trusted the author is the kind of thing that costs more when discovered than it ever
returned in data.

**A machine-derived id** (hostname or MAC hash) instead of a random UUID. It identifies **hardware**,
survives every attempt by the user to disconnect from it, and is the fingerprinting pattern this
project's privacy posture exists to refuse.

**Donations and transactional monetization**, noted because the goal list asked for thinking rather
than a verdict. They differ enormously in what they demand: a link to a funding page needs nothing
from the software and leaves every decision intact, while subscriptions or licence keys need
identity, entitlement checks and a server — reopening the licence, the signing identity and accounts
simultaneously. That is the line worth knowing before the conversation starts.
