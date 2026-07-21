# ADR-0006 — Game definitions ship only in the repository

**Status:** Accepted · **Date:** 2026-07-21 (recorded retroactively)

## Context

Games are described by a definition — id, name, url, viewport — loaded from a registry. The
natural next step, and one users will ask for, is a folder where anyone can drop in their own
game and have it appear in the panel. Every extensible desktop tool eventually grows one.

The original design went further: definitions could carry `injectCss` and an `actions` array
whose entries were **functions** run against the game page. [ADR-0003](0003-spawn-over-cdp.md)
removed those fields for unrelated reasons, but the question survives the removal, because any
future HUD or automation feature brings it straight back.

## Decision

**Definitions live only in the repository**, at the same trust level as hardcoded values —
everything is versioned and reviewed. A user-supplied games folder is **rejected, not
deferred**.

The reasoning is about who bears the risk. This app is distributed to other people, and it
exists to hold logged-in game accounts. A dropped-in `.js` file that receives page access runs
inside **someone else's** authenticated session. "Users can extend it" would mean shipping a
mechanism for arbitrary code execution against third parties' accounts, wrapped in a feature
that reads as convenience.

The distributed nature is decisive. For a single-user tool this would be a defensible
trade — the author would be the only one exposed. Here the author would be exposing everyone
who installs it.

## Consequences

- Adding a game means a pull request. Slower for the user, and the intended trade.
- The **custom slot** covers the common case without the risk: an arbitrary `https:` URL plus
  generic options (viewport, profile, mute) [see Correction]. No injected CSS, no actions, nothing
  game-specific — data the core already understands, not code it must run.
- The registry contract can stay tiny, because it never has to be a plugin API.

## Alternatives rejected

**A user games folder loading `.js`** — the requested feature, and arbitrary code execution
against other people's sessions.

**Sandboxed user scripts** — a sandbox that still needs page access to be useful is a sandbox
around the wrong boundary. The value of the feature and the danger of the feature are the same
capability.

**Signed third-party definitions** — moves the problem to key management and to deciding whom
to trust, for a project with one game and one maintainer.

## If this is ever revisited

The only acceptable form is **declarative actions**: data such as `{ selector, op: 'click' }`,
interpreted by the core, never executed as code. The core stays in control of what any verb can
do, and a malicious definition can only ask for things the core already permits.

That is a different feature from "load a script", and should get its own ADR rather than being
treated as a relaxation of this one.

## Correction (2026-07-21)

"generic options (viewport, profile, mute)" overstates what a custom slot accepts.

`SlotOverrides` in `packages/core/src/config.ts` carries `persistProfile` and `mute` only.
`viewport` exists on `GameDefinition`, not as a per-slot override, and window size comes from
the grid (`computeGrid`), never from a viewport. This was already true when the ADR was
written — `config.ts` predates it — so the enumeration was wrong from the start rather than
having drifted.

The decision is unaffected: the point stands that a custom slot is **data the core
understands, not code it runs**. Only the list of options was inaccurate.

Worth flagging for phase 1.5: a panel built from that sentence would offer a per-slot viewport
field the core cannot accept, and adding one would be a change to the config contract rather
than a UI detail.

Found by the documentation auditor (`/audit-docs`). Body left unchanged per the convention in
[README](README.md); only the inline `[see Correction]` marker was added.
