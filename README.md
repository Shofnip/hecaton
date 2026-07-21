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

**No usable app yet** — there is no UI, so nothing launches a game for you today.

Done: the feasibility spike, the project foundation, the pure core (grid layout, slot state
machine, registry validation, config merge, orchestrator) and the three adapters (Chrome via
spawn, window control, disk storage). Next and last step of v1 is the Electron panel.

## Requirements

- Windows
- Node 20+
- Google Chrome installed

## Development

```
npm install
npm run check             # typecheck + lint + fast tests
npm test                  # fast suite, no I/O - stays under a second
npm run test:watch
npm run test:integration  # real Chrome, real windows, real disk. Windows only.
```

The fast suite must stay fast, so the red-green loop is worth running. Anything that
launches a process, moves a window or touches disk goes in `*.integration.test.ts`.

Everything the app writes lives under `%APPDATA%/helloweb`, including in development:
config, logs, and the per-slot browser profiles under `profiles/`. Nothing the app produces
is ever written into the repository — profiles hold session cookies of logged-in accounts,
and keeping them out of the working tree removes that risk at the source.

### Native dependencies

npm 11+ blocks dependency install scripts by default. `node-window-manager` and its
transitive dependency `extract-file-icon` compile native code and need explicit entries in
the root `package.json` under `allowScripts` — approving the parent does **not** cover the
transitive one. Without them the install succeeds and the module fails at runtime.

Building them requires Visual Studio Build Tools and Python.

## Documentation

- `docs/architecture.md` — architecture decisions and their rationale
- `CLAUDE.md` — rules that are not derivable from the code

## A note on game terms of service

This app does not automate play and does not inject anything into game pages — it launches
ordinary Chrome windows and arranges them. Even so, every slot runs inside your logged-in
session, so check each game's terms before relying on it. Should injection or automation
return in a later phase, the risk of an account ban is the user's.
