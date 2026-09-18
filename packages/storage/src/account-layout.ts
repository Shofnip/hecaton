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
import { needsLegacyMigration, type LegacyLayout } from '@hecaton/core'
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

/**
 * What a migration attempt did, for the caller to log.
 *
 * `unfinished` is the one that matters: another launch adopted the staging
 * directory while this one was filling it, so `accounts/` exists but the legacy
 * paths were never emptied. Reporting it as done would strand the user's
 * sessions for ever - `accounts/` existing is what says the migration happened.
 */
export type MigrationOutcome = 'migrated' | 'resumed' | 'nothing-to-do' | 'unfinished'

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
  const legacyConfig = legacyConfigFilePath(env, platform)
  const legacyProfiles = legacyProfilesDir(env, platform)
  const legacy = (): LegacyLayout => ({
    hasAccountsDir: existsSync(accounts),
    hasLegacyConfig: existsSync(legacyConfig),
    hasLegacyProfiles: existsSync(legacyProfiles),
  })

  if (existsSync(accounts)) {
    // The layout is already the new one - unless a launch that raced this one
    // adopted the staging directory before it could move anything. Then the
    // legacy paths are still full, and saying "nothing to do" is what would
    // strand them.
    return moveLegacyInto(join(accounts, '1'), legacyConfig, legacyProfiles)
      ? 'unfinished'
      : 'nothing-to-do'
  }

  // Adopted rather than rebuilt: at this point the staging directory holds the
  // only copy of whatever was moved into it. Adoption then **finishes the job**,
  // because a crash between the two renames leaves one of them undone and the
  // promoted directory would otherwise look complete.
  if (existsSync(staging)) {
    renameSync(staging, accounts)
    moveLegacyInto(join(accounts, '1'), legacyConfig, legacyProfiles)
    return 'resumed'
  }

  if (!needsLegacyMigration(legacy())) return 'nothing-to-do'

  const destination = join(staging, '1')
  mkdirSync(destination, { recursive: true })
  moveLegacyInto(destination, legacyConfig, legacyProfiles)
  // Racing launches both reach here; the loser finds `accounts/` already there
  // and its own staging gone, which `renameSync` reports rather than hides.
  renameSync(staging, accounts)
  return 'migrated'
}

/**
 * Moves whichever legacy paths are still there into an account directory.
 *
 * Profiles first, config second. Neither order is safe against every crash, and
 * this one is safe against the crash that matters: the config is small and
 * rewritten from defaults if it is lost, while the profiles are the logged-in
 * sessions.
 *
 * Returns whether anything moved, which is how the caller tells "already done"
 * from "another launch adopted my staging directory and I still have work".
 */
function moveLegacyInto(
  destination: string,
  legacyConfig: string,
  legacyProfiles: string,
): boolean {
  let moved = false
  if (existsSync(legacyProfiles) && !existsSync(join(destination, 'profiles'))) {
    mkdirSync(destination, { recursive: true })
    renameSync(legacyProfiles, join(destination, 'profiles'))
    moved = true
  }
  if (existsSync(legacyConfig) && !existsSync(join(destination, 'config.json'))) {
    mkdirSync(destination, { recursive: true })
    renameSync(legacyConfig, join(destination, 'config.json'))
    moved = true
  }
  return moved
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
