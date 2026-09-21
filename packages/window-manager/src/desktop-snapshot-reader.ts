import type { DesktopSnapshot, DesktopWindowSnapshot } from './desktop-snapshot.js'
import { DESKTOP_SNAPSHOT_WORKER_SOURCE } from './desktop-snapshot-worker-source.js'
import { Win32Worker } from './win32-worker.js'

export interface DesktopSnapshotFilter {
  readonly processIds: readonly number[]
  readonly panelHwnd?: number
}

/** Reads only requested Win32 windows in a persistent process outside Electron. */
export class DesktopSnapshotReader {
  private readonly worker = new Win32Worker(DESKTOP_SNAPSHOT_WORKER_SOURCE)
  private stopped = false

  constructor() {
    void this.worker.start().catch(() => {})
  }

  get processId(): number | undefined {
    return this.worker.pid
  }

  async read(filter: DesktopSnapshotFilter): Promise<DesktopSnapshot> {
    if (this.stopped) throw new Error('desktop snapshot reader is disposed')
    const pids = filter.processIds.join(',') || '-'
    const reply = await this.worker.send(`scan ${pids} ${filter.panelHwnd ?? 0}`)
    const [monitors = '', windows = ''] = reply.split('|', 2)
    return {
      monitors: parseRows(monitors, 4).map((fields) => ({
        x: fields[0]!,
        y: fields[1]!,
        width: fields[2]!,
        height: fields[3]!,
      })),
      windows: parseRows(windows, 8).map((fields): DesktopWindowSnapshot => ({
        id: fields[0]!,
        processId: fields[1]!,
        visible: fields[2] === 1,
        titled: fields[3] === 1,
        bounds: {
          x: fields[4]!,
          y: fields[5]!,
          width: fields[6]!,
          height: fields[7]!,
        },
      })),
    }
  }

  async dispose(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    await this.worker.dispose()
  }
}

function parseRows(value: string, width: number): number[][] {
  if (!value) return []
  return value.split(';').map((row) => {
    const fields = row.split(',').map(Number)
    if (fields.length !== width || fields.some((field) => !Number.isFinite(field))) {
      throw new Error(`invalid desktop snapshot row: ${JSON.stringify(row)}`)
    }
    return fields
  })
}
