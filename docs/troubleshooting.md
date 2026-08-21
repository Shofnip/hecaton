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
permission denied) that leave the data split across two directories. Only a machine that ran a
build from before the rename needs this, and the first release (v0.1.0, 2026-08-20) shipped well
after it — so in practice that is the author's machine alone. See
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
against the zip that replaced it on 2026-08-08; since ADR-0019 the release is an installer again,
which is the shape the first of those two measurements used.) `npm` hides install-script output unless a script fails,
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

Note that no **lifecycle** path deletes a live `profiles/slot-N` — nothing that happens while
screens start, stop, crash or get removed. **Three** deletion paths exist, and the third is the
one to know about:

- `ChromeLauncher.discard` removes a throwaway clean-session profile under `%TEMP%` on `stop()`.
- `clearArchives` (the "clear archives" action) permanently removes profiles a removed slot
  archived to `slot-N.old-<stamp>` — a persistent session, but only after removing its slot
  explicitly archived it.
- **`data:deleteAll`** (Configurações → _Apagar todos os meus dados_) removes `%APPDATA%/hecaton`
  whole, **live profiles included**. It exists because the uninstaller deliberately does not ask
  the question, and it is guarded by an explicit confirmation and by every screen having to be
  stopped first.

The third arrived on 2026-08-08 and this page was not updated with it, which is worth naming: the
sentence that used to be here read as a structural guarantee that the app _cannot_ destroy a
logged-in session, and someone auditing "where can cookies go" from it would have counted wrong.
See ADR-0005 (and **both** its Corrections) and ADR-0008.

**A fourth path exists that is not the app's**, and an audit of "where can cookies go" has to count
it. Since [ADR-0019](adr/0019-an-assisted-installer-for-a-792-mb-app.md) the release is an
installer, and the uninstaller electron-builder generates accepts `--delete-app-data` on its command
line. Given it, the uninstaller deletes `%APPDATA%\Hecaton` — every logged-in profile — with no
confirmation anywhere. `deleteAppDataOnUninstall: false` in `electron-builder.yml` does **not**
disable it; that setting governs a different branch, and this one has no guard at all
(`app-builder-lib/templates/nsis/uninstaller.nsh:220-231` parses the flag, `:237` does the
deletion; read against electron-builder 26.15.3, the pinned version).

Nothing reaches it by accident. Clicking Uninstall does not pass the flag, and an update passes
`--updated` instead — probe P1 measured both. It takes someone typing it. The ADR records why it was
accepted rather than closed, and what closing it would have cost.

---

## The app refuses to start and says why

**Symptom**

A small window opens instead of the panel: _"O Hecaton não pôde iniciar"_, with one reason.

**Cause and what to do**, one per reason — all four come from the machine claim
([ADR-0018](adr/0018-one-instance-per-machine.md)), which runs before the panel exists and before
anything writes `config.json`:

| Reason on screen                                   | What it means                                                                                                                                                                                                                                                           | What to do                                                                                                                                                                                      |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _Já existe um Hecaton aberto nesta máquina_        | The `Global\` mutex is held by **your own** Windows account — often a second logon session, or a copy whose window you cannot see                                                                                                                                       | Close the other one. `Get-Process electron` across sessions, or sign out of the other session                                                                                                   |
| _Outra conta do Windows está com o Hecaton aberto_ | Another Windows account holds it. You cannot see or close their process, by design                                                                                                                                                                                      | That user closes theirs, or their session is ended                                                                                                                                              |
| _Esta parece ser uma máquina virtual_              | `Win32_ComputerSystem` Manufacturer/Model matched a known hypervisor                                                                                                                                                                                                    | Nothing, on a real VM. On physical hardware it means your vendor wrote a hypervisor-looking string into SMBIOS — check with `Get-CimInstance Win32_ComputerSystem`                              |
| _Esta máquina não é a que está registrada_         | The seal in `C:\ProgramData\hecaton\machine.json` does not match this hardware, or could not be read at all — **any** failure to read it refuses the launch, not only a parse error, provided the machine has a readable identity to compare against in the first place | If the machine is yours — a motherboard swap does this — delete that file **as an administrator** and start again; it writes a fresh seal. A standard user cannot delete it, which is the point |

Two of these have a failure mode worth knowing about, because they are indistinguishable from the
real thing: a hostile account on the machine can create the mutex first with a closed DACL, or drop
a bogus `machine.json` in place. Both show as the rows above. There is no way to tell them apart
without elevation, and the ADR explains why that is accepted rather than solved.

The verdict is in the log too — `instance.claim`, with the reason as its message. A refused launch
does write that line, so `%APPDATA%/hecaton/logs` exists and has an entry even when nothing else
was created. **The machine id is never in the log**, so there is nothing to redact before sending
one to someone.

---

## The app will not start, and nothing at all happens

**Symptom**

`npm --prefix apps/shell start` builds, prints nothing unusual, and no window appears. Running it
again does the same. Task Manager shows `electron.exe` processes that you did not just start.

**Cause**

A previous instance is still alive with its windows hidden, holding the single-instance lock. A
second launch takes `requestSingleInstanceLock()`, loses, and quits silently — which is the
designed behaviour and looks identical to "the app is broken".

**One more shape of "nothing happens", and it is brief:** the machine claim shells out to
PowerShell, and if that process never answers, the claim waits fifteen seconds before failing open
and starting the app anyway. A launch that stalls that long and then works normally is this, not a
hang.

**Since ADR-0018 this covers less ground than it used to.** A second launch that gets past
Electron's own lock now hits the machine claim, and that one is never silent: it opens a small
window naming the reason. So "nothing at all happens" narrowed to the same-session case — same
Windows account, same logon session, same Electron user-data directory. Anything else shows the
refusal screen, and the section below is the one to read.

Until 2026-08-09 it could get into that state on its own. `before-quit` calls
`event.preventDefault()` and re-issues `app.quit()` only after its PowerShell workers are disposed
— three of them now, Win32, WASAPI and the machine-lock mutex (ADR-0018) — and `dispose()` waited for the worker's reply to `exit` **with no deadline**. A worker
that neither answered nor died left the app running forever with no window to close. Observed
once, nine minutes in and still going, with both workers alive.

The two persistent workers now bound that wait (`GRACEFUL_EXIT_MS`) and kill the process either
way, and the mutex worker bounds its own at a second, so the shutdown cannot stall on a silent
worker. If you see this on an older build, or from some other
cause:

**What to do**

```
taskkill /IM electron.exe /F
```

Then check for orphaned workers, because a killed app cannot clean up after itself — the Win32 and
WASAPI workers are the one case where they outlive it. **The machine-lock worker is not**, and that
is measured rather than assumed: `taskkill /F` on the parent, without `/T`, and it is gone within
four seconds and the machine is claimable again. The difference is structural — the mutex worker
does nothing but wait on stdin, so it always notices the pipe close, while a worker blocked inside
a command (a `SendMessage` to a hung browser window) is not reading stdin at all. So a force-killed
Hecaton never locks the machine out; that is why ADR-0018 chose a mutex over a lock file.

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

The browser starts with `--load-extension=<dir>` and the extension is simply absent — not listed in
`chrome://extensions`, no error anywhere.

**Cause**

The flag is ignored. Chrome 137 removed it from branded builds, and probe P5 measured the
**unbranded Chromium snapshot ignoring it too** — which contradicts the upstream PSA that said
unbranded builds kept it, and corrects an assumption an earlier session made from memory.
`--disable-features=DisableLoadExtensionCommandLineSwitch` changes nothing either. It loads only
through the manual "Load unpacked" button, with developer mode on.

Bundling the browser (ADR-0016) did **not** reopen this, and slots now launch with
`--disable-extensions`, which states the posture rather than leaving it as an accident of the
browser version.

**What to do**

For local experiments, load it by hand. For anything shipped, this is why HUD and in-page
actions are deferred: distributing an extension means the Web Store or enterprise policy, each
with its own cost — a stop-and-ask decision, not a side effect of some later change. See the
deferred section of `architecture.md` and ADR-0003.

---

## A screen turns on grey and only paints after a reload

**Symptom**

A screen starts, the window is embedded in the right place, the process is alive — and the cell is
a flat grey rectangle. Pressing reload fixes it. It never fixes itself.

**Cause**

`SetParent` on an `--app` window throws away its rendered surface on the bundled Chromium. Measured
2026-08-20: Chrome 150 does not do it, a normal tabbed window does not do it, and the regression
landed during Chromium 151 — see [ADR-0017](adr/0017-repaint-an-embedded-screen.md).

**What to do**

Nothing, if the app is current: the window adapter reloads a screen the moment it embeds it and
holds it hidden for `REPAINT_SETTLE_MS` while it repaints, so the cell shows `Iniciando a tela…`
and then the game.

If it comes back, the two things worth checking in that order are whether the reload in
`NativeWindowManager.embed` is still there — a future cleanup might read it as redundant — and
whether a raised Chromium revision has changed the behaviour. The integration test
`has actually painted, not just been placed` is the one that will tell you: it reads a pixel off
the real screen, because every other signal stayed green throughout the original bug.

**On a slow connection** the second may not be enough and the grey shows briefly before the page
arrives. That is the accepted failure mode, not a new bug: without CDP there is no "painted" event
to wait for, only elapsed time.

---

## `bundled browser executable not found at ...`

**Symptom**

Every screen fails to start, with an error naming a path ending in
`chromium\chrome-win\chrome.exe`.

**Cause**

The app ships its own Chromium (ADR-0016) and launches nothing else — there is deliberately no
fallback to an installed Chrome. The binary is not in git, so a fresh clone does not have it, and
`npm install` wipes the link that points development at it because that link lives under
`node_modules`.

The path in the message tells the two cases apart. Under `node_modules/electron/dist/resources` it
is a development tree that has not fetched the browser; under the installed app's `resources`
(`%LOCALAPPDATA%\Programs\Hecaton` by default) it is an incomplete package, which is a build
problem rather than yours.

**What to do**

```
node scripts/fetch-chromium.mjs
```

It re-links in about a second if `vendor/chromium` is already there, and downloads 354 MB if it is
not. It refuses to unpack anything whose SHA256 does not match the pin, so a failure here is a
failure to verify, never a silent partial install.

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
`tests/repo-consistency.test.ts` fails if `ci.yml` ever grows an inline `- run: npm ...` step, other
than `npm ci`, that `check` lacks. Two shapes are invisible to it — a named step (`- name:` with `run:` on the next
line) and anything not invoked through `npm` — and those have to be added to `check` by hand. If you see
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
rather than `-Filter "Name='chrome.exe'"`. `browser-process-query.ts` does this deliberately, and
`browser-process-query.test.ts` holds it — the query is a shell string built from a resolved path,
so it is pinned by a test rather than by a comment.

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
