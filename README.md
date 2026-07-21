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

Phase 0 (feasibility spike) done. Foundation in progress. No usable app yet.

## Requirements

- Windows
- Node 20+
- Google Chrome installed

## Development

```
npm install
npm run check      # typecheck + lint + tests
npm test           # unit tests only
npm run test:watch
```

Config and logs are written to `%APPDATA%/helloweb`, including in development.
Browser profiles live in `data/`, which is git-ignored — it holds session cookies.

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

Anything this app injects or automates runs inside your logged-in session. Verify each
game's terms before relying on it. The risk of an account ban is the user's.
