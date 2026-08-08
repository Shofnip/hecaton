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

  it('reports nothing remaining when the directory is gone', () => {
    const dir = seedAppDir()
    expect(deleteUserData([{ path: dir, leaf: 'hecaton' }])).toEqual([])
  })

  it('reports what survived instead of throwing, when part of it cannot be removed', () => {
    // The real case this exists for, reproduced rather than mocked: the running
    // app cannot delete its own Electron directory inside %APPDATA%/hecaton, so
    // rmSync removes config, logs and profiles and *then* throws EPERM. Probe P4
    // measured that against a real Electron.
    //
    // A process's current directory cannot be removed on Windows either, which
    // is the same lock reached without needing Electron here. What is being
    // pinned is the contract: the adapter reports the outcome, and judging it is
    // the core's job (verifyUserDataDeletion).
    const dir = seedAppDir()
    const held = join(dir, 'shell')
    mkdirSync(held, { recursive: true })

    const back = process.cwd()
    process.chdir(held)
    let remaining: readonly string[]
    try {
      remaining = deleteUserData([{ path: dir, leaf: 'hecaton' }])
    } finally {
      process.chdir(back)
    }

    expect(remaining).toEqual(['shell'])
    // Everything it *could* remove is really gone: this is a partial deletion
    // being reported honestly, not an aborted one.
    expect(existsSync(join(dir, 'config.json'))).toBe(false)
    expect(existsSync(join(dir, 'profiles'))).toBe(false)
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
