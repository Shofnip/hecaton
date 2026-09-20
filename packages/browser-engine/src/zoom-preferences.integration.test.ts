import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readDefaultZoomLevel } from './zoom-preferences.js'

let root: string
let preferences: string

beforeEach(async () => {
  // Synthetic disk fixtures only. Never point this suite at a user's profile.
  root = await mkdtemp(join(tmpdir(), 'hecaton-zoom-reader-'))
  await mkdir(join(root, 'Default'))
  preferences = join(root, 'Default', 'Preferences')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('read-only zoom preference adapter, real disk', () => {
  it('returns only the numeric default and leaves the file byte-for-byte unchanged', async () => {
    const text = JSON.stringify({
      partition: { default_zoom_level: { x: 1.234 } },
      unrelated: 'not returned',
    })
    await writeFile(preferences, text)
    const before = await stat(preferences)
    expect(await readDefaultZoomLevel(root)).toBe(1.234)
    expect(await readFile(preferences, 'utf8')).toBe(text)
    expect((await stat(preferences)).mtimeMs).toBe(before.mtimeMs)
  })

  it('reads no cookie, login database, Local State or per-host settings', async () => {
    // Wrong targets are directories, so any accidental read of them cannot pass.
    for (const path of ['Cookies', 'Login Data', 'Secure Preferences'])
      await mkdir(join(root, 'Default', path))
    await mkdir(join(root, 'Local State'))
    await writeFile(
      preferences,
      JSON.stringify({
        partition: {
          default_zoom_level: { x: 2 },
          per_host_zoom_levels: 'not interpreted',
        },
      }),
    )
    expect(await readDefaultZoomLevel(root)).toBe(2)
  })

  it('distinguishes missing/unreadable files from an absent preference', async () => {
    expect(await readDefaultZoomLevel(root)).toBeUndefined()
    await writeFile(preferences, '{}')
    expect(await readDefaultZoomLevel(root)).toBe(0)
    await rm(preferences)
    await mkdir(preferences)
    expect(await readDefaultZoomLevel(root)).toBeUndefined()
  })

  it('does not leak malformed file contents through a JSON exception', async () => {
    await writeFile(preferences, '{"unrelated":"private fixture text')
    expect(await readDefaultZoomLevel(root)).toBeUndefined()
  })

  it('rejects an oversized file even if it is valid JSON', async () => {
    await writeFile(preferences, JSON.stringify({ padding: 'x'.repeat(4 * 1024 * 1024) }))
    expect(await readDefaultZoomLevel(root)).toBeUndefined()
  })
})
