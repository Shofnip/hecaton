import { describe, expect, it } from 'vitest'
import { expiredLogFiles, formatLogRecord, redactUrls } from './log.js'

describe('redactUrls', () => {
  it('replaces an http(s) url with a placeholder', () => {
    // A url can carry a session token in its query string, which is the one
    // thing that must never reach the log. Origin and path go too: the slotId
    // already identifies the slot, and its target is in the user's own config.
    expect(redactUrls('opening https://poke.idleworld.online/play?token=secret now')).toBe(
      'opening [url] now',
    )
  })

  it('redacts every url in the text, not just the first', () => {
    expect(redactUrls('from http://a.test/x to https://b.test/y')).toBe('from [url] to [url]')
  })

  it('leaves a bare protocol alone', () => {
    // "url must use https, got http:" names no host and carries no token, so it
    // is safe and worth keeping - it is the actual diagnosis.
    expect(redactUrls('url must use https, got "http:"')).toBe('url must use https, got "http:"')
  })

  it('leaves text with no url untouched', () => {
    expect(redactUrls('Chrome did not start within 20000ms')).toBe(
      'Chrome did not start within 20000ms',
    )
  })

  it('handles a url at the very end', () => {
    expect(redactUrls('refused navigation to https://evil.test/steal?c=1')).toBe(
      'refused navigation to [url]',
    )
  })
})

describe('formatLogRecord', () => {
  const ts = '2026-07-21T18:00:00.000Z'

  it('assembles a record with the timestamp first', () => {
    expect(formatLogRecord({ level: 'info', event: 'slot.start', slotId: 1 }, ts)).toEqual({
      ts,
      level: 'info',
      event: 'slot.start',
      slotId: 1,
    })
  })

  it('drops fields that were not provided', () => {
    // gameId is absent for a custom slot; a key with an undefined value would
    // serialise inconsistently and clutter every custom-slot line.
    const record = formatLogRecord({ level: 'info', event: 'slot.start', slotId: 3 }, ts)
    expect(Object.keys(record)).toEqual(['ts', 'level', 'event', 'slotId'])
  })

  it('keeps gameId and pid when present', () => {
    expect(
      formatLogRecord(
        { level: 'info', event: 'slot.ready', slotId: 1, gameId: 'poke-idleworld', pid: 4242 },
        ts,
      ),
    ).toMatchObject({ gameId: 'poke-idleworld', pid: 4242 })
  })

  it('redacts a url embedded in the message', () => {
    // Some of our own error messages embed the url (the config validators do),
    // so "no urls in the log" has to scrub the message text, not just omit a
    // url field the entry never carried.
    const record = formatLogRecord(
      {
        level: 'error',
        event: 'config.error',
        message: 'slot 3 url is not a valid URL: "https://x.test/?t=abc"',
      },
      ts,
    )
    // The quotes are the message's own (from JSON.stringify in the validator);
    // only the url between them is gone, which is what matters.
    expect(record['message']).toBe('slot 3 url is not a valid URL: "[url]"')
  })

  it('never carries a url field even if one is somehow passed', () => {
    // The entry type has no url field, but a caller reaching past the types must
    // not be able to smuggle one onto the record.
    const record = formatLogRecord(
      { level: 'info', event: 'slot.start', slotId: 1, url: 'https://x.test/' } as never,
      ts,
    )
    expect(record).not.toHaveProperty('url')
  })
})

describe('expiredLogFiles', () => {
  const day = (d: string): string => `app-2026-08-${d}.log`

  it('keeps the newest files and names the rest for deletion', () => {
    const files = [day('01'), day('02'), day('03'), day('04'), day('05')]
    expect(expiredLogFiles(files, 3)).toEqual([day('02'), day('01')])
  })

  it('deletes nothing while there are no more files than the limit', () => {
    expect(expiredLogFiles([day('01'), day('02')], 2)).toEqual([])
    expect(expiredLogFiles([], 14)).toEqual([])
  })

  it('sorts by the date in the name, not by the order the directory listed', () => {
    // readdirSync order is the filesystem's business, not a promise. The names
    // are ISO dates, so sorting them as strings is sorting them as dates - which
    // is the whole reason the file is named this way.
    expect(expiredLogFiles([day('03'), day('01'), day('02')], 1)).toEqual([day('02'), day('01')])
  })

  it('never names a file it does not recognise', () => {
    // The safety property, and the reason this is a rule rather than a glob in
    // the adapter: the logs directory is opened by the user from the panel, so
    // anything at all can be sitting in it - a copy they made, a file they were
    // sent to compare. Only files this logger itself could have written may be
    // deleted, whatever the keep count is.
    const strangers = ['notes.txt', 'app-2026-08-01.log.bak', 'app-old.log', 'config.json']
    expect(expiredLogFiles([...strangers, day('01'), day('02')], 0)).toEqual([day('02'), day('01')])
  })
})
