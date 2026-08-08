import { describe, expect, it } from 'vitest'
import { TERMS_VERSION, needsTermsAcknowledgement } from './terms.js'

describe('needsTermsAcknowledgement', () => {
  it('shows the warning on a fresh install, where nothing has been acknowledged', () => {
    expect(needsTermsAcknowledgement(0)).toBe(true)
  })

  it('stays quiet once the current version has been acknowledged', () => {
    expect(needsTermsAcknowledgement(TERMS_VERSION)).toBe(false)
  })

  it('shows it again when the text has moved on since it was acknowledged', () => {
    // The point of a version rather than a boolean. The warning summarises rules
    // that were read on a date, and D3b's argument for showing it is that it can
    // still change the user's decision - which is only true if a materially
    // different text is shown again rather than assumed to have been read.
    expect(needsTermsAcknowledgement(TERMS_VERSION - 1)).toBe(true)
  })

  it('stays quiet for a value beyond the current version', () => {
    // A hand-edited config, or one written by a newer build. Not a case to
    // defend against: this is a warning, not a gate, and re-showing it because a
    // number is too large would be noise.
    expect(needsTermsAcknowledgement(TERMS_VERSION + 5)).toBe(false)
  })
})
