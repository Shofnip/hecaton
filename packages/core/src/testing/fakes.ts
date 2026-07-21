/**
 * In-memory implementations of every port, for testing the orchestrator without
 * a browser, a window server or a disk.
 *
 * These live in the core rather than a separate package because the core is
 * what defines the ports — the fakes are their reference implementation. Split
 * them out when a second consumer needs them, not before.
 */
import type { GridCell } from '../grid.js'
import type { BrowserLauncher, LaunchRequest, Storage, WindowManager } from '../ports.js'
import type { LogEntry, Logger } from '../log.js'

export class FakeLogger implements Logger {
  readonly entries: LogEntry[] = []

  log(entry: LogEntry): void {
    this.entries.push(entry)
  }

  events(): string[] {
    return this.entries.map((entry) => entry.event)
  }
}

export class FakeBrowserLauncher implements BrowserLauncher {
  readonly launched: LaunchRequest[] = []
  readonly stopped: number[] = []

  /** Set to make the next launch reject, simulating a browser that never started. */
  failNextLaunch: Error | undefined

  private nextPid = 1000
  private readonly alive = new Set<number>()
  private readonly pidsBySlot = new Map<number, number>()

  launch(request: LaunchRequest): Promise<number> {
    if (this.failNextLaunch) {
      const error = this.failNextLaunch
      this.failNextLaunch = undefined
      return Promise.reject(error)
    }
    this.launched.push(request)
    const pid = this.nextPid++
    this.alive.add(pid)
    this.pidsBySlot.set(request.slotId, pid)
    return Promise.resolve(pid)
  }

  stop(pid: number): Promise<void> {
    this.alive.delete(pid)
    this.stopped.push(pid)
    return Promise.resolve()
  }

  isAlive(pid: number): boolean {
    return this.alive.has(pid)
  }

  /** Simulates the process dying on its own — a crash, or the user closing the window. */
  killSilently(pid: number): void {
    this.alive.delete(pid)
  }

  pidForSlot(slotId: number): number | undefined {
    return this.pidsBySlot.get(slotId)
  }
}

export class FakeWindowManager implements WindowManager {
  readonly bounds = new Map<number, GridCell>()
  readonly focused: number[] = []

  /** Pids whose window is "not found yet", as when the browser is still starting. */
  readonly missing = new Set<number>()

  setBounds(pid: number, bounds: GridCell): boolean {
    if (this.missing.has(pid)) return false
    this.bounds.set(pid, bounds)
    return true
  }

  focus(pid: number): boolean {
    if (this.missing.has(pid)) return false
    this.focused.push(pid)
    return true
  }
}

export class FakeStorage<T> implements Storage<T> {
  saves = 0

  constructor(private value: T | undefined = undefined) {}

  load(): Promise<T | undefined> {
    return Promise.resolve(this.value)
  }

  save(value: T): Promise<void> {
    this.value = value
    this.saves++
    return Promise.resolve()
  }
}
