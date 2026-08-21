/**
 * In-memory implementations of every port, for testing the orchestrator without
 * a browser, a window server or a disk.
 *
 * These live in the core rather than a separate package because the core is
 * what defines the ports — the fakes are their reference implementation. Split
 * them out when a second consumer needs them, not before.
 */
import type { GridCell } from '../grid.js'
import type {
  AudioController,
  BrowserLauncher,
  InstanceLock,
  LaunchRequest,
  MachineIdentity,
  ProfileArchive,
  Storage,
  WindowManager,
} from '../ports.js'
import type { InstanceLockState, MachineFacts } from '../instance-claim.js'
import type { LogEntry, Logger } from '../log.js'

export class FakeProfileArchive implements ProfileArchive {
  readonly archived: string[] = []
  readonly clearedCaches: string[] = []
  cleared = 0

  archive(profileDir: string): Promise<void> {
    this.archived.push(profileDir)
    return Promise.resolve()
  }

  clearArchives(): Promise<void> {
    this.cleared++
    return Promise.resolve()
  }

  clearCache(profileDir: string): Promise<void> {
    this.clearedCaches.push(profileDir)
    return Promise.resolve()
  }
}

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
  readonly reparented: number[] = []
  readonly hidden: number[] = []
  readonly shown: number[] = []
  readonly reloaded: number[] = []
  readonly closed: number[] = []

  /** Pids whose window is "not found yet", as when the browser is still starting. */
  readonly missing = new Set<number>()

  setBounds(pid: number, bounds: GridCell): boolean {
    if (this.missing.has(pid)) return false
    this.bounds.set(pid, bounds)
    return true
  }

  reparent(pid: number): boolean {
    if (this.missing.has(pid)) return false
    this.reparented.push(pid)
    return true
  }

  hide(pid: number): boolean {
    if (this.missing.has(pid)) return false
    this.hidden.push(pid)
    return true
  }

  show(pid: number): boolean {
    if (this.missing.has(pid)) return false
    this.shown.push(pid)
    return true
  }

  reload(pid: number): boolean {
    if (this.missing.has(pid)) return false
    this.reloaded.push(pid)
    return true
  }

  close(pid: number): boolean {
    if (this.missing.has(pid)) return false
    this.closed.push(pid)
    return true
  }
}

export class FakeAudioController implements AudioController {
  /** Every mute call, in order, so a test can assert what changed and how often. */
  readonly muteCalls: { pid: number; muted: boolean }[] = []
  /** Every volume call, in order. */
  readonly volumeCalls: { pid: number; volume: number }[] = []

  setMuted(pid: number, muted: boolean): Promise<void> {
    this.muteCalls.push({ pid, muted })
    return Promise.resolve()
  }

  setVolume(pid: number, volume: number): Promise<void> {
    this.volumeCalls.push({ pid, volume })
    return Promise.resolve()
  }

  /** The last mute state applied to a pid, or false if it was never touched. */
  isMuted(pid: number): boolean {
    let state = false
    for (const call of this.muteCalls) if (call.pid === pid) state = call.muted
    return state
  }

  /** The last volume applied to a pid, or undefined if it was never touched. */
  volumeOf(pid: number): number | undefined {
    let volume: number | undefined
    for (const call of this.volumeCalls) if (call.pid === pid) volume = call.volume
    return volume
  }
}

export class FakeStorage<T> implements Storage<T> {
  saves = 0

  /**
   * Set to make `load` reject.
   *
   * A file that will not load is a real state with real consequences - it is
   * what tells the instance guard that a hardware seal has been tampered with -
   * and a fake that can only succeed cannot express it.
   */
  failLoad: Error | undefined

  constructor(private value: T | undefined = undefined) {}

  load(): Promise<T | undefined> {
    if (this.failLoad) return Promise.reject(this.failLoad)
    return Promise.resolve(this.value)
  }

  save(value: T): Promise<void> {
    this.value = value
    this.saves++
    return Promise.resolve()
  }
}

/** The physical desktop probes P6 and P6b ran on, as WMI answered on it. */
export const PHYSICAL_MACHINE: MachineFacts = {
  manufacturer: 'ASUS',
  model: 'System Product Name',
  productUuid: '8F3A1C22-6B4D-11EE-9C1A-04421A1B2C3D',
  boardSerial: '230512345600123',
}

export class FakeMachineIdentity implements MachineIdentity {
  reads = 0

  constructor(private readonly facts: MachineFacts = PHYSICAL_MACHINE) {}

  read(): Promise<MachineFacts> {
    this.reads++
    return Promise.resolve(this.facts)
  }

  /**
   * Readable rather than realistic, so a failing assertion shows what was
   * hashed. The real adapter's digest is sha256; what the core relies on is only
   * that it is a stable one-way function of the canonical id.
   */
  digest(canonicalId: string): string {
    return `digest(${canonicalId})`
  }
}

export class FakeInstanceLock implements InstanceLock {
  claims = 0
  releases = 0

  constructor(private readonly state: InstanceLockState = 'free') {}

  claim(): Promise<InstanceLockState> {
    this.claims++
    return Promise.resolve(this.state)
  }

  release(): Promise<void> {
    this.releases++
    return Promise.resolve()
  }
}
