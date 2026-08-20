import { describe, expect, it } from 'vitest'
import { UPDATE_NOTES_MAX, interpretUpdateCheck, isNewerVersion } from './update.js'

describe('isNewerVersion', () => {
  it.each([
    ['0.2.0', '0.1.0'],
    ['0.1.1', '0.1.0'],
    ['1.0.0', '0.9.9'],
    ['0.10.0', '0.9.0'],
  ])('%s is newer than %s', (candidate, current) => {
    expect(isNewerVersion(candidate, current)).toBe(true)
  })

  it.each([
    ['0.1.0', '0.1.0'],
    ['0.1.0', '0.2.0'],
    ['0.9.0', '0.10.0'],
  ])('%s is not newer than %s', (candidate, current) => {
    expect(isNewerVersion(candidate, current)).toBe(false)
  })

  it('compares numbers, not strings', () => {
    // The bug this exists for: "0.10.0" < "0.9.0" as text, so a string compare
    // would tell the user their newer build is out of date, once, at exactly the
    // release where it is least expected.
    expect(isNewerVersion('0.10.0', '0.9.0')).toBe(true)
  })

  it('accepts the v prefix the tags carry', () => {
    expect(isNewerVersion('v0.2.0', '0.1.0')).toBe(true)
  })
})

describe('interpretUpdateCheck', () => {
  const release = (over: Record<string, unknown> = {}): unknown => ({
    tag_name: 'v0.2.0',
    body: 'Corrige o áudio.',
    ...over,
  })

  it('reports an update when the published tag is newer', () => {
    expect(interpretUpdateCheck(200, release(), '0.1.0')).toEqual({
      status: 'update-available',
      version: '0.2.0',
      notes: 'Corrige o áudio.',
    })
  })

  it('reports being up to date when it is', () => {
    expect(interpretUpdateCheck(200, release({ tag_name: 'v0.1.0' }), '0.1.0')).toEqual({
      status: 'up-to-date',
      version: '0.1.0',
    })
  })

  it('treats 404 as "nothing published yet" rather than a failure', () => {
    // Measured 2026-08-09: this repo has no release, and the API answers 404 for
    // /releases/latest while /releases answers 200 []. Today that is the normal
    // case, not an error, and it must not be shown as one.
    expect(interpretUpdateCheck(404, undefined, '0.1.0')).toEqual({ status: 'none-published' })
  })

  it.each([
    [403, 'rate-limited'],
    [429, 'rate-limited'],
    [500, 'server'],
    [503, 'server'],
    [418, 'unexpected'],
  ])('reports %d as unavailable (%s)', (httpStatus, reason) => {
    expect(interpretUpdateCheck(httpStatus, undefined, '0.1.0')).toEqual({
      status: 'unavailable',
      reason,
    })
  })

  it('reports a body that is not an object as malformed, rather than crashing', () => {
    expect(interpretUpdateCheck(200, 'not json', '0.1.0')).toEqual({
      status: 'unavailable',
      reason: 'malformed',
    })
  })

  it.each([
    ['a missing tag', { body: 'x' }],
    ['a non-string tag', { tag_name: 7 }],
    ['a tag that is not a version', { tag_name: 'nightly' }],
    ['a tag with extra parts', { tag_name: 'v1.2.3.4' }],
  ])('reports %s as malformed', (_case, over) => {
    // The response is untrusted input from the network. Anything unexpected fails
    // closed and visibly: the user is told the check did not work, never shown a
    // guess about what version they should be on.
    expect(interpretUpdateCheck(200, { tag_name: undefined, ...over }, '0.1.0')).toEqual({
      status: 'unavailable',
      reason: 'malformed',
    })
  })

  it('accepts a release with no notes, which the API sends as null', () => {
    expect(interpretUpdateCheck(200, release({ body: null }), '0.1.0')).toEqual({
      status: 'update-available',
      version: '0.2.0',
      notes: '',
    })
  })

  it('caps the notes, so a huge body cannot be pushed into the panel', () => {
    const long = 'a'.repeat(UPDATE_NOTES_MAX * 3)
    const result = interpretUpdateCheck(200, release({ body: long }), '0.1.0')
    expect(result.status === 'update-available' && result.notes.length).toBe(UPDATE_NOTES_MAX)
  })

  it('strips control characters from the notes', () => {
    // Built from char codes rather than typed, so the file itself stays text.
    // The notes are shown as text and never as HTML - the renderer sets
    // textContent - so markup is not the worry here. Control characters are:
    // they arrive from the network and can hide the rest of a line in the panel.
    const bell = String.fromCharCode(7)
    const nul = String.fromCharCode(0)
    const result = interpretUpdateCheck(200, release({ body: `a${nul}b${bell}c` }), '0.1.0')
    expect(result.status === 'update-available' && result.notes).toBe('abc')
  })

  it('keeps the line structure a changelog is written with, and joins the rest', () => {
    // This test used to assert that every newline survived verbatim, and that
    // was right until the notes were looked at on screen: the source is
    // hard-wrapped at ~95 columns, the panel renders `white-space: pre-wrap` in
    // a narrow box, so each line wrapped at the box width and *then* broke again
    // at the source's own newline. `displayNotes` now unwraps continuations.
    //
    // What is still protected is the part that mattered: structure survives.
    // Bullets stay on their own lines and a blank line still separates
    // paragraphs — those are the author's, not the formatter's.
    const structure = interpretUpdateCheck(
      200,
      release({ body: '## Fixes\n\n- um\n- dois' }),
      '0.1.0',
    )
    expect(structure.status === 'update-available' && structure.notes).toBe(
      '## Fixes\n\n- um\n- dois',
    )

    const wrapped = interpretUpdateCheck(
      200,
      release({ body: '- um item\r\n  continuado' }),
      '0.1.0',
    )
    expect(wrapped.status === 'update-available' && wrapped.notes).toBe('- um item continuado')
  })

  it('never carries a url out of the response', () => {
    // D7's obligation, pinned as a test rather than left to review: the release
    // page the app opens is a constant in main. A url taken from a document
    // fetched over the network would turn shell.openExternal into "open whatever
    // the server says", which is the shape the IPC surface refuses everywhere
    // else.
    const result = interpretUpdateCheck(
      200,
      release({ html_url: 'https://evil.example/x', assets: [{ browser_download_url: 'x' }] }),
      '0.1.0',
    )
    expect(JSON.stringify(result)).not.toMatch(/evil\.example|http/)
  })
})
