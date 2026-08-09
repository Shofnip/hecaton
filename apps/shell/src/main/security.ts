/**
 * The Electron security posture, as values rather than as scattered calls.
 *
 * The app is distributed, so this file is the one that decides what a hostile
 * page could do if one ever reached the panel. It is kept free of any `electron`
 * import so the decisions can be asserted in the fast suite; main.ts does the
 * handing-over and holds no policy of its own.
 *
 * Decisions 2A, 4A and 5A, taken by the project owner before implementation.
 */

/**
 * Deny by default; every load the panel needs is an explicit exception.
 *
 * `connect-src 'none'` is the load-bearing one, and it says exactly one thing:
 * **the renderer** reaches nothing. No remote asset, no telemetry, no fetch from
 * the panel — which is why the font and the favicon are bundled files.
 *
 * It used to say more. Until 2026-08-09 the app made no request at all, and this
 * comment said so, naming the absence of an update check as part of what the
 * policy bought. D7 changed that: the update check is a `fetch` in the **main
 * process**, where no CSP applies, and it did not need this line touched. The
 * distinction matters both ways — nobody should read this header as proof the
 * app is offline, and nobody should relax it to add a request that never needed
 * it.
 *
 * No `unsafe-inline` anywhere, which is why the panel's CSS and JS are files.
 * An injection here would be an injection into a page that talks to a process
 * launching browsers over logged-in sessions.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ')

export type ResponseHeaders = Record<string, string[]>

/**
 * The response headers to return from `onHeadersReceived`.
 *
 * Merged, never replaced. Measured on Electron 43 / Chromium 150: a `file://`
 * response arrives carrying `Content-Type` and `Last-Modified`, and returning a
 * fresh object without them fails the load with ERR_FAILED. That failure looks
 * exactly like "header CSP does not work over file://", which is what an
 * intermediate probe concluded before this was understood — and it is the
 * reason the panel is loaded from `file://` at all.
 *
 * An existing policy is replaced rather than added to. Two CSP headers are
 * intersected by the browser, which is safe in theory and unhelpful in
 * practice: it makes the effective policy depend on something written
 * elsewhere.
 */
export function cspHeaders(existing: ResponseHeaders | undefined): ResponseHeaders {
  const headers: ResponseHeaders = { ...existing }
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'content-security-policy') delete headers[key]
  }
  headers['Content-Security-Policy'] = [CONTENT_SECURITY_POLICY]
  return headers
}

export interface PanelWebPreferences {
  contextIsolation: boolean
  nodeIntegration: boolean
  sandbox: boolean
  nodeIntegrationInSubFrames: boolean
  webviewTag: boolean
  spellcheck: boolean
  webSecurity: boolean
}

/**
 * The renderer's capabilities.
 *
 * The first three have been Electron defaults for several majors. They are
 * written out anyway: a default is a decision someone else made and can change,
 * and these three are the difference between a sandboxed page and a page with
 * Node.
 */
export function panelWebPreferences(): PanelWebPreferences {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    nodeIntegrationInSubFrames: false,
    webviewTag: false,
    spellcheck: false,
    webSecurity: true,
  }
}

/**
 * Whether the panel window may navigate anywhere. It may not.
 *
 * A function rather than a constant so the call sites read as a decision and so
 * the refused url can be logged. There is no allowlist to add to: game urls
 * open in the user's own Chrome, and a logged-in game session inside the
 * Electron process is the thing this architecture exists to avoid.
 */
export function allowsNavigation(_url: string): boolean {
  return false
}
