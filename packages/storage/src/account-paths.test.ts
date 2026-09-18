import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import {
  accountConfigFilePath,
  accountDir,
  accountProfilesDir,
  accountsDir,
  legacyConfigFilePath,
  legacyProfilesDir,
  panelCacheDir,
  panelCachesDir,
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

  it('gives each launch its own Electron cache, so two windows do not fight over one', () => {
    // Per process rather than per account, and that distinction was earned: a
    // window that switches accounts keeps the cache it started with, because
    // setPath('userData', ...) cannot be moved once Electron resolved its session.
    // Keyed by pid, nothing collides and no window is left holding a directory
    // another one will want.
    expect(panelCacheDir(4242, env, 'win32')).toBe(join(root, 'shell', '4242'))
    expect(panelCachesDir(env, 'win32')).toBe(join(root, 'shell'))
  })

  it('refuses a pid that is not a positive integer', () => {
    expect(() => panelCacheDir(0, env, 'win32')).toThrow()
    expect(() => panelCacheDir(-3, env, 'win32')).toThrow()
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
