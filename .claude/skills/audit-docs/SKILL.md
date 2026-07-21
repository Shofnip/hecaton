---
name: audit-docs
description: Audit this project's documentation against the actual code and report where they disagree. Use when the user asks to check or audit the docs, before trusting a document to make a decision, or after a change that alters behaviour some document describes.
---

# Audit the documentation against the code

Invoke the `doc-auditor` subagent with the Agent tool. Let it do the work — do not audit the
documents yourself in this conversation. It runs with its own context and returns only the
report, which is the point: the audit reads a lot and you should receive conclusions, not the
contents of every file it opened.

Run it synchronously (`run_in_background: false`) when the user is waiting for the answer.

## Prompt to send

Pass any scope the user gave (a specific file, a recent change) and otherwise:

> Audit this project's documentation against the current code. Report every place where a
> document states something the code contradicts, with evidence from both sides. Read-only:
> report and recommend, do not edit anything.

If the user named a particular document or a recent change, say so — a narrow audit is faster
and just as useful.

## Relaying the result

The subagent's report is not shown to the user, so relay it. Keep the findings intact:
severity, both quotes with `file:line`, and the recommendation. Do not soften a finding or drop
one for brevity — a finding the user does not see is a finding that does not exist.

Then say what you would do about it and stop. **Do not apply the fixes without being asked.**
The audit is read-only by design, and the user decides what to change.

If any finding touches a security-relevant claim — session data, profile deletion, the https
rule, Chrome flags, IPC surface — present the fix as a decision with trade-offs rather than a
correction to make, following the project's rule in `CLAUDE.md`.

If the report is clean, say so plainly and mention what was verified. That is a useful result.
