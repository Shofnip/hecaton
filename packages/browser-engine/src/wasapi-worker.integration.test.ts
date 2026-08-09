/**
 * The WASAPI worker's shutdown path, against a real PowerShell process.
 *
 * The same defect as `win32-worker.integration.test.ts` documents, in the second
 * of the two workers `main.ts` disposes on quit. It matters that both are
 * covered rather than one: they are separate implementations of the same shape,
 * in separate packages, and `before-quit` waits on
 * `Promise.allSettled([audio, windows])` — so either one hanging alone is enough
 * to keep the whole app alive with its windows hidden.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { WasapiWorker } from './wasapi-worker.js'

/** Prints READY so `start()` resolves, then never reads stdin and never exits. */
const DEAF_SCRIPT = 'Write-Output "READY"; while ($true) { Start-Sleep -Seconds 1 }'

let worker: WasapiWorker | undefined

afterEach(async () => {
  await worker?.dispose()
  worker = undefined
})

describe('WasapiWorker.dispose', () => {
  it('gives up on a worker that never answers, and kills it', async () => {
    worker = new WasapiWorker(DEAF_SCRIPT)
    await worker.start()
    const pid = worker.pid
    expect(pid).toBeGreaterThan(0)

    const started = Date.now()
    await worker.dispose()

    expect(Date.now() - started).toBeLessThan(5000)
    expect(isAlive(pid!)).toBe(false)
  }, 20000)

  it('still shuts a healthy worker down promptly', async () => {
    worker = new WasapiWorker()
    await worker.start()

    const started = Date.now()
    await worker.dispose()

    expect(Date.now() - started).toBeLessThan(1000)
  }, 30000)
})

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
