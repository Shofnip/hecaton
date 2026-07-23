/**
 * Audio adapter: per-process mute and volume over the Windows Core Audio API
 * (WASAPI).
 *
 * The core asks to mute a slot, or set its volume, by the slot's main pid. On
 * Windows the sound a slot makes belongs to a child "audio service" process
 * Chrome spawns, not to the browser process itself; the mapping from the main
 * pid to that child lives in the worker (its Toolhelp parent-pid lookup), the OS
 * detail ADR-0010 keeps out of the core.
 *
 * Both operations ride one persistent PowerShell worker (wasapi-worker.ts): the
 * Core Audio COM surface is compiled once and driven over stdin, so a volume
 * slider drag lands each change in ~12 ms instead of the ~270 ms a fresh
 * shell-out cost (reparenting spike, item 0.4). No npm dependency and no native
 * build — the same posture ADR-0010 set, only warm.
 *
 * Holds no business rules: which slot is muted or how loud, and when, is the
 * orchestrator's decision. This only carries it out.
 */
import type { AudioController } from '@helloweb/core'
import { WasapiWorker } from './wasapi-worker.js'

export class WasapiAudioController implements AudioController {
  private readonly worker = new WasapiWorker()

  constructor() {
    // Warm the worker while the app is still starting, so the first mute or
    // volume change is already fast. Failure here is harmless: the first real
    // command starts it instead.
    void this.worker.start().catch(() => {})
  }

  async setMuted(pid: number, muted: boolean): Promise<void> {
    if (!Number.isInteger(pid) || pid <= 0) return
    try {
      await this.worker.send(`${muted ? 'mute' : 'unmute'} ${pid}`)
    } catch {
      // Best effort: a slot with no session yet (nothing has played), or a
      // worker that just died and will re-spawn, must not crash the focus loop.
      // The next focus tick applies the desired state again.
    }
  }

  /**
   * Per-screen volume, 0-100, via ISimpleAudioVolume.SetMasterVolume — the same
   * WASAPI session mute drives. Independent of the mute flag: a muted session
   * keeps its volume, so unmuting restores it. Values are clamped to the slider
   * range; a no-op when the process has no audio session yet, like setMuted.
   */
  async setVolume(pid: number, volume: number): Promise<void> {
    if (!Number.isInteger(pid) || pid <= 0) return
    const clamped = Math.max(0, Math.min(100, Math.round(volume)))
    try {
      await this.worker.send(`vol ${pid} ${clamped}`)
    } catch {
      // Same best-effort contract as setMuted.
    }
  }

  /**
   * The mute state of the slot's audio session, or undefined when it has none.
   * Diagnostics and the integration suite only — the core never reads state, it
   * only sets it.
   */
  async probeMuted(pid: number): Promise<boolean | undefined> {
    const reply = await this.query('query', pid)
    const match = reply && /muted=(True|False)/.exec(reply)
    if (!match) return undefined
    return match[1] === 'True'
  }

  /**
   * The 0..1 master volume of the slot's audio session, or undefined when it has
   * none. Diagnostics and the integration suite only.
   */
  async probeVolume(pid: number): Promise<number | undefined> {
    const reply = await this.query('getvol', pid)
    const match = reply && /vol=([\d.]+)/.exec(reply)
    if (!match) return undefined
    return Number(match[1])
  }

  /** Sends a read command; undefined on any failure or when no session was hit. */
  private async query(command: 'query' | 'getvol', pid: number): Promise<string | undefined> {
    let reply: string
    try {
      reply = await this.worker.send(`${command} ${pid}`)
    } catch {
      return undefined
    }
    // "SESSIONS=0" means the pid owns no audio session — nothing to report.
    return /SESSIONS=0(?:\s|$)/.test(reply) ? undefined : reply
  }

  /** Stops the persistent worker. Call on shutdown; the controller is done after. */
  async dispose(): Promise<void> {
    await this.worker.dispose()
  }
}
