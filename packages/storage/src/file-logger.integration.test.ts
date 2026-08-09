import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FileLogger } from './file-logger.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hecaton-logs-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const at = (iso: string) => () => new Date(iso)

describe('FileLogger', () => {
  it('writes one JSON object per line', () => {
    const logger = new FileLogger(dir, at('2026-07-21T18:00:00.000Z'))
    logger.log({ level: 'info', event: 'slot.start', slotId: 1 })
    logger.log({ level: 'info', event: 'slot.ready', slotId: 1, pid: 4242 })

    const file = join(dir, 'app-2026-07-21.log')
    const lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: 'slot.start', slotId: 1 })
    expect(JSON.parse(lines[1]!)).toMatchObject({ event: 'slot.ready', pid: 4242 })
  })

  it('stamps each record with the timestamp', () => {
    const logger = new FileLogger(dir, at('2026-07-21T18:30:00.000Z'))
    logger.log({ level: 'info', event: 'slot.stop', slotId: 2 })

    const line = readFileSync(join(dir, 'app-2026-07-21.log'), 'utf8').trim()
    expect(JSON.parse(line).ts).toBe('2026-07-21T18:30:00.000Z')
  })

  it('redacts a url that reached it inside a message', () => {
    // The real proof that the redaction is on the write path, not just a pure
    // function nobody wired up: a url handed to the logger must not survive to
    // disk.
    const logger = new FileLogger(dir, at('2026-07-21T18:00:00.000Z'))
    logger.log({
      level: 'error',
      event: 'config.error',
      message: 'bad url https://poke.idleworld.online/play?token=secret',
    })

    const raw = readFileSync(join(dir, 'app-2026-07-21.log'), 'utf8')
    expect(raw).not.toContain('token=secret')
    expect(raw).not.toContain('poke.idleworld.online')
    expect(raw).toContain('[url]')
  })

  it('starts a new file on a new day', () => {
    new FileLogger(dir, at('2026-07-21T23:59:00.000Z')).log({
      level: 'info',
      event: 'slot.start',
      slotId: 1,
    })
    new FileLogger(dir, at('2026-07-22T00:01:00.000Z')).log({
      level: 'info',
      event: 'slot.start',
      slotId: 1,
    })

    const files = readdirSync(dir).sort()
    expect(files).toEqual(['app-2026-07-21.log', 'app-2026-07-22.log'])
  })

  it('creates the directory if it does not exist yet', () => {
    const nested = join(dir, 'does', 'not', 'exist')
    const logger = new FileLogger(nested, at('2026-07-21T18:00:00.000Z'))
    logger.log({ level: 'info', event: 'slot.start', slotId: 1 })
    expect(existsSync(join(nested, 'app-2026-07-21.log'))).toBe(true)
  })

  it('never throws out of a failed write', () => {
    // Logging is diagnostic, not critical: a disk-full or permission error must
    // not abort the slot lifecycle the log line was describing. An empty string
    // is not a valid directory, so the write fails.
    const logger = new FileLogger('', at('2026-07-21T18:00:00.000Z'))
    expect(() => logger.log({ level: 'info', event: 'slot.start', slotId: 1 })).not.toThrow()
  })
})

describe('FileLogger.prune', () => {
  const write = (day: string): void => {
    new FileLogger(dir, at(`2026-08-${day}T12:00:00.000Z`)).log({ level: 'info', event: 'x' })
  }

  it('removes the oldest daily files and keeps the newest', () => {
    for (const day of ['01', '02', '03', '04']) write(day)

    new FileLogger(dir).prune(2)

    expect(readdirSync(dir).sort()).toEqual(['app-2026-08-03.log', 'app-2026-08-04.log'])
  })

  it('leaves a file it did not write, whatever the limit', () => {
    // The panel opens this directory for the user, so anything can be in it.
    write('01')
    writeFileSync(join(dir, 'notes-from-a-friend.txt'), 'keep me', 'utf8')

    new FileLogger(dir).prune(0)

    expect(readdirSync(dir)).toEqual(['notes-from-a-friend.txt'])
  })

  it('says nothing and does nothing when the directory does not exist', () => {
    // The ordinary state on a first run: prune happens at startup, before
    // anything has been logged.
    expect(() => new FileLogger(join(dir, 'not-created-yet')).prune(14)).not.toThrow()
  })
})
