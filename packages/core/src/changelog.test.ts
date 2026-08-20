import { describe, expect, it } from 'vitest'
import { changelogSection, displayNotes, needsReleaseNotes } from './changelog.js'

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

describe('displayNotes', () => {
  it('joins the hard wraps a markdown file is written with', () => {
    // The defect this exists for, found by looking at the running app: the file
    // is wrapped at ~95 columns by the formatter, `white-space: pre-wrap` keeps
    // those newlines, and the panel is ~440px wide - so each source line soft
    // wraps *and then* breaks again at the hard newline, with the continuation
    // indented two spaces. One sentence came out as three ragged lines.
    expect(
      displayNotes('- Uma tela ocupa o painel inteiro, e o áudio segue\n  quem está em foco.'),
    ).toBe('- Uma tela ocupa o painel inteiro, e o áudio segue quem está em foco.')
  })

  it('keeps separate bullets separate', () => {
    expect(displayNotes('- primeiro\n- segundo')).toBe('- primeiro\n- segundo')
    expect(displayNotes('- primeiro\n* segundo')).toBe('- primeiro\n* segundo')
  })

  it('keeps blank lines, which are the paragraph breaks', () => {
    expect(displayNotes('Primeira versão.\n\n- um item')).toBe('Primeira versão.\n\n- um item')
  })

  it('keeps a heading on its own line', () => {
    expect(displayNotes('## Fixes\n- um item')).toBe('## Fixes\n- um item')
  })

  it('drops emphasis markers, since this is rendered as text and not as markup', () => {
    // textContent is what makes a <script> in a GitHub release note five words
    // of plain text, and it is not up for negotiation. The cost is that
    // `**bold**` arrives as literal asterisks, which is what the owner saw.
    expect(displayNotes('- **Seus dados**: onde ficam seus logins.')).toBe(
      '- Seus dados: onde ficam seus logins.',
    )
    expect(displayNotes('um _detalhe_ e um `trecho`')).toBe('um detalhe e um trecho')
  })

  it('leaves a lone asterisk alone, so a bullet is not eaten', () => {
    expect(displayNotes('* item')).toBe('* item')
    expect(displayNotes('2 * 3')).toBe('2 * 3')
  })

  it('trims trailing space left by joining, and never leaves a leading blank line', () => {
    expect(displayNotes('\n\n- um\n')).toBe('- um')
  })
})
