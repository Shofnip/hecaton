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
import { appDataDir } from './app-paths.js'

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
 * Electron's own cache and storage for the window that owns this account.
 *
 * Per account rather than one shared directory, and for the same reason the
 * profiles are: two Electron processes pointed at one `userData` fight over the
 * same Chromium cache - which is where "unable to move the cache: access
 * denied" came from when the app shared `%APPDATA%/Electron` with every other
 * Electron app (ADR-0004). Allowing several windows (ADR-0021) brings that back
 * unless each has its own.
 *
 * It holds no game session: the panel is a `file://` page under
 * `connect-src 'none'`, and the games run in a browser this directory knows
 * nothing about.
 */
export function accountElectronUserDataDir(
  id: number,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  return join(accountDir(id, env, platform), 'shell')
}
