/**
 * The live "one Hecaton on this machine" lock: a named `Global\` mutex, held by
 * a child process for as long as the app runs.
 *
 * Why a mutex and not a lock file, measured in probe P6: a kernel object dies
 * with the last handle to it, so an app killed from Task Manager — which is how
 * this one gets stopped when a browser hangs — leaves nothing behind. A lock
 * file would strand the machine, and teaching the app to ignore a stale one is
 * teaching it to ignore the lock.
 *
 * Why `Global\` and not a per-session name: the whole point is to cross Windows
 * logon sessions. Probe P6 measured that a standard user creates one without
 * `SeCreateGlobalPrivilege` — that privilege governs file-mapping objects, not
 * mutexes — and probe P6b watched an object created in session 0 resolve from
 * session 1.
 *
 * Why the **default** security descriptor: P6 measured it as exactly right. It
 * names SYSTEM, the creator's logon session and the creator's user SID, and
 * nobody else — so another Windows account gets `ACCESS_DENIED`, which is a
 * different failure from "no such name" and is what tells the two cases apart.
 * Opening the DACL up was measured too, and is worse: granting `Everyone:
 * Synchronize` still fails, because .NET asks for `Modify | Synchronize`, so
 * making it work would mean letting any account on the machine interfere with
 * the lock object itself.
 *
 * The known hole, recorded rather than defended against: whoever creates the
 * name first wins. A hostile account can create it with a deny-all DACL and this
 * app cannot tell that apart from a genuine holder — you cannot enumerate the
 * owner of a named object without elevation, and there is no shared secret to
 * prove authenticity, because the source is public (ADR-0013). It surfaces as
 * "another user holds it", which is what it looks like.
 */
import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { InstanceLock, InstanceLockState } from '@hecaton/core'

/**
 * The one name, shared by every Hecaton on the machine.
 *
 * Not derived from anything — not the user, not the install path, not the
 * machine id. Derive it from any of those and the lock quietly becomes per-user
 * or per-installation, which is the exact failure this replaces.
 */
export const INSTANCE_MUTEX_NAME = 'Hecaton.Instance'

/**
 * Take the mutex, say what happened, then hold it until stdin closes.
 *
 * Holding it in a child rather than in the main process is forced: Electron
 * cannot open a Win32 named object without a native module, and this project
 * ships none. What makes the child safe is the `ReadLine` loop — when the parent
 * dies, however it dies, its end of the pipe closes, `ReadLine` returns null and
 * this process exits, closing the handle. The same mechanism the window and
 * audio workers already rely on.
 *
 * The classification is by exception, and walks `InnerException` because
 * PowerShell wraps every .NET call failure in a `MethodInvocationException` —
 * measured in probe P6b. A `catch [System.UnauthorizedAccessException]` happens
 * to match through the wrapper, but a generic catch that reads
 * `$_.Exception.GetType()` sees only the wrapper, and would report the machine
 * free when it is held by someone else.
 */
const WORKER_SCRIPT = (name: string): string => `
$ErrorActionPreference = 'Stop'
$name = 'Global\\${name}'
$mutex = $null
$state = 'free'
try {
  $created = $false
  $mutex = New-Object System.Threading.Mutex($false, $name, [ref]$created)
  if (-not $created) { $state = 'held-by-this-user' }
} catch {
  $state = 'error'
  $e = $_.Exception
  while ($e) {
    if ($e -is [System.UnauthorizedAccessException]) { $state = 'held-by-another-user'; break }
    if ($e -is [System.Threading.WaitHandleCannotBeOpenedException]) { $state = 'free'; break }
    $e = $e.InnerException
  }
}
[Console]::Out.WriteLine($state); [Console]::Out.Flush()
if ($state -ne 'free') { exit 0 }
while ($null -ne [Console]::In.ReadLine()) { }
if ($null -ne $mutex) { $mutex.Dispose() }
`

/** How long the worker gets to report before the claim is treated as failed. */
const CLAIM_TIMEOUT_MS = 15_000

export class MutexInstanceLock implements InstanceLock {
  private worker: ChildProcessWithoutNullStreams | undefined

  /** The name is a parameter so the integration test does not fight the real app. */
  constructor(private readonly name: string = INSTANCE_MUTEX_NAME) {}

  /** The holding process, for diagnostics and for the orphan test. */
  get workerPid(): number | undefined {
    return this.worker?.pid
  }

  async claim(): Promise<InstanceLockState> {
    const worker = spawn(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(WORKER_SCRIPT(this.name), 'utf16le').toString('base64'),
      ],
      { windowsHide: true },
    )
    this.worker = worker

    const state = await new Promise<InstanceLockState | 'error'>((resolve) => {
      const timer = setTimeout(() => resolve('error'), CLAIM_TIMEOUT_MS)
      const settle = (value: InstanceLockState | 'error'): void => {
        clearTimeout(timer)
        resolve(value)
      }
      createInterface({ input: worker.stdout }).on('line', (line) => settle(asState(line.trim())))
      worker.on('error', () => settle('error'))
      worker.on('exit', () => settle('error'))
    })

    if (state === 'free') return state

    // Anything but a clean claim leaves no handle of ours behind: a refused
    // launch that kept one would make the next attempt report contention
    // instead of naming the hypervisor or the seal that actually refused it.
    await this.release()

    // A worker that failed to run at all is not evidence that the machine is
    // busy. Reporting it as free is the same fail-open the core applies to an
    // unreadable machine identity, for the same reason: the instrument broke,
    // not the user.
    return state === 'error' ? 'free' : state
  }

  async release(): Promise<void> {
    const worker = this.worker
    if (!worker) return
    this.worker = undefined
    if (worker.exitCode !== null || worker.signalCode !== null) return
    await new Promise<void>((resolve) => {
      worker.once('exit', () => resolve())
      // Closing stdin is the polite path the worker is written around; the kill
      // is for a worker that never reached its read loop.
      worker.stdin.end()
      setTimeout(() => {
        worker.kill()
        resolve()
      }, 1000)
    })
  }
}

const asState = (line: string): InstanceLockState | 'error' =>
  line === 'free' || line === 'held-by-this-user' || line === 'held-by-another-user'
    ? line
    : 'error'
