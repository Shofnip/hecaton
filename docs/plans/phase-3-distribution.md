# Phase 3 — distribution: planning

> **Working document — scaffolding, not structure.** It carries the phase's open decisions while
> they are being taken, and is **deleted when the phase lands**: everything durable migrates to
> ADR(s) and `architecture.md`. Nothing here is decided until its section says `DECIDED`, with a
> date and the owner's choice. Per CLAUDE.md rule 2, every fork in this document that touches
> security, distribution, network, dependencies or signing is the **project owner's** to take —
> an implementing session must not resolve an `OPEN` item on its own.

## Scope

Phase 3 turns a repository that runs on the author's machine into an application other people
install and keep running. `architecture.md` sketches it as one line — "`electron-builder` ·
Windows installer · code signing decision · auto-update · license · Electron security review" —
and this document is the fine plan that line stands for, widened by the owner's Phase-3 goals: an
update mechanism, a real product name, a study of user accounts, and operational logging. (The
update goal was first stated as a **forced** minimum version and was narrowed by the owner during
planning — see D8.)

Out of scope, and to stay out: anti-detection (`architecture.md`, "Anti-detection is out of
scope"), automation/injection in game pages (Phase 2 dropped the extension path), and any
in-Electron game session (ADR-0007 decision 5).

## Constraints inherited (not up for re-decision here)

These are already decided. A Phase-3 decision may **interact** with them, and where it does the
interaction is named in the decision's section — but none of them is reopened by this document.

| Source                      | Constraint that binds Phase 3                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-0007 decision 1         | `electron` pinned exactly; a **cadence to update it** is an accepted obligation; CI must not fetch the binary                          |
| ADR-0007 decision 2         | one load mode, `file://`, dev and prod identical — a packaged build must not introduce a second, weaker load path                      |
| ADR-0007 decision 4         | the app makes **no network request** in v1; any Phase-3 network is a new, deliberate decision (see the CSP note below)                 |
| ADR-0007 decision 3         | enumerated IPC channels, payloads validated by core validators; no generic `invoke`                                                    |
| ADR-0004                    | everything persisted lives under `%APPDATA%/<app>`, dev and prod alike — the **directory name** is renamed by D2, its placement is not |
| ADR-0005 / ADR-0008         | no code path deletes a **live** persistent profile; only an archived one, only by explicit user action                                 |
| ADR-0006                    | game definitions ship only in the repository — the registry is not a plugin API                                                        |
| ADR-0009                    | the target game's login is bound to the tab; nothing packaging does can preserve a session                                             |
| `architecture.md` → Privacy | the app never stores passwords; no profile data leaves the machine; **no telemetry (if ever, explicit opt-in)**                        |
| CLAUDE.md rule 1            | strict TDD — packaging scripts and any update/logging logic follow the same red-green rule, core stays I/O-free                        |

### The CSP note, because it will otherwise be got wrong

ADR-0007 decision 4 reads "`connect-src 'none'`, so the app makes no network request at all in
v1". The **conclusion** is a v1 property of the whole app; the **mechanism** named only covers
the renderer. A Content-Security-Policy governs the page. An `electron-updater` check, a metrics
POST or a minimum-version probe all run in the **main process**, in Node, where no CSP applies.

Two consequences for this plan:

1. Adding auto-update or telemetry does **not** require relaxing the renderer CSP, and it must
   not: `default-src 'none'` / `connect-src 'none'` in the panel stays exactly as it is.
2. Therefore the decision at hand is not "loosen a header" but "**the privileged process gains a
   network surface**" — it can reach the internet, parse a remote response, and (for update) run
   what it downloads. That is the thing to weigh, and it is strictly more serious than a CSP edit.

## How this document is used

Each decision below carries:

- **Status** — `OPEN`, `DECIDED (YYYY-MM-DD)`, `DEFERRED`, or — for D13 alone — obligations with
  no fork in them.
- **What it protects · what it exposes · implementation cost · reversibility** for each option,
  the four axes CLAUDE.md rule 2 requires.
- **Recommendation**, and which option is the **most conservative** — never the same sentence.
- **Where it lands**: whether the decision, once taken, becomes an ADR (it reverses an earlier
  decision, or alternatives were seriously weighed) or just a line in `architecture.md`.

## Decision register

| #   | Decision                                                                                | Status                                                | Depends on | Lands as                                             |
| --- | --------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------- | ---------------------------------------------------- |
| D1  | Product name and identity                                                               | **DECIDED 2026-07-29 — `Hecaton`**                    | —          | ADR (naming + its consequences)                      |
| D2  | App identity strings and the fate of `%APPDATA%/helloweb`                               | **DECIDED 2026-07-29**                                | D1         | ADR-0012, plus a Correction to ADR-0004              |
| D3  | License, EULA and the terms-of-service disclosure                                       | **DECIDED 2026-07-29**                                | —          | `LICENSE` + `NOTICE` + architecture.md, and ADR-0013 |
| D4  | Packaging target, installer shape, and what an uninstall leaves                         | **DECIDED 2026-07-29**                                | D1, D2     | ADR (uninstall vs ADR-0005 is a real fork)           |
| D5  | Code signing                                                                            | **DECIDED 2026-07-29 — unsigned**                     | D1         | ADR                                                  |
| D6  | Release hosting and the update feed's home                                              | **DECIDED 2026-07-29 — GitHub Releases**              | D3, D5     | folded into D7's ADR                                 |
| D7  | Update mechanism — the app's first network surface                                      | **DECIDED 2026-07-29**                                | D5, D6     | ADR (reverses ADR-0007's premise)                    |
| D8  | ~~Minimum-version enforcement ("forced update")~~ → how an available update is surfaced | **DECIDED 2026-07-29 — no enforcement; closed by D7** | D7         | same ADR as D7                                       |
| D9  | Logging, metrics and telemetry                                                          | **DECIDED 2026-07-29**                                | D6, D7     | ADR (fulfils the "explicit opt-in" clause)           |
| D10 | User accounts / login — viability, and whether Phase 3 does anything                    | **DECIDED 2026-07-29 — no accounts**                  | D9         | ADR                                                  |
| D11 | Monetization posture and its liability consequence                                      | **DECIDED 2026-07-29 — never**                        | —          | architecture.md (a recorded non-goal)                |
| D12 | Supply chain and build provenance                                                       | **DECIDED 2026-07-29**                                | D5         | architecture.md + the distribution ADR               |
| D13 | User data at rest, log redaction, and the pre-release security review                   | **Obligations, no fork**                              | D4, D9     | architecture.md + review record                      |

Order of decision is the order above: cheapest and most blocking first (a name and a license gate
the installer; the installer gates signing; signing gates the update trust chain; the update
channel gates telemetry; telemetry infrastructure gates any account discussion).

### Two directions the owner set on 2026-07-29, after D2

Both narrow the phase, and both are recorded here because a later session reading only the goal
list would otherwise plan for the wider version.

**Distribution is free, permanently — there is no monetization, now or later (D11).** The phase was
planned with monetization held open as a possibility, and that possibility was the reason several
decisions had to preserve optionality. It is now closed. Three things follow immediately:

- The license question loses its main constraint — a permissive licence no longer forecloses
  anything (D3).
- The terms-of-service exposure changes character. Free distribution with an explicit warning is a
  materially different posture from selling a tool whose principal use may breach a third party's
  terms. The **warning** still matters; the liability argument for it weakens, the honesty argument
  does not.
- User accounts (D10) lose their strongest justification. Entitlement, licensing and billing were
  the only things that genuinely required identity; what remains is configuration sync, which is a
  convenience, not a requirement.

**There is no forced update. The user chooses (D8).** An available update is offered — with its
changelog visible so the user can see what changes — and declining it simply opens the installed
version. Enforcement of a minimum version is rejected, not deferred. What this buys is large and
worth naming: **the app never gains a remote kill switch.** No fail-open/fail-closed dilemma, no
scenario where a dead or hijacked feed host bricks or takes over installations that hold logged-in
sessions. The cost is accepted and real: a user can stay on a version with a known defect
indefinitely, and the only lever left is how visibly the update is surfaced — which is what D8
now decides instead.

What this did **not** settle, and was left to D7: whether the app checks for updates **by itself**
(network at launch) or **only when the user asks**. Dropping enforcement removes the kill switch;
it does not by itself remove the network surface, and an automatic check is a request to a server
carrying the user's IP, app version and timing — which is a form of telemetry regardless of intent.
**D7 settled it: only when the user asks.**

### The audience, stated on 2026-07-29 after D4 — and it reframes the whole phase

`architecture.md` says "the app **will be distributed** to other people", and the phase was being
planned against the widest reading of that. The owner's actual intent is narrower and needs
recording, because almost every remaining decision is sized by it:

- **The audience is a handful of friends.** Not a public launch.
- **The public repository is audit optionality, not a distribution channel** — it exists so the
  code _can_ be read if this ever grows beyond that circle.
- **The owner does not want personal exposure** in publishing the tool.
- **Attribution matters**: copying without credit is the thing to prevent.

Consequences, taken together rather than one at a time:

- Signing is what would have exposed a legal identity, so D5's answer and the privacy goal agree
  rather than conflict.
- Apache-2.0 turns out to be the right licence for the attribution goal specifically: §4 obliges a
  redistributor to keep the copyright notices and to state their changes, and its trademark clause
  keeps a fork from calling itself Hecaton. **The copyright holder may be a handle** — `Copyright
2026 Shofn` is valid and exposes nothing beyond what the GitHub account already shows. A `NOTICE`
  file is where that line belongs.
- D4a was decided **before** this was stated, and was revisited because of it (see D4).
- D9 and D10 should be re-read against this before being planned: telemetry infrastructure and
  user accounts are shaped very differently for four friends than for a public user base.

**A trigger to re-decide, written down so it is not forgotten:** if distribution ever leaves the
circle of friends, D5 (signing) returns to the table as a security decision, and D3's one-way
licence choice will already have been made.

---

## D1 — Product name and identity

**Status:** DECIDED (2026-07-29) — the product is **Hecaton**.

`helloweb` is a scaffold name from the first commit. It reaches further than it looks: the
`%APPDATA%` directory (`APP_DIR_NAME` in `packages/storage/src/app-paths.ts`), the
`electron-builder` `appId` and `productName`, the installer's Start-menu entry and uninstall
registry key, the subject name on any code-signing certificate, and the host of an update feed.
Choosing it late is more expensive than choosing it now, which is why it is D1 — and the
migration question it opens is D2, deliberately separated.

**Hecaton**, short for the _Hecatoncheires_ — the hundred-handed giants of Greek myth. The name
was reached by way of Argus, the hundred-eyed watchman, which the owner liked first; the hundred
**hands** were preferred because they describe this product more exactly. The differentiator
stated in `architecture.md` is not that the user _watches_ every session at once but that they can
**act on any one without selecting it first** — many hands, not many eyes. It also avoids the one
real weakness of `Argus`: a crowded trademark space, since several monitoring products carry that
name.

Candidates rejected, so the ground is not re-walked: `Argus` and `Argus Arcade`, `Play Argus`
(reads as though Argus were the game rather than the orchestrator), `Panoptes` (Argus's own
epithet — the cleanest of the Argus family, but the `panopt-` root carries the surveillance
connotation of the panopticon, wrong for an app whose privacy promise is that nothing leaves the
machine), `Heimdall`, `Lynceus`, `Ophanim`, `Hydra`, and the earlier non-mythic shortlists
(`Colmeia`/`Atalaia`/`Mosaico`/`Idlewall`, then `Watchwall`/`Playwall`/`Crowsnest`/`Perch`).

**Still to verify** — not claims, tasks. Both shrank once D5 and D6 were taken:

- **Trademark collision for `Hecaton` in software**, in Brazil and internationally. It no longer
  gates a certificate purchase (D5 signs nothing), but Apache-2.0's trademark clause only protects
  a name the project is entitled to use in the first place.
- **Domain availability** — now moot unless something reverses D6, since GitHub Releases needs no
  domain of the owner's.
- ~~npm scope `@hecaton`~~ — not applicable: D2(b) established that the workspace packages are
  private and never published, so no npm namespace is claimed.

---

## D2 — App identity strings and the fate of `%APPDATA%/helloweb`

**Status:** DECIDED (2026-07-29)

Renaming the product splits into two questions with very different risk, and they must not be
answered as one:

**(a) The data directory.** `APP_DIR_NAME` is one constant, and everything the app persists hangs
off it: `config.json`, `logs/`, `profiles/slot-N` — the **live logged-in browser sessions** — and
the archived `profiles/slot-N.old-*`. Changing that constant changes where the app looks for all
of it. This is the question with real risk, and it touches ADR-0004 (the directory's location) and
ADR-0005 (no code path may endanger a live persistent profile).

The fact that decides it: **the app has never been distributed.** Version is `0.0.0`, Phase 3 has
not started, so the only `%APPDATA%/helloweb` in existence is the owner's own, plus any test
machine. There is no installed base to migrate — and that is only true until the first release,
which is what makes this the moment to choose.

**(b) The code-level name.** `@helloweb/*` npm scopes across six workspace packages, the root
`package.json` name, the repo directory, the GitHub repo. Grepped: 146 occurrences in 45 files,
of which the data directory is exactly one. Loud diff, no user-visible risk, no session data
involved.

**Decided (2026-07-29):**

**(a) `APP_DIR_NAME` becomes `hecaton`, and no migration code is ever written.** The app looks
only at `%APPDATA%/hecaton`; `%APPDATA%/helloweb` is left exactly where it is, untouched, for the
owner to move by hand once. The property this buys is the one worth having: **no code path in the
shipped product moves, copies or deletes a directory of logged-in sessions** — the strongest
possible reading of ADR-0005, and it holds because there is no installed base to migrate.

An automatic first-run migration was rejected. It reads as the friendly option and is the
dangerous one — the shape ADR-0005's own README warns about. It would create, permanently, a code
path that moves live session data, with partial-failure states (Chrome running, file locked,
permission denied) that leave a split directory, and it would stay in the product forever to solve
a problem that existed for one day and one user. Freezing `helloweb` as the directory name was
also rejected: it is the most conservative option for the data, but it leaves a product called
Hecaton storing sessions under a name that appears nowhere in it, which breaks the property
CLAUDE.md requires — that "where can cookies land on this machine?" has an answerable answer.

**Obligations that come with this**, recorded because they are invisible in the code:

- `docs/troubleshooting.md` gets the one-time manual step (`%APPDATA%/helloweb` → `hecaton`),
  written as a **move**, never a delete — the old directory holds real logged-in profiles.
- The rename must land **before** the first release. After that this decision is unavailable and
  only the rejected migration path remains.
- `packages/storage/src/app-paths.test.ts` pins the directory name; the rename is red-first there.

**(b) Everything is renamed now**, in one mechanical commit of its own: `@helloweb/*` → `@hecaton/*`
across the six workspace packages, the root `package.json` name, and the GitHub repository. The
packages are private and never published, so no npm namespace is involved. Doing it before Phase 3
writes any code keeps the churn from tangling with real changes; deferring it only makes the same
diff bigger.

---

## D3 — License, EULA and the terms-of-service disclosure

**Status:** DECIDED (2026-07-29)

**(a) Apache-2.0, public repository.** With monetization permanently off the table, the one real
argument against a permissive licence — preserving the option to charge — is gone. What is left
favours it: an application that holds logged-in game sessions and (per D7) will reach the network
is far easier to trust when it can be read, and Apache-2.0 carries an explicit patent grant and a
trademark clause that keeps a fork from shipping under the name **Hecaton**.

Rejected: proprietary/private (maximum reversibility, but it makes the user install an unauditable
binary and puts the whole trust burden on D5), source-visible-without-a-licence (auditable and
grants nothing, but an unusual posture that forbids the redistribution a free tool wants), and
source-available non-commercial (its entire purpose was protecting a revenue stream that will not
exist).

The asymmetry to remember: **this decision is one-way.** Closed→open is available at any time;
open→closed is not, because what has been cloned stays cloned.

**(b) The terms-of-service warning appears in three places: first run, README, and a licence page
in the installer.** The reasoning is honesty rather than liability — free distribution weakens the
legal argument but not the moral one. The exposure being disclosed is not incidental: the
product's central capability, several accounts of the same game side by side
(`architecture.md`, settled decision 3), is exactly what most game terms call multi-accounting,
and the ban lands on the end user, never on the author. `architecture.md` already asks for this
("be explicit in the UI/README"); this closes it.

Accepted cost: a warning about bans on first launch is a discouraging first impression and will
cost some adoption. Taken deliberately — it is the only moment the warning can still change the
user's decision, because it precedes logging an account in.

**Consequence that constrains D4:** a licence page requires the **assisted** NSIS installer.
A one-click installer has nowhere to show it.

**Verification task, still open:** the Poke IdleWorld terms have never been read. `architecture.md`
lists this as an open risk and it has stayed open. Reading them is a task of this phase, and the
result decides how strongly the first-run text is worded — not whether it exists.

---

## D4 — Packaging target, installer shape, and what an uninstall leaves

**Status:** DECIDED (2026-07-29)

`electron-builder` producing an **assisted NSIS installer** — the shape was already forced by D3b,
since a licence page has nowhere to live in a one-click installer.

**(a) Per-user install (`%LOCALAPPDATA%/Programs/Hecaton`, no elevation).**

**This reversed within the session, and the reversal is the interesting part.** Per-machine
(`Program Files`, UAC) was chosen first, on the sound argument that tampering with the binary
should require administrator. Two premises then arrived that had not been on the table: the
binary would **not be signed** (D5), and the audience is **a handful of friends**, not a public
release.

Per-machine and unsigned is the worst pairing Windows offers. Every install _and every update_
raises the yellow **"Unknown publisher"** UAC dialog — the highest-friction, lowest-trust prompt
in the system — in exchange for protecting a binary that four people will install. Per-user
raises no UAC at all; SmartScreen appears once, on first run, and that is the whole cost.

Choosing per-user also **dissolved one of this section's two probes**: with no elevation there is
no ambiguity about which user's `%APPDATA%` an uninstaller is looking at.

Worth recording either way: this decision is cheap only because ADR-0004 already put **every**
piece of app state outside the install directory. An app that wrote next to its own binary would
have had to care.

**(b) The uninstaller asks whether to remove data too.** A checkbox or page offering to delete
`%APPDATA%/hecaton`, defaulting to keeping it. This is the same shape ADR-0008 already accepts for
clearing archives — deletion of session data only by an explicit, confirmed user action — but it
runs somewhere new: outside the app, without the orchestrator's guards.

**One probe is mandatory before this is implemented, and it may reopen the design.**

**Does an update run the old uninstaller, and in silent mode?** If an NSIS update executes the
previous version's uninstaller, the data-deleting branch must be provably unreachable from that
path — otherwise an _update_ deletes logged-in profiles. This is the exact class of assumption
this project has been burned by before, so it is measured, not reasoned about.

**Pre-agreed fallback if the probe shows the uninstaller cannot be trusted to reach the delete
branch only on a real uninstall:** the "delete my data" action moves **into the app**, where the
orchestrator's guards exist, and the uninstaller keeps only the informational page saying where
the data is. That change is a fork and goes back to the owner rather than being taken by an
implementing session.

_(A second probe — which user's `%APPDATA%` an elevated uninstaller resolves — was dropped when
(a) became per-user: without elevation the question does not arise.)_

**Rejected:** portable zip — incompatible with D3b (no licence page), no uninstall entry, no update
path, and misleading besides, since deleting the unzipped folder leaves every logged-in profile in
`%APPDATA%`.

---

## D5 — Code signing

**Status:** DECIDED (2026-07-29) — **the installer is not signed.**

Three earlier decisions had raised the value of signing: D4a put a UAC dialog in front of every
user, D3a made the source public so anyone can build a lookalike, and D7 will download and run an
installer. Against that stood a cost this project cares about more than money: **a code-signing
certificate is issued to a verified identity, and that identity is visible** in the UAC dialog and
the file's properties, to everyone. The owner's stated intent is to publish the tool without
personal exposure, and signing is precisely what would undo that.

For an audience of friends, trust comes from the author handing over the file, not from a
certificate. Accepted costs, to be stated plainly to those friends rather than discovered by them:

- **SmartScreen** warns on first run — "Windows protected your PC", requiring
  _More info → Run anyway_.
- Nothing distinguishes an authentic build from a tampered one. Partial mitigation: publish the
  **SHA256** of each release artifact, which helps whoever checks it and nobody else.

Rejected: Azure Trusted Signing (~US$10/month, the cheapest credible route, but it exposes the
identity and its eligibility for a Brazilian individual was never verified), a CA OV/IV
certificate (~US$200–400/year, plus SmartScreen reputation that only accrues over time), and an EV
certificate (~US$400–700/year and typically a registered company — to distribute a free tool to
friends). Figures are orders of magnitude from an assistant's knowledge, not quotes; none was
verified, and none needs to be while this decision stands.

**Re-decide when:** distribution leaves the circle of friends. At public scale the calculus
inverts — an unsigned installer that self-updates, from a public repository anyone can fork, stops
being a friction problem and becomes a security one.

---

## D6 — Release hosting

**Status:** DECIDED (2026-07-29) — **GitHub Releases**, on the public repository D3 established.

Free, HTTPS, no server of the owner's to run, keep patched, or have compromised — and no domain to
register, which also keeps D1's domain-availability check off the critical path. Self-hosting was
never attractive: it would add infrastructure and an attack surface to serve an audience of
friends.

---

## D7 — Update mechanism, and the app's first network request

**Status:** DECIDED (2026-07-29)

**The app checks only when the user asks.** A "check for updates" action fetches a small version
document from GitHub, shows the changelog for what is newer, and — if the user wants it — opens the
release page in their browser. The download and the install are the user's, done by hand.

This reverses the premise in **ADR-0007 decision 4** ("the app makes no network request at all in
v1"), which is what makes it ADR material. It does **not** touch the renderer's CSP:
`default-src 'none'` / `connect-src 'none'` stand exactly as they are, because the request is made
by the main process, where CSP does not apply. Anyone reading only the CSP would draw the wrong
conclusion, which is why the distinction is written down twice in this document.

Why this shape rather than `electron-updater`, which is the obvious tool:

- **It adds no dependency.** ADR-0007 decision 1 deliberately kept the shipped app's supply chain
  small and pinned, so that it is something decided rather than installed. `electron-updater`
  brings a dependency tree into the **main process** — the one with full access to the disk,
  including the logged-in profiles. That is a rule-2 trigger on its own, before the network is even
  discussed.
- **The app never downloads and executes an installer.** With D5 leaving the installer unsigned,
  an in-app updater would be auto-executing an unsigned binary whose only integrity check is a
  hash published by the same feed that served it. Handing the user a browser and a release page
  keeps that step where the user can see it.
- **No silent ping.** Because the request happens only on an explicit action, the app never
  contacts a server carrying the user's IP, version and clock without them asking — which is the
  thing that would have quietly become telemetry.

The obligations this creates:

- **The release URL is hardcoded.** `shell.openExternal` is safe here only because the URL is a
  constant in the main process. A URL that ever came from the renderer, or from the fetched
  document, would turn this into an arbitrary-open surface — the same shape ADR-0007 decision 3
  rejected for IPC, and the same reason `logs:reveal` takes no argument.
- **The fetched document is untrusted input.** It is parsed and validated in the main process by a
  pure core validator, like every IPC payload; a malformed or hostile response must fail closed
  and visibly, never crash the app and never be rendered as HTML.
- **Failure is normal.** No network, GitHub down, rate limit — all of these are ordinary outcomes
  that say "could not check" and change nothing else.

---

## D8 — How an available update is surfaced

**Status:** DECIDED (2026-07-29) — **no enforcement, and closed by D7.**

Forced updates and minimum-version enforcement are rejected outright (see the owner's direction
above): the app never gains a remote kill switch. What remained of D8 was how visibly an update
gets surfaced — and D7 answered it. With no automatic check, **the app cannot know an update
exists until the user asks**, so the surfacing is exactly one thing: the check action, plus the
author telling friends.

The one variant that could change this, named so it is a decision and not a drift: an **opt-in**
automatic check (a setting, default off, that lets the app check once per launch). It would make
updates discoverable without the user remembering to look, at the cost of a periodic request
carrying IP, version and timing. It is not planned. Turning it on is the owner's call and would
amend this section.

---

## D9 — Logging, metrics and bug reports

**Status:** DECIDED (2026-07-29)

The three are separate systems with different destinations, and conflating them is how privacy
promises get broken by accident:

|                                                                      | Where it lives         | Leaves the machine?                                 |
| -------------------------------------------------------------------- | ---------------------- | --------------------------------------------------- |
| **Logs** — the existing rotated JSONL under `%APPDATA%/hecaton/logs` | on the machine, always | only inside a bug report the user reviewed and sent |
| **Metrics** — behavioural counters                                   | sent to the author     | yes, with consent                                   |
| **Bug reports** — the user asking for help                           | sent to the author     | yes, per report, with the contents shown first      |

`architecture.md` says "No telemetry (if ever, explicit opt-in)". The "if ever" is now, and the
parenthesis had already pre-decided the consent model — so this **fulfils** that line rather than
reversing it. The ADR should say so, because a reader who finds telemetry in an app that promised
none will otherwise assume the promise was quietly dropped.

**(a) Consent is a forced choice on first run.** The first-run screen D3b already creates asks
whether to send anonymous usage metrics, with **nothing pre-selected**, and the answer is changeable
in settings. Asked directly, most people answer; left as a toggle to discover, almost nobody turns
it on, and the few who do are a biased sample. Opt-out-by-default was rejected: it would reverse a
written promise, and collecting by default from friends who trusted the author is the kind of thing
that costs more when discovered than it ever returned in data.

**(b) A managed analytics service, fed by a plain HTTPS POST from the main process — no SDK.**
Sending JSON with the runtime's own `fetch` keeps ADR-0007 decision 1 intact: the shipped app's
third-party dependencies stay at the two D12 pinned, and this phase adds none. It also avoids
running a server that receives data from other
people's machines, which is infrastructure the author would have to defend, and it avoids
registering a domain (which would reintroduce identity exposure through WHOIS — the thing D5 was
protecting).

The cost is real and belongs in the ADR: a third party stores the events and sees the friends' IP
addresses, and its retention policy becomes the app's retention policy. Choosing the specific
service is an open task with stated criteria (below).

**(c) A random UUID generated on first run and stored in `config.json`.** Without it, "how many
screens do people usually run" cannot be computed — one heavy user would become the entire sample.
It is pseudonymity, not anonymity, and the ADR must say that: combined with an IP, an installation
is traceable over time by whoever hosts the endpoint. Deleting `config.json` resets it. A
machine-derived id (hostname/MAC hash) was rejected outright — it identifies **hardware**, survives
every attempt by the user to disconnect from it, and is the fingerprinting pattern this project's
privacy posture exists to refuse.

### The event schema is an allowlist, and it is built in the core

**Proposed by this plan, and the owner's to override.** The payload is assembled by a **pure
function in `packages/core`** (state → event) with the adapter doing nothing but the POST. That
turns "no sensitive field can leak" into a property of the fast test suite rather than something
maintained by review — which is the same reasoning that put config merge and grid math in the core.

Allowed: registry game id (a fixed enum), `custom` as an opaque marker, screen count, focus-mode
usage and duration, session length, app version, Windows version, whether a feature was used
(cache clear, rename, volume, reload), crash and restart counts.

Forbidden, and each for a specific reason rather than as a general precaution:

- **A custom slot's URL** — user data that can carry a token in a query string or identify an
  account. A custom slot reports as `custom` and nothing else.
- **A screen's name** — free text the user typed; it can contain anything.
- **Anything from a log line**, any file path, any profile directory content.

Never a blocklist. A blocklist fails silently on the first field someone adds.

### The bug report tool

An in-app "report a bug, error or suggestion" action. It asks whether to attach the logs, and the
consent is given by **showing, not describing**: the redacted bundle is displayed on screen,
scrollable and editable, and the user presses send on what they just read.

The reason it must show rather than describe: `architecture.md` states that a log line can contain
a page URL with a session token. Any generic sentence about "technical information" would be least
accurate exactly where accuracy matters. A redaction pass runs first, but redaction by pattern is
never provably complete — showing the result is what makes the consent real.

Sending without attaching logs must remain a normal, one-click path. A suggestion is not a
diagnostic.

### Obligations and open tasks

- **Choose the managed service.** Criteria: accepts a plain JSON POST without an SDK, has a free
  tier at this volume, states its retention, and lets IP collection be turned off or is honest
  that it cannot. Decide before implementing; it is a dependency-and-data decision, so it comes
  back to the owner with options.
- **Metrics must never block anything.** No network at launch beyond what the user consented to,
  failures are logged locally and forgotten, and no send ever delays the UI.
- **The metrics request is a second main-process network surface**, alongside D7's. Same rules: the
  endpoint URL is a hardcoded constant, the response is ignored or validated, and the renderer's
  CSP is untouched.
- **Retention and reach.** Decide how long data is kept and write it in the first-run text. Brazil's
  LGPD is the relevant frame even at this scale: a pseudonymous id plus an IP is personal data, and
  "friends" is not an exemption.

---

## D10 — User accounts and login

**Status:** DECIDED (2026-07-29) — **the app has no accounts. Recorded as a non-goal.**

This was on the phase's goal list as a viability study, so the study is recorded rather than the
conclusion alone. Every purpose an account could serve was examined and each is either dead or
better served without one:

| Purpose                                | Verdict                                                                                                                                                                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entitlement / licensing                | Dead — monetization is permanently off (D11)                                                                                                                                                                                            |
| Identifying users in metrics           | Solved by D9c's random UUID, and solved **better**: it answers the question without creating a database of people                                                                                                                       |
| Attributing a bug report               | An optional contact field in the report form (D9) does it, with no account                                                                                                                                                              |
| Syncing configuration between machines | The only genuine use — and small. `config.json` can be copied by hand, and **profiles cannot be synced at all**: uploading one is literally sending a logged-in session off the machine, which the whole architecture exists to prevent |
| Restricting use to invited friends     | Futile. The source is public under Apache-2.0 (D3a), so any gate can be removed and rebuilt around                                                                                                                                      |

On the cost side stood an authentication server, stored credentials, password recovery, and a
database of real people's contact details under LGPD. Nothing on the benefit side survived to
weigh against it.

Two constraints this preserves, both of which would have needed defending otherwise: CLAUDE.md's
"the app never stores passwords" stays absolute with no exception to reason about, and the app's
only stored identity remains a random id the user can delete.

---

## D11 — Monetization

**Status:** DECIDED (2026-07-29) — **never. Distribution is free, permanently.**

Recorded as a non-goal in the same spirit as D10: not "not now", but a settled property that other
decisions were then allowed to depend on. D3's one-way licence choice, D5's decision not to expose
an identity, and D10's absence of accounts all lean on it.

Noted for the record, since the original goal list asked for thinking on the subject rather than
just a decision: if this ever grew far beyond the circle of friends and the author changed his
mind, the paths differ enormously in what they demand of the app. **Donations** (a link to a
funding page) need nothing from the software at all — no identity, no accounts, no server, and
they leave every decision in this document intact. **Anything transactional** — subscriptions,
licence keys, paid tiers — needs identity, entitlement checks and a server, which would reopen
D3, D5 and D10 simultaneously. If the subject ever returns, that is the line worth knowing before
the conversation starts.

---

## D12 — Supply chain and build provenance

**Status:** DECIDED (2026-07-29)

Two findings shaped this, both from measuring rather than assuming.

**ADR-0007 decision 1 was only half in force.** It pinned `electron` exactly so the embedded
Chromium would be "a reviewed decision rather than an `npm install` outcome". But the app has a
**second** third-party runtime dependency — `node-window-manager` in
`packages/window-manager/package.json` — and it sat at `^2.2.4`, floating. It is a **native**
module: it compiles code at install time and runs in the main process with full access to the disk
and the profiles. The reasoning that justified pinning Electron applies to it at least as
strongly. It went unnoticed because the ADR's wording was about the renderer.

**`electron-builder` is the largest new surface in this phase, and it hides as a devDependency.**
It pulls a wide tree, runs with full privilege on the build machine, and **assembles the binary
other people execute**. A compromised build-time package injects into the artifact — and with D5
leaving it unsigned, nothing downstream would notice.

**(a) Releases are built by GitHub Actions on a tag.** A clean checkout and `npm ci` from the
lockfile every time, so the artifact does not carry the state of one machine, and — the part that
matters here — the build produces a **public log of what went into the binary**. For an unsigned
artifact that is the only provenance evidence available: a friend can compare the release's SHA256
against the log. It does not replace a signature; it is the closest substitute this project can
have. In exchange, the release workflow's token must be scoped to the minimum that can publish a
release, since a workflow with publish rights is itself a target.

**No contradiction with ADR-0007, and the plan should say so** before someone spots it: that ADR
requires CI not to fetch the Electron binary, which was about the **verification** pipeline —
`typecheck` works from `electron.d.ts` and `npm ci` downloads nothing. A **release** job needs the
binary by definition. Different job, different rule.

**(b) `node-window-manager` is pinned exactly**, taking on the same standing obligation the
Electron pin created: somebody must raise it deliberately when there is a fix. `electron-builder`
is pinned exactly for the same reason.

Also to settle during implementation, flowing from the same reasoning: `electron-builder` may need
its own `allowScripts` entries (npm 11+ blocks install scripts, and the root `package.json` note
records that approving a parent does not cover a transitive package, which fails only at runtime).

---

## D13 — User data at rest, redaction, and the pre-release security review

**Status:** obligations, not a fork. Recorded so the phase cannot land without them.

**Data at rest stays exactly as it is.** A per-slot profile is an ordinary Chrome profile, and on
Windows its cookies are protected by DPAPI bound to the Windows user account. The app neither adds
to that nor weakens it. App-level encryption of a profile directory was considered and is not
pursued: Chrome must be able to read its own profile, so the app would have to decrypt it before
launch anyway, which buys nothing and risks the one thing ADR-0005 protects.

What the first-run text and the README must therefore say accurately: **session data lives in two
places**, not one — `%APPDATA%/hecaton/profiles` for persistent slots, and the OS temp directory
for clean-session slots (ADR-0005). Any statement of "where your data is" that names only the
first is wrong.

**Redaction already exists, and it already runs at the right moment.** An earlier draft of this
section claimed it would be new work; that was wrong, and the truth is better. `redactUrls` lives
in `packages/core/src/log.ts` and is applied by `formatLogRecord` at the logger boundary, so **no
URL ever reaches the file on disk** — the guarantee is enforced on the way in, not on the way out.
Every other logged field (`slotId`, `gameId`, `pid`) is structured and safe by construction.

This changes D9's bug-report design for the better: the bundle is **safe by construction** rather
than by a second redaction pass, and the same holds if a friend sends a raw log file by hand
instead of using the tool. What remains is smaller than it looked — verify the guarantee still
holds for any field this phase adds to a log entry, and build the show-before-send UI, which stays
valuable because seeing the contents is what makes the consent real.

**The security review before the first release covers the surfaces this phase created**, not the
whole app:

1. Both main-process network calls (update check, metrics POST): hardcoded URLs, responses
   validated or ignored, failures closed and visible, neither ever blocking the UI.
2. `shell.openExternal` — the URL is a constant; nothing from the renderer or from a fetched
   document can reach it.
3. The uninstaller's delete branch, after its probe.
4. The metrics allowlist: tests proving the forbidden fields (custom URL, screen name, log
   content, paths) cannot appear in a built event.
5. The bug-report bundle: redaction, and that what is shown is what is sent.
6. The first-run screen: consent is a real choice, nothing pre-selected, and the text matches what
   the code does.
7. **What actually ships in the package**: the `packages/core/src/testing/` fakes are excluded from
   the build by design — verify that in the packaged artifact, not in the source tree. Same for the
   `spike/` directory and anything else not meant to travel.
8. **That the packaged renderer still loads from `file://` with the same CSP.** ADR-0007 decision 2
   rests on "what is tested is what is distributed", and packaging is exactly the step that can
   quietly break it. Verify in the built app, not in dev.

## Suggested complements — proposed, none decided

Raised because the phase's decisions make them cheap or newly necessary. Each is the owner's call;
none is assumed by the plan above.

1. **Log retention.** `packages/storage/src/file-logger.ts` says outright that old files are not
   pruned and that retention was "left to a later decision rather than slipped in here". Handing
   the app to other people is that later moment: a daily file per day, forever, on someone else's
   disk. It is also a **deleting** path, which this project keeps deliberate — so it needs a
   decision, not a default.
2. **Corrupt-config recovery.** `JsonFileStorage.load` throws with the file named, which is good
   diagnostics, but a friend whose `config.json` got truncated is simply stuck. Suggested shape,
   consistent with the never-delete posture: rename it to `.bad-<timestamp>`, start from defaults,
   and say so in the UI — never silently overwrite, never delete.
3. **A "your data" entry in the panel.** Names both locations (`%APPDATA%/hecaton` and the temp
   directory used by clean-session slots) and opens the folder. It serves D13's accuracy
   obligation, gives the uninstaller's information page somewhere to point, and reuses the existing
   `logs:reveal` pattern of computing the path in main.
4. **Version and build info visible in-app**, and pre-filled into a bug report. Trivial, and the
   first thing wanted when a friend says "it broke".
5. **Release notes shown after updating**, not only before. D7 shows the changelog to help decide;
   showing it once after the new version starts closes the loop.
6. **A written dependency-review cadence.** ADR-0007 accepted the obligation to raise Electron
   deliberately; D12 just added two more pins (`node-window-manager`, `electron-builder`). An
   obligation with no moment attached is one nobody performs — tying the review to each release is
   the cheapest moment that already exists.

Not suggested, because they are already done and were checked: atomic config writes (`save` writes
to a temp file and renames, which is crash-safe on the same volume) and log redaction (see D13).

## Probes — measured, not reasoned about

Disposable, Phase-0 style, outside the packages, no TDD; findings recorded here and carried into
the ADRs.

| #   | Question                                                                                                                                                                   | Why it blocks                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Does an NSIS update run the previous version's uninstaller, and in silent mode?                                                                                            | If it does, D4b's delete-data branch must be provably unreachable from that path — otherwise an _update_ deletes logged-in profiles |
| P2  | Does the packaged app load the renderer from `file://` with the CSP header intact, and are the core fakes and `spike/` absent from the artifact?                           | ADR-0007 decisions 2 and 4 are only true if packaging preserves them                                                                |
| P3  | Does `shell.openExternal` to the hardcoded release URL behave with the navigation handlers ADR-0007 installed (`will-navigate` prevented, `setWindowOpenHandler` denying)? | The deny-everything posture must not have to be weakened to let the update link work                                                |

## When the phase lands

This document is deleted. What survives, and where:

| ADR                                                      | Carries                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ADR-0012** — the name and the data directory           | D1, D2: `Hecaton`, `APP_DIR_NAME` renamed, and **no migration code, ever**                                                                                                                                                                                                          |
| **ADR-0013** — the distribution posture                  | D3, D4, D5, D6, D12: Apache-2.0 and a public repo, per-user assisted NSIS, unsigned, GitHub Releases, CI-built, exact pins. These were weighed **together** and each depends on the others — unsigned is what makes per-user right, and a public repo is what makes unsigned costly |
| **ADR-0014** — the app's first network request           | D7, D8: user-initiated update check, no enforcement, no kill switch, no `electron-updater`                                                                                                                                                                                          |
| **ADR-0015** — metrics, logs and the absence of accounts | D9, D10, D11: opt-in metrics through a core-built allowlist, logs that stay local, no accounts, no monetization                                                                                                                                                                     |

Two existing ADRs are touched, and **they need different treatments** — which is exactly the
distinction the ADR README draws, so getting it wrong here would be ironic:

- **ADR-0007 gets `Superseded in part by ADR-0014`** at the top. Its decision 4 said the app makes
  no network request at all, and that is no longer true. This is **not** a Correction: ADR-0007 was
  not wrong about the code, the decision changed.
- **ADR-0004 gets a `## Correction`**, not a supersession. Its decision — all state outside the
  repository, in `%APPDATA%` — stands untouched; only the directory's _name_ changes, so after D2
  lands its text describes a path that no longer exists. That is a factual drift introduced by a
  later change, which the README says to record as a Correction stating that it appeared when the
  code changed rather than being wrong from the start.

`architecture.md` is updated in the same commit as the behaviour: the Privacy section (which
currently promises no telemetry), Data locations (the directory name), Errors and logging (the
bug-report bundle), and Phases (Phase 3 from "not started" to done).

## Implementation order

Sequenced so each step is verifiable and nothing risky happens before its probe.

1. **P1** — the uninstaller probe. It can change D4b's design, so it comes first.
2. **The rename** (D1, D2), as one mechanical commit: `@hecaton/*`, root package name, repo, and
   `APP_DIR_NAME` red-first in `packages/storage/src/app-paths.test.ts`. Plus the one-time manual
   step in `docs/troubleshooting.md`, written as a **move**.
3. **`LICENSE` + `NOTICE`** (Apache-2.0, copyright held under the handle) and the README's terms
   section.
4. **`electron-builder` config and the first packaged build**, then **P2** and **P3** against it.
5. **The release workflow** on tag, publishing the artifact and its SHA256.
6. **The first-run screen** — the terms warning and the metrics consent, together, since D3b and
   D9a share it.
7. **The update check** — core validator first, then the adapter, then the UI.
8. **Metrics** — the pure event builder in the core with its allowlist tests, then the POST adapter.
9. **The bug report** — bundle, redaction, show-before-send.
10. **The security review** (D13), then the docs: `architecture.md`, the four new ADRs, ADR-0007's
    `Superseded in part` line and ADR-0004's Correction — then delete this file.

## Non-decisions — recorded so they are not re-raised

- The renderer CSP is not relaxed by anything in this phase (see the CSP note above).
- No game session ever runs inside Electron, packaged or not (ADR-0007 decision 5).
- No forced update, no minimum-version enforcement, no remote kill switch (D8).
- No accounts (D10), no monetization (D11).
- No app-level encryption of profile directories (D13).
- No `electron-updater`, and no automatic update check unless the owner turns on the opt-in variant
  named in D8.
