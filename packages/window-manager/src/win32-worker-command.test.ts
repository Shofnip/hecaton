/**
 * The worker script has to fit on a Windows command line.
 *
 * `Win32Worker` hands its whole C# surface to PowerShell through
 * `-EncodedCommand`, which is UTF-16 and then base64 — so every character of
 * that template literal costs about **2.7 bytes of command line**, and Windows
 * refuses to spawn a process whose command line exceeds 32,767 characters.
 *
 * That makes prose inside the literal expensive in a way it is nowhere else in
 * this repository, where long explanatory comments are the house style and cost
 * nothing. Nothing said so. Measured on 2026-09-20 while adding two comments to
 * that file: the first took the encoded command from 29,592 to 31,188 and left
 * a margin of 1,579; the second took it to 34,216 and the adapter stopped being
 * able to start at all. The failure is a `spawn ENAMETOOLONG` from a worker that
 * never prints READY, which surfaces as every window operation silently doing
 * nothing — embeds, moves, focus, reload — with no error near the cause.
 *
 * So the budget is a test rather than a comment, and it asserts headroom rather
 * than mere fitting: a limit you are allowed to sit against is one the next
 * edit walks through.
 */
import { describe, expect, it } from 'vitest'
import { WORKER_SCRIPT } from './win32-worker.js'

/** What `CreateProcess` accepts, including the terminating null. */
const WINDOWS_COMMAND_LINE_LIMIT = 32_767

/**
 * Room for the next person to explain something without measuring first.
 *
 * Deliberately large. The point is not to discover the ceiling at the moment
 * somebody needs the space; it is to fail early enough that they can still put
 * the explanation in a TypeScript comment outside the literal, where it is free.
 */
const REQUIRED_HEADROOM = 3_000

const encodedLength = (script: string): number =>
  Buffer.from(script, 'utf16le').toString('base64').length

describe('the encoded worker command', () => {
  it('fits on a Windows command line, with room to spare', () => {
    const encoded = encodedLength(WORKER_SCRIPT)
    expect(
      encoded,
      `the encoded worker command is ${encoded} characters; Windows accepts ` +
        `${WINDOWS_COMMAND_LINE_LIMIT} and this file keeps ${REQUIRED_HEADROOM} in reserve. ` +
        'Move prose out of the C# template literal into a TypeScript comment above it, ' +
        'where it costs nothing.',
    ).toBeLessThan(WINDOWS_COMMAND_LINE_LIMIT - REQUIRED_HEADROOM)
  })

  it('measures the encoding the spawn actually uses, not the source length', () => {
    // Guards the arithmetic above rather than the script: if this ever stopped
    // being UTF-16-then-base64, the budget would be measuring the wrong thing
    // and would pass while the spawn failed. Ratio, not a magic number - base64
    // of UTF-16 is 4 characters per 3 bytes, and 2 bytes per source character.
    const ratio = encodedLength(WORKER_SCRIPT) / WORKER_SCRIPT.length
    expect(ratio).toBeGreaterThan(2.6)
    expect(ratio).toBeLessThan(2.8)
  })
})
