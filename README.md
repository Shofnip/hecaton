# Hecaton

**Hecaton is a desktop app for playing several web games at once, in one window.** It launches
up to four real browser windows — each with its own isolated login — and embeds them into a single
panel laid out like a video wall: every screen visible at once, and you interact with any of them
by just moving the mouse and clicking, no selecting first. Think of a security-camera wall, but
the tiles are live, playable browsers.

The games run in **real Chromium windows reparented into the panel**, not in iframes and not in a
screencast. That is what keeps each screen a fully working browser — real login, the browser's own
password manager, real audio — while sidestepping `X-Frame-Options`/CSP and giving session
isolation by construction. The browser **ships with the app**; you do not need one installed. First
target game: **Poke IdleWorld**; any `https://` URL works too.

**Play is manual** — you play with your own hands. Automation is a later phase, deliberately.

## What it does

- **Up to four screens**, each an independent browser window with its own profile (its own login),
  tiled in a grid — one fills the panel, two split it, three or four make a 2×2.
- **Per-screen controls**: turn on/off, reload (keeps the login), rename, mute, set volume, or
  edit what it points at (the shipped game or a custom `https://` address).
- **Focus mode** — click a screen's name to blow it up to the main area with the others as
  thumbnails; **fullscreen** covers the whole app like a video player.
- **Audio follows focus** (optional, on by default): with no screen focused every game is audible
  at its own volume; focus one and the rest go quiet.
- **Light/dark themes**, and small tools: clear a screen's cache without logging it out, open the
  logs, and remove/re-add screens (a removed screen's profile is archived, never deleted).
- **Delete everything**, from the settings modal: where your data lives, and one confirmed action
  that removes it and closes the app.
- **Check for updates** when you feel like it — never on its own. It reads the release list, shows
  the changelog, and opens the page in your browser if you want it.

## Requirements

- **Windows** (the window embedding and audio are Win32-specific)
- Nothing else. The app **ships its own Chromium** and launches only that one, so there is no
  browser to install and no version of yours it can disagree with. It also means the games' browser
  updates when Hecaton does and at no other time — see
  [ADR-0016](docs/adr/0016-ship-our-own-chromium.md), which is honest about what that costs.

Building from source needs **Node 22.12+** as well (Electron 43 requires it, and Vitest 4 pulls in a
Vite that does too), plus
about **1.2 GB of free disk** for the browser step below, 440 MB of it permanent; running a release
needs neither.

## Install

Download the zip from the [releases page](https://github.com/Shofnip/hecaton/releases/latest),
extract it anywhere, and run `Hecaton.exe`. No installer, no elevation — and no uninstaller either,
so removing the folder is the uninstall.

Two things to expect, both of them consequences of a decision rather than accidents:

- **Windows will warn you on first run** — "Windows protected your PC", _More info_ → _Run anyway_.
  The build is not signed, because a code-signing certificate is issued to a verified legal identity
  that every user then sees. For a tool handed to a few friends, that trade was not worth making.
- **A `.sha256` is published beside the zip**, and it is the only thing that tells an authentic
  build from a lookalike — anyone can compile this source and produce something that looks the same.
  Check it with `sha256sum -c Hecaton-<version>-win-x64.zip.sha256`, or
  `Get-FileHash <zip> -Algorithm SHA256` in PowerShell.

That leaves your logins and settings behind on purpose: they live in `%APPDATA%/hecaton`, not in the
extracted folder, so replacing the folder with a newer version keeps them. To remove them, use
**Configurações → Apagar todos os meus dados**, which deletes that directory and closes the app —
stop every screen first, since the browser holds its profile open. A folder with the app's own cache
stays behind; it holds no login. A clean-session screen also leaves a throwaway profile in your temp
directory if the app was killed before it could clean up.

## Build from source

```
git clone <this repo>
cd hecaton
npm install
```

**Then fetch the Electron binary, which `npm install` does not do:**

```
node node_modules/electron/install.js
```

Electron ships no install script — it exposes the downloader as a bin instead — so `npm install`
leaves `node_modules/electron/dist/` empty and the app fails to start with `Electron failed to
install correctly`. This is deliberate on the project's side (see the `allowScripts` note in
`package.json`), and it is the step most likely to be missed on a fresh clone.

**Then fetch the browser the app ships, which `npm install` does not do either:**

```
node scripts/fetch-chromium.mjs
```

That downloads a pinned Chromium revision, **verifies its SHA256 before unpacking anything**, drops
the files the app does not ship, and links the result where both the development run and the
packaged build look for it. It is a 354 MB download the first time and a second the next, since the
unpacked tree lives in `vendor/` and survives `npm install` — only the link under `node_modules`
has to be remade. Budget **~1.2 GB while it runs** — the verified zip is only deleted once the tree
is unpacked and stripped — and **440 MB** left in `vendor/` afterwards.
The binary is not in git: what is pinned is the revision and the hash, in
`scripts/fetch-chromium.mjs`.

`npm install` also needs to build two native modules (`node-window-manager` and its transitive
`extract-file-icon`). npm 11+ blocks their build scripts by default; this repo already lists them
under `allowScripts` in `package.json`, so `npm install` builds them — but the machine needs
**Visual Studio Build Tools and Python** for that compile to succeed. Without the build the
install still finishes and the module fails only at runtime.

Both of these have entries in [`docs/troubleshooting.md`](docs/troubleshooting.md) with the exact
error each produces.

### Open it on your machine

```
npm --prefix apps/shell start
```

That builds the app and launches the Electron window. (It is a shortcut for
`cd apps/shell && npm start`, which runs `npm run build && electron .`.) Close the window to quit;
the browser screens close with it.

Everything the app saves lives under `%APPDATA%/hecaton` (see [Data](#data-and-privacy) below),
so your logins and settings persist between runs.

## Development

```
npm run check             # typecheck + lint + format:check + fast tests — what CI runs
npm test                  # fast suite, no I/O — stays under a second
npm run test:watch        # the same suite, for the red-green loop
npm run test:integration  # the real browser, real windows, real disk — Windows only, manual
```

The codebase is a small monorepo: a pure, I/O-free `packages/core` (grid math, slot state machine,
registry, config, the orchestrator, the IPC contract) tested in the fast suite against fakes, and
thin adapters behind narrow ports — the bundled browser via spawn and per-process audio (`browser-engine`),
window embedding over Win32 (`window-manager`), disk and logs (`storage`) — covered by the
integration suite. The Electron shell lives in `apps/shell`; the game registry in `packages/games`.

The fast suite must stay fast, so it is worth running in a loop. Anything that launches a process,
moves a window or touches disk goes in `*.integration.test.ts`. Strict TDD throughout — see
`CLAUDE.md`.

## Data and privacy

Everything the app persists lives under `%APPDATA%/hecaton`, **including in development**: config,
rotated logs, and the per-slot browser profiles under `profiles/`. Nothing the app produces is ever
written into the repository — a profile _is_ a logged-in session (cookies, saved passwords), and
keeping it out of the working tree removes that risk at the source.

A screen set to a **clean session** is the one exception: its profile is a throwaway directory
under the OS temp folder, removed when the screen stops. If the app is killed before that, the
directory survives until Windows reclaims it — worth knowing on a shared machine.

The app **never stores passwords** — logins live only inside the bundled browser's own profile. No
profile data leaves the machine, and there is no telemetry.

It makes **one** network request, and only when you press **Configurações → Procurar
atualizações**: it asks GitHub what the latest release is. Nothing is sent with it — no identifier,
no usage, not even which version you are on, since the comparison happens on your machine. Nothing
is downloaded or installed either: if there is a newer version, the app offers to open the release
page in your browser and the rest is yours.

**Configurações → Seus dados** names both of those locations and opens the first. Beside it,
**Apagar todos os meus dados** deletes `%APPDATA%/hecaton` — profiles, config and logs — after an
explicit confirmation, and closes the app. It is the only way the app deletes a profile that is
still in use, there is no command-line equivalent, and every screen has to be stopped before it
will run.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — how the system works now; edited freely, always current
- [`docs/adr/`](docs/adr/README.md) — one immutable record per decision, including what was rejected and why
- [`docs/troubleshooting.md`](docs/troubleshooting.md) — problems already hit, by the symptom you see first
- [`docs/releasing.md`](docs/releasing.md) — cutting a release, and the checks no test performs
- `CLAUDE.md` — rules that are not derivable from the code

## License

[Apache License 2.0](LICENSE) — see [`NOTICE`](NOTICE). Free to use, modify and redistribute, with
two obligations worth knowing before you fork: keep the copyright and license notices, and state
what you changed. The name **Hecaton** is not covered by the grant (section 6 is explicit that no
trademark rights come with it), so a fork should carry its own name.

The source is public so that an app holding logged-in game sessions can be read rather than
trusted. It is distributed free, and that is permanent: there is no paid tier planned, now or
later.

## Read this before you log an account in

Hecaton's whole point — several accounts of the same game side by side — is the thing most game
terms restrict. It does not automate play and injects nothing into game pages; it launches ordinary
browser windows — its own bundled Chromium — and arranges them. That does not put it outside the rules, and pretending otherwise
would be the dishonest way to present it.

**For the first target game, Poke IdleWorld, the rules are specific.** Read on
[poke.idleworld.online/rules](https://poke.idleworld.online/rules) on 2026-07-30:

- Running **more than four accounts** without authorization previously accepted by the
  administration can lead to "the permanent deletion of the accounts involved". Hecaton ships with
  four screens, which sits exactly at that line — **adding a fifth crosses it** unless you have
  asked and been told yes.
- "Using any program, script or extension without staff permission is forbidden." Hecaton **is** a
  program used alongside the game. It does not simulate your presence and runs no macros or
  auto-clickers, which are called out separately and are what the rule most clearly targets — but
  the broad wording covers it, and only the game's staff can say whether it is acceptable.
- Penalties escalate with history: warnings, suspension, item removal, permanent ban.

**The consequence lands on you, not on the author.** Every screen runs inside your own logged-in
session; there is no shared infrastructure and no way for anyone else to absorb a ban. If an
account matters to you, ask the game's staff before pointing Hecaton at it.

Terms change, and the summary above is a snapshot with a date on it, not legal advice. Check the
rules yourself. If injection or automation ever returns in a later phase, this section gets stricter,
not softer.

**The app says this too, before you can use it.** The first launch opens on that warning with a
single button, because it is the last moment it can still change what you decide — after the first
login it is advice about a decision already taken. Afterwards it stays readable under
**Configurações → Aviso sobre os termos do jogo**.
