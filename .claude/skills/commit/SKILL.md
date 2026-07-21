---
name: commit
description: Commit changes in this project with the full pre-commit discipline - review what is being staged, run the checks, stage explicit paths. Use whenever committing here, including when the user just says "commit this".
---

# Committing in this project

Follow this in order. It exists because each step failed at least once here.

## 1. Look at what changed, before staging anything

```
git status --short
```

**Read every path in that list.** Not skim — read. If a file is there that you did not
write or open in this session, open it now.

This is the step that failed: a `git add -A` once swept in files created by another
process, and they were pushed without anyone reading them. A `PreToolUse` hook now blocks
`git add -A`, `git add .`, `git add -u` and `git commit -a`, so the blind forms are not
available. The hook cannot tell "reviewed" from "swept up" — that part is yours.

For anything unfamiliar, also check whether it is still being written:

```
git status --short && ls -la <the file>
```

A file whose timestamp is seconds old may be half-written by someone else. Committing a
draft is worse than waiting.

## 2. Run the checks

```
npm run check
```

typecheck + lint + format:check + fast tests — the same four steps CI runs.
`tests/repo-consistency.test.ts` keeps that equivalence honest, so a green check really
does mean a green CI.

Do not commit around a failure. If a test is red, the commit is not ready; that is what
strict TDD means here. The husky `pre-commit` hook runs `npm run check` again, so a
failure blocks the commit anyway — running it first just means finding out sooner.

**Integration tests are not part of this.** They launch real Chrome and move real windows,
take minutes, and are run deliberately: `npm run test:integration`. Run them when you
touched `browser-engine`, `window-manager` or `storage`, and say in the commit message
that you did.

## 3. Stage explicit paths

```
git add packages/core/src/grid.ts packages/core/src/grid.test.ts
```

Naming each file is the point. It is what makes step 1 real rather than a habit.

If the list is long enough to be tedious, that is a signal the commit is doing too many
things — consider splitting it rather than reaching for a shortcut.

## 4. Write a message that explains why

Conventional Commits for the subject. In the body, explain **why**, not what — the diff
already says what. If the change encodes a decision or a trade-off, say which and why the
alternative was rejected. If it fixes something subtle, describe the failure it prevents.

If the decision belongs in the permanent record rather than the commit log, it belongs in
`docs/adr/` — see `docs/adr/README.md` for when to write one.

## 5. After committing

Confirm the working tree is clean, and check CI if you pushed:

```
git status --short
gh run list --limit 1
```

If `gh` fails with "Resource not accessible by personal access token", the `GITHUB_TOKEN`
environment variable holds a PAT without the needed scope; clear it for that command and
the keyring credential is used instead.

## Things that are never right here

- Committing with a failing test, or with `--no-verify`. If a hook is in the way, the
  answer is to fix what it caught.
- Staging a file you have not read. This is the one that actually happened.
- Committing a security-relevant change without the owner's decision — session data,
  profile deletion, the https rule, Chrome flags, IPC surface. See `CLAUDE.md`.
- Fixing a documentation claim by changing the document when the code is what is wrong.
  Check which one is telling the truth before editing either.
