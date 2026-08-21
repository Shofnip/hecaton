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

export function appDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'win32') {
    const appData = env['APPDATA']
    if (!appData) {
      throw new Error('APPDATA is not set; cannot determine where to store application data')
    }
    return join(appData, APP_DIR_NAME)
  }

  // Not a supported target, but CI type-checks and runs on Linux.
  const xdg = env['XDG_CONFIG_HOME']
  if (xdg) return join(xdg, APP_DIR_NAME)

  const home = env['HOME']
  if (!home) {
    throw new Error('neither XDG_CONFIG_HOME nor HOME is set; cannot determine application data')
  }
  return join(home, '.config', APP_DIR_NAME)
}

export function configFilePath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  return join(appDataDir(env, platform), 'config.json')
}

export function logsDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  return join(appDataDir(env, platform), 'logs')
}

/**
 * Root for per-slot browser profiles.
 *
 * Outside the repository for the same reason as config and logs, only more so:
 * logs *might* contain a session token, whereas a profile *is* the logged-in
 * session — cookies for a real account. Keeping them here removes the risk at
 * the source rather than leaving .gitignore as the only thing between a stray
 * `git add -f` and a leaked account.
 */
export function profilesDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  return join(appDataDir(env, platform), 'profiles')
}

/**
 * Where Electron keeps its own state — cache, cookies and local storage for the
 * panel window itself.
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

export function electronUserDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  return join(appDataDir(env, platform), ELECTRON_DIR_NAME)
}

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
  return join(programData, APP_DIR_NAME, 'machine.json')
}
