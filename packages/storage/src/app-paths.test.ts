import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import {
  DEV_APP_DIR_NAME,
  ELECTRON_DIR_NAME,
  appDataDir,
  appDirName,
  logsDir,
  accountMutexPrefix,
  machineSealPath,
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
  it('puts the logs under the app directory', () => {
    expect(logsDir(WINDOWS_ENV, 'win32')).toBe(join(appDataDir(WINDOWS_ENV, 'win32'), 'logs'))
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
    for (const resolve of [appDataDir, logsDir]) {
      const resolved = resolve(WINDOWS_ENV, 'win32')
      expect(resolved.startsWith(ROAMING)).toBe(true)
      expect(resolved).not.toMatch(/[/\\]packages[/\\]/)
      expect(resolved).not.toMatch(/[/\\]data[/\\]?$/)
    }
  })
})

describe('machineSealPath', () => {
  it('puts the seal under ProgramData, machine-wide by design', () => {
    // The one file this app writes outside its own data directory. It has to be
    // shared by every account on the machine - that is what makes it a machine
    // seal rather than a per-user note - and ProgramData is the location Windows
    // gives that meaning to. ADR-0018.
    expect(machineSealPath({ PROGRAMDATA: 'C:\\ProgramData' }, 'win32')).toBe(
      join('C:\\ProgramData', 'hecaton', 'machine.json'),
    )
  })

  it('fails loudly when ProgramData is missing', () => {
    // Never a silent fallback to somewhere writable. A seal in the wrong place
    // is not a degraded seal, it is a different machine on every launch.
    expect(() => machineSealPath({}, 'win32')).toThrow(/PROGRAMDATA/)
  })

  it('refuses to invent a location off Windows', () => {
    // The other paths fall back so the suite runs on Linux CI. This one must
    // not: a machine-wide file is a Windows concept here, and guessing a POSIX
    // equivalent would drop a shared file somewhere nobody has audited.
    expect(() => machineSealPath({ HOME: '/home/x' }, 'linux')).toThrow(/Windows/)
  })
})

describe('appDirName', () => {
  it('is hecaton when nothing says otherwise', () => {
    // The production answer, and the one a packaged app always gets: there is no
    // `app.isPackaged` branch anywhere, so the path that ships is the path that
    // is tested (ADR-0022).
    expect(appDirName({})).toBe('hecaton')
  })

  it('takes the development directory from the environment', () => {
    // What `npm start` sets, so a development run has its own profiles, its own
    // config and its own account locks - and can be open beside the real app.
    expect(appDirName({ HECATON_APP_DIR: DEV_APP_DIR_NAME })).toBe('hecaton-dev')
  })

  it.each(['..', 'a/b', 'a\b', 'C:', 'name with spaces', '', '.hidden', 'x'.repeat(33)])(
    'refuses %j and uses the production name',
    (value) => {
      // This string becomes a directory under %APPDATA% and part of a mutex
      // name. Anything that could climb out of there, or name a different
      // machine-wide object, is ignored rather than sanitised - an env var is
      // not a place to accept a path.
      expect(appDirName({ HECATON_APP_DIR: value })).toBe('hecaton')
    },
  )

  it('is what every path is built from', () => {
    const env = { APPDATA: ROAMING, HECATON_APP_DIR: DEV_APP_DIR_NAME }
    expect(appDataDir(env, 'win32')).toBe(join(ROAMING, 'hecaton-dev'))
    expect(logsDir(env, 'win32')).toBe(join(ROAMING, 'hecaton-dev', 'logs'))
  })

  it('names the machine seal too, so a development run cannot touch the real one', () => {
    const env = { PROGRAMDATA: 'C:\\ProgramData', HECATON_APP_DIR: DEV_APP_DIR_NAME }
    expect(machineSealPath(env, 'win32')).toBe(
      join('C:\\ProgramData', 'hecaton-dev', 'machine.json'),
    )
  })
})

describe('accountMutexPrefix', () => {
  it('carries the directory name, so dev and production never share a lock', () => {
    // Without this a development window would claim the account the real app is
    // running - different profiles, same lock - and the two would push each
    // other onto other accounts for no reason.
    expect(accountMutexPrefix({})).toBe('Hecaton.hecaton.Account')
    expect(accountMutexPrefix({ HECATON_APP_DIR: DEV_APP_DIR_NAME })).toBe(
      'Hecaton.hecaton-dev.Account',
    )
  })
})
