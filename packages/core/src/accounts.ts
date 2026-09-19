/**
 * Accounts: several Hecatons on one machine, each with its own screens.
 *
 * Until 2026-09-18 the app allowed exactly one instance per machine
 * ([ADR-0018](../../../docs/adr/0018-one-instance-per-machine.md)), and the
 * owner reversed that: a person may run as many windows as they like. What they
 * must never do is run two windows over the **same profiles** — two browsers
 * with one `--user-data-dir` corrupt each other's session, which is the thing
 * the old lock protected by accident rather than by design.
 *
 * So an **account** is the unit of isolation: a name, its own `config.json`, its
 * own profile directory, and at most four screens. The lock did not disappear —
 * it went from one-per-machine to one-per-account, which is the narrowest form
 * that still stops two windows sharing a session.
 *
 * **There is deliberately no shared index file.** Accounts are discovered by
 * listing directories, and each account's name lives in its own config, so two
 * running windows never write the same file. An `accounts.json` would have been
 * the obvious design and would have put a read-modify-write race in the one
 * place a lost write costs a user their account list.
 */

/** The cap on an account's display name, shared by the parser and the UI. */
export const MAX_ACCOUNT_NAME_LENGTH = 24

/**
 * How many unused ids `claimFreeAccount` will try before giving up.
 *
 * A bound rather than a loop, because the failure it guards is not "the ids ran
 * out" but "every claim fails for a reason that is not contention" — a broken
 * lock worker answering the same way forever. Twenty windows racing to create an
 * account at the same instant is not a case worth staying correct past.
 */
export const ACCOUNT_CLAIM_ATTEMPTS = 20

/** A named workspace. The name is UI text, so Portuguese by default. */
export interface Account {
  id: number
  name: string
}

/**
 * The directory an account's config and profiles live in, under `accounts/`.
 *
 * The id itself, and validated hard: this string is joined onto a filesystem
 * path, so anything that could carry a separator, a dot or a sign is refused
 * here rather than sanitised further down.
 */
export function accountDirName(id: number): string {
  return String(requirePositiveInteger(id, 'account id'))
}

/**
 * What a new account is called before anybody renames it. UI text.
 *
 * **"Perfil" in the interface, `account` in the code**, decided by the owner on
 * 2026-09-18: what the UI calls a perfil is this workspace, and what the UI used
 * to call a perfil - a screen's browser profile - it now calls a tela. The code
 * keeps `account` because renaming it to `profile` would collide with the
 * browser profiles it is full of, which is the confusion the UI change fixes.
 */
export function defaultAccountName(id: number): string {
  return `Perfil ${requirePositiveInteger(id, 'account id')}`
}

/**
 * The id a new account gets: past the highest, never into a gap.
 *
 * Filling a gap is the tempting version and is wrong. A missing id means an
 * account was removed, and its profile directory can still be on disk — handing
 * that number to a new account would hand it somebody else's logged-in sessions.
 */
export function nextAccountId(existing: readonly number[]): number {
  return existing.reduce((highest, id) => Math.max(highest, id), 0) + 1
}

/** The id of an account, as it arrives from the renderer: `unknown` until checked. */
export function parseAccountId(input: unknown): number {
  return requirePositiveInteger(input, 'account id')
}

/**
 * An account's display name, as the renderer sends it.
 *
 * Trimmed, capped, and stripped of control characters — the same treatment a
 * screen's name gets, for the same reason: it is rendered as text and written
 * into a JSON file, and a newline in it makes the dropdown lie about its height.
 */
export function parseAccountName(input: unknown): string {
  if (typeof input !== 'string') {
    throw new Error(`account name must be a string, got ${JSON.stringify(input)}`)
  }
  // Spelled out rather than written as a regex character class: the class needs
  // escapes, and an escape that survives one editor and not the next is how a
  // literal control character ends up committed in the source.
  const flattened = [...input]
    .map((character) => (isControl(character) ? ' ' : character))
    .join('')
    .trim()
  if (flattened === '') throw new Error('account name must not be blank')
  if (flattened.length > MAX_ACCOUNT_NAME_LENGTH) {
    throw new Error(`account name must be at most ${MAX_ACCOUNT_NAME_LENGTH} characters`)
  }
  return flattened
}

/**
 * Takes the first account nobody else is running, creating one when they are all
 * taken.
 *
 * This is the rule a second window follows: open on account 2, and if there is
 * no account 2, make one. Ids are walked **in order** so the same window lands
 * on the same account every time — a person's screens must not shuffle between
 * accounts because two windows started in a different sequence.
 *
 * The claim is what decides, never a file: `tryClaim` takes the account's lock
 * and answers whether it was free. Reading "is it in use" and then acting on the
 * answer would leave a window between the two in which another instance claims
 * the same account, which is precisely the collision this exists to prevent.
 *
 * Past the existing ids it keeps going rather than failing, because a fresh id
 * can be taken too: two windows starting together both see one account and both
 * reach for id 2. One wins, and the other must land on 3.
 */
export async function claimFreeAccount(
  existing: readonly number[],
  tryClaim: (id: number) => Promise<boolean>,
): Promise<{ id: number; created: boolean }> {
  const free = await claimExistingAccount(existing, tryClaim)
  if (free !== undefined) return { id: free, created: false }

  let candidate = nextAccountId(existing)
  for (let attempt = 0; attempt < ACCOUNT_CLAIM_ATTEMPTS; attempt++) {
    if (await tryClaim(candidate)) return { id: candidate, created: true }
    candidate++
  }

  throw new Error(
    `no account could be claimed after ${ACCOUNT_CLAIM_ATTEMPTS} attempts past id ${nextAccountId(existing)}`,
  )
}

/**
 * Takes the first account nobody else is running, and never creates one.
 *
 * The half of `claimFreeAccount` that only looks at what exists, because one
 * caller must not have the other half: a window whose account has just been
 * deleted needs somewhere to go, and "nowhere" is a real answer there. Creating
 * an empty account to land in would answer a question the user did not ask -
 * they asked to remove a profile, not to be handed a blank one - so the deletion
 * is refused instead, and the panel points at clearing the cache, which is what
 * "I want this profile emptied" actually means.
 *
 * `undefined` therefore covers two cases the caller treats alike: there are no
 * other accounts, and every other account is open in another window.
 */
export async function claimExistingAccount(
  existing: readonly number[],
  tryClaim: (id: number) => Promise<boolean>,
): Promise<number | undefined> {
  for (const id of [...existing].sort((a, b) => a - b)) {
    if (await tryClaim(id)) return id
  }
  return undefined
}

/** What the data directory looks like, as far as the migration is concerned. */
export interface LegacyLayout {
  /** Whether `accounts/` exists — the record that the move already happened. */
  hasAccountsDir: boolean
  /** Whether `config.json` sits directly in the data directory. */
  hasLegacyConfig: boolean
  /** Whether `profiles/` sits directly in the data directory. */
  hasLegacyProfiles: boolean
}

/**
 * Whether the pre-accounts layout has to be moved into account 1.
 *
 * `accounts/` existing is the whole record that it has been done. Nothing is
 * written to say so, and nothing needs to be: the second run finds the
 * directory and answers no.
 *
 * Either half alone is enough to migrate. Somebody who never started a screen
 * has a config and no profiles; a config that failed to save leaves the
 * opposite.
 */
export function needsLegacyMigration(layout: LegacyLayout): boolean {
  if (layout.hasAccountsDir) return false
  return layout.hasLegacyConfig || layout.hasLegacyProfiles
}

function requirePositiveInteger(value: unknown, what: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`${what} must be a positive integer, got ${JSON.stringify(value)}`)
  }
  return value as number
}

/** A character no name may carry: it would break the line the name is rendered on. */
function isControl(character: string): boolean {
  const code = character.codePointAt(0) ?? 0
  return code < 32 || code === 127
}

/**
 * Which of the panel cache directories left on disk may be removed.
 *
 * Each launch writes its own (named by pid, see `panelCacheDir` in storage), and
 * a launch that is killed leaves it behind. The rule is the narrowest one that
 * cleans up: a directory whose name is a pid, that is not this process, and that
 * no live process answers to.
 *
 * The liveness answer comes from the caller - the core may not ask the operating
 * system anything - and a caller that cannot tell must say `true`, because the
 * cost of keeping a stale directory is a few megabytes and the cost of removing
 * a live one is another window losing its cache mid-session.
 */
export function stalePanelCaches(
  names: readonly string[],
  ownPid: number,
  isAlive: (pid: number) => boolean,
): string[] {
  return names.filter((name) => {
    const pid = Number(name)
    if (!Number.isInteger(pid) || pid < 1 || String(pid) !== name) return false
    if (pid === ownPid) return false
    return !isAlive(pid)
  })
}
