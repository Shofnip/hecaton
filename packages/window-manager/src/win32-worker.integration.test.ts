/**
 * The shutdown path, against a real PowerShell process.
 *
 * This exists because of a defect observed on 2026-08-09, not because the path
 * looked thin: an app instance was found alive nine minutes after its windows
 * had been hidden, still holding the single-instance lock, with both of its
 * PowerShell workers running. Launching the app again then did nothing at all —
 * the new process took the lock check, lost, and quit silently.
 *
 * The mechanism: `dispose()` awaited the worker's reply to "exit" with no bound.
 * `main.ts` calls `event.preventDefault()` in `before-quit` and only re-issues
 * `app.quit()` once disposal resolves, so a worker that neither answers nor dies
 * keeps the whole app alive with no window to close.
 *
 * The worker used here is a real `powershell.exe` that prints READY and then
 * ignores its stdin forever — which is exactly what the broken case looked like,
 * and something no fake could demonstrate.
 */
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { Win32Worker } from './win32-worker.js'

/** Prints READY so `start()` resolves, then never reads stdin and never exits. */
const DEAF_SCRIPT = 'Write-Output "READY"; while ($true) { Start-Sleep -Seconds 1 }'

let worker: Win32Worker | undefined

afterEach(async () => {
  await worker?.dispose()
  worker = undefined
})

describe('Win32Worker.dispose', () => {
  it('gives up on a worker that never answers, instead of waiting forever', async () => {
    worker = new Win32Worker(DEAF_SCRIPT)
    await worker.start()

    const started = Date.now()
    await worker.dispose()
    const elapsed = Date.now() - started

    // The bound, not the exact duration: what matters is that it returns at all.
    expect(elapsed).toBeLessThan(5000)
  }, 20000)

  it('kills the process it could not shut down politely', async () => {
    // The other half, and the one the orphaned powershell.exe proved was missing:
    // giving up on the reply is only safe if the child still dies.
    worker = new Win32Worker(DEAF_SCRIPT)
    await worker.start()
    const pid = worker.pid
    expect(pid).toBeGreaterThan(0)

    await worker.dispose()

    expect(isAlive(pid!)).toBe(false)
  }, 20000)

  it('still shuts a healthy worker down, and does so promptly', async () => {
    // The regression guard for the fix itself: bounding the wait must not turn
    // every clean shutdown into a timeout. A real worker answers and exits well
    // inside the grace period.
    worker = new Win32Worker()
    await worker.start()

    const started = Date.now()
    await worker.dispose()

    expect(Date.now() - started).toBeLessThan(1000)
  }, 20000)

  it('is safe to call twice', async () => {
    worker = new Win32Worker(DEAF_SCRIPT)
    await worker.start()
    await worker.dispose()
    await expect(worker.dispose()).resolves.toBeUndefined()
  }, 20000)
})

describe('Win32Worker DPI coordinate space', () => {
  it('is per-monitor aware, so Windows does not virtualise physical layout pixels', async () => {
    worker = new Win32Worker()
    await worker.start()
    expect(processDpiAwareness(worker.pid!)).toBe(2)
  }, 20000)
})

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** PROCESS_DPI_AWARENESS from the real worker process: 0 unaware, 1 system, 2 per-monitor. */
function processDpiAwareness(pid: number): number {
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DpiProbe {
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("shcore.dll")] static extern int GetProcessDpiAwareness(IntPtr process, out int awareness);
  public static int Read(uint pid) {
    IntPtr process=OpenProcess(0x1000, false, pid);
    if(process==IntPtr.Zero) throw new Exception("OpenProcess failed");
    try { int awareness; int hr=GetProcessDpiAwareness(process,out awareness); if(hr!=0) throw new Exception("GetProcessDpiAwareness failed: "+hr); return awareness; }
    finally { CloseHandle(process); }
  }
}
'@
[DpiProbe]::Read(${pid})
`
  return Number(
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim(),
  )
}
