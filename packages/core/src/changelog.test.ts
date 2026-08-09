import { describe, expect, it } from 'vitest'
import { changelogSection, needsReleaseNotes } from './changelog.js'

const CHANGELOG = `# Changelog

## 0.2.0

- Telas com sessão limpa.
- Correção no áudio.

## 0.1.0

- Primeira versão.
`

describe('changelogSection', () => {
  it('returns the entries under the heading for that version', () => {
    expect(changelogSection(CHANGELOG, '0.2.0')).toBe(
      '- Telas com sessão limpa.\n- Correção no áudio.',
    )
  })

  it('stops at the next version rather than running to the end of the file', () => {
    expect(changelogSection(CHANGELOG, '0.1.0')).toBe('- Primeira versão.')
  })

  it('accepts a heading written with a v, since tags are', () => {
    expect(changelogSection('## v1.2.3\n\n- x\n', '1.2.3')).toBe('- x')
  })

  it('returns nothing for a version with no section', () => {
    // The honest outcome, and the one that keeps the file optional: a release
    // whose notes nobody wrote says nothing rather than showing the wrong ones.
    expect(changelogSection(CHANGELOG, '0.3.0')).toBeUndefined()
    expect(changelogSection('', '0.1.0')).toBeUndefined()
  })

  it('returns nothing for a section with no content under it', () => {
    expect(changelogSection('## 0.2.0\n\n## 0.1.0\n\n- x\n', '0.2.0')).toBeUndefined()
  })

  it('does not treat a version as a prefix of another', () => {
    // `0.1.0` must not match the `0.1.0-beta` heading, nor `0.10.0` the `0.1.0`.
    expect(changelogSection('## 0.10.0\n\n- ten\n', '0.1.0')).toBeUndefined()
    expect(changelogSection('## 0.1.0-beta\n\n- beta\n', '0.1.0')).toBeUndefined()
  })
})

describe('needsReleaseNotes', () => {
  it('shows the notes when this version has not been seen', () => {
    expect(needsReleaseNotes(undefined, '0.2.0')).toBe(true)
    expect(needsReleaseNotes('0.1.0', '0.2.0')).toBe(true)
  })

  it('does not show them twice for the same version', () => {
    expect(needsReleaseNotes('0.2.0', '0.2.0')).toBe(false)
  })

  it('reads an absent value as unseen, like the terms version does', () => {
    // The choice that makes the first update work at all: nobody running today
    // has this field, so reading its absence as "already seen" would skip the
    // notes for exactly the release that introduces them.
    expect(needsReleaseNotes(undefined, '0.1.0')).toBe(true)
  })
})
