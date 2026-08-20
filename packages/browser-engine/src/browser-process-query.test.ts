import { describe, expect, it } from 'vitest'
import { browserProcessQuery } from './browser-process-query.js'

describe('browserProcessQuery', () => {
  it('filters on the executable it was given, not on a hardcoded name', () => {
    // The name used to be the literal 'chrome.exe'. It is now the basename of
    // whichever executable was resolved, so that renaming or replacing the
    // bundled browser cannot leave the launcher looking for a process that no
    // longer exists — a failure that surfaces as "the browser did not start
    // within 20000ms", pointing nowhere near the cause.
    expect(browserProcessQuery('chrome.exe')).toContain("$_.Name -eq 'chrome.exe'")
    expect(browserProcessQuery('hecaton-browser.exe')).toContain(
      "$_.Name -eq 'hecaton-browser.exe'",
    )
  })

  it('asks for the two fields the launcher reads and no others', () => {
    // The command line is how a slot is identified (by --user-data-dir, never by
    // window title), so it has to come back — but nothing else should. A
    // Win32_Process row carries the full command line of every browser on the
    // machine, including the user's own.
    expect(browserProcessQuery('chrome.exe')).toContain('Select-Object ProcessId,CommandLine')
  })

  it('produces one JSON document even for a single match', () => {
    // ConvertTo-Json emits an object rather than an array when there is exactly
    // one row, and the caller parses an array. The @() is what makes the shape
    // constant.
    expect(browserProcessQuery('chrome.exe')).toMatch(/^@\(/)
    expect(browserProcessQuery('chrome.exe')).toContain('ConvertTo-Json -Compress')
  })

  it('uses no double quote anywhere', () => {
    // PowerShell eats double quotes out of a -Command string, which
    // docs/troubleshooting.md records the hard way.
    expect(browserProcessQuery('chrome.exe')).not.toContain('"')
  })

  it('escapes a quote in the name instead of ending the string early', () => {
    // The name is derived from a path, and a path can hold an apostrophe. An
    // unescaped one would close the PowerShell literal and hand the rest of the
    // name to the parser as code.
    expect(browserProcessQuery("o'brien.exe")).toContain("$_.Name -eq 'o''brien.exe'")
  })

  it('refuses a path, which is not a process name', () => {
    // Win32_Process.Name is a file name. Passing a whole path would match
    // nothing at all, silently, and the launcher would time out instead.
    expect(() => browserProcessQuery('C:\\x\\chrome.exe')).toThrow(/name/i)
    expect(() => browserProcessQuery('x/chrome.exe')).toThrow(/name/i)
    expect(() => browserProcessQuery('')).toThrow(/name/i)
  })
})
