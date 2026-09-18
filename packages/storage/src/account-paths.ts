/**
 * Where an account keeps its config and its profiles.
 *
 * One directory per account, and **nothing inside the data directory that two
 * running windows both write**. That is the whole design: the app allows several
 * instances now (ADR-0021), and the thing they must never share is a browser
 * profile — two Chromes on one `--user-data-dir` damage each other's session.
 * Config goes the same way for the same reason: `JsonFileStorage` writes through
 * a `<file>.tmp` beside the target, so two processes writing one config would
 * also be writing one temporary file.
 *
 * The pre-accounts paths stay here, named, because the migration has to move
 * them and because an audit of "what does this app touch" reads this file.
 */
import { join } from 'node:path'
import { accountDirName } from '@hecaton/core'
import { ELECTRON_DIR_NAME, appDataDir } from './app-paths.js'

/**
 * The directory every account lives under.
 *
 * Exported as a name because the "delete everything" action has to judge what
 * survived under `%APPDATA%/hecaton`, and with the account layout the survivor
 * is this directory - a string main would otherwise have written out by hand
 * next to a `rmSync`.
 */
export const ACCOUNTS_DIR_NAME = 'accounts'

/** The parent of every account directory. Its existence is also the migration's record. */
export function accountsDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  return join(appDataDir(env, platform), ACCOUNTS_DIR_NAME)
}

/**
 * One account's directory.
 *
 * The id is validated by `accountDirName` in the core rather than here: it is
 * the same rule the lock name uses, and a path and a lock that disagreed about
 * which account they mean is the one bug this whole feature cannot survive.
 */
export function accountDir(
  id: number,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  return join(accountsDir(env, platform), accountDirName(id))
}

/** An account's own config file. Written only by the window that holds its lock. */
export function accountConfigFilePath(
  id: number,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  return join(accountDir(id, env, platform), 'config.json')
}

/** An account's own profile root: `slot-N` and the `slot-N.old-…` archives. */
export function accountProfilesDir(
  id: number,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  return join(accountDir(id, env, platform), 'profiles')
}

/** Where config.json lived before accounts existed. Only the migration reads it. */
export function legacyConfigFilePath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  return join(appDataDir(env, platform), 'config.json')
}

/** Where the profiles lived before accounts existed. Only the migration reads it. */
export function legacyProfilesDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  return join(appDataDir(env, platform), 'profiles')
}

/**
 * Electron's own cache and storage for **this process**.
 *
 * Per process, not per account, and that was a correction rather than the first
 * idea. Per account looks right and breaks the moment a window switches
 * accounts: `app.setPath('userData', …)` can only be set before Electron
 * resolves its session, so after a switch the window keeps the directory of the
 * account it *started* on. Two consequences followed, both found in review -
 * another window claiming that account would collide on the same cache, which
 * is the "unable to move the cache" failure ADR-0004 exists to avoid, and the
 * wide delete would report failure over a directory the deleting window itself
 * was holding open.
 *
 * A pid is known before `ready` and never shared, so it answers both. What it
 * costs is a directory per launch, which `stalePanelCaches` clears.
 *
 * It holds no game session: the panel is a `file://` page under
 * `connect-src 'none'`, and the games run in a browser this directory knows
 * nothing about.
 */
export function panelCacheDir(
  pid: number,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (!Number.isInteger(pid) || pid < 1) {
    throw new Error(`pid must be a positive integer, got ${JSON.stringify(pid)}`)
  }
  return join(appDataDir(env, platform), ELECTRON_DIR_NAME, String(pid))
}

/** The parent of every launch's cache directory. */
export function panelCachesDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  return join(appDataDir(env, platform), ELECTRON_DIR_NAME)
}
