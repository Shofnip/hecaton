import { describe, expect, it, vi } from 'vitest'
import {
  ACCOUNT_CLAIM_ATTEMPTS,
  MAX_ACCOUNT_NAME_LENGTH,
  accountDirName,
  claimFreeAccount,
  defaultAccountName,
  needsLegacyMigration,
  nextAccountId,
  parseAccountId,
  parseAccountName,
} from './accounts.js'

describe('accountDirName', () => {
  it('is the id, so the directory and the lock cannot disagree', () => {
    expect(accountDirName(1)).toBe('1')
    expect(accountDirName(12)).toBe('12')
  })

  it('refuses anything that is not a positive integer', () => {
    // The name goes straight into a filesystem path. Nothing that could contain
    // a separator, a dot or a minus sign ever reaches it.
    expect(() => accountDirName(0)).toThrow()
    expect(() => accountDirName(-1)).toThrow()
    expect(() => accountDirName(1.5)).toThrow()
  })
})

describe('defaultAccountName', () => {
  it('names an account after its number, in the app language', () => {
    // UI text, so Portuguese - the same rule the game registry's `name` follows.
    expect(defaultAccountName(1)).toBe('Conta 1')
    expect(defaultAccountName(3)).toBe('Conta 3')
  })
})

describe('nextAccountId', () => {
  it('starts at one', () => {
    expect(nextAccountId([])).toBe(1)
  })

  it('goes past the highest, never filling a gap', () => {
    // A gap means an account was deleted, and its profile directory may still be
    // on disk. Reusing the number would hand somebody else's logged-in sessions
    // to a brand new account.
    expect(nextAccountId([1, 3])).toBe(4)
    expect(nextAccountId([2])).toBe(3)
  })
})

describe('parseAccountName', () => {
  it('accepts a name and trims it', () => {
    expect(parseAccountName('  Principal  ')).toBe('Principal')
  })

  it('refuses a blank name', () => {
    // An account with no name is one the dropdown cannot show.
    expect(() => parseAccountName('   ')).toThrow()
  })

  it('refuses anything that is not a string', () => {
    expect(() => parseAccountName(42)).toThrow()
    expect(() => parseAccountName(undefined)).toThrow()
  })

  it('refuses a name longer than the cap', () => {
    expect(() => parseAccountName('x'.repeat(MAX_ACCOUNT_NAME_LENGTH + 1))).toThrow()
    expect(parseAccountName('x'.repeat(MAX_ACCOUNT_NAME_LENGTH))).toHaveLength(
      MAX_ACCOUNT_NAME_LENGTH,
    )
  })

  it('strips control characters rather than storing them', () => {
    // The name is rendered as text and written into a JSON file; a newline in it
    // would break neither, and would make the dropdown lie about its own height.
    expect(parseAccountName('Conta\nnova')).toBe('Conta nova')
  })
})

describe('parseAccountId', () => {
  it('accepts a positive integer', () => {
    expect(parseAccountId(2)).toBe(2)
  })

  it('refuses everything else, because this one picks a directory', () => {
    expect(() => parseAccountId(0)).toThrow()
    expect(() => parseAccountId('1')).toThrow()
    expect(() => parseAccountId(1.5)).toThrow()
  })
})

describe('claimFreeAccount', () => {
  it('takes the only account there is', async () => {
    const tryClaim = vi.fn().mockResolvedValue(true)

    await expect(claimFreeAccount([1], tryClaim)).resolves.toEqual({ id: 1, created: false })
    expect(tryClaim).toHaveBeenCalledWith(1)
  })

  it('creates the first account when there are none', async () => {
    const tryClaim = vi.fn().mockResolvedValue(true)

    await expect(claimFreeAccount([], tryClaim)).resolves.toEqual({ id: 1, created: true })
  })

  it('moves to the second account when the first is in use', async () => {
    // The whole point of the feature: a second window opens on the next account
    // rather than fighting the first one for its profiles.
    const tryClaim = vi.fn(async (id: number) => id !== 1)

    await expect(claimFreeAccount([1, 2], tryClaim)).resolves.toEqual({ id: 2, created: false })
  })

  it('walks the ids in order, whatever order it was handed', async () => {
    const seen: number[] = []
    const tryClaim = vi.fn(async (id: number) => {
      seen.push(id)
      return id === 3
    })

    await expect(claimFreeAccount([3, 1, 2], tryClaim)).resolves.toEqual({ id: 3, created: false })
    expect(seen).toEqual([1, 2, 3])
  })

  it('creates a new account when every existing one is busy', async () => {
    const tryClaim = vi.fn(async (id: number) => id > 2)

    await expect(claimFreeAccount([1, 2], tryClaim)).resolves.toEqual({ id: 3, created: true })
  })

  it('keeps going when another window created the same id first', async () => {
    // Two instances starting together both see one account and both go for id 2.
    // One wins; the other must land on 3 rather than fail or share.
    const tryClaim = vi.fn(async (id: number) => id === 3)

    await expect(claimFreeAccount([1], tryClaim)).resolves.toEqual({ id: 3, created: true })
  })

  it('gives up rather than spinning forever', async () => {
    const tryClaim = vi.fn().mockResolvedValue(false)

    await expect(claimFreeAccount([1], tryClaim)).rejects.toThrow(/no account could be claimed/i)
    expect(tryClaim.mock.calls.length).toBeLessThanOrEqual(1 + ACCOUNT_CLAIM_ATTEMPTS)
  })
})

describe('needsLegacyMigration', () => {
  it('migrates a data directory written before accounts existed', () => {
    expect(
      needsLegacyMigration({
        hasAccountsDir: false,
        hasLegacyConfig: true,
        hasLegacyProfiles: true,
      }),
    ).toBe(true)
  })

  it('migrates a config with no profiles yet, and profiles with no config', () => {
    // Both halves are optional: somebody who never started a screen has a config
    // and no profiles, and a config that failed to save leaves the opposite.
    expect(
      needsLegacyMigration({
        hasAccountsDir: false,
        hasLegacyConfig: true,
        hasLegacyProfiles: false,
      }),
    ).toBe(true)
    expect(
      needsLegacyMigration({
        hasAccountsDir: false,
        hasLegacyConfig: false,
        hasLegacyProfiles: true,
      }),
    ).toBe(true)
  })

  it('does nothing on a fresh install', () => {
    expect(
      needsLegacyMigration({
        hasAccountsDir: false,
        hasLegacyConfig: false,
        hasLegacyProfiles: false,
      }),
    ).toBe(false)
  })

  it('never runs twice', () => {
    // `accounts/` existing is the whole record that the move already happened.
    // Running again could only move a file into a directory that already has one.
    expect(
      needsLegacyMigration({
        hasAccountsDir: true,
        hasLegacyConfig: true,
        hasLegacyProfiles: true,
      }),
    ).toBe(false)
  })
})
