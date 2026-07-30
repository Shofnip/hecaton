import { describe, expect, it } from 'vitest'
import {
  DELETE_USER_DATA_FLAG,
  planUserDataDeletion,
  requestsUserDataDeletion,
} from './user-data.js'

const APP_DATA = { path: 'C:\\Users\\x\\AppData\\Roaming\\hecaton', leaf: 'hecaton' }
const UPDATER = { path: 'C:\\Users\\x\\AppData\\Local\\hecaton-updater', leaf: 'hecaton-updater' }

describe('planUserDataDeletion', () => {
  it('returns the declared targets when every one of them checks out', () => {
    expect(planUserDataDeletion([APP_DATA, UPDATER])).toEqual([APP_DATA.path, UPDATER.path])
  })

  it('accepts posix separators, so the suite can run on CI', () => {
    const posix = { path: '/home/x/.config/hecaton', leaf: 'hecaton' }
    expect(planUserDataDeletion([posix])).toEqual([posix.path])
  })

  it('refuses a path whose last segment is not the leaf the caller declared', () => {
    // The bug this exists for: handing it %APPDATA% instead of %APPDATA%/hecaton
    // would delete every application's roaming data, not this app's. The caller
    // says what it expects and the path has to match, so the mistake cannot be
    // silent.
    expect(() =>
      planUserDataDeletion([{ path: 'C:\\Users\\x\\AppData\\Roaming', leaf: 'hecaton' }]),
    ).toThrow(/hecaton/)
  })

  it('refuses a relative path', () => {
    expect(() =>
      planUserDataDeletion([{ path: 'AppData\\Roaming\\hecaton', leaf: 'hecaton' }]),
    ).toThrow(/absolute/)
  })

  it('refuses a path too shallow to be inside a user profile', () => {
    // A broken or hostile APPDATA of `C:\` would otherwise resolve to `C:\hecaton`
    // and be deleted from the drive root.
    expect(() => planUserDataDeletion([{ path: 'C:\\hecaton', leaf: 'hecaton' }])).toThrow(/depth/)
  })

  it('refuses an empty leaf, which would make the check meaningless', () => {
    expect(() => planUserDataDeletion([{ path: 'C:\\Users\\x\\anything', leaf: '' }])).toThrow(
      /leaf/,
    )
  })

  it('refuses the same target twice', () => {
    expect(() => planUserDataDeletion([APP_DATA, APP_DATA])).toThrow(/twice|duplicate/i)
  })

  it('refuses one target nested inside another', () => {
    // Deleting a parent and then a child is not merely redundant: it hides the
    // fact that one of the two was not what the caller thought it was.
    const nested = { path: 'C:\\Users\\x\\AppData\\Roaming\\hecaton\\profiles', leaf: 'profiles' }
    expect(() => planUserDataDeletion([APP_DATA, nested])).toThrow(/nested|inside/i)
  })

  it('refuses an empty target list, so "delete nothing" cannot look like success', () => {
    expect(() => planUserDataDeletion([])).toThrow(/no targets|empty/i)
  })
})

describe('requestsUserDataDeletion', () => {
  // The uninstaller launches the app with this flag when the user ticked the box.
  // It is the only way in, so what counts as "the flag" is worth pinning: this
  // decides whether a process deletes every logged-in session on the machine.
  it('recognises the flag on its own', () => {
    expect(requestsUserDataDeletion(['Hecaton.exe', DELETE_USER_DATA_FLAG])).toBe(true)
  })

  it('recognises it among other arguments', () => {
    expect(requestsUserDataDeletion(['Hecaton.exe', '--updated', DELETE_USER_DATA_FLAG])).toBe(true)
  })

  it('is false for a normal launch', () => {
    expect(requestsUserDataDeletion(['Hecaton.exe'])).toBe(false)
    expect(requestsUserDataDeletion([])).toBe(false)
  })

  it('does not match a longer argument that merely starts with the flag', () => {
    expect(requestsUserDataDeletion(['Hecaton.exe', '--delete-user-data-now'])).toBe(false)
    expect(requestsUserDataDeletion(['Hecaton.exe', `${DELETE_USER_DATA_FLAG}=yes`])).toBe(false)
  })

  it('does not match the flag appearing inside another argument value', () => {
    // A game URL or a slot name must never be able to trigger a deletion by
    // containing this string.
    expect(
      requestsUserDataDeletion(['Hecaton.exe', `--url=https://x/?q=${DELETE_USER_DATA_FLAG}`]),
    ).toBe(false)
  })
})
