# ADR-0013 — The distribution posture: a portable, unsigned zip under Apache-2.0

**Status:** Superseded in part by [ADR-0019](0019-an-assisted-installer-for-a-792-mb-app.md) ·
**Date:** 2026-07-29, with the packaging reversal of 2026-08-08

Only the **format** is superseded: the artifact is an assisted installer again, and the alternative
this ADR rejected under _Alternatives rejected_ is the one that was taken. Everything else here —
Apache-2.0, the public repository, nothing signed, GitHub Releases, the exact pins, the terms
warning, and where the data lives — stands.

## Context

`architecture.md` had said "the app will be distributed to other people" and the phase was planned
against the widest reading of that. The owner's actual intent is narrower, and almost every decision
below is sized by it:

- **The audience is a handful of friends.** Not a public launch.
- **The public repository is audit optionality, not a distribution channel.**
- **The owner does not want personal exposure** in publishing the tool — meaning a **legal identity**,
  the subject name on a certificate shown in a UAC dialog to every user. It does not extend to the
  commit-author e-mail, weighed separately below.
- **Attribution matters**: copying without credit is the thing to prevent.

A second direction, taken the same day, removes the constraint that had been holding several of
these open: **distribution is free, permanently — there is no monetization, now or later.**
Entitlement, licensing and billing were the only things that genuinely required identity or a
server, and they are gone.

## Decision

**Apache-2.0, in a public repository.** With monetization off the table, the one real argument
against a permissive licence — preserving the option to charge — is gone, and what remains favours
it. An application that holds logged-in game sessions and reaches the network
([ADR-0014](0014-the-apps-first-network-request.md)) is far easier to trust when it can be read.
Apache-2.0 also serves the attribution goal exactly: §4 obliges a redistributor to keep the
copyright notices and to state their changes, and §6 grants no right to the name **Hecaton**. The
copyright holder is the handle **`Shofnip`**, matching the GitHub account, so `NOTICE` exposes
nothing the account does not already show.

**One exposure was accepted knowingly at the door.** A pass over the 93 commits before publishing
found no token, key, personal path or sensitive file — but every commit carries `shofnip@gmail.com`
in the author field, which a public repository serves through the API, where it is harvested.
Rewriting the author to a `noreply` address was offered, was cheap while the repository was private
and impossible afterwards, and **the owner chose to publish as-is.** A future reader must not
mistake this for the identity concern that governs signing: that one is a legal name shown to every
user, this one is an address in commit metadata, and they were weighed separately.

**The terms-of-service warning appears in two places: first run, and the README.** The product's
central capability — several accounts of one game side by side — is what most game terms call
multi-accounting, and the ban lands on the end user, never on the author. The reasoning is honesty
rather than liability: free distribution weakens the legal argument and not the moral one. The rules
of the target game were read on 2026-07-30 and the warning is specific rather than generic, with the
reading date attached.

**A portable zip. There is no installer.** The user downloads it, extracts it wherever they like,
and runs `Hecaton.exe`. Updating is replacing the folder; deleting the folder is the uninstall.
There is no install step, no elevation, no Start-menu entry, no uninstall registry key. What makes
this viable at all is [ADR-0004](0004-appdata-over-repo-dir.md), decided long before anyone
considered a zip: nothing the app persists lives beside its binary, so the extracted folder is
disposable. An app that wrote next to its own binary could not ship this way without redesigning
where its data lives.

**Nothing is signed.** A code-signing certificate is issued to a **verified identity, and that
identity is visible** — in the file's properties and in any elevation dialog — to everyone. That is
precisely what the owner's stated intent rules out. For an audience of friends, trust comes from the
author handing over the file. Accepted costs, to be stated to those friends rather than discovered
by them: **SmartScreen** warns on first run ("Windows protected your PC" → _More info_ → _Run
anyway_), and nothing distinguishes an authentic build from a tampered one except the **SHA256**
published beside each release.

**GitHub Releases hosts it**, on that public repository. Free, HTTPS, no server of the owner's to
run, patch or have compromised, and no domain to register — which also keeps a WHOIS record, another
identity exposure, off the table.

**Releases are built by GitHub Actions on a tag, and the two runtime dependencies are pinned
exactly.** A clean checkout and `npm ci` from the lockfile, so the artifact does not carry the state
of one machine — and, the part that matters for an unsigned artifact, the build produces a **public
log of what went into the binary**. It is not a signature; it is the closest substitute this project
can have. The release workflow uses no third-party actions and its token is `contents: write` on one
job, because a workflow with publish rights is itself a target.

Two findings forced the pins. `node-window-manager` sat at `^2.2.4` while ADR-0007 decision 1 pinned
Electron — and it is a **native** module that compiles at install time and runs in the main process
with full access to the profiles, so the reasoning that justified pinning Electron applies to it at
least as strongly. It had gone unnoticed because that ADR's wording was about the renderer.
`electron-builder` is the largest new surface of the phase and hides as a devDependency: it runs
with full privilege on the build machine and **assembles the binary other people execute**, where a
compromise would be invisible downstream precisely because nothing is signed.

## Consequences

- **The uninstaller was the moment to ask about user data, and that moment no longer exists.**
  Deleting the folder leaves `%APPDATA%/hecaton` — every logged-in profile, plus config and logs —
  with nothing prompting about it. So **"delete all my data" is an action inside the app**, in the
  panel, behind an explicit confirmation. See the Correction on
  [ADR-0005](0005-never-delete-a-persistent-profile.md); the headless `--delete-user-data` flag that
  existed only so NSIS could call it was removed, because without the installer it was a bare argv
  flag that wiped every profile with no confirmation anywhere. **The measurement that should stop
  anyone putting deletion back into an installer**, taken while the NSIS variant was still live: an
  update silently runs the **previous release's** uninstaller, and an unguarded branch inside it
  runs on that path. So the code deciding which directories die would be frozen in every uninstaller
  already distributed, and a wrong answer could never be repaired for anyone who had installed —
  which is the argument for the decision travelling with the app version that owns it.
- **The zip must carry `LICENSE` and `NOTICE` itself.** The first one shipped neither: it carried
  Electron's and Chromium's licences while Apache-2.0 §4's obligation went unmet, because the
  installer's licence page had been quietly satisfying it. They travel as `extraFiles`, named `.txt`
  because Windows has no handler for an extensionless `LICENSE`. **This is the kind of thing an
  installer hides** — dropping it removed a mechanism that was carrying an obligation nobody had
  written down as its job.
- **The download is 134 MB where the installer was 96 MB** [see Correction (2026-08-20)], and there is no lever: `compression:
maximum` saved 0.27% for 3.5 minutes of build time, because it drives LZMA for 7z and NSIS targets
  and leaves the zip's deflate alone. A `.7z` target would close the gap and is rejected — Windows
  cannot extract it unaided, which defeats the point of choosing a zip.
- The zip extracts **flat**: `Hecaton.exe` sits at the archive root. Explorer's "Extract All" makes a
  folder named after the zip, so the common path is fine, but a 7-Zip "extract here" scatters ~50
  files. `electron-builder`'s zip target has no wrap-in-folder option.
- **The build is not reproducible byte for byte** — CI and a local build of the same commit hash
  differently. So the provenance is "this hash came from this public log", not "you can rebuild and
  compare". Weaker than it sounds, and it should be said plainly to whoever is asked to trust it.
- **Exact pins create a standing obligation**, now three deep (Electron, `node-window-manager`,
  `electron-builder`) [see Correction (2026-08-20)]: somebody must raise them deliberately when
  there is a fix.
- The licence choice is **one-way**. Closed→open is available at any time; open→closed is not,
  because what has been cloned stays cloned.
- **If distribution ever leaves the circle of friends, signing returns to the table** as a security
  decision — an unsigned binary from a public repository anyone can fork stops being a friction
  problem and becomes a security one at scale.

## Alternatives rejected

**The assisted NSIS installer — built, verified, and then dropped.** It was the shape D3b forced,
since a licence page has nowhere to live in a one-click installer, and it was per-user
(`%LOCALAPPDATA%/Programs/Hecaton`, no elevation) after per-machine was reversed within the session:
per-machine **and unsigned** is the worst pairing Windows offers, raising the yellow "Unknown
publisher" dialog on every install _and every update_ to protect a binary four people will install.
It is recorded here rather than deleted because "no installer" reads as an omission unless someone
says it was a choice — and because its reasoning is what explains where the delete-data action
lives. Three of the four objections that had originally rejected a zip were dissolved by later
decisions rather than argued away; the fourth (deleting the folder leaves the profiles behind) is
the one that survived, and it is answered by the in-app action.

**Signing, in three flavours:** Azure Trusted Signing (~US$10/month, the cheapest credible route,
but it exposes the identity and its eligibility for a Brazilian individual was never verified), a CA
OV/IV certificate (~US$200–400/year plus SmartScreen reputation that only accrues over time), and EV
(~US$400–700/year and typically a registered company — to distribute a free tool to friends).
Figures are orders of magnitude, not quotes; none was verified and none needs to be while this
stands.

**Proprietary or source-available licences.** Proprietary keeps maximum reversibility and makes the
user install an unauditable binary, putting the whole trust burden on a signature that does not
exist. Source-visible-without-a-licence grants nothing and forbids the redistribution a free tool
wants. Source-available non-commercial existed only to protect a revenue stream that will not exist.

**Self-hosting the release**, which would add infrastructure, an attack surface and a domain to
serve an audience of friends.

**npm `overrides` to close the build-time advisories.** `npm audit --omit=dev` is clean — the
shipped tree has zero — and the remainder are denial-of-service issues in build-machine tooling
(`brace-expansion` via `glob`/`@electron/asar`, `ejs` via `jake`) fed only by patterns the build
itself supplies. Forcing patched transitives would close them while creating an untested combination
inside `electron-builder`, and a packaging step that breaks subtly is worse than the denial of
service it prevents. `npm audit fix --force` was rejected outright: it moves `electron-builder` off
the exact pin, which is the cheapest thing to type and the most expensive consequence.

## Correction (2026-08-20)

Two figures in Consequences were overtaken by [ADR-0016](0016-ship-our-own-chromium.md), which made
the app ship its own Chromium.

**The pins are four, not three.** The fourth is the bundled browser's revision, pinned in
`scripts/fetch-chromium.mjs` — and it is the heaviest of them, because nothing else will ever
update the browser that holds every logged-in game session, and the snapshot it names is trunk with
no stable-branch security backports. `docs/releasing.md` and `docs/architecture.md` both say four.
Anyone auditing "what must somebody bump?" from the list above counts three and misses the one that
matters most.

**The artifact is 332 MB zipped over 792 MB unpacked**, not 134 MB, measured 2026-08-20 and
recorded in `apps/shell/electron-builder.yml`. The compression reasoning in that bullet is
unaffected and still holds — most of the added bulk is already-compressed binaries, so there is
even less for LZMA to win. [see Correction (2026-08-21)]

**The decision itself is untouched:** a portable, unsigned zip under Apache-2.0, published on
GitHub Releases with its SHA256. Whether an artifact this size stays a zip is probe P8's question.
Both errors appeared when the code changed.

## Correction (2026-08-21)

The compression sentence in the Correction directly above — "most of the added bulk is
already-compressed binaries, so there is even less for LZMA to win" — was a prediction, and probe P8
measured it false. The identical 792 MB payload is **316.7 MiB as deflate and 199.9 MiB as LZMA**:
117 MiB less, 37%. An unoptimised Chromium snapshot compresses well, which is the same reason it is
four times the size of a branded Chrome install in the first place.

What that changes and what it does not: the 2026-08-08 figure it was extending (`compression:
maximum` saving 0.27% for 3.5 minutes) is still right, because that option cannot touch the zip
target's deflate at all. The error is only in the extrapolation to the bundled payload, and it was
wrong the day it was written rather than overtaken later. It mattered because it made the zip look
like it was giving up nothing, and [ADR-0019](0019-an-assisted-installer-for-a-792-mb-app.md) — the
decision that replaced it — turns on that number.
