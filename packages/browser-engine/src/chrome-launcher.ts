/**
 * Browser adapter: plain Chrome, launched the way a shortcut would.
 *
 * No CDP anywhere — the target game's Turnstile rejects controlled browsers.
 * That costs us the handle Playwright used to give us, so the slot→process link
 * is rebuilt here from the profile path on the command line.
 *
 * Holds no business rules. Which slot runs where, and when to restart, are the
 * orchestrator's decisions.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserLauncher, LaunchRequest } from '@helloweb/core'
import { buildChromeArgs } from './chrome-args.js'

const DEFAULT_CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
]

export function findChromeExecutable(): string | undefined {
  return DEFAULT_CHROME_PATHS.find((path) => existsSync(path))
}

interface ChromeProcess {
  pid: number
  commandLine: string
}

function listChromeProcesses(): ChromeProcess[] {
  const script =
    "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' } " +
    '| Select-Object ProcessId,CommandLine) | ConvertTo-Json -Compress'
  let stdout: string
  try {
    stdout = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      // Capture stdout, but silence stderr rather than letting it inherit the
      // app's console: PowerShell writes progress and CLIXML noise there, which
      // otherwise surfaces in the running app's output for no reason.
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return []
  }
  if (!stdout.trim()) return []

  try {
    const parsed = JSON.parse(stdout) as { ProcessId: number; CommandLine: string | null }[]
    return parsed.map((entry) => ({ pid: entry.ProcessId, commandLine: entry.CommandLine ?? '' }))
  } catch {
    return []
  }
}

/**
 * The browser process for a profile.
 *
 * Matching is on the profile path rather than the window title: a title filter
 * would happily match the user's own Chrome window showing the same game, and
 * during the Phase 0 spike it did exactly that. Renderers and GPU helpers carry
 * `--type=`; the browser process is the one that does not.
 */
function findBrowserPid(profilePath: string): number | undefined {
  const needle = `--user-data-dir=${profilePath}`
  return listChromeProcesses().find(
    (proc) => proc.commandLine.includes(needle) && !proc.commandLine.includes('--type='),
  )?.pid
}

async function waitForBrowserPid(profilePath: string, timeoutMs = 20_000): Promise<number> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const pid = findBrowserPid(profilePath)
    if (pid !== undefined) return pid
    if (Date.now() >= deadline) {
      throw new Error(`Chrome did not start for profile ${profilePath} within ${timeoutMs}ms`)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

interface RunningProfile {
  path: string
  /** Throwaway directory this adapter created, and the only thing it may delete. */
  ephemeral: boolean
}

export class ChromeLauncher implements BrowserLauncher {
  private readonly chromePath: string | undefined
  private readonly profiles = new Map<number, RunningProfile>()

  constructor(
    private readonly profilesRoot: string,
    chromePath?: string,
  ) {
    this.chromePath = chromePath ?? findChromeExecutable()
  }

  /** Where a running slot's profile lives. Useful in logs and diagnostics. */
  profilePathOf(pid: number): string | undefined {
    return this.profiles.get(pid)?.path
  }

  async launch(request: LaunchRequest): Promise<number> {
    const chrome = this.chromePath
    if (!chrome || !existsSync(chrome)) {
      throw new Error(`Chrome executable not found${chrome ? ` at ${chrome}` : ''}`)
    }

    // A clean session gets a throwaway directory under the OS temp dir, and
    // that directory is the only thing stop() will ever delete. The slot's
    // persistent profile is never the target of removal code, so no bug in the
    // persistProfile flag can destroy a logged-in session.
    const ephemeral = !request.persistProfile
    const profilePath = ephemeral
      ? mkdtempSync(join(tmpdir(), 'helloweb-clean-'))
      : join(this.profilesRoot, request.profileDir)
    if (!ephemeral) mkdirSync(profilePath, { recursive: true })

    // Detached: the browser outlives this call, and the pid returned by spawn is
    // a launcher stub that exits immediately. The real one is found below.
    const stub = spawn(chrome, buildChromeArgs(request, profilePath), {
      detached: true,
      stdio: 'ignore',
    })
    stub.unref()

    const pid = await waitForBrowserPid(profilePath)
    this.profiles.set(pid, { path: profilePath, ephemeral })
    return pid
  }

  /** How long a browser gets to shut down on its own before it is forced. */
  private static readonly CLOSE_GRACE_MS = 5000

  /**
   * Stops a slot, asking before forcing.
   *
   * The asking matters. `taskkill /F` is an unclean exit, and Chrome records
   * that in its own profile: the next launch of that slot opens with "Restore
   * pages? Chrome didn't shut down correctly", over a window the user just
   * asked for. A plain taskkill sends WM_CLOSE instead, which Chrome treats as
   * a normal shutdown - it flushes its session state and marks the profile as
   * closed properly.
   *
   * Force remains, because a browser that will not close must not leave a slot
   * stuck forever. Only the order changed.
   */
  async stop(pid: number): Promise<void> {
    const profile = this.profiles.get(pid)

    if (this.isAlive(pid)) {
      this.askToClose(pid)
      await this.waitForExit(pid, ChromeLauncher.CLOSE_GRACE_MS)
      if (this.isAlive(pid)) {
        // /T takes the renderer and GPU children with it; without it they linger.
        try {
          execFileSync('taskkill', ['/PID', String(pid), '/F', '/T'], { stdio: 'ignore' })
        } catch {
          // Already gone between the check and the kill.
        }
      }
    }

    this.profiles.delete(pid)
    if (profile?.ephemeral) await this.discard(profile.path)
  }

  /**
   * Asks the browser window to close, the way clicking its X does.
   *
   * `taskkill` without /F was tried first and does not work here: Chrome
   * ignores it, the full grace period elapses, and the force path runs anyway.
   * CloseMainWindow posts WM_CLOSE to the process's main window, which Chrome
   * treats as a real close - measured at ~360ms, after which it has flushed its
   * session and written exit_type Normal into the profile.
   *
   * No double quotes in the command, deliberately: PowerShell eats those out of
   * a -Command string, which docs/troubleshooting.md records the hard way.
   */
  private askToClose(pid: number): void {
    try {
      execFileSync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid}).CloseMainWindow()`],
        { stdio: 'ignore' },
      )
    } catch {
      // No such process, or no main window to close. The force path follows.
    }
  }

  private async waitForExit(pid: number, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (this.isAlive(pid) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  /**
   * Deletes a throwaway profile.
   *
   * Guarded twice over: only paths this adapter created as ephemeral get here,
   * and the path must still sit under the OS temp directory. Deleting profile
   * data is the most destructive thing this app does, so the guard is worth
   * more than the two lines it costs.
   */
  private async discard(path: string): Promise<void> {
    const temporary = tmpdir()
    if (!path.startsWith(temporary) || path === temporary) {
      throw new Error(`refusing to delete ${path}: not a throwaway profile`)
    }
    // Chrome holds file handles briefly after exit; retry rather than fail.
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        rmSync(path, { recursive: true, force: true })
        return
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }
  }

  isAlive(pid: number): boolean {
    try {
      // Signal 0 checks for existence without touching the process.
      process.kill(pid, 0)
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM'
    }
  }
}
