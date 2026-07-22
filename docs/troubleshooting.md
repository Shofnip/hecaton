# Troubleshooting

Problems this project has actually hit, with the symptom you will see first. Every entry here
cost someone time to diagnose once.

Add to it when something takes more than a few minutes to figure out — especially anything
whose symptom points away from its cause.

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

**What to do**

Nothing, for now — this is why the integration suite is a separate manual workflow
(`.github/workflows/integration.yml`) rather than part of CI. The authoritative run is local,
on Windows, where Visual Studio Build Tools are recognised: `npm run test:integration`.

If you need it green in CI, the options are pinning an older runner image or waiting for
`node-gyp` to learn VS 18. Do not add `--ignore-scripts` to make it pass — that produces a
green run that builds nothing, which this project already had once.

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
Error: EPERM, Permission denied: '...\helloweb-clean-XXXX'
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
