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
 * no game session: the panel loads from `file://` and makes no network request.
 */
export const ELECTRON_DIR_NAME = 'shell'

export function electronUserDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  return join(appDataDir(env, platform), ELECTRON_DIR_NAME)
}
