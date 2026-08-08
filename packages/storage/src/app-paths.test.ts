import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import {
  ELECTRON_DIR_NAME,
  appDataDir,
  configFilePath,
  electronUserDataDir,
  logsDir,
  profilesDir,
} from './app-paths.js'

const WINDOWS_ENV = { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' }
const ROAMING = 'C:\\Users\\x\\AppData\\Roaming'

describe('appDataDir', () => {
  it('uses APPDATA on Windows', () => {
    expect(appDataDir(WINDOWS_ENV, 'win32')).toBe(join(ROAMING, 'hecaton'))
  })

  it('fails loudly when APPDATA is missing on Windows', () => {
    expect(() => appDataDir({}, 'win32')).toThrow(/APPDATA/)
  })

  it('falls back to XDG_CONFIG_HOME elsewhere, so CI on Linux works', () => {
    expect(appDataDir({ XDG_CONFIG_HOME: '/home/x/.config' }, 'linux')).toBe(
      join('/home/x/.config', 'hecaton'),
    )
  })

  it('falls back to HOME when XDG_CONFIG_HOME is unset', () => {
    expect(appDataDir({ HOME: '/home/x' }, 'linux')).toBe(join('/home/x', '.config', 'hecaton'))
  })

  it('fails loudly when nothing at all is set', () => {
    expect(() => appDataDir({}, 'linux')).toThrow(/HOME/)
  })
})

describe('paths derived from it', () => {
  it.each([
    ['config', configFilePath, 'config.json'],
    ['logs', logsDir, 'logs'],
    ['profiles', profilesDir, 'profiles'],
    ['electron state', electronUserDataDir, ELECTRON_DIR_NAME],
  ] as const)('puts %s under the app directory', (_name, resolve, leaf) => {
    expect(resolve(WINDOWS_ENV, 'win32')).toBe(join(appDataDir(WINDOWS_ENV, 'win32'), leaf))
  })

  it('names the electron directory, because the delete action has to tolerate it', () => {
    // Not a free-floating constant: `data:deleteAll` cannot remove this one - the
    // running process holds it open - so the name is what tells a survivor of the
    // deletion apart from a failure. main and the tolerance list must agree, and
    // they agree by both reading this.
    expect(ELECTRON_DIR_NAME).toBe('shell')
  })

  it('never resolves anywhere near the repository', () => {
    // Profiles are the logged-in sessions themselves. Keeping them out of the
    // working tree removes the risk at the source instead of leaving .gitignore
    // as the only thing between a stray `git add -f` and a leaked account.
    for (const resolve of [appDataDir, configFilePath, logsDir, profilesDir]) {
      const resolved = resolve(WINDOWS_ENV, 'win32')
      expect(resolved.startsWith(ROAMING)).toBe(true)
      expect(resolved).not.toMatch(/[/\\]packages[/\\]/)
      expect(resolved).not.toMatch(/[/\\]data[/\\]?$/)
    }
  })

  it('keeps profiles separate from config, so clearing one cannot touch the other', () => {
    expect(profilesDir(WINDOWS_ENV, 'win32')).not.toBe(configFilePath(WINDOWS_ENV, 'win32'))
    expect(profilesDir(WINDOWS_ENV, 'win32')).not.toBe(logsDir(WINDOWS_ENV, 'win32'))
  })
})
