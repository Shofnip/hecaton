---
name: commit-push
description: Commit changes in this project with the full pre-commit discipline - review what is being staged, run the checks, stage explicit paths - and push to origin at the end. Use whenever committing here, including when the user just says "commit this".
---

# Committing and pushing in this project

Follow this in order. It exists because each step failed at least once here.

The name says push because the last step publishes. A skill that pushes without saying so
in its name is the same kind of claim this repository keeps having to correct: accurate
about most of what it does, silent about the part that is hard to undo.

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

An untracked **directory** is shown collapsed, as one line. Expand it before believing it:

```
git status --short --untracked-files=all <the directory>
```

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
`tests/repo-consistency.test.ts` keeps that equivalence honest for the steps `ci.yml`
writes as `- run: npm ...`, bar `npm ci` — it cannot see a named step (`- name:` with
`run:` on the next line) or one not invoked through `npm`, so a step of either shape has
to be added to `check` by hand.

Do not commit around a failure. If a test is red, the commit is not ready; that is what
strict TDD means here. The husky `pre-commit` hook runs `npm run check` again, so a
failure blocks the commit anyway — running it first just means finding out sooner.

**Integration tests are not part of this.** They launch the browser the app ships (fetch it
first with `node scripts/fetch-chromium.mjs`) and move real windows,
take minutes, and are run deliberately: `npm run test:integration`. Run them when you
touched `browser-engine`, `window-manager`, `storage` or `machine-lock`, and say in the commit
message that you did.

## 3. Stage explicit paths

```
git add packages/core/src/grid.ts packages/core/src/grid.test.ts
```

Naming each file is the point. It is what makes step 1 real rather than a habit.

If the list is long enough to be tedious, that is a signal the commit is doing too many
things — split it. Two commits that are each green on their own beat one that needs a
paragraph to explain its own shape.

## 4. Write a message that explains why

Conventional Commits for the subject. The subject describes the change itself, so it reads
the same to someone who has never seen the plan: name what the commit does, not which phase
or step of the project it belongs to. `feat(core): retire grid tiling from the orchestrator`,
never `feat(core): Step 3c — retire grid tiling`. Milestone numbers are scaffolding for the
working session; they mean nothing in the permanent log and date badly.

In the body, explain **why**, not what — the diff already says what. If the change encodes a
decision or a trade-off, say which and why the alternative was rejected. If it fixes something
subtle, describe the failure it prevents.

The same restraint governs the code being committed: a comment earns its place only when it
says something the code cannot. Explain a decision, a non-obvious constraint, or a failure the
shape guards against — never narrate what the next line plainly does. A comment that restates
the code is noise that later has to be kept true; leave it out.

Pass the message with a heredoc, which is shell syntax:

```
git commit -F - <<'EOF'
feat(core): ...
EOF
```

Not PowerShell's `@'...'@`. In the Bash tool that is not a heredoc, and the `@` ends up
literally in the subject line — which then needs an amend to fix.

If the decision belongs in the permanent record rather than the commit log, it belongs in
`docs/adr/` — see `docs/adr/README.md` for when to write one.

## 5. Push

```
git push
```

CI runs on every push to `main`, so this is what turns a local green into a verified one.

If the push is **rejected** because the remote moved, do not force. Rebase, re-run
`npm run check` — a clean rebase can still produce a broken tree — and push again:

```
git pull --rebase && npm run check && git push
```

`--force` and `--force-with-lease` are not part of this workflow. Rewriting published
history on a branch CI and other machines track is a bigger problem than whatever it was
meant to tidy.

## 6. Confirm it landed

```
git status --short
git status -sb | head -1
gh run list --limit 1
```

A clean tree, no `ahead` on the branch line, and a CI run that is queued or green. **A
push is not done until CI is green** — if the run fails, fixing it is the current task,
not a later one.

If `gh` fails with "Resource not accessible by personal access token", the `GITHUB_TOKEN`
environment variable holds a PAT without the needed scope; clear it for that command and
the keyring credential is used instead:

```
GITHUB_TOKEN= GH_TOKEN= gh run list --limit 1
```

## Things that are never right here

- Committing with a failing test, or with `--no-verify`. If a hook is in the way, the
  answer is to fix what it caught.
- Staging a file you have not read. This is the one that actually happened.
- Force-pushing to `main`.
- Committing a security-relevant change without the owner's decision — session data,
  profile deletion, the https rule, Chrome flags, IPC surface. See `CLAUDE.md`.
- Fixing a documentation claim by changing the document when the code is what is wrong.
  Check which one is telling the truth before editing either.
