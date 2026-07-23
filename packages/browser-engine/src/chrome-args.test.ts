import { describe, expect, it } from 'vitest'
import { buildChromeArgs } from './chrome-args.js'
import type { LaunchRequest } from '@helloweb/core'

const REQUEST: LaunchRequest = {
  slotId: 1,
  url: 'https://poke.idleworld.online/',
  profileDir: 'slot-1',
  bounds: { x: 0, y: 0, width: 960, height: 1080 },
  mute: false,
  persistProfile: true,
  backgroundThrottling: false,
}

const PROFILE_PATH = 'C:\\Users\\x\\AppData\\Roaming\\helloweb\\profiles\\slot-1'

describe('buildChromeArgs', () => {
  it('points Chrome at the slot profile, which is what isolates the session', () => {
    expect(buildChromeArgs(REQUEST, PROFILE_PATH)).toContain(`--user-data-dir=${PROFILE_PATH}`)
  })

  it('places the window where the grid says', () => {
    const args = buildChromeArgs(REQUEST, PROFILE_PATH)
    expect(args).toContain('--window-position=0,0')
    expect(args).toContain('--window-size=960,1080')
  })

  it('opens the url as an app window, not a tab', () => {
    // App windows do not take part in Chrome's session restore, so a slot never
    // reopens the tabs from last time and never accumulates them. A normal
    // window would, and stopping cleanly (which it must, to avoid the "restore
    // pages?" bubble) is exactly what makes that restore fire.
    expect(buildChromeArgs(REQUEST, PROFILE_PATH)).toContain('--app=https://poke.idleworld.online/')
  })

  it('does not open a normal browser window alongside the app window', () => {
    // --new-window plus --app would open two windows. Only the app window
    // should exist, and the url must not trail as a bare argument either, which
    // would open it as an ordinary tab.
    const args = buildChromeArgs(REQUEST, PROFILE_PATH)
    expect(args).not.toContain('--new-window')
    expect(args).not.toContain('https://poke.idleworld.online/')
  })

  it('suppresses first-run prompts that would cover the game', () => {
    const args = buildChromeArgs(REQUEST, PROFILE_PATH)
    expect(args).toContain('--no-first-run')
    expect(args).toContain('--no-default-browser-check')
  })

  it('mutes only when asked', () => {
    expect(buildChromeArgs(REQUEST, PROFILE_PATH)).not.toContain('--mute-audio')
    expect(buildChromeArgs({ ...REQUEST, mute: true }, PROFILE_PATH)).toContain('--mute-audio')
  })

  it('handles a negative window position, for a monitor left of the primary', () => {
    const request: LaunchRequest = {
      ...REQUEST,
      bounds: { x: -1920, y: 0, width: 960, height: 1080 },
    }
    expect(buildChromeArgs(request, PROFILE_PATH)).toContain('--window-position=-1920,0')
  })

  describe('flags that must never appear', () => {
    // These weaken protections that exist for a reason. Adding any of them to
    // unblock a problem is a security decision for the project owner, never an
    // implementation detail - so the ban is a test, not a code comment.
    const FORBIDDEN = [
      '--no-sandbox',
      '--disable-web-security',
      '--allow-running-insecure-content',
      '--disable-features=IsolateOrigins',
      '--disable-site-isolation-trials',
      '--ignore-certificate-errors',
      '--remote-debugging-port',
      '--remote-debugging-pipe',
      '--disable-blink-features=AutomationControlled',
      '--load-extension',
    ]

    it.each(FORBIDDEN)('never emits %s', (flag) => {
      for (const mute of [true, false]) {
        for (const persistProfile of [true, false]) {
          const args = buildChromeArgs({ ...REQUEST, mute, persistProfile }, PROFILE_PATH)
          expect(args.some((arg) => arg.startsWith(flag))).toBe(false)
        }
      }
    })

    it('never enables remote debugging, which is what the game rejects', () => {
      const args = buildChromeArgs(REQUEST, PROFILE_PATH).join(' ')
      expect(args).not.toMatch(/remote-debugging/)
    })
  })
})
