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
planning — see D8. **Two of those four goals ended in nothing being built:** the account study
concluded against accounts (D10), and operational logging was decided in full and then reversed
before implementation (D9). The local rotated logs the app already had are untouched.)

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
| D4  | ~~Packaging target, installer shape~~ → a portable zip, no installer                    | **REVERSED 2026-08-08**                               | D1, D2     | ADR (the reversal and what it costs)                 |
| D5  | Code signing                                                                            | **DECIDED 2026-07-29 — unsigned**                     | D1         | ADR                                                  |
| D6  | Release hosting and the update feed's home                                              | **DECIDED 2026-07-29 — GitHub Releases**              | D3, D5     | folded into D7's ADR                                 |
| D7  | Update mechanism — the app's first network surface                                      | **DECIDED 2026-07-29**                                | D5, D6     | ADR (reverses ADR-0007's premise)                    |
| D8  | ~~Minimum-version enforcement ("forced update")~~ → how an available update is surfaced | **DECIDED 2026-07-29 — no enforcement; closed by D7** | D7         | same ADR as D7                                       |
| D9  | ~~Logging, metrics and telemetry~~ → dropped; local logs unchanged                      | **REVERSED 2026-07-30 — nothing built**               | D6, D7     | ADR (a decision taken and dropped before code)       |
| D10 | User accounts / login — viability, and whether Phase 3 does anything                    | **DECIDED 2026-07-29 — no accounts**                  | D9         | ADR                                                  |
| D11 | Monetization posture and its liability consequence                                      | **DECIDED 2026-07-29 — never**                        | —          | architecture.md (a recorded non-goal)                |
| D12 | Supply chain and build provenance                                                       | **DECIDED 2026-07-29**                                | D5         | architecture.md + the distribution ADR               |
| D13 | User data at rest, log redaction, and the pre-release security review                   | **Obligations, no fork**                              | D4, D9     | architecture.md + review record                      |

Order of decision is the order above: cheapest and most blocking first (a name and a license gate
the installer; the installer gates signing; signing gates the update trust chain; the update
channel gates telemetry; telemetry infrastructure gates any account discussion). The last two links
in that chain became moot when D9 was reversed — there is no telemetry to gate anything.

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
- **The owner does not want personal exposure** in publishing the tool. Scope, after 2026-07-30: this
  governs a **legal identity** — the subject name on a certificate, shown in a UAC dialog to every
  user (D5). It does not extend to the commit-author e-mail, which was weighed separately and
  accepted when the repository went public (see D3a).
- **Attribution matters**: copying without credit is the thing to prevent.

Consequences, taken together rather than one at a time:

- Signing is what would have exposed a legal identity, so D5's answer and the privacy goal agree
  rather than conflict.
- Apache-2.0 turns out to be the right licence for the attribution goal specifically: §4 obliges a
  redistributor to keep the copyright notices and to state their changes, and its trademark clause
  keeps a fork from calling itself Hecaton. **The copyright holder may be a handle** — and the owner
  chose **`Copyright 2026 Shofnip`** (2026-07-30), matching the GitHub account exactly, so the notice
  exposes nothing the account does not already show. `NOTICE` is where that line belongs, and it also
  states that §6 grants no right to the name Hecaton.
- D4a was decided **before** this was stated, and was revisited because of it (see D4).
- D9 and D10 should be re-read against this before being planned: telemetry infrastructure and
  user accounts are shaped very differently for four friends than for a public user base. Both were
  re-read and both ended in nothing being built — D10 as a non-goal on 2026-07-29, D9 reversed on
  2026-07-30. For four friends, the audience note turned out to argue against each of them.

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

**Done 2026-07-30 — the repository is public at `github.com/Shofnip/hecaton`, and one exposure was
accepted knowingly at the door.** A pass over the history before flipping found it clean in every
respect but one: no sensitive file was ever committed, no token or private key appears in any of the
93 commits, no personal e-mail or user path is in the tracked content. But **all 93 commits carry
`shofnip@gmail.com` in the author field**, and a public repository serves that through the API, where
it is routinely harvested.

The options were put to the owner, including rewriting the author to
`Shofnip@users.noreply.github.com` before publishing — cheap while the repository was still private,
impossible afterwards, and it would have kept attribution working since GitHub links a noreply
address to its account. **The owner chose to publish as-is.** Recorded here because it qualifies a
statement made elsewhere in this document: "the owner does not want personal exposure" was the
premise behind D5, and it still governs **signing**, where the exposure is a legal name in a UAC
dialog shown to every user. An e-mail address in commit metadata was weighed separately and
accepted. A future session must not read the D5 sentence as covering this too, nor reopen it.

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

**Consequence that constrained D4** — void since 2026-08-08: a licence page required the **assisted**
NSIS installer, and there is no installer any more. The warning now appears in **two** places, README
and first run, and `LICENSE` ships inside the zip. Recorded rather than quietly dropped, because
"three places" was a deliberate choice and it is now two: the one lost is the one a user could not
skip past, so the first-run text carries more weight than it did.

**Verification task — DONE 2026-07-30, and the result is sharper than expected.** The Poke IdleWorld
rules had never been read; `architecture.md` carried it as an open risk. Read on
[poke.idleworld.online/rules](https://poke.idleworld.online/rules):

- **More than four accounts** without authorization previously accepted by the administration can
  bring "the permanent deletion of the accounts involved". **The app ships with four screens, exactly
  at that threshold** — so the default is inside the rule and a fifth screen is outside it.
- **"Using any program, script or extension without staff permission is forbidden."** This reaches
  Hecaton itself, regardless of it automating nothing. Macros, auto-clickers and "tools that simulate
  your presence" are prohibited separately and are what the rule most clearly targets — the app does
  none of those — but the broad wording covers it and only the game's staff can say otherwise.
- Penalties escalate with history: warning, suspension, item removal, permanent ban.

So the warning is now specific rather than generic, with the reading date attached, and the README
section was rewritten around it. It also raises a **product decision that is the owner's** and is not
taken here: whether the app should say something when a user adds a **fifth** screen, since that is
the moment a documented line is crossed. Options run from nothing, through a one-time note next to
the add-screen action, to naming it in the first-run text. Not implemented.

---

## D4 — Packaging target, installer shape, and what an uninstall leaves

**Status:** DECIDED (2026-07-29) → **REVERSED (2026-08-08). There is no installer. The release is a
zip.**

### The zip, decided 2026-08-08

`electron-builder` producing a **portable zip**. The user downloads it, extracts it wherever they
like, and runs `Hecaton.exe`. Updating is replacing the folder. There is no install step, no
elevation, no Start-menu entry, no uninstall registry entry, and nothing writes outside the extracted
folder and `%APPDATA%/hecaton`.

**This is the option D4 rejected on 2026-07-29, and three of the four reasons it was rejected for
were dissolved by later decisions rather than argued away:**

| Original objection                                                                    | Why it no longer holds                                                                                                                             |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| "incompatible with D3b (no licence page)"                                             | D3b wanted the warning in three places; the installer was one of them. Two remain — README and first run — and the licence itself ships in the zip |
| "no uninstall entry"                                                                  | Accepted deliberately: deleting the folder is the uninstall                                                                                        |
| "no update path"                                                                      | D7 already decided the app never installs anything — it opens the release page and the user downloads. That works identically for a zip            |
| "misleading, since deleting the folder leaves every logged-in profile in `%APPDATA%`" | **This one still holds**, and is the reason the delete action moves into the app — see below                                                       |

**What makes the zip viable at all is ADR-0004**, and it is worth naming because it was decided long
before anyone considered a zip: every piece of state already lives in `%APPDATA%/hecaton`, so the
extracted folder is disposable and can sit anywhere. An app that wrote next to its own binary could
not be shipped this way without redesigning where its data lives.

**The consequence that survives, and what is done about it.** Deleting the folder leaves
`%APPDATA%/hecaton` behind — the persistent profiles, which **are** logged-in sessions, plus config
and logs — with nothing prompting about it. With an installer, the uninstaller was the moment to ask.
That moment no longer exists, so **the "delete all my data" action moves into the app's panel**
(decided 2026-08-08), with explicit confirmation, reusing the core validator and the adapter that
already exist and are tested. The headless `--delete-user-data` flag is removed with the installer:
it existed only so NSIS could call it.

Two obligations follow, and both are D13 accuracy obligations rather than new ideas: the README and
the first-run text must say where the data is, and the panel needs the "your data" entry that
suggested complement 3 already describes — it stops being a nicety and becomes the only place the
user can act.

**What was built for the installer and is now dropped:** the NSIS custom script
(`build-resources/installer.nsh`), the uninstaller checkbox, and the `${isUpdated}` guard. It stays
in git history. Probe P1's findings keep their value as a record of _why_ the delete branch was never
written in NSIS, but they now describe a mechanism this project does not use.

### The installer decision, superseded 2026-08-08

Kept for the trail. **None of this is built any more.**

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

**(b) The uninstaller offers a checkbox, and the app performs the deletion.** DECIDED 2026-07-29,
after probe P1 measured the update path (findings below). The uninstaller shows an unchecked
checkbox; if it is checked, `customUnInstall` runs `Hecaton.exe --delete-user-data` **before** NSIS
removes the installation directory — at that point the app binary still exists, because
`customUnInstall` is inserted at the top of the uninstall section, ahead of the `RMDir /r $INSTDIR`.

**Scope:** everything under `%APPDATA%/hecaton` — the persistent profiles `slot-N`, the archived
`slot-N.old-*`, `config.json` and `logs/` — plus the 96 MB installer copy that a normal uninstall
orphans (consequence 5 below).

**Refined while implementing, 2026-07-30: the updater cache is deleted by NSIS, not by the app.** An
earlier line here said the NSIS script "contains no deletion of its own: it contains a launch". That
is no longer exactly true, and the reason is a measurement. The cache directory's name is derived by
electron-builder from the **package** name, not the product name: `sanitize-filename('@hecaton/shell')`
keeps the `@` and drops only the slash, so the real path is
**`%LOCALAPPDATA%/@hecatonshell-updater`** — not `hecaton-updater`, as this document previously
stated. The app could only know that by reimplementing electron-builder's derivation, which would
fail silently the day it changed. NSIS has it as a build-time constant.

So the split is by who knows the path and by what is at stake: **the app deletes the session data**,
from its own constant, in code the suite covers; **NSIS deletes the installer copy**, which contains
no user data — it is a copy of a public installer — by exact filename, then removes the directory
non-recursively. There is no `RMDir /r` anywhere in the custom script. The property D4b was protecting
is unchanged: no deletion of _user data_ happens outside tested code.

**Not in scope:** the throwaway clean-session profiles under the OS temp directory (the ADR-0005
exception). They are deleted on `stop()` and only survive a crash, and sweeping them would mean
deleting by filename pattern inside `%TEMP%`, where a pattern one character too broad destroys a
third party's files. The informational text says the temp location exists instead.

**Why the app and not the NSIS script**, given that P1 proved the `${isUpdated}` guard works: the
guard is not the risky part. Deciding _which directories die_ is, and in the NSIS variant that
decision sits outside the test suite and is **frozen in every uninstaller already distributed** —
the uninstaller an update executes is the previous release's binary, so a wrong branch cannot be
repaired by any later release. In this shape the frozen part is "launch the app with a flag", which
is trivial and unlikely to need repair, while the deletion travels with the app version that owns
it. The cost accepted in exchange: NSIS gains the ability to execute the app (a rule-2 external
code execution trigger, recorded here as taken deliberately), and the app needs a headless mode
that runs and exits without a window — if it hangs, the uninstall hangs.

**Obligations this creates:**

- **`deleteAppDataOnUninstall` stays `false`.** The built-in deletes on every real uninstall with no
  confirmation at all, which is exactly what ADR-0005 and ADR-0008 forbid; and P1 measured that it
  also matches `%APPDATA%/<package.json name>`, which after the D2 rename is `%APPDATA%/hecaton`
  itself. It must be off, deliberately, not by default.
- **The launch is guarded by `${isUpdated}`** even though the checkbox cannot be checked on the
  update path (no pages are shown), because P1 measured that an unguarded branch in
  `customUnInstall` runs on every update.
- **The checkbox label must match the scope.** "Apagar dados de perfil" would understate it now that
  config and logs are included; the label is **"Apagar todos os meus dados (perfis, configuração e
  logs)"**. Same obligation as the first-run text: D13's accuracy requirement applies to any UI
  string that describes what happens to user data.
- **The first release that ships this must be right**, because of the frozen-binary property above.

_(A second probe — which user's `%APPDATA%` an elevated uninstaller resolves — was dropped when
(a) became per-user: without elevation the question does not arise.)_

**Rejected:** portable zip — incompatible with D3b (no licence page), no uninstall entry, no update
path, and misleading besides, since deleting the unzipped folder leaves every logged-in profile in
`%APPDATA%`.

---

## D5 — Code signing

**Status:** DECIDED (2026-07-29) — **nothing is signed.** The decision stands unchanged after D4's
reversal on 2026-08-08; only its wording ages, since there is no installer to sign. Two of the three
arguments that had raised signing's value are now gone with it — there is no UAC dialog, and D7 never
downloaded or ran an installer in the first place. What remains is D3a: the source is public, so
anyone can build a lookalike zip. The SHA256 published beside each release is still the only thing
that distinguishes an authentic build, and a zip makes checking it no harder.

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

**Status:** DECIDED (2026-07-29) → **REVERSED (2026-07-30). Nothing here is built, and nothing here
will be built.** The owner dropped metrics and the bug-report tool outright.

### What stands after the reversal

|                                                                      | Where it lives         | Leaves the machine? |
| -------------------------------------------------------------------- | ---------------------- | ------------------- |
| **Logs** — the existing rotated JSONL under `%APPDATA%/hecaton/logs` | on the machine, always | **never**           |
| ~~Metrics~~                                                          | —                      | does not exist      |
| ~~Bug reports~~                                                      | —                      | does not exist      |

**The local logs are untouched.** `FileLogger`, the rotation, and the redaction at the logger
boundary all stay exactly as they are: they were never part of what D9 proposed to add, and they
never leave the machine. Dropping them was offered and rejected — an app with no local diagnostic
leaves nothing to ask a friend for when something breaks on their machine.

**Three properties this buys, and they are larger than the feature that was dropped:**

1. **The app's only network request is D7's update check**, which happens only when the user asks.
   There is no second main-process network surface, no endpoint, no third party storing anything.
2. **`architecture.md`'s "No telemetry (if ever, explicit opt-in)" and `README.md`'s "there is no
   telemetry" stay true, and stop being conditional.** The "if ever" was opened and closed without a
   line of code. Neither file needs editing, which is the clearest sign the promise held.
3. **No pseudonymous id exists.** D9c's UUID is not generated, so the app stores no identifier of
   any kind, and the LGPD question the original design had to answer does not arise.

**The cost, stated plainly rather than glossed:** the author will have no idea how the app is used —
how many screens people actually run, which features are touched, how often it crashes. Every future
decision about what to build or simplify will be made on intuition. And when a friend reports a
problem, the diagnostic path is entirely manual: ask them to open `%APPDATA%/hecaton/logs` and send
a file. That is the trade being accepted.

**This is a reversal before implementation, which is the cheap kind.** Nothing has to be removed, no
user data was ever collected, and no promise has to be walked back. Had it been reversed after
shipping, the ADR would have had to explain a telemetry endpoint that once existed.

### The design that was decided and then dropped

Kept, not deleted. If metrics ever return, the reasoning below is what it cost to work out — the
consent model, the allowlist-in-the-core shape, and the specific things ruled out. **None of it is
built. Do not read past this line as a description of the app.**

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

### ~~Obligations and open tasks~~ — all cancelled by the reversal

Every one of these existed only to serve metrics, and all are void: choosing a managed analytics
service (the dependency-and-data decision that would have come back to the owner), keeping the send
off the UI's critical path, the second main-process network surface, and the retention policy that
would have had to be written into the first-run text under Brazil's LGPD.

That last one is worth noticing. The original design had to answer "how long is this kept, and by
whom" before the first-run screen could be written truthfully. **With nothing collected, the question
has no subject** — which is why the first-run screen (step 7) is now a smaller, unblocked piece of
work rather than one waiting on two open decisions.

---

## D10 — User accounts and login

**Status:** DECIDED (2026-07-29) — **the app has no accounts. Recorded as a non-goal.**

This was on the phase's goal list as a viability study, so the study is recorded rather than the
conclusion alone. Every purpose an account could serve was examined and each is either dead or
better served without one:

| Purpose                                | Verdict                                                                                                                                                                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entitlement / licensing                | Dead — monetization is permanently off (D11)                                                                                                                                                                                            |
| Identifying users in metrics           | Moot since 2026-07-30: D9 was reversed, there are no metrics. It had been solved by a random UUID, which is now not generated either                                                                                                    |
| Attributing a bug report               | Moot for the same reason — there is no in-app report form. A friend messages the author, which is what four friends were always going to do                                                                                             |
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

With D9 reversed there is no bug-report tool, and this guarantee matters **more** rather than less:
sending a log file is now entirely manual, so a friend attaching one by hand gets the same safety a
show-before-send UI would have given them. Nothing was lost by dropping the tool on this axis,
because the protection was never in the tool — it is at the logger boundary. What remains is one
standing obligation: verify the guarantee still holds for any field a later change adds to a log
entry.

**The security review before the first release covers the surfaces this phase created**, not the
whole app:

1. The app's **one** main-process network call, D7's update check: hardcoded URL, response validated,
   failure closed and visible, never blocking the UI. It was two until D9 was reversed, and the
   review is stronger for it — "the app makes exactly one request, only when asked" is a claim that
   can be checked by grepping for `fetch` in the main process and finding a single call site.
2. `shell.openExternal` — the URL is a constant; nothing from the renderer or from a fetched
   document can reach it.
3. **The in-app delete action** (rewritten 2026-08-08, since there is no uninstaller): it is reachable
   only through an explicit, confirmed user action in the panel; the paths come from
   `@hecaton/storage`'s own functions and never from an IPC payload; the core validator still refuses
   anything that is not the app's own directory; and **no other code path deletes user data** —
   checked by finding every call site of the adapter and confirming there is one. The old NSIS
   guards (`deleteAppDataOnUninstall: false`, the `${isUpdated}` branch, the headless flag) are gone
   with the installer and are not part of this review.
4. ~~The metrics allowlist.~~ Void — D9 reversed, no events are built.
5. ~~The bug-report bundle.~~ Void for the same reason. Instead, confirm the negative: **nothing in
   the app sends a log anywhere.** A dropped feature leaves no test behind, so this one is checked by
   looking rather than by a suite.
6. The first-run screen: the terms text matches what the code does. The consent half is gone with
   D9, so what is left to review is accuracy, not whether a choice was real.
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
4. **Version and build info visible in-app.** More useful since D9 was reversed, not less: with no
   report form to pre-fill, a friend has to read the version off the screen and type it. Trivial, and the
   first thing wanted when a friend says "it broke".
5. **Release notes shown after updating**, not only before. D7 shows the changelog to help decide;
   showing it once after the new version starts closes the loop.
6. **A written dependency-review cadence.** ADR-0007 accepted the obligation to raise Electron
   deliberately; D12 just added two more pins (`node-window-manager`, `electron-builder`). An
   obligation with no moment attached is one nobody performs — tying the review to each release is
   the cheapest moment that already exists. **The disk-footprint check below belongs in the same
   review**, since it fails the same way: silently, between versions.

Not suggested, because they are already done and were checked: atomic config writes (`save` writes
to a temp file and renames, which is crash-safe on the same volume) and log redaction (see D13).

### Disk footprint per screen — done 2026-07-29, with a verification that outlives the commit

Not a fork; recorded because it was measured during this phase, it changes what installing this
costs a friend, and it carries an obligation no test can hold.

`%APPDATA%/helloweb` was 17.4 GB for four slots. **16.3 GB of that was Chrome's Gemini Nano model**,
4,072 MB duplicated in each profile under `OptGuideOnDeviceModel`, the same model version every
time. The rest of a profile is ~300 MB. It arrives roughly **two days** after a profile is created,
not at first launch — measured from directory creation times across the four slots, at Chrome
150.0.7871.187.

Every slot is now launched with
`--disable-features=OptimizationGuideOnDeviceModel,OptimizationGuideModelDownloading`. The 16.3 GB
already on disk is the owner's to remove by hand, with the app closed — the same posture as the D2
directory move: no code in this product deletes anything inside a live profile. The flag weakens no
browser protection; adding it
did, however, weaken an existing test, which was fixed in the same commit — `chrome-args.test.ts`
matched forbidden flags on the whole argument, so `--disable-features=<anything>,IsolateOrigins`
would have passed once the switch existed. The guard now inspects the parsed feature names, and pins
the number of `--disable-features` arguments at one, because Chromium honours a single value per
switch and a second occurrence would silently discard the first.

**The verification obligation:** there is no fast test for this. Chromium ignores feature names it
does not recognise, so a rename upstream turns the switch into a no-op whose only symptom is the
disk filling again, two days at a time. Confirmation is checking that `OptGuideOnDeviceModel` has not
reappeared — which is why it is tied to the release-time dependency review above rather than left as
an intention.

## Probes — measured, not reasoned about

Disposable, Phase-0 style, outside the packages, no TDD; findings recorded here and carried into
the ADRs.

| #   | Question                                                                                                                                                                                                                                                                              | Why it blocks                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| P1  | **DONE 2026-07-29 — yes to both. Historical since 2026-08-08:** there is no installer, so nothing exercises this path. Does an NSIS update run the previous version's uninstaller, and in silent mode?                                                                                | If it does, D4b's delete-data branch must be provably unreachable from that path — otherwise an _update_ deletes logged-in profiles |
| P2  | **DONE twice — against the installer 2026-07-30, where the first build failed it, and against the zip 2026-08-08, where it passed.** Does the packaged app load the renderer from `file://` with the CSP header intact, and are the core fakes and `spike/` absent from the artifact? | ADR-0007 decisions 2 and 4 are only true if packaging preserves them                                                                |
| P3  | **MOVED to step 7** — nothing calls `shell.openExternal` yet, so there is no behaviour to measure against the artifact. Does it behave with the navigation handlers ADR-0007 installed?                                                                                               | The deny-everything posture must not have to be weakened to let the update link work                                                |

### P1 — findings, measured 2026-07-29

Windows 11 Pro 10.0.26200, `electron-builder` 26.15.3, Electron 43.2.0. Two throwaway installers
(1.0.0 and 1.0.1) built in exactly D4's shape — assisted with a licence page, per-user, no
elevation — with every NSIS hook instrumented to log its state. The delete branches were
**simulated**: they logged "would delete" instead of deleting, so reachability was answered without
removing a file. `deleteAppDataOnUninstall: true` was left on and pointed at throwaway marker
directories, so the one real deletion in the probe was observable and harmless.

**An update runs the previous version's uninstaller, always silently, with an explicit `--updated`
flag.** Measured command line, logged by the 1.0.0 uninstaller while the 1.0.1 installer ran:

```
"...\Temp\nsw6FD1.tmp\old-uninstaller.exe" /S /KEEP_APP_DATA /currentuser --keep-shortcuts --updated
```

| Path                       | `${isUpdated}` | `${Silent}` | unguarded branch | guarded branch | built-in delete       |
| -------------------------- | -------------- | ----------- | ---------------- | -------------- | --------------------- |
| fresh install              | —              | —           | not run          | not run        | not run               |
| **update** (silent, `/S`)  | **YES**        | **YES**     | **RAN**          | skipped        | did **not** delete    |
| **update** (assisted, GUI) | **YES**        | **YES**     | **RAN**          | skipped        | did **not** delete    |
| real uninstall             | no             | YES         | RAN              | RAN            | **deleted both dirs** |

The `/S` is hardcoded in `installUtil.nsh`'s `uninstallOldVersion`, which `installSection.nsh` calls
**unconditionally** — not gated on the installer itself being silent. That is why the assisted and
silent rows are identical, and it was measured both ways rather than inferred from the one.

The row that decides D4b: **an unguarded branch in `customUnInstall` runs during an update.**
`${isUpdated}` distinguishes the paths reliably, and electron-builder's own built-in deletion is
already guarded by it — but `!insertmacro customUnInstall` is inserted at the **top** of the
uninstall section, ahead of that guard, so custom code inherits no protection.

**Five consequences, three of which were not in the question:**

1. **The uninstaller executed during an update is the OLD release's binary**, read from the
   `UninstallString` registry value and copied to `%TEMP%`. A wrong delete branch is therefore
   permanent for everyone who already installed: fixing it in 1.0.2 does nothing for the 1.0.1
   uninstaller that 1.0.2's installer will run. This is what decided D4b's shape.
2. **A "delete my data?" page cannot appear on the update path — and that is the trap, not the fix.**
   Silent means NSIS shows no pages, so a checkbox variable keeps its initial value and the code
   after it runs anyway. Absence of the page is not absence of the branch.
3. **`deleteAppDataOnUninstall` deletes more than its name suggests.** Measured: it removed both
   `%APPDATA%\<productName>` and `%APPDATA%\<package.json name>`; from `uninstaller.nsh` it targets
   `APP_FILENAME`, `APP_PRODUCT_FILENAME` and `APP_PACKAGE_NAME`. After the D2 rename the package
   name and `APP_DIR_NAME` are the same string, so `%APPDATA%\hecaton` — every persistent profile —
   is in that list.
4. **`InstallLocation` came back empty in the registry**, so `uninstallOldVersion` fell back to
   deriving the directory from the `UninstallString` path. It worked, but the update path depends on
   a fallback rather than on the value it reads first.
5. **Every install leaves a full copy of the installer in `%LOCALAPPDATA%`, and no uninstall removes
   it.** Measured: 99 MB at `%LOCALAPPDATA%\<package name>-updater\installer.exe`, still there after
   a clean uninstall. Source: `include/installer.nsh:93`,
   `!insertmacro copyFile "$EXEPATH" "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"`. It is one file
   overwritten per update, not an accumulating pile, but it survives uninstallation permanently. It
   exists to serve `electron-updater`'s `--package-file` flow, which **D7 decided not to use**, so
   for this project it is dead weight. It is now inside D4b's delete scope, and any "where is my
   data" text has to count it. **The exact name, measured on 2026-07-30 while implementing D4b:**
   `%LOCALAPPDATA%\@hecatonshell-updater`. It comes from the **package** name, not the product name —
   `sanitize-filename('@hecaton/shell')` keeps the `@` and removes only the slash — which is also why
   NSIS deletes it rather than the app (see D4b).

**Confirmed in passing:** per-user install raised **no UAC prompt** on install or update (D4a's
premise); the install directory is `%LOCALAPPDATA%\Programs\<productName>`; the assisted installer's
licence page appeared and worked (D3b's requirement); and NSIS and the app agree on `%APPDATA%`.

### P2 — findings, measured 2026-07-30

Run against `release/win-unpacked` and its `app.asar`, built by `npm run package -w @hecaton/shell`.

**The first packaged build failed the artifact half, which is exactly why this probe was written.**
The workspace packages are symlinked into `node_modules`, and `electron-builder` copied them whole —
`src/` included. `app.asar` therefore contained **`core/src/testing/fakes.ts` and 19 `*.test.ts`
files**. CLAUDE.md says the fakes are "excluded from the build so they never ship"; that was true of
`tsc`'s output and false of the thing people install. D13's item 7 asks for this to be checked "in
the packaged artifact, not in the source tree", and the source tree looked perfect throughout.

Fixed with two negations in `files`, after which the asar went from 447 entries to 335: no `src/`, no
tests, no fakes, no `spike/`, `dist/` intact (34 entries). Source maps went with `src/`, because they
carry no `sourcesContent` — only a relative path to `../src/*.ts` — so without it they resolve to
nothing. If readable stack traces are ever wanted (they were going to serve the bug-report tool D9
dropped, and would now serve a log file a friend sends by hand), the fix is `inlineSources` in
tsconfig, which makes maps self-contained; it is **not** shipping `src/` again.

**The `file://` and CSP half passes, verified in the artifact rather than in dev:** the `index.html`
extracted from `app.asar` carries the identical policy (`default-src 'none'` … `connect-src 'none'`),
the packaged `main.js` still uses `loadFile`, and the packaged `Hecaton.exe` renders the full panel
with its four screens. That last part is the load-path proof: the screens come from main over IPC, so
a broken `file://` resolution inside the asar, a CSP that rejected the bundled script, or a preload
bridge that did not attach would all show up as an empty window.

Also confirmed in the artifact: `will-navigate`, `setWindowOpenHandler` with `action: 'deny'`, and
`will-attach-webview` are all present in the packaged main — ADR-0007's handlers survive packaging.

**Why P3 could not run here.** It asks how `shell.openExternal` behaves alongside those handlers, and
**nothing in the app calls `openExternal` yet** — the packaged main uses `shell.openPath` only. There
is no behaviour to measure, so the probe moves to step 7, where the update check creates the call and
the test becomes direct. Recorded rather than quietly satisfied by argument: the mechanism suggests no
conflict, since `openExternal` runs in main and hands the URL to the OS shell while both handlers
govern renderer-initiated navigation — but that is reasoning, and this project's habit is to measure.

**Packaging facts worth carrying into step 4**, learned building the probe: `electron-builder`
26.15.3 installs **277 packages**, and pulls `electron-winstaller@5.4.0`, whose install script npm 11
blocks — the NSIS build succeeded with it unapproved, so it needs no `allowScripts` entry. The
config needs `publish: null` or the build fails at its last step computing update channels. Pointing
`electronDist` at the repo's own `node_modules/electron/dist` avoids downloading a second Electron,
but then `electronVersion` must be stated explicitly.

### The release workflow — measured 2026-07-30

Run through `workflow_dispatch` on `main`, so the build could be proven before a tag existed. It
succeeded on `windows-latest` in 3m56s, and the artifact was downloaded and exercised rather than
trusted:

- `sha256sum -c` accepts the published `.sha256` file, which is the property that matters — a friend
  checks it with the standard tool and nothing bespoke.
- The installer from CI installs, both `addon.node` files are unpacked outside the asar, and the app
  **runs**: the panel renders with its four screens, which it could not do if the native modules had
  the wrong ABI, since main imports the window manager at module load.

**The blocker everyone expected did not appear, and the reason is worth recording.**
`docs/troubleshooting.md` and `integration.yml` both said `npm ci` cannot build the two native
modules on the hosted image, because `node-gyp` 11.5 does not recognise Visual Studio 18. `node-gyp`
is **12.4.0** in the lockfile now — it rose when `electron-builder` was installed, not because anyone
set out to fix it. Both documents were corrected. A trap on the way: `npm` hides install-script
output unless a script fails, so a successful native build shows **no gyp lines at all**, and the
absence of them is not evidence that nothing compiled.

**The build is not reproducible byte for byte.** The CI artifact hashes
`2951dce3…` where the same commit built locally hashes `e9b58cae…`. So the provenance D12a buys is
"this hash came from this public log", not "you can rebuild it and compare". For an unsigned release
that is still the strongest claim available, but it is weaker than it sounds and should be stated
plainly to whoever is asked to trust it.

**`npm audit` reports 16 high-severity advisories, and none of them ship.** `npm audit --omit=dev`
is clean: the production tree has zero. All sixteen are build-time and collapse to two roots —
`brace-expansion` (denial of service through unbounded expansion), reached via
`minimatch` → `glob` → `@electron/asar` → `app-builder-lib` → `electron-builder`, and `ejs` via
`jake`.

**DECIDED 2026-07-30 — accepted as they are.** The owner chose to accept rather than patch. What is
being accepted is narrow and worth stating precisely: a denial-of-service in a glob library that runs
on the **build machine**, over patterns the build itself supplies. Nothing feeds hostile glob input
into this build, and nothing affected reaches a user's disk.

Rejected: npm `overrides` forcing patched transitives under the build tree — it would close the
advisories while keeping the pin, but it creates an untested combination inside `electron-builder`,
and a packaging step that breaks subtly is worse than the denial of service it prevents. Also
rejected: `npm audit fix --force`, which would move `electron-builder` off the exact pin D12 chose
deliberately — the cheapest thing to type and the most expensive consequence.

**The gap in this decision, stated so it is not mistaken for covered.** Accepting leans on revisiting
at each release, and D12b did create the standing obligation ("somebody must raise it deliberately
when there is a fix") — but the **moment** is still only suggested complement 6, undecided. Until
that is taken, this is an acceptance with no scheduled revisit, which is a weaker thing.

**Proposed, not implemented — the way to make this decision enforceable rather than remembered.**
Run `npm audit --omit=dev` in CI, so build-time advisories stay accepted while one landing in the
**shipped** tree fails the build. It turns "all sixteen are build-time" from a fact observed once into
a property that is checked. The cost is real and is why it is not simply done: `tests/repo-consistency.test.ts`
requires `npm run check` to cover everything CI runs, so `check` would gain a step that needs the
network — it is offline today, and a registry outage would turn into a red local run. A separate
manual or scheduled workflow avoids both, at the price of being a signal nobody is forced to read.
The owner's call.

## When the phase lands

This document is deleted. What survives, and where:

| ADR                                                       | Carries                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ADR-0012** — the name and the data directory            | D1, D2: `Hecaton`, `APP_DIR_NAME` renamed, and **no migration code, ever**                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **ADR-0013** — the distribution posture                   | D3, D4, D5, D6, D12: Apache-2.0 and a public repo, **a portable zip and no installer**, unsigned, GitHub Releases, CI-built, exact pins. The assisted per-user NSIS installer was built, verified and then dropped on 2026-08-08 in favour of the zip — the ADR carries that reversal, because the installer's reasoning is what explains why the delete-data action lives in the panel rather than in an uninstaller, and because "no installer" is the kind of decision someone later reads as an omission rather than a choice |
| **ADR-0014** — the app's first network request            | D7, D8: user-initiated update check, no enforcement, no kill switch, no `electron-updater`                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **ADR-0015** — what the app deliberately does not collect | D9, D10, D11: **no metrics, no bug-report tool, no accounts, no monetization**, and logs that never leave the machine. D9 is the interesting half: opt-in telemetry through a core-built allowlist was designed in full, then dropped before a line was written, so the ADR records a decision **taken and reversed** rather than one implemented. Both alternatives it rejected — opt-out defaults and a machine-derived id — are worth carrying, because they are what someone would reach for if the subject returns           |

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

`architecture.md` is updated in the same commit as the behaviour: Data locations (the directory
name) and Phases (Phase 3 from "not started" to done).

**Its Privacy section does not change, and neither does `README.md`'s.** Both promise no telemetry,
and after D9's reversal both are simply still true — the earlier note here, that they would have to
change in the commit landing D9 "or the app ships contradicting its own README", is void. Worth
leaving on the record: that contradiction was a real risk right up until the feature was dropped, and
the reason it never materialised is that the promise was written in two places and both were being
tracked.

## Implementation order

Sequenced so each step is verifiable and nothing risky happens before its probe.

1. ~~**P1** — the uninstaller probe.~~ **Done 2026-07-29**; it did change D4b's design (see D4b and
   the findings above).
2. **The rename** (D1, D2), as one mechanical commit: `@hecaton/*`, root package name, repo, and
   `APP_DIR_NAME` red-first in `packages/storage/src/app-paths.test.ts`. Plus the one-time manual
   step in `docs/troubleshooting.md`, written as a **move**.
3. ~~**`LICENSE` + `NOTICE`** (Apache-2.0, copyright held under the handle) and the README's terms
   section.~~ **Done 2026-07-30.** Apache-2.0 verbatim from apache.org, `NOTICE` under `Shofnip`, and
   the README rewritten around the rules actually read (see D3b). **Making the repository public is
   the remaining half of D3a and is deliberately separate**, since it is the one-way door: it needs a
   pass over the git history first, because publishing publishes every commit, not just the current
   tree.
4. ~~**`electron-builder` config and the first packaged build**, then **P2** and **P3** against it.~~
   **Done 2026-07-30**, `deleteAppDataOnUninstall: false` from the first line as D4b requires. P2
   passed only after a fix it forced (see its findings); **P3 moved to step 7**, since nothing calls
   `shell.openExternal` yet. D12's two exact pins are now actually in force: `electron-builder`
   at 26.15.3 and `node-window-manager` at 2.2.4, which had still been floating at `^2.2.4`.
5. ~~**The delete-user-data path** (D4b).~~ **Done 2026-07-30.** Core validator red-first, sync
   adapter with an integration test on real disk, headless branch in main ahead of the
   single-instance lock, and the NSIS checkbox with its `${isUpdated}` guard. Verified against real
   installers with `APPDATA` redirected to a throwaway directory **and the real one moved aside
   first**, so the destructive path could never reach four logged-in profiles: ticked → data gone and
   the sibling directory untouched; update 0.1.0 → 0.1.1 → data survives; uninstall without ticking →
   data survives. That covers D13's review item 3 by installing and inspecting rather than by reading
   the script.
6. ~~**The release workflow** on tag, publishing the artifact and its SHA256.~~ **Done 2026-07-30**,
   and exercised through `workflow_dispatch` before any tag exists. Findings below.
7. **The first-run screen** — the terms warning, and only that. It was going to carry the metrics
   consent too, which is why D3b and D9a were paired here; with D9 reversed the screen is one thing,
   and it is **no longer blocked** on choosing an analytics service or writing a retention policy.
8. **The update check** — core validator first, then the adapter, then the UI. **P3 runs here**, once
   `shell.openExternal` exists to be measured.
9. ~~**Metrics** — the pure event builder in the core with its allowlist tests, then the POST
   adapter.~~ **Cancelled 2026-07-30 (D9 reversed).**
10. ~~**The bug report** — bundle, redaction, show-before-send.~~ **Cancelled 2026-07-30 (D9
    reversed).**
11. **The security review** (D13), then the docs: `architecture.md`, the four new ADRs, ADR-0007's
    `Superseded in part` line and ADR-0004's Correction — then delete this file.

**Reopened on 2026-08-08 by D4's reversal.** Steps 4, 5 and 6 were done against an installer that no
longer exists, so each has a remainder rather than being simply undone:

- ~~**4r — the zip.**~~ **Done 2026-08-08.** Target switched, `nsis` block and `installer.nsh` gone,
  `files` negations untouched. **P2 re-run against the zip and it passes**: 337 asar entries, zero
  fakes, zero tests, zero `spike/`, `dist` intact, identical CSP in the extracted `index.html`, both
  `addon.node` unpacked, and the app runs from the extracted folder rendering its four screens. Two
  findings, both caught by looking at the artifact rather than the config — see below.
- **5r — the in-app delete.** Keep the core validator, the adapter and their tests; they are unchanged
  and were never installer-specific. Remove the headless `--delete-user-data` branch from main, and
  add the panel action with confirmation, plus the "your data" entry (complement 3) that is now the
  only place a user can act. Red-first as usual, and the IPC channel is enumerated and validated like
  every other.
- ~~**6r — the workflow.**~~ **Done 2026-08-08** and exercised through `workflow_dispatch`. It named
  the exe in three places, not two. The CI zip was downloaded and checked: `sha256sum -c` accepts the
  published hash, and the archive carries `Hecaton.exe`, `LICENSE.txt` and `NOTICE.txt`. Least
  privilege, the tag/version check and the no-third-party-actions rule are unaffected.

**Two findings from packaging as a zip, 2026-08-08:**

1. **The first zip shipped no licence at all.** It carried `LICENSE.electron.txt` and
   `LICENSES.chromium.html` — Electron's and Chromium's obligation, not this project's — while the
   Apache-2.0 `LICENSE` and `NOTICE` were absent. Apache-2.0 §4 obliges whoever distributes the binary
   to include them, and the installer's licence page had been quietly satisfying that. A zip has no
   page. They now travel as `extraFiles`, named `.txt` because Windows has no handler for an
   extensionless `LICENSE`. **This is the kind of thing the installer was hiding:** dropping it
   removed a mechanism that was carrying an obligation nobody had written down as its job.
2. **The zip is 134 MB where the installer was 96 MB**, and there is no lever. `compression: maximum`
   was measured and rejected: 380 KB saved, 0.27%, for 3.5 minutes of build time, because it drives
   LZMA for 7z and NSIS targets and leaves the zip's deflate alone. A 7z target would close the gap
   and is rejected — Windows cannot extract `.7z` unaided, which defeats the point of choosing a zip.
   So a friend downloads 40% more than they would have. Accepted as the price of no installer.

**One rough edge, not fixed:** the zip extracts **flat** — `Hecaton.exe` sits at the archive root
rather than inside a `Hecaton/` folder. Windows Explorer's "Extract All" creates a folder named after
the zip, so the common path is fine, but a 7-Zip "extract here" would scatter about fifty files into
whatever directory the user was in. `electron-builder`'s zip target has no wrap-in-folder option.

**Then 7, 8 and the review.** The phase is shorter than it was a week ago on both counts: the app's
whole network surface is one user-initiated request, and its whole install story is "unzip it".

## Non-decisions — recorded so they are not re-raised

- The renderer CSP is not relaxed by anything in this phase (see the CSP note above).
- No game session ever runs inside Electron, packaged or not (ADR-0007 decision 5).
- No forced update, no minimum-version enforcement, no remote kill switch (D8).
- No accounts (D10), no monetization (D11).
- No app-level encryption of profile directories (D13).
- No sweeping of the OS temp directory for leftover clean-session profiles, and no deletion of user
  data by the NSIS script itself — the uninstaller launches the app, which deletes (D4b).
- No `electron-updater`, and no automatic update check unless the owner turns on the opt-in variant
  named in D8.
- **No installer.** The release is a zip; extracting it is the install and deleting the folder is the
  uninstall (D4, reversed 2026-08-08). No Start-menu entry, no uninstall registry key, no elevation.
  Deleting user data is an action **inside the app**, because a zip has no uninstaller to host it.
- **No metrics, no telemetry, no analytics endpoint, no installation id, and no in-app bug-report
  tool** (D9, reversed 2026-07-30). The app's local logs stay and never leave the machine. The design
  that was dropped is kept in D9 so it does not have to be re-derived if the subject ever returns —
  but reopening it is a decision, not a resumption.
