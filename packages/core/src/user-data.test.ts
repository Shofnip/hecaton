import { describe, expect, it } from 'vitest'
import { planUserDataDeletion } from './user-data.js'

const APP_DATA = { path: 'C:\\Users\\x\\AppData\\Roaming\\hecaton', leaf: 'hecaton' }
// A second target purely to exercise the multi-target rules. The app passes exactly
// one — %APPDATA%/hecaton — since the installer copy in %LOCALAPPDATA% went with the
// installer itself. The array shape and its duplicate/nesting guards are kept
// because they are what would make a second target safe to add.
const OTHER = { path: 'C:\\Users\\x\\AppData\\Local\\hecaton-elsewhere', leaf: 'hecaton-elsewhere' }

describe('planUserDataDeletion', () => {
  it('returns the declared targets when every one of them checks out', () => {
    expect(planUserDataDeletion([APP_DATA, OTHER])).toEqual([APP_DATA.path, OTHER.path])
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
