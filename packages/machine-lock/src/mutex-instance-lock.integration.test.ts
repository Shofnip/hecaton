/**
 * The lock against the real kernel object, which is the only place it can be
 * tested: a fake mutex would be testing the fake, and every interesting
 * behaviour here — who is denied, what happens when the holder is killed — is
 * the operating system's, not this code's.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { MutexInstanceLock } from './mutex-instance-lock.js'

/** A name per test file run, so a leftover from an earlier run cannot confuse it. */
const NAME = `Hecaton.Test.${process.pid}`

const locks: MutexInstanceLock[] = []
const holders: ChildProcessWithoutNullStreams[] = []

const lock = (name = NAME): MutexInstanceLock => {
  const created = new MutexInstanceLock(name)
  locks.push(created)
  return created
}

afterEach(async () => {
  for (const held of locks.splice(0)) await held.release()
  for (const holder of holders.splice(0)) holder.kill()
})

/**
 * Holds `name` from another process with a DACL that names only SYSTEM.
 *
 * This is probe P6's simulation of a second Windows account, and it is here for
 * the reason P6b found: the kernel denial is real, but PowerShell wraps the
 * exception, so a classifier that looks at the wrong exception would report
 * "unknown" where it must report "occupied" — and nothing in the fast suite can
 * see that, because the fast suite has no PowerShell. A real second account is
 * still the manual pre-release check; this covers the code path on every run.
 */
function holdWithForeignDacl(name: string): Promise<void> {
  const script = `
$rule = New-Object System.Security.AccessControl.MutexAccessRule(
  (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')),
  [System.Security.AccessControl.MutexRights]::FullControl,
  [System.Security.AccessControl.AccessControlType]::Allow)
$sec = New-Object System.Security.AccessControl.MutexSecurity
$sec.SetAccessRule($rule)
$m = New-Object System.Threading.Mutex($false, 'Global\\${name}')
$m.SetAccessControl($sec)
[Console]::Out.WriteLine('HELD'); [Console]::Out.Flush()
while ($null -ne [Console]::In.ReadLine()) { }
`
  const proc = spawn(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    { windowsHide: true },
  )
  holders.push(proc)
  return new Promise((resolve, reject) => {
    proc.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('HELD')) resolve()
    })
    proc.on('error', reject)
    proc.on('exit', () => reject(new Error('foreign holder exited before holding')))
  })
}

describe('MutexInstanceLock', () => {
  it('takes a free name', async () => {
    expect(await lock().claim()).toBe('free')
  })

  it('reports the same Windows user when this account already holds it', async () => {
    // P6 measured why this is not "denied": the default DACL names the creator's
    // own SID, so a second process of the same account opens the object fine.
    await lock().claim()
    expect(await lock().claim()).toBe('held-by-this-user')
  })

  it('frees the name again on release', async () => {
    const first = lock()
    expect(await first.claim()).toBe('free')
    await first.release()
    expect(await lock().claim()).toBe('free')
  })

  it('reports another Windows user when the DACL does not name us', async () => {
    const name = `${NAME}.Foreign`
    await holdWithForeignDacl(name)
    expect(await lock(name).claim()).toBe('held-by-another-user')
  })

  it('leaves no orphan when the holding process is killed outright', async () => {
    // The whole reason the lock is a mutex and not a file. It has to survive the
    // app being killed with Task Manager, which is how this app gets stopped
    // when a browser hangs — a lock file would strand the machine, and teaching
    // the app to ignore a stale one would defeat the lock.
    const held = lock()
    expect(await held.claim()).toBe('free')
    const pid = held.workerPid
    expect(pid).toBeDefined()

    process.kill(pid!)
    await new Promise((resolve) => setTimeout(resolve, 1500))

    expect(await lock().claim()).toBe('free')
  })

  it('reports free again after a claim that was refused', async () => {
    // A refused claim must not leave a handle behind. If it did, the refusal
    // would look like contention on the next attempt instead of naming its real
    // cause.
    const name = `${NAME}.Refused`
    await holdWithForeignDacl(name)
    const refused = lock(name)
    expect(await refused.claim()).toBe('held-by-another-user')
    await refused.release()
    expect(refused.workerPid).toBeUndefined()
  })
})
