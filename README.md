# helloweb

> Provisional name.

**helloweb is a desktop app for playing several web games at once, in one window.** It launches
up to four real Chrome windows — each with its own isolated login — and embeds them into a single
panel laid out like a video wall: every screen visible at once, and you interact with any of them
by just moving the mouse and clicking, no selecting first. Think of a security-camera wall, but
the tiles are live, playable browsers.

The games run in **real Chrome windows reparented into the panel**, not in iframes and not in a
screencast. That is what keeps each screen a fully working browser — real login, Chrome's own
password manager, real audio — while sidestepping `X-Frame-Options`/CSP and giving session
isolation by construction. First target game: **Poke IdleWorld**; any `https://` URL works too.

**Play is manual** — you play with your own hands. Automation is a later phase, deliberately.

## What it does

- **Up to four screens**, each an independent Chrome window with its own profile (its own login),
  tiled in a grid — one fills the panel, two split it, three or four make a 2×2.
- **Per-screen controls**: turn on/off, reload (keeps the login), rename, mute, set volume, or
  edit what it points at (the shipped game or a custom `https://` address).
- **Focus mode** — click a screen's name to blow it up to the main area with the others as
  thumbnails; **fullscreen** covers the whole app like a video player.
- **Audio follows focus** (optional, on by default): with no screen focused every game is audible
  at its own volume; focus one and the rest go quiet.
- **Light/dark themes**, and small tools: clear a screen's cache without logging it out, open the
  logs, and remove/re-add screens (a removed screen's profile is archived, never deleted).

## Requirements

- **Windows** (the window embedding and audio are Win32-specific)
- **Node 20+**
- **Google Chrome** installed (the app drives your installed Chrome; it does not ship a browser)

## Install

There is no packaged installer yet — a Windows installer is a future phase — so for now you run it
from the source:

```
git clone <this repo>
cd helloweb
npm install
```

`npm install` also needs to build two native modules (`node-window-manager` and its transitive
`extract-file-icon`). npm 11+ blocks their build scripts by default; this repo already lists them
under `allowScripts` in `package.json`, so `npm install` builds them — but the machine needs
**Visual Studio Build Tools and Python** for that compile to succeed. Without the build the
install still finishes and the module fails only at runtime.

## Open it on your machine

```
npm --prefix apps/shell start
```

That builds the app and launches the Electron window. (It is a shortcut for
`cd apps/shell && npm start`, which runs `npm run build && electron .`.) Close the window to quit;
the browser screens close with it.

Everything the app saves lives under `%APPDATA%/helloweb` (see [Data](#data-and-privacy) below),
so your logins and settings persist between runs.

## Development

```
npm run check             # typecheck + lint + format:check + fast tests — what CI runs
npm test                  # fast suite, no I/O — stays under a second
npm run test:watch        # the same suite, for the red-green loop
npm run test:integration  # real Chrome, real windows, real disk — Windows only, manual
```

The codebase is a small monorepo: a pure, I/O-free `packages/core` (grid math, slot state machine,
registry, config, the orchestrator, the IPC contract) tested in the fast suite against fakes, and
thin adapters behind narrow ports — Chrome via spawn and per-process audio (`browser-engine`),
window embedding over Win32 (`window-manager`), disk and logs (`storage`) — covered by the
integration suite. The Electron shell lives in `apps/shell`; the game registry in `packages/games`.

The fast suite must stay fast, so it is worth running in a loop. Anything that launches a process,
moves a window or touches disk goes in `*.integration.test.ts`. Strict TDD throughout — see
`CLAUDE.md`.

## Data and privacy

Everything the app persists lives under `%APPDATA%/helloweb`, **including in development**: config,
rotated logs, and the per-slot browser profiles under `profiles/`. Nothing the app produces is ever
written into the repository — a profile _is_ a logged-in session (cookies, saved passwords), and
keeping it out of the working tree removes that risk at the source.

A screen set to a **clean session** is the one exception: its profile is a throwaway directory
under the OS temp folder, removed when the screen stops. If the app is killed before that, the
directory survives until Windows reclaims it — worth knowing on a shared machine.

The app **never stores passwords** — logins live only inside Chrome's own profile. No profile data
leaves the machine, and there is no telemetry.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — how the system works now; edited freely, always current
- [`docs/adr/`](docs/adr/README.md) — one immutable record per decision, including what was rejected and why
- [`docs/troubleshooting.md`](docs/troubleshooting.md) — problems already hit, by the symptom you see first
- `CLAUDE.md` — rules that are not derivable from the code

## A note on game terms of service

helloweb does not automate play and does not inject anything into game pages — it launches ordinary
Chrome windows and arranges them. Even so, every screen runs inside **your** logged-in session, so
check each game's terms before relying on it. Should injection or automation return in a later
phase, the risk of an account ban is the user's.
