import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { defaultZoomLevel } from '@hecaton/core'

/** Bound memory and JSON parsing even for a damaged/untrusted preference file. */
const MAX_BYTES = 4 * 1024 * 1024

/**
 * Owner-approved read-only access to Default/Preferences. The caller supplies
 * an app-owned profile path, never a renderer-provided path. Only the numeric
 * default zoom escapes; there is no logging, write, per-host lookup or access
 * to Cookies, Login Data, Secure Preferences or Local State.
 *
 * Unknown is distinct from an absent key in a valid JSON object. In particular,
 * a new browser may not have written Preferences yet: retry, do not assume 100%.
 */
export async function readDefaultZoomLevel(profilePath: string): Promise<number | undefined> {
  try {
    const file = await open(join(profilePath, 'Default', 'Preferences'), 'r')
    try {
      const info = await file.stat()
      if (!info.isFile() || info.size > MAX_BYTES) return undefined
      // The extra byte detects growth after stat; never read an unbounded file.
      const buffer = Buffer.alloc(MAX_BYTES + 1)
      let length = 0
      while (length < buffer.length) {
        const { bytesRead } = await file.read(buffer, length, buffer.length - length, null)
        if (bytesRead === 0) break
        length += bytesRead
      }
      if (length > MAX_BYTES) return undefined
      const preferences: unknown = JSON.parse(buffer.toString('utf8', 0, length))
      return defaultZoomLevel(preferences)
    } finally {
      await file.close()
    }
  } catch {
    // JSON/filesystem exception text can contain profile data or user paths.
    return undefined
  }
}
