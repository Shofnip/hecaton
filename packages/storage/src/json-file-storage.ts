/**
 * A Storage port backed by one JSON file.
 *
 * Thin by contract: it serialises, writes and reads. No schema knowledge, no
 * defaults, no migration — those are decisions, and decisions live in the core.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { quarantineFileName } from '@hecaton/core'
import type { Storage } from '@hecaton/core'

/**
 * The file exists and is not JSON at all.
 *
 * Its own type because the caller has to tell this apart from every other load
 * failure: this is the one — and the only one — that may set the file aside and
 * start from defaults. A missing file is a first run; an unreadable one is a
 * problem with the disk, and quarantining on either would be renaming a file
 * over a condition that has nothing to do with its contents.
 */
export class CorruptJsonError extends Error {
  constructor(
    readonly filePath: string,
    cause: unknown,
  ) {
    super(
      `${filePath} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
    this.name = 'CorruptJsonError'
    this.cause = cause
  }
}

export class JsonFileStorage<T> implements Storage<T> {
  constructor(private readonly filePath: string) {}

  async load(): Promise<T | undefined> {
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }

    try {
      return JSON.parse(raw) as T
    } catch (error) {
      // Named, because a parse error with no path is the kind of log line that
      // costs an hour to act on — and typed, because this is the one failure the
      // caller is allowed to recover from by setting the file aside.
      throw new CorruptJsonError(this.filePath, error)
    }
  }

  /**
   * Moves the file out of the way, under a name derived from its own.
   *
   * A **rename, never a delete or an overwrite**: the bad file is the only copy
   * of whatever the user had configured, and anyone who can read JSON gets it
   * back from there. The same posture as archiving a removed slot's profile
   * (ADR-0008), for the same reason.
   *
   * The target name is the core's (`quarantineFileName`) and is resolved beside
   * the original — this adapter chooses no location. It refuses rather than
   * clobbering if that name is somehow taken, because the thing already sitting
   * there is evidence too.
   */
  async quarantine(isoTimestamp: string): Promise<string> {
    const name = quarantineFileName(basename(this.filePath), isoTimestamp)
    const target = join(dirname(this.filePath), name)
    // `rename` overwrites an existing target silently on POSIX, so the check is
    // the guard, not a nicety. The race it leaves is between two processes, and
    // the single-instance lock is what rules that out.
    try {
      await readFile(target)
      throw new Error(`${target} already exists; refusing to overwrite an earlier quarantine`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await rename(this.filePath, target)
    return name
  }

  /**
   * Written to a temporary file and renamed into place.
   *
   * `rename` is atomic on the same volume, so a crash mid-write leaves either
   * the old file or the new one — never a truncated config that the app cannot
   * parse on next start. This app orchestrates long-running child processes and
   * is expected to be killed abruptly, so the cheap guarantee is worth taking.
   */
  async save(value: T): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.tmp`
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rename(temporary, this.filePath)
  }
}
