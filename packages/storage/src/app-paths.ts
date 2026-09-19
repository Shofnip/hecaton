/**
 * Where the app keeps its own state.
 *
 * Always outside the repository — in development too. Writing config and logs
 * into the working tree would make .gitignore the only thing standing between a
 * distracted `git add -f` and a committed session token, since page URLs can
 * carry them in query strings. Same path in dev and prod also removes a class
 * of packaging bug that only shows up after electron-builder runs.
 */
import { join } from 'node:path'

export const APP_DIR_NAME = 'hecaton'

/** What a development run uses instead, so it can be open beside the real app. */
export const DEV_APP_DIR_NAME = 'hecaton-dev'

/**
 * A directory name this app may keep its data under: lower-case letters, digits
 * and dashes, nothing longer than 32 characters.
 *
 * Deliberately not a path. The environment variable below chooses a **name**
 * under `%APPDATA%`, never a location - accepting a path there would turn a
 * stray variable into "write the user's logged-in sessions anywhere", which is
 * the kind of surface ADR-0007 refuses for IPC and this file refuses here.
 */
const SAFE_DIR_NAME = /^[a-z0-9-]{1,32}$/

/**
 * The directory this run keeps its data under, `hecaton` unless told otherwise.
 *
 * Until 2026-09-18 this was a constant, and `CLAUDE.md` said in so many words
 * that development used the same directory as production - so a developer could
 * not run the app while the real one was open, which is exactly what testing
 * accounts needs. [ADR-0022](../../../docs/adr/0022-a-separate-data-directory-for-development.md)
 * records the reversal and what was kept from the original reasoning.
 *
 * What was kept is the part that mattered: there is **no `app.isPackaged`
 * branch**. A packaged app never has the variable set, so it takes the
 * production name by the same code path a development run takes the other one -
 * the class of packaging bug the old rule prevented needs two code paths, and
 * there is still only one. `npm start` is what sets it.
 *
 * An unusable value is ignored rather than rejected: this is read on the way to
 * resolving every path in the app, including before the panel exists, and
 * throwing there would turn a typo in an environment variable into a window that
 * never opens.
 */
export function appDirName(env: NodeJS.ProcessEnv = process.env): string {
  const requested = env['HECATON_APP_DIR']
  return requested !== undefined && SAFE_DIR_NAME.test(requested) ? requested : APP_DIR_NAME
}

/**
 * The prefix for this run's account locks.
 *
 * Carries the directory name, so a development window and a production one never
 * contend: they keep different profiles, and sharing a lock would only make each
 * push the other onto an account it did not want. The `Hecaton.` prefix stays so
 * the names remain recognisable in a kernel-object listing.
 */
export function accountMutexPrefix(env: NodeJS.ProcessEnv = process.env): string {
  return `Hecaton.${appDirName(env)}.Account`
}

export function appDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'win32') {
    const appData = env['APPDATA']
    if (!appData) {
      throw new Error('APPDATA is not set; cannot determine where to store application data')
    }
    return join(appData, appDirName(env))
  }

  // Not a supported target, but CI type-checks and runs on Linux.
  const xdg = env['XDG_CONFIG_HOME']
  if (xdg) return join(xdg, appDirName(env))

  const home = env['HOME']
  if (!home) {
    throw new Error('neither XDG_CONFIG_HOME nor HOME is set; cannot determine application data')
  }
  return join(home, '.config', appDirName(env))
}

export function logsDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  return join(appDataDir(env, platform), 'logs')
}

/**
 * The directory under which Electron keeps its own state — cache, cookies and
 * local storage for the panel window itself, one subdirectory per launch
 * (`panelCacheDir` in account-paths.ts builds the path; this is only the name).
 *
 * Under the app's directory rather than the shared `%APPDATA%/Electron`, for
 * ADR-0004's reason and one practical one: the shared folder is where "unable to
 * move the cache: access denied" comes from, since any other Electron app holds
 * it.
 *
 * The name is exported because the delete action needs it. The running app
 * cannot remove this directory — the process holds it open until it exits — so
 * it is the one entry allowed to survive `data:deleteAll`, and telling that
 * survivor apart from a real failure means knowing what it is called. It holds
 * no game session, and that survives the update check (ADR-0014): the panel
 * loads from `file://` under `connect-src 'none'`, and the one request the app
 * makes is a `fetch` in the main process, which uses neither this session nor
 * this directory.
 */
export const ELECTRON_DIR_NAME = 'shell'

/**
 * The hardware seal that binds one Hecaton to one machine (ADR-0018).
 *
 * The single file this app writes outside its own data directory, and the
 * reason it is here rather than built inline at the call site: a path this
 * consequential belongs where an audit of "what does this app touch" already
 * looks.
 *
 * `%ProgramData%` is the point. The seal has to be the same file for every
 * account on the machine, which `%APPDATA%` cannot be. What lands there is a
 * digest, never raw hardware identifiers - the directory is world-readable, and
 * measured in probe P6, a standard user gets ReadAndExecute on the file and
 * cannot delete or overwrite one another account created.
 *
 * No fallback in either direction. A missing `PROGRAMDATA` throws instead of
 * guessing, because a seal written somewhere else is not a weaker seal - it is a
 * different machine identity on every launch, which refuses the user forever.
 */
export function machineSealPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== 'win32') {
    throw new Error('the machine seal is Windows-only; there is no supported path elsewhere')
  }
  const programData = env['PROGRAMDATA']
  if (!programData) {
    throw new Error('PROGRAMDATA is not set; cannot determine where the machine seal lives')
  }
  return join(programData, appDirName(env), 'machine.json')
}
