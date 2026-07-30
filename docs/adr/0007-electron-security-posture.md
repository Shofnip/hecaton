# ADR-0007 — The Electron security posture

**Status:** Accepted · **Date:** 2026-07-21

## Context

Phase 1.5 built the Electron shell, and it tripped five of the project's security triggers at
once: the `electron` dependency (the first thing to enter a bundle distributed to third
parties), `webPreferences`, the IPC surface, the Content-Security-Policy, and the navigation
allowlist. Per CLAUDE.md rule 2 the work stopped and the five were decided together, before any
code existed to defend. This ADR records them as one posture, because they were weighed as one
and each is a trade-off with alternatives seriously considered.

One of the five was **decided one way, then reversed by measurement** before implementation.
That reversal is the reason this is an ADR and not five commit messages.

## Decision

**1 — `electron` pinned to an exact version, renderer with zero dependencies.** The embedded
Chromium becomes a reviewed decision rather than an `npm install` outcome, and the supply-chain
surface is one package instead of a package plus a front-end toolchain. The panel is four cards;
plain HTML and TypeScript suffice, so no React/Vite. Two obligations come with the exact pin,
recorded because they are invisible in the code:

- **A cadence to update Electron.** Chromium's security fixes arrive as Electron patch releases,
  and Electron supports only its three most recent majors. An exact pin turns "receive the CVE
  fix automatically" into "someone must bump it." For a distributed app holding logged-in
  sessions this is an obligation, not a footnote.
- **CI must not fetch the binary.** Electron ships no install script; its ~100 MB binary is
  fetched by running `node node_modules/electron/install.js` explicitly (see
  `docs/troubleshooting.md`). `typecheck` works from the shipped `electron.d.ts` with no binary,
  and `npm ci` downloads nothing — so CI needs no Electron binary at all.

**2 — one load mode, in development and production.** `contextIsolation: true`,
`nodeIntegration: false`, `sandbox: true`, `webSecurity` on, no `<webview>`. The renderer is
loaded from `file://` in both dev and prod, so the CSP and the navigation rules are identical to
what ships — what is tested is what is distributed. A dev server on localhost was rejected: it
is a second, weaker load path, and the weak one is the one reached for while debugging — the
same shape ADR-0004 rejected.

**3 — enumerated IPC channels, every payload validated in the main process.** Each channel has a
fixed signature and is validated by calling pure functions in the core, never by ad-hoc `if`s in
the adapter. The renderer is a separate process, so what arrives is `unknown` and the TypeScript
types are gone — validation is the only real check. A generic `invoke(method, args)` was
rejected: it becomes an arbitrary-call surface the first time a method name is forwarded from the
renderer. Two points inside this decision: `logs:reveal` takes no argument (main computes the
directory; a path parameter would be "open an arbitrary file"), and the panel never renders log
contents (a log line can carry a session token).

**4 — restrictive CSP, delivered by header, from the `file://` renderer.**
`default-src 'none'` with no `unsafe-inline`; `connect-src 'none'`, so the app makes no network
request at all in v1 — no update check, no telemetry, no remote asset. **This decision was
reversed by measurement.** It had been decided as a custom `app://` scheme, on the premise that
`onHeadersReceived` does not fire for `file://` and that `'self'` is meaningless under an opaque
`file:` origin. Both were measured false on Electron 43.2.0 / Chromium 150 before any code was
written: the listener fires for `file://`, a merged CSP header is enforced there (the document
loads and a blocked script does not run), and `script-src 'self'` matches sibling files. So
`file://` gives the full protection `app://` was chosen for, with no new code in the load path —
and the `app://` handler had failed on its first attempt, in exactly the path-resolving code
that was its predicted risk. The header is **merged** with the headers `file://` already returns,
never replaced: a `file://` response carries `Content-Type`, and returning a fresh object
without it fails the load with `ERR_FAILED` — a failure indistinguishable from "header CSP does
not work over `file://`", which an intermediate probe concluded before the cause was understood.

**5 — deny all navigation and all permissions.** The panel is one static page that never
navigates: `will-navigate` and `will-redirect` are always prevented, `setWindowOpenHandler`
always denies, and permissions are denied through all three handlers
(`setPermissionRequestHandler`, `setPermissionCheckHandler`, `setDevicePermissionHandler`) —
denying only the first while claiming to deny everything is the partial coverage this project
keeps correcting. A game url opens in the user's own Chrome, never inside Electron: a logged-in
game session inside the Electron process is exactly what the whole architecture avoids, and
Turnstile would reject it anyway.

## Consequences

- The panel's CSS and JS are files, never inline. Small price.
- `connect-src 'none'` means auto-update in phase 3 is a deliberate future decision, not a
  default already in place.
- The exact Electron pin only stays defensible while the update cadence above is honoured.
- A single-instance lock and the placement of Electron's own `userData` under
  `%APPDATA%/helloweb/shell` are related hardening, recorded in `architecture.md` and consistent
  with ADR-0004 rather than decided here. [see Correction (2026-07-30)]

## Alternatives rejected

- **A custom `app://` scheme for the renderer** — chosen first, reversed by the measurement above.
  It gives a defined origin and header CSP, but so does `file://` here, and `app://` adds a
  path-resolving handler (a traversal surface) in the load path. Kept in reserve only if a future
  Chromium breaks `'self'` under `file:`.
- **A dev server on localhost** — a second, weaker load path (decision 2).
- **A generic IPC `invoke(method, args)`** — an arbitrary-call surface (decision 3).
- **`electron` with `^` and a React/Vite renderer** — two builds of one tag could embed
  different Chromiums, and the toolchain is supply-chain surface the four-card panel does not
  need (decision 1).

## Note on scope

The finding that the target game binds its login to the browser tab — which invalidated a
premise behind the `persistProfile` default — is a separate matter, recorded in
[ADR-0009](0009-login-is-bound-to-the-tab.md). The profile reset/archive feature is
[ADR-0008](0008-archive-a-removed-slot-profile.md).

## Correction (2026-07-30)

**Electron's `userData` is under `%APPDATA%/hecaton/shell`, not `%APPDATA%/helloweb/shell`.** The
product was named **Hecaton** during Phase 3 planning and `APP_DIR_NAME` was renamed in one
mechanical commit; verify in `packages/storage/src/app-paths.ts`. The hardening this Consequence
describes is unchanged — only the directory's name. This appeared when the code changed rather than
being wrong when written, and [ADR-0004](0004-appdata-over-repo-dir.md) carries the same correction
for the same reason.

Nothing about the security posture in this ADR is affected. Note for a reader arriving here from
Phase 3: the `connect-src 'none'` Consequence above says auto-update would be "a deliberate future
decision" — that decision has now been taken, and it reverses this ADR's decision 4. It is **not**
part of this Correction, because a changed decision is not a factual error: it gets its own ADR and
a `Superseded in part` line at the top of this file, and neither exists yet.
