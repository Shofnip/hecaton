import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WasapiAudioController } from './wasapi-audio-controller.js'

const onWindows = process.platform === 'win32'

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].find((path) => existsSync(path))

// A continuous quiet tone, so the slot opens a real WASAPI render session that
// this adapter can then find and mute. Autoplay needs the flag on the command
// line below; without a session there would be nothing to test.
const TONE_HTML = `<!doctype html><meta charset="utf-8"><title>tone</title><script>
const ctx = new AudioContext();
const osc = ctx.createOscillator();
const gain = ctx.createGain();
gain.gain.value = 0.02; osc.frequency.value = 220;
osc.connect(gain).connect(ctx.destination); osc.start(); ctx.resume();
</script>`

/** The browser process for a profile — the one without --type=, as the launcher matches. */
function browserPidFor(profilePath: string): number | undefined {
  const script =
    "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' } " +
    '| Select-Object ProcessId,CommandLine) | ConvertTo-Json -Compress'
  const stdout = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  if (!stdout.trim()) return undefined
  const rows = JSON.parse(stdout) as { ProcessId: number; CommandLine: string | null }[]
  return rows.find(
    (row) =>
      (row.CommandLine ?? '').includes(`--user-data-dir=${profilePath}`) &&
      !(row.CommandLine ?? '').includes('--type='),
  )?.ProcessId
}

interface Slot {
  profile: string
  page: string
  pid: number
}

async function launchTone(): Promise<Slot> {
  const profile = mkdtempSync(join(tmpdir(), 'helloweb-audio-'))
  const page = join(profile, 'tone.html')
  writeFileSync(page, TONE_HTML)
  const child = spawn(
    CHROME!,
    [
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required',
      '--new-window',
      `file:///${page.replace(/\\/g, '/')}`,
    ],
    { detached: true, stdio: 'ignore' },
  )
  child.unref()

  let pid: number | undefined
  for (let attempt = 0; attempt < 60; attempt++) {
    pid = browserPidFor(profile)
    if (pid !== undefined) break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  expect(pid).toBeGreaterThan(0)
  return { profile, page, pid: pid! }
}

function kill(pid: number): void {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/F', '/T'], { stdio: 'ignore' })
  } catch {
    // already gone
  }
}

function removeDir(path: string): void {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      rmSync(path, { recursive: true, force: true })
      return
    } catch {
      // Chrome briefly holds handles after exit; a synchronous retry is enough
      // by the time the OS releases them.
    }
  }
}

let controller: WasapiAudioController
let a: Slot
let b: Slot

describe.skipIf(!onWindows || !CHROME)('WasapiAudioController', () => {
  beforeAll(async () => {
    controller = new WasapiAudioController()
    a = await launchTone()
    b = await launchTone()
    // Give the tone time to actually start rendering, so the session exists.
    await new Promise((resolve) => setTimeout(resolve, 4000))
  }, 120_000)

  afterAll(() => {
    if (a) {
      kill(a.pid)
      removeDir(a.profile)
    }
    if (b) {
      kill(b.pid)
      removeDir(b.profile)
    }
  })

  it('mutes a slot by its main pid', async () => {
    await controller.setMuted(a.pid, true)
    expect(await controller.probeMuted(a.pid)).toBe(true)
  })

  it('leaves the other slot untouched', async () => {
    // The whole point of per-process muting: silencing one slot must not silence
    // its neighbour, nor the user's own browser.
    expect(await controller.probeMuted(b.pid)).not.toBe(true)
  })

  it('unmutes the slot again', async () => {
    await controller.setMuted(a.pid, false)
    expect(await controller.probeMuted(a.pid)).toBe(false)
  })

  it('does not throw for a pid with no audio session', async () => {
    await expect(controller.setMuted(999_999, true)).resolves.toBeUndefined()
    expect(await controller.probeMuted(999_999)).toBeUndefined()
  })
})
