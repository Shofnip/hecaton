# ADR-0021 — Several windows, one account each

**Status:** Accepted · **Date:** 2026-09-18

Supersedes [ADR-0018](0018-one-instance-per-machine.md) in part: its first layer is
gone and the other two stand. Reverses, for the second time and knowingly,
[ADR-0012](0012-hecaton-and-the-data-directory.md)'s "no migration code, ever".

## Context

ADR-0018 allowed **one Hecaton per machine**, in three cumulative layers: a live
`Global\` mutex, a refusal to run inside a recognised hypervisor, and a hardware seal
in `%ProgramData%`. The reason recorded there was not data integrity — it was a limit
on how much one person could run, chosen by the owner with the trade written down.

The owner reversed that on 2026-09-18 and asked for the opposite: as many windows as
they like, and a way to keep several sets of game accounts apart. What must not
happen is two windows over the same browser profiles — two Chromes on one
`--user-data-dir` damage each other's session, which is a thing the old lock
prevented by accident rather than by intent.

## Decision

**An account is the unit of isolation, and the lock moved onto it.**

An account is a named workspace with its own `config.json`, its own profile
directory, its own Electron cache, and at most four screens. On disk:

```
%APPDATA%/hecaton/
  accounts/<id>/config.json     the settings, and the account's name
  accounts/<id>/profiles/       slot-N and the slot-N.old-… archives
  accounts/<id>/shell/          Electron's own cache for that window
  logs/                         shared; one file a day, whichever window writes
```

**The mutex kept its mechanism and changed its job**: `Global\Hecaton.Account.<id>`
instead of `Global\Hecaton.Instance`. It is now a data-integrity guarantee rather
than a usage limit — one window per account, across Windows logon sessions, with
everything probes P6 and P6b measured about why a mutex still standing.

**A launch takes the first account nobody is running, and creates one when they are
all busy.** So a second window opens on account 2; a third on account 3; and the same
window lands on the same account every time, because the ids are walked in order.

**There is no shared index file.** Accounts are discovered by listing directories and
each name lives in its own account's config, so no file is written by two windows.
An `accounts.json` was the obvious design and was rejected for exactly that: a
read-modify-write race where losing a write costs a user their account list.

**Electron's own single-instance lock is gone**, and it had to be: it fires before
there is any way to know which account a window will get.

**The panel gained an account section** in Configurações (design §10) — a dropdown of
the accounts, the current one's name, and "create another". Switching stops every
screen, releases the old lock and adopts the new one, in that order.

## Consequences

- **Logged-in sessions are moved on disk, once.** `%APPDATA%/hecaton/config.json` and
  `profiles/` become `accounts/1/…`. ADR-0012 said there would be no migration code
  ever, and that held while nothing had shipped; two releases later the owner chose
  the symmetric layout over an asymmetric one that would have needed no move. The
  move is renames into a staging directory followed by **one rename** that makes the
  new layout real, nothing is ever copied or deleted, and a staging directory found
  on the next launch is adopted — after the first rename it holds the only copy of
  the profiles.
- **This is the one place in the app that does not fail open.** Everywhere else a
  broken instrument lets the launch through: an unreadable machine identity, a
  `%ProgramData%` that will not answer, an ACL that cannot be set. Here a lock that
  cannot answer stops the launch, because the alternative is two windows writing one
  browser profile. The lock adapter reports `unavailable` instead of the `free` it
  used to answer on a broken worker, and the refusal screen names it.
- **"Apagar todos os meus dados" became two actions.** One deletes this account, one
  deletes every account — including accounts another window is running right now,
  which the confirmation says in those words. Before accounts there was one meaning;
  keeping one button would have made the wider meaning the silent default.
- **The usage limit the owner asked for in ADR-0018 is gone**, and with it the reason
  that ADR gave for existing. What survives of it is the hypervisor refusal and the
  hardware seal, unchanged, plus the sentence in
  [ADR-0015](0015-what-the-app-deliberately-does-not-collect.md) that a machine-derived
  identifier is stored at all.
- **Two windows means two of everything that was one.** Two bundled browsers running,
  two WASAPI workers, two window workers, two liveness timers. Nothing in the
  architecture assumed there was only one — the adapters are per-process already —
  but the machine's memory and CPU now scale with windows as well as screens.
- **The account name is UI text**, so `Conta 1` in Portuguese, following the same rule
  as a game's `name` in the registry.

## Alternatives rejected

**Keeping one Hecaton and adding accounts inside it.** Several accounts in one window,
switched from the panel. It gives the same isolation with none of the lock work — and
it does not answer what the owner asked for, which is two windows side by side.

**Profiles namespaced inside one directory** (`profiles/a2-slot-1`), so nothing moves.
It was the option that needed no migration code and the owner turned it down for the
asymmetry: account 1's profiles would have lived somewhere every other account's did
not, forever, and every path function would have carried the special case.

**An `accounts.json` index.** See above: one file, several writers, and the failure
mode is silent.

**Probing the other accounts' locks to grey them out in the dropdown.** Finding out
whether an account is in use means taking its lock; a probe that holds one for even a
moment can push a window that is starting up onto a different account. The dropdown
shows every account and a switch to a busy one fails with a message instead.
