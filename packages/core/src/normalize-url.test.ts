import { describe, expect, it } from 'vitest'
import { normalizeUrl } from './normalize-url.js'

describe('normalizeUrl', () => {
  it('adds https to a bare domain', () => {
    // So the user can type google.com instead of https://www.google.com.
    expect(normalizeUrl('google.com')).toBe('https://google.com')
  })

  it('adds https to a bare domain with a path', () => {
    expect(normalizeUrl('poke.idleworld.online/play')).toBe('https://poke.idleworld.online/play')
  })

  it('leaves an https url untouched', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeUrl('  example.com  ')).toBe('https://example.com')
  })

  it('does not upgrade an explicit http url', () => {
    // A scheme the user typed on purpose is left as they typed it, so the https
    // check downstream rejects it rather than this quietly coercing insecure
    // input into looking secure.
    expect(normalizeUrl('http://example.com/')).toBe('http://example.com/')
  })

  it('leaves a url that already has a scheme+authority alone', () => {
    // file:// and the like carry `://`, so they pass through unchanged and the
    // https check downstream rejects them. Only a bare host gets a scheme.
    expect(normalizeUrl('file:///C:/Windows/win.ini')).toBe('file:///C:/Windows/win.ini')
  })

  it('leaves an empty string empty', () => {
    expect(normalizeUrl('   ')).toBe('')
  })
})
