import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { JsonFileStorage } from './json-file-storage.js'

interface Shape {
  schemaVersion: number
  maxSlots: number
}

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'helloweb-storage-'))
  file = join(dir, 'nested', 'config.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('JsonFileStorage', () => {
  it('returns undefined when nothing has been saved yet', async () => {
    const storage = new JsonFileStorage<Shape>(file)
    expect(await storage.load()).toBeUndefined()
  })

  it('round-trips a value through the real filesystem', async () => {
    const storage = new JsonFileStorage<Shape>(file)
    const value: Shape = { schemaVersion: 1, maxSlots: 4 }

    await storage.save(value)
    expect(await storage.load()).toEqual(value)
  })

  it('creates missing parent directories rather than failing', async () => {
    const storage = new JsonFileStorage<Shape>(file)
    await storage.save({ schemaVersion: 1, maxSlots: 4 })
    expect(readFileSync(file, 'utf8')).toContain('maxSlots')
  })

  it('overwrites a previous value instead of appending', async () => {
    const storage = new JsonFileStorage<Shape>(file)
    await storage.save({ schemaVersion: 1, maxSlots: 4 })
    await storage.save({ schemaVersion: 1, maxSlots: 2 })

    expect(await storage.load()).toEqual({ schemaVersion: 1, maxSlots: 2 })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ schemaVersion: 1, maxSlots: 2 })
  })

  it('leaves no temporary file behind, so a directory listing stays clean', async () => {
    const storage = new JsonFileStorage<Shape>(file)
    await storage.save({ schemaVersion: 1, maxSlots: 4 })

    const entries = readdirSync(join(dir, 'nested'))
    expect(entries).toEqual(['config.json'])
  })

  it('keeps the previous value when a write is interrupted', async () => {
    // Atomic write: a crash mid-save must not leave a truncated config that
    // the app cannot parse on next start.
    const storage = new JsonFileStorage<Shape>(file)
    await storage.save({ schemaVersion: 1, maxSlots: 4 })

    writeFileSync(`${file}.tmp`, '{"schemaVersion":1,"maxSlots":')
    expect(await storage.load()).toEqual({ schemaVersion: 1, maxSlots: 4 })
  })

  it('reports a corrupt file by name instead of failing obscurely', async () => {
    const storage = new JsonFileStorage<Shape>(file)
    await storage.save({ schemaVersion: 1, maxSlots: 4 })
    writeFileSync(file, 'not json at all')

    await expect(storage.load()).rejects.toThrow(/config\.json/)
  })

  it('writes readable JSON, so a human can inspect or fix it', async () => {
    const storage = new JsonFileStorage<Shape>(file)
    await storage.save({ schemaVersion: 1, maxSlots: 4 })
    expect(readFileSync(file, 'utf8')).toContain('\n')
  })
})

// Path resolution is pure string work, so it lives in app-paths.test.ts and runs
// in the fast suite, where CI actually covers it.
