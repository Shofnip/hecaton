/**
 * A Logger that appends JSONL to a daily file under the logs directory.
 *
 * Thin by contract, like the storage adapter beside it: it serialises and
 * writes. What may be written, and the redaction that enforces "no url ever
 * reaches the log", live in the core (`formatLogRecord`) — so redaction happens
 * at this boundary no matter what a caller put in the entry.
 *
 * One file per day (`app-YYYY-MM-DD.log`). That is the rotation: a new file each
 * day rather than one growing without bound. Old files are not pruned yet —
 * deleting is a destructive path this project keeps deliberate, so retention is
 * left to a later decision rather than slipped in here.
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { formatLogRecord } from '@hecaton/core'
import type { LogEntry, Logger } from '@hecaton/core'

export class FileLogger implements Logger {
  constructor(
    private readonly dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  log(entry: LogEntry): void {
    const timestamp = this.now()
    const record = formatLogRecord(entry, timestamp.toISOString())
    // The date part of the ISO string is the file for the day.
    const file = join(this.dir, `app-${timestamp.toISOString().slice(0, 10)}.log`)
    try {
      mkdirSync(this.dir, { recursive: true })
      appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8')
    } catch {
      // Logging is diagnostic, not critical. A failed write is dropped rather
      // than thrown: it must never take down the slot lifecycle it describes,
      // and there is nowhere better than this file to report a logging failure.
    }
  }
}
