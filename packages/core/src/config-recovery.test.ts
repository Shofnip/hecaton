import { describe, expect, it } from 'vitest'
import { quarantineFileName } from './config-recovery.js'

const TS = '2026-08-09T11:30:00.000Z'

describe('quarantineFileName', () => {
  it('keeps the original name and extension, with the moment in between', () => {
    expect(quarantineFileName('config.json', TS)).toBe('config.bad-2026-08-09T11-30-00-000Z.json')
  })

  it('produces a name Windows can actually create', () => {
    // An ISO timestamp carries colons, and a colon in a Windows filename is not
    // an error the caller sees as "bad name" — it opens an alternate data stream
    // or fails outright, depending on the API. The whole point of setting a file
    // aside is that it still exists afterwards.
    expect(quarantineFileName('config.json', TS)).not.toMatch(/[:*?"<>|]/)
  })

  it('is derived from the name it was given, never assembled from scratch', () => {
    // The caller renames whatever this returns, so a name that ignored its input
    // would be this function choosing a file the caller did not mean.
    expect(quarantineFileName('slots.json', TS)).toBe('slots.bad-2026-08-09T11-30-00-000Z.json')
  })

  it('handles a name with no extension without inventing one', () => {
    expect(quarantineFileName('config', TS)).toBe('config.bad-2026-08-09T11-30-00-000Z')
  })

  it('refuses a name that is a path', () => {
    // It returns a *file name*, and the caller resolves it beside the original.
    // Accepting a path would let the result point somewhere else entirely, which
    // is the shape planUserDataDeletion exists to refuse for deletions.
    expect(() => quarantineFileName('C:\\Users\\x\\config.json', TS)).toThrow(/name/)
    expect(() => quarantineFileName('sub/config.json', TS)).toThrow(/name/)
  })
})
