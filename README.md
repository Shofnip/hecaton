# helloweb

> Provisional name.

Desktop orchestrator for playing several web games at once. It launches up to N real browser
windows (default 4), each with its own isolated session, arranges them in a grid, and lets you
focus any one of them — a control-room experience: see every screen at once, interact with any
of them without selecting first.

The app does not embed games. It launches and arranges real browser windows, which sidesteps
`X-Frame-Options`/CSP entirely and gives session isolation by construction.

**Play is manual.** Automation is a later phase.

## Status

**v1 is functionally complete.** The Electron panel (`apps/shell`) launches, arranges and
focuses the slots, adds/removes/edits them, restores the grid, and surfaces state and errors.

It is built on the pure core (`packages/core` — grid layout, slot state machine, registry
validation, config parsing, orchestrator, the IPC contract) and four adapters: Chrome via
spawn (`browser-engine`), window control (`window-manager`), disk storage plus rotated logs
(`storage`), and profile archiving (`browser-engine`). The shipped game registry lives in
`packages/games`. Structured logging and per-slot profile archiving are wired in.

What remains before a public release is packaging and distribution (phase 3) — see
[docs/architecture.md](docs/architecture.md).

## Requirements

- Windows
- Node 20+
- Google Chrome installed

## Development

```
npm install
npm run check             # typecheck + lint + format:check + fast tests, what CI runs
npm test                  # fast suite, no I/O - stays under a second
npm run test:watch
npm run test:integration  # real Chrome, real windows, real disk. Windows only.
```

The fast suite must stay fast, so the red-green loop is worth running. Anything that
launches a process, moves a window or touches disk goes in `*.integration.test.ts`.

Everything the app persists lives under `%APPDATA%/helloweb`, including in development:
config, logs, and the per-slot browser profiles under `profiles/`. Nothing the app produces
is ever written into the repository — profiles hold session cookies of logged-in accounts,
and keeping them out of the working tree removes that risk at the source.

A slot configured for a clean session is the one exception: its profile is a throwaway
directory under the OS temp folder, removed when the slot stops. If the app is killed before
that, the directory survives until Windows reclaims it — worth knowing if you are cleaning a
shared machine.

### Native dependencies

npm 11+ blocks dependency install scripts by default. `node-window-manager` and its
transitive dependency `extract-file-icon` compile native code and need explicit entries in
the root `package.json` under `allowScripts` — approving the parent does **not** cover the
transitive one. Without them the install succeeds and the module fails at runtime.

Building them requires Visual Studio Build Tools and Python.

## Documentation

- `docs/architecture.md` — how the system works now; edited freely, always current
- `docs/adr/` — one immutable record per decision, including what was rejected and why
- `docs/troubleshooting.md` — problems already hit, by the symptom you see first
- `CLAUDE.md` — rules that are not derivable from the code

## A note on game terms of service

This app does not automate play and does not inject anything into game pages — it launches
ordinary Chrome windows and arranges them. Even so, every slot runs inside your logged-in
session, so check each game's terms before relying on it. Should injection or automation
return in a later phase, the risk of an account ban is the user's.
