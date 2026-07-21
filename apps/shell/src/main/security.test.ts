/**
 * The Electron security posture, tested as data.
 *
 * Everything here is a value or a pure predicate, deliberately: the wiring that
 * hands these to Electron cannot run in the fast suite, so the parts that carry
 * the decisions are kept where they can be asserted on every commit. What is
 * left in main.ts is the handing-over, and nothing else.
 */
import { describe, expect, it } from 'vitest'
import {
  CONTENT_SECURITY_POLICY,
  allowsNavigation,
  cspHeaders,
  panelWebPreferences,
} from './security.js'

function directive(name: string): string | undefined {
  return CONTENT_SECURITY_POLICY.split(';')
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `))
}

describe('the content security policy', () => {
  it('denies everything by default', () => {
    // Everything the panel may load is then an explicit exception, so a
    // forgotten directive fails closed rather than open.
    expect(directive('default-src')).toBe("default-src 'none'")
  })

  it.each([
    ['script-src', "script-src 'self'"],
    ['style-src', "style-src 'self'"],
    ['img-src', "img-src 'self' data:"],
    ['font-src', "font-src 'self'"],
    ['connect-src', "connect-src 'none'"],
    ['form-action', "form-action 'none'"],
    ['frame-src', "frame-src 'none'"],
    ['object-src', "object-src 'none'"],
    ['base-uri', "base-uri 'none'"],
  ])('sets %s', (name, expected) => {
    expect(directive(name)).toBe(expected)
  })

  it('never allows inline script or style', () => {
    // An injection in a panel that talks to a process which launches browsers
    // and owns logged-in sessions is the worst case this app has. Keeping CSS
    // and JS in files is the price, and it is small.
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe-inline')
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe-eval')
  })

  it('forbids the app from making network requests at all', () => {
    // connect-src 'none' is the whole of decision 4A's network stance: no
    // update check, no telemetry, no remote asset. Anything that needs the
    // network in a later phase has to change this line, on purpose.
    expect(directive('connect-src')).toBe("connect-src 'none'")
  })
})

describe('cspHeaders', () => {
  it('keeps the headers the response already carried', () => {
    // Measured on Electron 43: a file:// response arrives with Content-Type and
    // Last-Modified, and replacing rather than merging them fails the load
    // outright. This is the bug that made an intermediate probe look like proof
    // that header CSP does not work over file://.
    const merged = cspHeaders({ 'Content-Type': ['text/html'], 'Last-Modified': ['whenever'] })
    expect(merged['Content-Type']).toEqual(['text/html'])
    expect(merged['Last-Modified']).toEqual(['whenever'])
  })

  it('adds the policy', () => {
    expect(cspHeaders({})['Content-Security-Policy']).toEqual([CONTENT_SECURITY_POLICY])
  })

  it('replaces a policy the response already claimed', () => {
    // Two CSP headers are intersected by the browser, which sounds safe until
    // the other one is the weaker one someone added to debug something.
    const merged = cspHeaders({ 'Content-Security-Policy': ['default-src *'] })
    expect(merged['Content-Security-Policy']).toEqual([CONTENT_SECURITY_POLICY])
  })

  it('survives a response with no headers', () => {
    expect(() => cspHeaders(undefined)).not.toThrow()
  })
})

describe('the panel window', () => {
  it('isolates the renderer', () => {
    expect(panelWebPreferences()).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    })
  })

  it('turns off what the panel does not use', () => {
    expect(panelWebPreferences()).toMatchObject({
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      spellcheck: false,
    })
  })

  it('keeps web security on', () => {
    // Never weaken an existing control to unblock a problem.
    expect(panelWebPreferences().webSecurity).toBe(true)
  })
})

describe('navigation', () => {
  it.each([
    ['the game itself', 'https://poke.idleworld.online/'],
    ['any https page', 'https://example.com/'],
    ['a local file', 'file:///C:/Windows/win.ini'],
    ['a javascript url', 'javascript:alert(1)'],
    ['about:blank', 'about:blank'],
  ])('refuses to navigate to %s', (_case, url) => {
    // The panel is one static page that never navigates. Game urls open in the
    // user's Chrome, never here: a logged-in session inside the Electron
    // process is precisely what the whole architecture avoids.
    expect(allowsNavigation(url)).toBe(false)
  })
})
