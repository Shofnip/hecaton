# Troubleshooting

Problems this project has actually hit, with the symptom you will see first. Every entry here
cost someone time to diagnose once.

Add to it when something takes more than a few minutes to figure out — especially anything
whose symptom points away from its cause.

---

## The app starts with no slots, and the old profiles seem gone

**Symptom.** After pulling the commit that renamed the app to Hecaton, the app opens as if it were
a fresh install: default slots, nobody logged in. `%APPDATA%/hecaton` exists and is nearly empty.

**Cause.** Nothing is lost. `APP_DIR_NAME` changed from `helloweb` to `hecaton`
(`packages/storage/src/app-paths.ts`), so the app now looks in a directory that did not exist and
created it. The old state — `config.json`, `logs/`, and `profiles/slot-N`, which **are** the
logged-in browser sessions — is still sitting in `%APPDATA%/helloweb`.

**Fix — a one-time manual move, and it is a move, never a delete.** With the app closed and no
Chrome holding a slot profile open:

```powershell
# Merge is not the intent: if %APPDATA%\hecaton was auto-created and is empty, remove
# the empty directory first, then rename the old one into its place.
Move-Item "$env:APPDATA\helloweb" "$env:APPDATA\hecaton"
```

Same volume, so it is a rename and finishes instantly whatever the size. If `hecaton` already
exists, `Move-Item` refuses rather than merging — that is the safe behaviour. Delete the _empty_
auto-created `hecaton` (check it is empty first) and run the move again.

**Why there is no code that does this for you.** A first-run migration is the obvious friendly
feature and it is the dangerous one: it would be a permanent code path in the shipped app that
moves live logged-in sessions, with partial-failure states (Chrome running, a file locked,
permission denied) that leave the data split across two directories. The app has never been
distributed, so exactly one machine needs this once — see
[ADR-0004](adr/0004-appdata-over-repo-dir.md)'s 2026-07-30 Correction and
[ADR-0005](adr/0005-never-delete-a-persistent-profile.md).

---

## `npm ci` fails on a native module in CI

**Symptom**

```
gyp ERR! find VS unknown version "undefined" found at "C:\Program Files\Microsoft Visual Studio\18\Enterprise"
gyp ERR! find VS could not find a version of Visual Studio 2017 or newer to use
```

**Cause**

`node-gyp` 11.5 does not recognise Visual Studio 18, which is what the GitHub `windows-latest`
image ships. The two native modules (`node-window-manager` and its transitive
`extract-file-icon`) therefore cannot build there.

**Resolved on 2026-07-30 — `node-gyp` is 12.4.0 in the lockfile and builds fine on
`windows-latest`.** It rose when `electron-builder` was installed for the release workflow, not by
anyone deciding to fix this. Measured: the release workflow runs `npm ci` without
`--ignore-scripts` on `windows-latest`, packages the app, and the resulting artifact runs with both
`addon.node` files present and loading. (Measured against an NSIS installer on 2026-07-30 and again
against the zip that replaced it on 2026-08-08; the release is a zip now.) `npm` hides install-script output unless a script fails,
which is why a successful build shows no `gyp` lines at all — absence of gyp output is not evidence
that nothing was compiled.

The entry is kept rather than deleted because the symptom is worth recognising if it comes back: a
`node-gyp` that predates the runner's Visual Studio produces exactly the error above, and the fix is
to raise `node-gyp`, not to reach for `--ignore-scripts`.

**What to do if it returns**

Raise `node-gyp` (check `package-lock.json` for the version actually in use), or pin an older runner
image. Do not add `--ignore-scripts` to make it pass — that produces a green run that builds
nothing, which this project already had once.

The integration suite stays a manual workflow regardless: its other reason is that it needs an
interactive desktop session, which no hosted runner has, and that has not changed. The authoritative
run is local, on Windows: `npm run test:integration`.

---

## The app builds and installs, then a native module fails at runtime

**Symptom**

`npm install` succeeds with no error. Later:

```
Error: Cannot find module '../build/Release/addon.node'
```

**Cause**

npm 11 blocks dependency install scripts by default. Native modules are downloaded but never
compiled, and **the install still reports success** — the failure surfaces only when something
imports the module.

The trap: approving the parent does **not** cover a transitive dependency.
`npm approve-scripts node-window-manager` leaves `extract-file-icon` inert.

**What to do**

Both need their own entry in the root `package.json`:

```json
"allowScripts": {
  "node-window-manager@2.2.4": true,
  "extract-file-icon@0.3.2": true
}
```

Then `npm rebuild node-window-manager extract-file-icon`. Verify by checking that the compiled
addons exist, rather than trusting the install:

```
ls node_modules/node-window-manager/build/Release/addon.node
ls node_modules/extract-file-icon/build/Release/addon.node
```

Building them needs Visual Studio Build Tools and Python on the machine.

---

## `EPERM` deleting a slot profile directory

**Symptom**

```
Error: EPERM, Permission denied: '...\hecaton-clean-XXXX'
```

right after stopping a slot, often only in tests.

**Cause**

Chrome holds file handles for a short while after the process exits. A delete issued
immediately after `taskkill` races it.

**What to do**

Retry with a short delay rather than failing — `ChromeLauncher.discard` already does this, and
the integration tests do the same in their cleanup. If you write new code that removes a
profile directory, expect the race.

Note that a **live** `profiles/slot-N` is never deleted by the app. Two deletion paths exist,
both away from a live profile: `ChromeLauncher.discard` removes a throwaway clean-session
profile under `%TEMP%` on `stop()`, and `clearArchives` (the "clear archives" action) permanently
removes profiles a removed slot archived to `slot-N.old-<stamp>`. So a persistent session can be
deleted — but only after it has been explicitly archived by removing its slot, never while live.
See ADR-0005 (and its Correction) and ADR-0008.

---

## The app will not start, and nothing at all happens

**Symptom**

`npm --prefix apps/shell start` builds, prints nothing unusual, and no window appears. Running it
again does the same. Task Manager shows `electron.exe` processes that you did not just start.

**Cause**

A previous instance is still alive with its windows hidden, holding the single-instance lock. A
second launch takes `requestSingleInstanceLock()`, loses, and quits silently — which is the
designed behaviour and looks identical to "the app is broken".

Until 2026-08-09 it could get into that state on its own. `before-quit` calls
`event.preventDefault()` and re-issues `app.quit()` only after both PowerShell workers are
disposed, and `dispose()` waited for the worker's reply to `exit` **with no deadline**. A worker
that neither answered nor died left the app running forever with no window to close. Observed
once, nine minutes in and still going, with both workers alive.

Both workers now bound that wait (`GRACEFUL_EXIT_MS`) and kill the process either way, so the
shutdown cannot stall on a silent worker. If you see this on an older build, or from some other
cause:

**What to do**

```
taskkill /IM electron.exe /F
```

Then check for orphaned workers, because a killed app cannot clean up after itself — this is the
one case where they outlive it:

```
powershell "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Select ProcessId, ParentProcessId"
```

Anything whose parent is gone can be stopped. A normal shutdown takes its workers with it; verify
by closing the app and confirming no `electron.exe` and no worker `powershell.exe` remain.

---

## `gh` fails with "Resource not accessible by personal access token"

**Symptom**

```
GraphQL: Resource not accessible by personal access token (createRepository)
```

even though `gh auth status` shows you logged in.

**Cause**

Two credentials are present. A fine-grained PAT in the `GITHUB_TOKEN` environment variable
takes precedence over the keyring credential, and it lacks the needed scope.

**What to do**

Clear the variable for that command so the keyring credential is used:

```bash
GITHUB_TOKEN= GH_TOKEN= gh repo create ...
```

Nothing needs to be changed permanently.

**It is not only `gh repo create`.** Every command that writes needs the same prefix — measured on
this repository: `gh repo rename`, `gh repo edit --visibility`, `gh workflow run`, and `git push`
itself, since git picks the same credential up. Reads mostly work without it, which is what makes
this confusing: `gh run view` and `gh run list` succeed and then the next write returns HTTP 403.

---

## A browser extension does not load

**Symptom**

Chrome starts with `--load-extension=<dir>` and the extension is simply absent — not listed in
`chrome://extensions`, no error anywhere.

**Cause**

Chrome 150 ignores `--load-extension` on the stable channel. It loads only through the manual
"Load unpacked" button, with developer mode on.

**What to do**

For local experiments, load it by hand. For anything shipped, this is why HUD and in-page
actions are deferred: distributing an extension means the Web Store or enterprise policy, each
with its own cost. See the deferred section of `architecture.md` and ADR-0003.

---

## A shell one-liner using `jq` fails

**Symptom**

```
jq: command not found
```

**Cause**

`jq` is not installed on this machine, and many hook and CI recipes found online assume it.

**What to do**

Use Node, which is always present here — see `.claude/hooks/block-blind-git-add.mjs` for the
pattern of reading JSON from stdin. A script file is also easier to test and to read than an
inline one-liner.

---

## `npm run check` passes locally but CI fails

**Symptom**

Green locally, red in CI, usually on formatting.

**Cause**

This was real: `check` did not run `format:check` while CI did.

**What to do**

It should not happen again — `check` now runs the same four steps as CI, and
`tests/repo-consistency.test.ts` fails if CI ever grows a step that `check` lacks. If you see
this, that test is the first thing to look at.

---

## PowerShell mangles a quoted command

**Symptom**

```
Get-CimInstance : Consulta inválida
```

or a command that works when pasted into a terminal but fails when invoked from code.

**Cause**

Double quotes inside a `powershell -Command "..."` string are consumed before PowerShell sees
them.

**What to do**

Avoid inner double quotes entirely — use single quotes inside, and filter with `Where-Object`
rather than `-Filter "Name='chrome.exe'"`. `chrome-launcher.ts` does this deliberately; the
comment there explains why.

---

## `npm install` succeeds but Electron has no binary

**Symptom**

```
Error: Electron failed to install correctly, please delete node_modules/electron and try again
```

or `node_modules/electron/dist/` and `node_modules/electron/path.txt` simply do not exist,
while `npm install` reported success and added the package.

**Cause**

**Electron ships no install script.** Its `package.json` has no `scripts` field at all: the
downloader is exposed as a bin (`install-electron`, i.e. `node_modules/electron/install.js`)
and is expected to be run explicitly.

This is easy to misdiagnose as the npm-blocks-install-scripts trap above, because the symptom
is identical — a successful install and a missing binary. It is not the same problem, and
adding `"electron@<version>": true` to `allowScripts` does nothing, because there is no script
to approve. The lockfile settles it:

```
node -e "const l=require('./package-lock.json'); console.log(l.packages['node_modules/electron'].hasInstallScript)"
```

`undefined` or `false` means no script exists and `allowScripts` is not the answer.

**What to do**

```
node node_modules/electron/install.js
```

It downloads the platform binary through `@electron/get` and verifies it against the
`checksums.json` shipped inside the npm package — so the integrity check is anchored to the
tarball npm already verified against the lockfile, not to a checksum fetched alongside the
download.

Verify by looking, rather than by trusting the exit code:

```
cat node_modules/electron/path.txt          # electron.exe
cat node_modules/electron/dist/version      # must match package.json
```

**CI does not need any of this.** `electron.d.ts` ships inside the npm package, so `typecheck`
works with no binary present, and nothing in `npm ci` tries to download one. There is no need
for `ELECTRON_SKIP_BINARY_DOWNLOAD` — that variable belongs to the era when the postinstall
existed, and `install.js` does not read it.
