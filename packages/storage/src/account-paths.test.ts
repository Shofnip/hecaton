import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import {
  accountConfigFilePath,
  accountDir,
  accountElectronUserDataDir,
  accountProfilesDir,
  accountsDir,
  legacyConfigFilePath,
  legacyProfilesDir,
} from './account-paths.js'

const env = { APPDATA: 'C:\\Users\\Alguem\\AppData\\Roaming' } as NodeJS.ProcessEnv
const root = join(env['APPDATA']!, 'hecaton')

describe('where an account keeps its things', () => {
  it('puts every account under one directory', () => {
    expect(accountsDir(env, 'win32')).toBe(join(root, 'accounts'))
  })

  it('gives each account a directory named after its id', () => {
    expect(accountDir(2, env, 'win32')).toBe(join(root, 'accounts', '2'))
  })

  it('gives each account its own config, so two windows never write one file', () => {
    // The whole concurrency story in one path. Two instances share the data
    // directory and nothing inside it that either of them writes.
    expect(accountConfigFilePath(1, env, 'win32')).toBe(join(root, 'accounts', '1', 'config.json'))
    expect(accountConfigFilePath(2, env, 'win32')).toBe(join(root, 'accounts', '2', 'config.json'))
  })

  it('gives each account its own profiles, which is what stops the collision', () => {
    expect(accountProfilesDir(3, env, 'win32')).toBe(join(root, 'accounts', '3', 'profiles'))
  })

  it('gives each account its own Electron cache, so two windows do not fight over one', () => {
    // The panel's own cache, not a game profile. Shared, it is where "unable to
    // move the cache: access denied" comes from - the error ADR-0004 moved the
    // app out of %APPDATA%/Electron to avoid, which several windows would
    // otherwise reintroduce against itself.
    expect(accountElectronUserDataDir(2, env, 'win32')).toBe(join(root, 'accounts', '2', 'shell'))
  })

  it('refuses an id that is not a positive integer', () => {
    // These strings are joined onto a path. The core's validator is what they go
    // through, and this is the test that says they still do.
    expect(() => accountDir(0, env, 'win32')).toThrow()
    expect(() => accountProfilesDir(-1, env, 'win32')).toThrow()
    expect(() => accountConfigFilePath(1.5, env, 'win32')).toThrow()
  })
})

describe('where the pre-accounts layout kept them', () => {
  it('names the old config and profile paths, for the migration to move', () => {
    // Kept as named functions rather than inlined into the migration: an audit
    // of "what does this app touch" reads this file, and a path this one moves
    // holds logged-in sessions.
    expect(legacyConfigFilePath(env, 'win32')).toBe(join(root, 'config.json'))
    expect(legacyProfilesDir(env, 'win32')).toBe(join(root, 'profiles'))
  })
})
