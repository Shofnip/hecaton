import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { CorruptJsonError, JsonFileStorage } from './json-file-storage.js'

interface Shape {
  schemaVersion: number
  maxSlots: number
}

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hecaton-storage-'))
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

describe('JsonFileStorage recovery', () => {
  const corrupt = (): JsonFileStorage<Shape> => {
    mkdirSync(dirname(file), { recursive: true })
    // What a kill during a save used to be able to leave, before save became
    // write-to-temp-and-rename. A friend can still arrive here by editing the
    // file by hand, or by a disk that lied about a flush.
    writeFileSync(file, '{"schemaVersion": 1, "maxSl', 'utf8')
    return new JsonFileStorage<Shape>(file)
  }

  it('tells a corrupt file apart from every other failure', async () => {
    // The distinction the recovery rests on: only a file that is not JSON at all
    // may be set aside. A missing file is a first run, and an unreadable one is
    // a problem with the disk, not with the contents.
    await expect(corrupt().load()).rejects.toBeInstanceOf(CorruptJsonError)

    const missing = new JsonFileStorage<Shape>(join(dir, 'nothing-here.json'))
    expect(await missing.load()).toBeUndefined()
  })

  it('renames the file beside itself and leaves nothing at the original path', async () => {
    const storage = corrupt()
    const saved = await storage.quarantine('2026-08-09T11:30:00.000Z')

    expect(saved).toBe('config.bad-2026-08-09T11-30-00-000Z.json')
    expect(existsSync(file)).toBe(false)
    expect(readFileSync(join(dirname(file), saved), 'utf8')).toBe('{"schemaVersion": 1, "maxSl')
  })

  it('starts clean once the bad file is out of the way', async () => {
    const storage = corrupt()
    await storage.quarantine('2026-08-09T11:30:00.000Z')

    // undefined, not a throw: to the loader this is now indistinguishable from a
    // first run, which is exactly what "start from defaults" means.
    expect(await storage.load()).toBeUndefined()
  })

  it('never overwrites an earlier quarantine taken in the same millisecond', async () => {
    // Two corrupt starts inside one millisecond is not realistic; silently
    // destroying the first evidence if it happened is not acceptable either.
    const storage = corrupt()
    await storage.quarantine('2026-08-09T11:30:00.000Z')
    writeFileSync(file, 'still not json', 'utf8')

    await expect(storage.quarantine('2026-08-09T11:30:00.000Z')).rejects.toThrow(/exists/)
    expect(
      readFileSync(join(dirname(file), 'config.bad-2026-08-09T11-30-00-000Z.json'), 'utf8'),
    ).toBe('{"schemaVersion": 1, "maxSl')
  })
})
