import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deleteUserData } from './delete-user-data.js'

// Real disk, per CLAUDE.md: an adapter is covered against the real thing, never
// against a fake that would only prove the fake works. Everything here happens
// inside a temp directory that stands in for %APPDATA%.
let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hecaton-delete-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** A directory shaped like the real one: config, logs, and profiles with content. */
function seedAppDir(name = 'hecaton'): string {
  const dir = join(root, 'Roaming', name)
  mkdirSync(join(dir, 'logs'), { recursive: true })
  mkdirSync(join(dir, 'profiles', 'slot-1', 'Default', 'Network'), { recursive: true })
  writeFileSync(join(dir, 'config.json'), '{"schemaVersion":1}')
  writeFileSync(join(dir, 'logs', 'app-2026-07-30.log'), 'line\n')
  writeFileSync(join(dir, 'profiles', 'slot-1', 'Default', 'Network', 'Cookies'), 'sqlite')
  return dir
}

describe('deleteUserData', () => {
  it('removes the directory and everything under it', () => {
    const dir = seedAppDir()
    deleteUserData([{ path: dir, leaf: 'hecaton' }])
    expect(existsSync(dir)).toBe(false)
  })

  it('leaves the parent alone, so sibling applications are untouched', () => {
    const dir = seedAppDir()
    const neighbour = join(root, 'Roaming', 'SomeOtherApp')
    mkdirSync(neighbour, { recursive: true })
    writeFileSync(join(neighbour, 'keep.txt'), 'not ours')

    deleteUserData([{ path: dir, leaf: 'hecaton' }])

    expect(existsSync(join(root, 'Roaming'))).toBe(true)
    expect(existsSync(join(neighbour, 'keep.txt'))).toBe(true)
  })

  it('succeeds when the directory is already gone, so a second uninstall is not an error', () => {
    const dir = join(root, 'Roaming', 'hecaton')
    expect(() => deleteUserData([{ path: dir, leaf: 'hecaton' }])).not.toThrow()
  })

  it('refuses a target the core rejects, and deletes nothing at all', () => {
    // The whole roaming directory, declared as if it were the app's own. Nothing
    // may be removed - not even a valid target passed alongside it.
    const dir = seedAppDir()
    const roaming = join(root, 'Roaming')

    expect(() =>
      deleteUserData([
        { path: dir, leaf: 'hecaton' },
        { path: roaming, leaf: 'hecaton' },
      ]),
    ).toThrow(/does not end in/)

    expect(existsSync(join(dir, 'config.json'))).toBe(true)
  })
})
