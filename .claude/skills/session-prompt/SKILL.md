---
name: session-prompt
description: Write the prompt that starts the next session - compact, no repetition, and carrying only what the documents it points at cannot say themselves. Use whenever the user asks for a prompt to open a new session, a handoff, or "um prompt para a próxima sessão".
---

# The prompt that opens the next session

One principle, and everything below follows from it:

> **The prompt carries only what the documents cannot.**

The same rule this repository applies to comments — a comment earns its place only when it
says something the code cannot. A prompt that summarises the plan it tells you to read has
spent the reader's attention twice and created a second copy that will drift.

## The shape

Six moves, in this order, each usually one line. Drop any that has nothing to say; never
pad one to look complete.

```
<what to build, one sentence, named the way the project names it>

Ler: <path> (<the part that matters>) e <path>

<state: what is done, what is not, what is pushed>

<corrections to those documents, where they are known to be wrong>

<decisions to bring back to me, and when>

<scope, and where to stop>
```

## The exemplar

This is a real one, and it worked — every later turn of that session traced back to a line
in it:

```
Implementar a Frente B da Fase 4 do Hecaton: uma instância por máquina.

Ler: C:\Users\Shofn\.claude\plans\sleepy-prancing-reef.md (Frente B) e
spike/p6-machine-lock/findings.md

Frente A concluída e empurrada; nada da Frente B começou.

Correção ao plano: a ADR é a 0018, não a 0017 — essa já foi usada.

Decidir comigo antes do adapter: a ressalva de conta única da P6.

Escopo: só a Frente B, ADR e docs no mesmo commit. Parar antes da P8.
```

Six lines. It names no rule from CLAUDE.md, explains no architecture, and justifies
nothing — and the session still ran under strict TDD, stopped where it was told, and asked
before the adapter.

## What to leave out, and why

- **Anything in CLAUDE.md, `docs/architecture.md` or an ADR.** It is read anyway. Restating
  it invites the next session to trust the paraphrase over the source.
- **Any summary of a document the prompt tells you to read.** If it is worth knowing, the
  path is enough. If the path is not enough, the document is the thing to fix.
- **Motivation and rationale.** Why the work matters belongs in the plan or the ADR.
- **Instructions the harness already enforces** — hooks, the pre-commit check, the ban on
  blind `git add`.
- **Politeness, framing, and "please".** It is a work order, not a message.

## What must never be left out

Each of these costs the next session real time when missing, and none of them is in any
document:

- **Where to read, by exact path**, narrowed to the part that matters. Verify the path
  exists before writing it.
- **The true state.** What landed, what is committed, what is pushed, what has not been
  started. Read it from `git log`/`git status` rather than from memory of the session.
- **Corrections to the documents.** Where a plan or an ADR is known to be wrong, say so in
  the prompt — the next session will otherwise follow it. This is the highest-value line in
  the whole prompt and the easiest to forget.
- **Decisions to bring back**, and the moment to bring them ("before the adapter", "before
  packaging"). Without this the session either decides alone or blocks at the wrong time.
- **Scope and the stopping point.** Say what is out of scope by name, not "just this".

## Language

Portuguese. The owner reads it before pasting it, and every prompt and plan in this project
is written that way — the same reason `docs/design/design.md` and the plans are. The code,
commits and documents the session then produces stay English, as CLAUDE.md requires.

## Output

Emit the prompt as one fenced block and nothing else — no preamble, no explanation of the
choices, no offer to adjust it. If something genuinely could not be determined (a path that
does not exist, a state that git does not settle), ask that single question first, then emit
the block.
