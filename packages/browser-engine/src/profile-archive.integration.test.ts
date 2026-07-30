import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FileProfileArchive } from './profile-archive.js'

let root: string
let archive: FileProfileArchive

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hecaton-archive-'))
  archive = new FileProfileArchive(root)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Creates a fake profile directory with a marker file inside. */
function makeProfile(name: string): void {
  mkdirSync(join(root, name, 'Default'), { recursive: true })
  writeFileSync(join(root, name, 'Default', 'Cookies'), 'session')
}

describe('FileProfileArchive', () => {
  it('renames a profile aside instead of deleting it', async () => {
    makeProfile('slot-2')
    await archive.archive('slot-2')

    expect(existsSync(join(root, 'slot-2'))).toBe(false)
    const archived = readdirSync(root).filter((name) => name.startsWith('slot-2.old-'))
    expect(archived).toHaveLength(1)
    // The session data moved with it - archiving is a rename, nothing is lost.
    expect(existsSync(join(root, archived[0]!, 'Default', 'Cookies'))).toBe(true)
  })

  it('is a no-op when the slot never had a profile on disk', async () => {
    // A slot removed before it was ever launched has nothing to archive.
    await expect(archive.archive('slot-3')).resolves.toBeUndefined()
    expect(readdirSync(root)).toEqual([])
  })

  it('clears archived profiles but never a live one', async () => {
    makeProfile('slot-1')
    makeProfile('slot-2')
    await archive.archive('slot-2')
    makeProfile('slot-3')
    await archive.archive('slot-3')

    await archive.clearArchives()

    // The two archives are gone; the live slot-1 is untouched.
    expect(readdirSync(root)).toEqual(['slot-1'])
  })

  it('leaves a live profile alone even if its name resembles a slot', async () => {
    // Only the `.old-` archives are deletable. A live slot-N, however named,
    // is never a target - the guard is what keeps a reset from ever reaching a
    // logged-in session.
    makeProfile('slot-1')
    makeProfile('slot-10')
    await archive.clearArchives()
    expect(readdirSync(root).sort()).toEqual(['slot-1', 'slot-10'])
  })

  it('does nothing when there is nothing archived', async () => {
    makeProfile('slot-1')
    await expect(archive.clearArchives()).resolves.toBeUndefined()
    expect(readdirSync(root)).toEqual(['slot-1'])
  })
})

/** A profile with both cache directories and session files inside it. */
function makeProfileWithCache(name: string): void {
  const cacheDirs = [join('Default', 'Cache'), join('Default', 'Code Cache'), 'GPUCache']
  for (const dir of cacheDirs) {
    mkdirSync(join(root, name, dir), { recursive: true })
    writeFileSync(join(root, name, dir, 'blob'), 'cached')
  }
  mkdirSync(join(root, name, 'Default'), { recursive: true })
  writeFileSync(join(root, name, 'Default', 'Cookies'), 'session')
  writeFileSync(join(root, name, 'Default', 'Login Data'), 'creds')
}

describe('FileProfileArchive.clearCache', () => {
  it('deletes the cache directories but keeps the session', async () => {
    makeProfileWithCache('slot-2')
    await archive.clearCache('slot-2')

    // The cache is gone...
    expect(existsSync(join(root, 'slot-2', 'Default', 'Cache'))).toBe(false)
    expect(existsSync(join(root, 'slot-2', 'Default', 'Code Cache'))).toBe(false)
    expect(existsSync(join(root, 'slot-2', 'GPUCache'))).toBe(false)
    // ...but the login survives: clearing cache never logs anyone out.
    expect(existsSync(join(root, 'slot-2', 'Default', 'Cookies'))).toBe(true)
    expect(existsSync(join(root, 'slot-2', 'Default', 'Login Data'))).toBe(true)
  })

  it('touches only the named profile, not its neighbours', async () => {
    makeProfileWithCache('slot-1')
    makeProfileWithCache('slot-2')
    await archive.clearCache('slot-2')

    // slot-1's cache is left exactly as it was.
    expect(existsSync(join(root, 'slot-1', 'Default', 'Cache'))).toBe(true)
    expect(existsSync(join(root, 'slot-1', 'GPUCache'))).toBe(true)
  })

  it('is a no-op when the profile or its cache is not there', async () => {
    // A slot that never launched, or one already cache-free, must not throw.
    await expect(archive.clearCache('slot-3')).resolves.toBeUndefined()
    makeProfile('slot-1') // profile with a session but no cache dirs
    await expect(archive.clearCache('slot-1')).resolves.toBeUndefined()
    expect(existsSync(join(root, 'slot-1', 'Default', 'Cookies'))).toBe(true)
  })
})
