/**
 * A Logger that appends JSONL to a daily file under the logs directory.
 *
 * Thin by contract, like the storage adapter beside it: it serialises and
 * writes. What may be written, and the redaction that enforces "no url ever
 * reaches the log", live in the core (`formatLogRecord`) — so redaction happens
 * at this boundary no matter what a caller put in the entry.
 *
 * One file per day (`app-YYYY-MM-DD.log`). That is the rotation: a new file each
 * day rather than one growing without bound. `prune` is the retention half,
 * decided on 2026-08-09 and deliberately not a default that slipped in: which
 * files may go is `expiredLogFiles` in the core, and this only unlinks what it
 * names.
 */
import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { LOG_FILES_KEPT, expiredLogFiles, formatLogRecord } from '@hecaton/core'
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

  /**
   * Deletes the daily files beyond the newest `keep`.
   *
   * Called once, at startup, and never while the app runs: the file for today is
   * open for appends, and a prune that raced the writer would be chasing a
   * handle it just invalidated. Startup is also the only moment where the newest
   * file is not yet the one being written.
   *
   * Holds no rule of its own — `expiredLogFiles` decides which names may go, so
   * a file this logger did not write is not a candidate at any limit. Failures
   * are swallowed for the same reason a failed write is: retention is
   * housekeeping, and it must never be the thing that stops the app starting.
   */
  prune(keep: number = LOG_FILES_KEPT): void {
    let names: string[]
    try {
      names = readdirSync(this.dir)
    } catch {
      // No directory yet, which is the ordinary state on a first run.
      return
    }

    for (const name of expiredLogFiles(names, keep)) {
      try {
        unlinkSync(join(this.dir, name))
      } catch {
        // A file held open by something else stays. It will be a candidate again
        // at the next startup, and one surviving log is not worth a failure here.
      }
    }
  }
}
