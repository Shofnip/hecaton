/**
 * The migration that moves logged-in sessions, against a real filesystem.
 *
 * Faking the disk here would test the fake, and this is the one piece of code in
 * the product that **moves a live profile directory** — the thing ADR-0005
 * protects and ADR-0012 said would never be written. It earns a real temp
 * directory, real renames, and a test for the half-finished case.
 *
 * Every run works inside its own throwaway `APPDATA`, so nothing here can reach
 * the owner's `%APPDATA%/hecaton`, and the paths are asserted to resolve inside
 * it before anything is written.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appDataDir } from './app-paths.js'
import { accountProfilesDir, accountsDir } from './account-paths.js'
import { listAccountIds, migrateLegacyLayout, stagingAccountsDir } from './account-layout.js'

let root: string
let env: NodeJS.ProcessEnv
let data: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hecaton-accounts-'))
  env = { APPDATA: root } as NodeJS.ProcessEnv
  data = appDataDir(env, 'win32')
  // The assertion CLAUDE.md asks for before anything destructive-ish runs: this
  // suite must be operating inside its own throwaway directory and nowhere else.
  expect(data.startsWith(root)).toBe(true)
  mkdirSync(data, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function writeLegacyLayout(): void {
  writeFileSync(join(data, 'config.json'), '{"schemaVersion":1,"maxSlots":4}')
  mkdirSync(join(data, 'profiles', 'slot-1', 'Default', 'Network'), { recursive: true })
  writeFileSync(join(data, 'profiles', 'slot-1', 'Default', 'Network', 'Cookies'), 'sqlite')
}

describe('migrateLegacyLayout', () => {
  it('moves the config and the profiles into account 1', () => {
    writeLegacyLayout()

    expect(migrateLegacyLayout(env, 'win32')).toBe('migrated')

    expect(readFileSync(join(accountsDir(env, 'win32'), '1', 'config.json'), 'utf8')).toContain(
      'schemaVersion',
    )
    expect(
      readFileSync(
        join(accountProfilesDir(1, env, 'win32'), 'slot-1', 'Default', 'Network', 'Cookies'),
        'utf8',
      ),
    ).toBe('sqlite')
  })

  it('leaves nothing at the old paths, so nothing reads them by accident', () => {
    writeLegacyLayout()

    migrateLegacyLayout(env, 'win32')

    expect(existsSync(join(data, 'config.json'))).toBe(false)
    expect(existsSync(join(data, 'profiles'))).toBe(false)
  })

  it('moves rather than copies, which is what makes it safe on a 400 MB profile', () => {
    // A copy would double the disk a logged-in profile takes and could half-fail
    // with no way to tell which half is authoritative. A rename on one volume is
    // atomic and instant.
    writeLegacyLayout()
    const before = readFileSync(
      join(data, 'profiles', 'slot-1', 'Default', 'Network', 'Cookies'),
      'utf8',
    )

    migrateLegacyLayout(env, 'win32')

    expect(before).toBe('sqlite')
    expect(existsSync(join(data, 'profiles'))).toBe(false)
  })

  it('does nothing the second time', () => {
    writeLegacyLayout()
    migrateLegacyLayout(env, 'win32')

    expect(migrateLegacyLayout(env, 'win32')).toBe('nothing-to-do')
  })

  it('does nothing on a fresh install, and creates no directory either', () => {
    expect(migrateLegacyLayout(env, 'win32')).toBe('nothing-to-do')
    expect(existsSync(accountsDir(env, 'win32'))).toBe(false)
  })

  it('finishes a migration that was interrupted before the last step', () => {
    // The staging directory is the crash-safety design: everything is moved into
    // it, and one rename flips the whole layout. A process killed in between
    // leaves the staging directory holding the only copy of the profiles, so the
    // next launch has to adopt it rather than treat the data as gone.
    const staging = stagingAccountsDir(env, 'win32')
    mkdirSync(join(staging, '1', 'profiles', 'slot-1'), { recursive: true })
    writeFileSync(join(staging, '1', 'profiles', 'slot-1', 'marker'), 'a real session')

    expect(migrateLegacyLayout(env, 'win32')).toBe('resumed')

    expect(
      readFileSync(join(accountProfilesDir(1, env, 'win32'), 'slot-1', 'marker'), 'utf8'),
    ).toBe('a real session')
    expect(existsSync(staging)).toBe(false)
  })

  it('leaves a half-finished staging directory alone once accounts exist', () => {
    // Both present means a migration ran and something later recreated staging.
    // Adopting it would overwrite live accounts, so the rule is to touch neither.
    mkdirSync(join(accountsDir(env, 'win32'), '1'), { recursive: true })
    const staging = stagingAccountsDir(env, 'win32')
    mkdirSync(join(staging, '1'), { recursive: true })

    expect(migrateLegacyLayout(env, 'win32')).toBe('nothing-to-do')
    expect(existsSync(staging)).toBe(true)
  })

  it('touches nothing else in the data directory', () => {
    // Logs and the Electron cache are not the migration's business, and a friend
    // may have dropped a file in there: the panel offers a button that opens it.
    writeLegacyLayout()
    mkdirSync(join(data, 'logs'), { recursive: true })
    writeFileSync(join(data, 'logs', 'app-2026-09-18.log'), 'line')
    mkdirSync(join(data, 'shell'), { recursive: true })
    writeFileSync(join(data, 'notes-from-a-friend.txt'), 'keep me')

    migrateLegacyLayout(env, 'win32')

    expect(readFileSync(join(data, 'logs', 'app-2026-09-18.log'), 'utf8')).toBe('line')
    expect(existsSync(join(data, 'shell'))).toBe(true)
    expect(readFileSync(join(data, 'notes-from-a-friend.txt'), 'utf8')).toBe('keep me')
  })
})

describe('listAccountIds', () => {
  it('finds nothing before any account exists', () => {
    expect(listAccountIds(env, 'win32')).toEqual([])
  })

  it('lists the accounts on disk, in order', () => {
    for (const id of ['2', '10', '1'])
      mkdirSync(join(accountsDir(env, 'win32'), id), { recursive: true })

    expect(listAccountIds(env, 'win32')).toEqual([1, 2, 10])
  })

  it('ignores anything that is not an account directory', () => {
    // Discovery is a directory listing, so it meets whatever is in there: a
    // stray file, a folder somebody made by hand, the staging directory of an
    // interrupted migration.
    mkdirSync(join(accountsDir(env, 'win32'), '1'), { recursive: true })
    mkdirSync(join(accountsDir(env, 'win32'), 'rascunho'), { recursive: true })
    mkdirSync(join(accountsDir(env, 'win32'), '01'), { recursive: true })
    writeFileSync(join(accountsDir(env, 'win32'), '2'), 'a file, not a directory')

    expect(listAccountIds(env, 'win32')).toEqual([1])
  })
})
