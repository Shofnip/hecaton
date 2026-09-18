/**
 * Finding the accounts on disk, and moving a pre-accounts data directory into
 * one.
 *
 * Two jobs that belong together because both are about the shape of
 * `%APPDATA%/hecaton` rather than about any account's contents.
 *
 * **Discovery is a directory listing**, deliberately, and not an index file:
 * several windows run at once now (ADR-0021), and an index would be a file they
 * all write. What a listing costs is that it meets whatever is in the directory,
 * so anything that is not a plain decimal id is ignored rather than trusted.
 *
 * **The migration moves logged-in sessions**, which is the most consequential
 * thing this product does to a user's disk and the reason it is written the way
 * it is:
 *
 * - it only ever **renames**; nothing is copied, nothing is deleted, and a
 *   400 MB profile moves in a few milliseconds on one volume;
 * - everything lands in a **staging directory** first, and a single rename of
 *   that directory is what makes the new layout real, so a process killed part
 *   way leaves either the old layout or the staging directory — never a half
 *   layout that looks complete;
 * - a staging directory found on the next launch is **adopted**, because after
 *   the first move it holds the only copy of the profiles.
 *
 * ADR-0012 said there would be no migration code, ever. That held while nothing
 * had shipped; two releases later the owner chose the symmetric layout knowing
 * the cost, and ADR-0021 records the reversal.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { needsLegacyMigration } from '@hecaton/core'
import { appDataDir } from './app-paths.js'
import { accountsDir, legacyConfigFilePath, legacyProfilesDir } from './account-paths.js'

/**
 * Where the new layout is assembled before it becomes real.
 *
 * Beside `accounts/` rather than inside it, so the one rename that finishes the
 * job is a rename between siblings on the same volume — the only kind that is
 * atomic.
 */
export function stagingAccountsDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  return join(appDataDir(env, platform), 'accounts.incoming')
}

/** What a migration attempt did, for the caller to log. */
export type MigrationOutcome = 'migrated' | 'resumed' | 'nothing-to-do'

/**
 * Moves a pre-accounts data directory into account 1, or finishes a move that
 * was interrupted.
 *
 * Synchronous on purpose: it runs before the panel exists and before any
 * browser, and the one thing worse than a slow launch here would be a second
 * window starting while the directory is half moved.
 */
export function migrateLegacyLayout(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): MigrationOutcome {
  const accounts = accountsDir(env, platform)
  const staging = stagingAccountsDir(env, platform)

  if (existsSync(accounts)) return 'nothing-to-do'

  // Adopted rather than rebuilt: at this point the staging directory holds the
  // only copy of whatever was moved into it.
  if (existsSync(staging)) {
    renameSync(staging, accounts)
    return 'resumed'
  }

  const legacyConfig = legacyConfigFilePath(env, platform)
  const legacyProfiles = legacyProfilesDir(env, platform)
  const layout = {
    hasAccountsDir: false,
    hasLegacyConfig: existsSync(legacyConfig),
    hasLegacyProfiles: existsSync(legacyProfiles),
  }
  if (!needsLegacyMigration(layout)) return 'nothing-to-do'

  const destination = join(staging, '1')
  mkdirSync(destination, { recursive: true })
  // Profiles first, config second. Neither order is safe against every crash,
  // and this one is safe against the crash that matters: the config is small
  // and rewritten from defaults if it is lost, while the profiles are the
  // logged-in sessions, so they spend the least possible time being the only
  // thing in a directory nobody has adopted yet.
  if (layout.hasLegacyProfiles) renameSync(legacyProfiles, join(destination, 'profiles'))
  if (layout.hasLegacyConfig) renameSync(legacyConfig, join(destination, 'config.json'))
  renameSync(staging, accounts)
  return 'migrated'
}

/**
 * The ids of the accounts that exist, ascending.
 *
 * Only plain decimal names count, and `01` is not one: a directory whose name is
 * not exactly the id it parses to would give an account two spellings, and the
 * lock is named from the id.
 */
export function listAccountIds(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): number[] {
  const root = accountsDir(env, platform)
  if (!existsSync(root)) return []
  return readdirSync(root)
    .filter((name) => {
      const id = Number(name)
      if (!Number.isInteger(id) || id < 1 || String(id) !== name) return false
      return statSync(join(root, name)).isDirectory()
    })
    .map(Number)
    .sort((a, b) => a - b)
}
