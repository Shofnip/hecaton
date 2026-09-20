# ADR-0024 — What each version number means, from 0.3.0 on

**Status:** Accepted · **Date:** 2026-09-19

## Context

Three releases were cut — 0.1.0, 0.2.0, 0.3.0 — before anyone wrote down what the numbers meant.
The owner asked the question after the third, and the honest answer was that nothing defined it:

- **No tool derives the version.** No `semantic-release`, no `changesets`, no `release-please`. The
  commits carry Conventional Commits prefixes and nothing reads them: a `feat:` does not raise the
  minor, a `fix:` does not raise the patch. They are labels for people.
- **Only the shape is enforced.** `packages/core/src/update.ts` parses `^v?(\d+)\.(\d+)\.(\d+)$` and
  compares field by field as numbers, and the release workflow refuses a tag that disagrees with
  `apps/shell/package.json`. Both are about coherence; neither is about meaning.
- **`docs/releasing.md` step 4 said where to edit and never what to write.**

So the practice existed and only the precedent expressed it: 0.1.0 first release, 0.2.0 the app
bringing its own browser, 0.2.1 an off-screen login window fixed, 0.3.0 several windows with a
profile each. Minor for a capability, patch for a repair, major untouched.

Two things about this product decide the rest, and neither is a matter of taste:

**A release cannot be gone back to once it moves the user's data.** 0.3.0 migrated `config.json` and
`profiles/` into `accounts/1/`. Nothing breaks, and yet 0.2.0 — still sitting in the folder the user
extracted it into, since the artifact is a zip ([ADR-0020](0020-a-zip-the-user-extracts-not-an-installer.md))
— now looks in the old paths, finds nothing, and opens as a first run. The data is intact and the
old app cannot see it. That is the sharpest edge the product has, and no number was pointing at it.

**The version selects what the user reads.** The app shows the `## X.Y.Z` section of `CHANGELOG.md`
matching `app.getVersion()`, once, after an update. A version with no section interrupts somebody
and then says nothing.

## Decision

**Patch** for a release with nothing the user can name — fixes, wording, and the pins on their own:
a release whose whole content is a newer Electron or a newer bundled Chromium is a patch, because
what changed is the browser rather than the app.

**Minor** for anything the user can point at — a capability, a control, a game in the registry — and
**for anything that moves their data**, while the major is 0.

**Major stays 0**, and raising it to 1 buys exactly one promise: **from 1.0.0 on, a release that
moves, renames or reinterprets anything under `%APPDATA%/hecaton` is a major.** Not a claim about
quality, not about signing, not about the feature set — about the one kind of change a user cannot
undo by extracting the previous zip again.

Three rules with no judgement in them, so they can be checked rather than remembered:

1. **No suffixes**: `v0.4.0`, never `v0.4.0-rc1`. The app's parser rejects it, so every installation
   would quietly read "up to date"; and `/releases/latest` excludes prereleases anyway.
2. **Every released version has its changelog section**, written before the tag.
3. **A number that never becomes a tag does not keep its section** — fold it into the release that
   ships its content.

`tests/repo-consistency.test.ts` holds the root and shell manifests to the same number, holds that
number to the three-digit shape, and holds it to having a changelog section. Each was watched
failing before it was kept.

## Consequences

- **The leading 0 now has a job.** It is not "unfinished"; it is the licence to move the user's data
  under a minor, which is the only reason 0.3.0 could be a minor honestly. Spending it is the owner's
  decision and costs that licence.
- **A pins-only release is a patch, and pins-only releases are expected**: the bundled browser moves
  only when a release moves it ([ADR-0016](0016-ship-our-own-chromium.md)), so "nothing the user can
  name changed" will be the most common release this project makes.
- **The changelog rule is now a test, not an intention.** It fires on the bump rather than at the
  tag, which is the moment someone is already editing the file next to it.
- **0.2.1 stays where it is.** Its section describes a fix that shipped inside 0.3.0, and 0.3.0's
  notes do not mention it — the rule above exists so the next one is folded instead, and rewriting
  the published section now would make the file disagree with the `CHANGELOG.txt` already shipped
  beside the 0.3.0 zip.
- **Nothing automated changed.** The number is still chosen by a person at step 4; what changed is
  that the choice has an answer to check itself against.

## Alternatives rejected

**Strict SemVer.** Its own specification says 0.y.z means anything may change at any time, which
would leave the sharpest edge in the product — a data migration — describable by any number at all.
The rule here is narrower than SemVer on purpose: it names the one breaking change this app can
actually make to somebody.

**Deriving the version from Conventional Commits** (`semantic-release` and friends). It would read
prefixes this project already writes, and that is the problem: the prefix records what a commit did
to the code, not what the release does to the user. A `fix:` that changes where profiles live is a
patch to the tool and a one-way door to the person. It would also put a release-cutting dependency
into a repository whose pins are a reviewed decision ([ADR-0007](0007-electron-security-posture.md)
decision 1).

**Calendar versioning** (`2026.09.0`). Honest about cadence and silent about consequence: the number
would say when the release happened and nothing about whether the previous one can still be opened.

**Going to 1.0.0 with this release.** Tempting — the app is in use by real people with real logged-in
accounts. Refused because the promise 1.0.0 is being defined to make is one this release breaks: it
moves the data directory. A first major that violates its own rule on the day it is declared would
teach everybody to ignore the rule.
