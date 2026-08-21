# ADR-0018 — One instance per machine, bound to the hardware

**Status:** Accepted · **Date:** 2026-08-20

Supersedes, in part, two earlier decisions, one sentence each.
[ADR-0015](0015-what-the-app-deliberately-does-not-collect.md)'s "**No pseudonymous id exists**, so
the app stores no identifier of any kind" now has one exception, and
[ADR-0004](0004-appdata-over-repo-dir.md)'s "everything the app writes goes to `%APPDATA%`" gains a
**second** exception — its own 2026-07-21 Correction already narrowed that rule to state the app
_persists_, because clean-session profiles go to the OS temp directory. What 0015 gives up is the
identifier; what 0004 gives up is the location; both are the same file, described below. Everything else in either ADR stands — no metrics, no accounts, no
monetization, no network call beyond the update check, and nothing leaving the machine.

## Context

`v0.1.0` had a single-instance lock: `app.requestSingleInstanceLock()`, a second launch quits and
focuses the first panel. It is **per Windows logon session**. A second user account on the same
machine opens a second Hecaton today, and so does the same user in a second session.

That gap is wider than it looks, because code already depends on the lock being stronger than it
is. `json-file-storage.ts` dismisses the race between two processes renaming `config.json` on the
grounds that "the single-instance lock is what rules that out" — an invariant the code asserts and
the system did not provide.

**The owner's reason for closing it is a limit on use, not data safety.** Hecaton runs several
logged-in accounts of one game side by side; the point of one instance per machine is that one
person runs one farm. That is a control aimed at the user, which is worth saying plainly in the
place where a future session will read it, because it explains why the layers below are shaped the
way they are: they are aimed at someone who is not trying to defeat them.

Five probes fed this. P7 measured which hardware fields are real on a physical machine; P6
measured the mutex and the `ProgramData` ACLs; P6b crossed a real session boundary to close P6's
one open question; P6c ran the whole thing through the built app; P6d measured that a force-killed
parent leaves no stale mutex, and why that does not generalise to the other two workers.

## Decision

**Three cumulative layers, evaluated before the panel exists and before anything writes
`config.json`.** The rule is one pure function in `packages/core/src/instance-claim.ts`; the three
adapters below hold none of it.

**1 — A live `Global\Hecaton.Instance` mutex.** Held by a PowerShell child for the life of the
process. A standard user can create one without `SeCreateGlobalPrivilege` (that privilege governs
file-mapping objects, not mutexes), and the **default** security descriptor is exactly what is
wanted: it names SYSTEM, the creator's logon session and the creator's user SID, and nobody else.
So the three cases separate cleanly, with no custom DACL and no lock file. **Free and
same-account are told apart by the constructor's `createdNew` out-parameter**, not by an exception:
the constructor creates the object when the name is unused and opens it when it is not.
**`ACCESS_DENIED` is the one that arrives as an exception**, and it means another Windows account
holds it. (`WaitHandleCannotBeOpenedException` is handled too, but it is a defensive fallback — it
means the name is taken by a different kind of wait handle — not the ordinary free path. Dropping
the out-parameter to "simplify" the worker would make a second instance of the same account read as
free, which is the whole layer.)

And there is **no stale lock to clean up**, because a kernel object dies with its last handle. That
is measured, not reasoned: probe P6d force-killed the parent with `taskkill /F`, without `/T`, and
the worker was gone within four seconds with the name claimable again. It holds here because the
mutex worker does nothing but wait on stdin, so it always notices the pipe close — unlike the Win32
and WASAPI workers, which can be blocked inside a command and are the orphans
`docs/troubleshooting.md` records.

A mutex opened _successfully_ means the same Windows account already has one running, which is a
different message to show than another account's; the code says `held-by-this-user`, not
`held-by-this-session`, because the DACL names the user SID and a second logon session of the same
account therefore opens it fine.

**2 — A refusal to run inside a recognised hypervisor**, decided from
`Win32_ComputerSystem.Manufacturer` and `Model` against a list of markers.

**3 — A hardware seal at `C:\ProgramData\hecaton\machine.json`**, written on the first allowed
launch and never rewritten. A machine whose seal does not match is refused. It is the only thing
the app **persists** outside its own data directory — the throwaway clean-session profiles under
`%TEMP%` (ADR-0005) are the other place it writes, and they are deleted on stop.

**What identifies a machine:** `Win32_ComputerSystemProduct.UUID`, required, plus
`Win32_BaseBoard.SerialNumber` when it is not an OEM placeholder. **What is stored is a plain
sha256 of that, never the values.** `ProgramData` is world-readable, and a file spelling out
someone's SMBIOS identifiers to every account on their machine — and to anyone they send it to —
is a disclosure the seal does not need to make. The digest is unsalted on purpose: a salt would
have to ship inside a public-source binary or sit beside the file it protects.

**The machine id never reaches the log, in any form, not even truncated.** `instance.claim` records
the verdict and nothing else — words like `virtual-machine`, `foreign-machine`. Two neighbouring
events do carry a free-form error string, `instance.seal-failed` and `instance.claim-failed`, and
neither can contain the id either; all three are redacted at the logger boundary like every other
entry, and `docs/architecture.md` keeps the current inventory of emitters. This is the same rule
that keeps urls out of the log, applied for the same reason: this project's diagnostic path is
asking a user to send a log file to someone.

**One deliberate fail-open, and one deliberate fail-closed.** A machine identity that cannot be
read at all lets the app start: that is this app's own instrument failing, and charging the user
for it is wrong. A seal that disagrees refuses — that is positive evidence, not an absence — and so
does a seal that exists and **cannot be read for any reason at all**, since `claimInstance` catches
every error from the load and only a missing file comes back as "no seal". A seal that cannot be
read is a seal that cannot be verified; the recourse is the same one the screen already gives.

The two are ordered, and the order matters: **both refusal branches sit inside the identity check**,
so a machine that could not be identified is not refused over its seal either. The fail-open wins,
and that case has its own test.

**The recourse for a legitimate refusal is stated on the refusal screen.** Replacing a motherboard
changes the identity, and the honest answer is that the user must delete the seal **as an
administrator** — which they can do and a hostile standard user cannot, because P6 measured that
`BUILTIN\Users` gets `ReadAndExecute` on the file and no `Delete` on it or on its directory.

**A refusal shows a real window** — `blocked.html`, loaded from `file://`, naming which layer said
no in Portuguese. There was nowhere else to say it: the app's error banner needs a live panel and
an IPC push, and neither exists this early. The page carries **no script and no new IPC channel**;
the verdict travels as the URL fragment and CSS `:target` selects one of four sections. Measured
in P6c: exactly one section per verdict, and none at all for an unknown fragment, which leaves the
heading rather than a wrong reason.

**Electron's own `requestSingleInstanceLock` stays**, unchanged, for the same-session case — it is
the one that can focus the running panel instead of merely refusing.

## The ceiling, measured rather than assumed

Recorded once here so a later session does not read any of it as a bug to fix.

- **"One instance per physical machine" is not reachable by software.** Two VMs on one host share
  nothing a guest can read; two Windows installations dual-booting share no `ProgramData`. What
  this delivers is one instance per **Windows installation**, plus a hypervisor refusal, plus a
  seal that makes a moved installation detectable.
- **`HypervisorPresent` is not an input to the decision, and must not become one.** It returned
  **True on the owner's own physical desktop** — VBS/Memory Integrity and WSL2 put the host itself
  on Hyper-V. The naive check would have refused to start on the machine the app is developed on.
  That case is a named test, `does not call the probe machine virtual`.
- **The manufacturer/model list ages by itself** and a guest with customised SMBIOS strings walks
  past it. Accepted: the alternative was measured and is worse.
- **Whoever creates the name first wins — twice.** A hostile account can pre-create the mutex with
  a deny-all DACL, or pre-create a bogus `machine.json`, and the legitimate user then reads
  "occupied" or "foreign" with no way to tell it from the real thing. You cannot enumerate the
  owner of a named object without elevation, and there is no shared secret to authenticate with
  because the source is public. Both are named failure modes with clear text on screen, not
  something to outwit.
- **[ADR-0015](0015-what-the-app-deliberately-does-not-collect.md) already wrote the last word:**
  any gate here can be removed by recompiling the Apache-2.0 source. This is worth something
  against someone who would rather not, and nothing against someone who would.

## Consequences

- **`json-file-storage.ts`'s assumption becomes true.** Its comment about two processes racing over
  `config.json` now names a lock that actually spans the machine. P6c confirmed the ordering end to
  end: a refused launch wrote no `config.json` at all.
- **ADR-0015's "no identifier of any kind" is now false as written**, and this is the whole of the
  exception: one sha256 of the product UUID — plus the board serial when that is not an OEM
  placeholder — in one file, on the user's own disk. Nothing
  derived from it is sent anywhere, and there is still no network surface beyond the update check,
  so **"there is no telemetry" in `README.md` stays true**.
- **The app persists something outside its own data directory for the first time.** An audit of
  "what does this app touch" now has a third answer — `%APPDATA%/hecaton`, the temp directory for clean-session
  profiles (ADR-0005), and `C:\ProgramData\hecaton`. `data:deleteAll` does **not** remove the seal:
  it deletes the user's data, and the seal is the machine's.
- **A legitimate user can be refused**, by a motherboard swap or by physical hardware whose vendor
  strings look like a hypervisor's. Neither is silent, but only the first has a recourse: delete
  the seal as an administrator. **The hypervisor refusal is a dead end by design** — an override
  would be a flag that removes the layer, so the screen names the cause and offers nothing.
- **A new failure mode at start-up runs before the panel**, so anything that throws there is a
  window that never opens. That is why the identity adapter never throws, the lock reports free
  when its worker fails to run, and the call site treats an unresolvable seal path as `allow`. The
  cost is that all three layers can be absent without anyone noticing: of those three paths, only
  the last writes a log line.
- **The two-account case is still an inference** [see Correction], though a much narrower one than it was: P6b
  observed `ACCESS_DENIED` across a real session boundary from a different security context, and
  the adapter's integration test exercises the classification against a real kernel denial on
  every run. A run from a second interactive account remains a pre-release check.

## What was rejected

**A custom DACL on the mutex.** Measured, and worse: granting `Everyone: Synchronize` still fails,
because .NET's `OpenExisting` asks for `Modify | Synchronize`. Making it succeed means
`Everyone: Modify`, which lets any account interfere with the lock object itself — to buy nothing,
since `ACCESS_DENIED` already answers the question.

**A lock file instead of a mutex.** It survives the process, and this app is one that gets killed
from Task Manager when a browser hangs. Every lock-file design then needs a rule for ignoring a
stale lock, and that rule is a hole in the lock.

**Making the seal evidence-only** — log the mismatch, start anyway. It removes the false positive
on a hardware change, and it also removes the third layer: with no telemetry (ADR-0015), a log
line about tampering exists only on the machine of the person who tampered.

**Storing the two hardware fields instead of a digest**, so that a single changed part could be
tolerated. Both fields come from the same SMBIOS tables, so anyone editing one edits the other; it
would buy tolerance against honest hardware changes at the price of putting raw identifiers in a
world-readable file.

**Anything with an account, a licence key or a server.** ADR-0015 examined that in full and closed
it. Nothing here reopens it: the whole mechanism is local, offline, and readable by the user whose
machine it runs on.

## Correction (2026-08-21)

The last Consequence closes a forward-looking obligation — "a run from a second interactive
account remains a pre-release check" — and that obligation has since been discharged, so the
sentence would otherwise send a future session to redo it.

It was accurate when written. On **2026-08-21** probe P6e ran it: a throwaway **standard** Windows
account (not an administrator, so its token carries no `Administrators` SID to change the access
check), in its own interactive session, against this app holding `Global\Hecaton.Instance` in the
owner's session. Both layers reported `held-by-another-user` — the `MutexInstanceLock` adapter and
the whole app. That also produced the first `held-by-another-user` the app has ever emitted: P6c
could only reach `held-by-this-user`, because it ran two instances under one account.

So the mutex layer now rests on nothing inferred. `docs/architecture.md` carries the present-tense
record; this note exists only so the body's standing instruction is not acted on twice.
