/**
 * Runs the app in development, against its own data directory.
 *
 * `HECATON_APP_DIR=hecaton-dev` is the whole difference: config, logs, profiles
 * and the account locks all hang off that name (`appDirName` in
 * `@hecaton/storage`), so a development window can be open beside the real app
 * without the two ever touching the same file - which is what testing accounts
 * needs. See ADR-0022.
 *
 * A node script rather than `set X=… && electron .` in package.json, for the
 * reason this repository keeps relearning: that line is cmd.exe syntax, it is
 * silently different in PowerShell, and the trailing space before `&&` has
 * ended up inside the value more than once. Here the variable is a string in a
 * process object.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
// The path of the Electron binary: imported from Node rather than from inside
// Electron, the package exports exactly that. This used to be the
// `node_modules/.bin/electron.cmd` shim, and from Node 20.12 `spawn` refuses a
// `.cmd` without `shell: true` — so the development run died with `spawn EINVAL`
// before Electron was ever reached. Going straight to the exe fixes it without
// putting a shell back in the middle, which is the whole point of this file.
import electron from 'electron'

const here = dirname(fileURLToPath(import.meta.url))
const shell = join(here, '..')

const child = spawn(electron, ['.'], {
  cwd: shell,
  stdio: 'inherit',
  env: { ...process.env, HECATON_APP_DIR: 'hecaton-dev' },
})
child.on('exit', (code) => process.exit(code ?? 0))
