/**
 * A Storage port backed by one JSON file.
 *
 * Thin by contract: it serialises, writes and reads. No schema knowledge, no
 * defaults, no migration — those are decisions, and decisions live in the core.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Storage } from '@helloweb/core'

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
      // Name the file. A parse error with no path is the kind of log line that
      // costs an hour to act on.
      throw new Error(
        `${this.filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
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
