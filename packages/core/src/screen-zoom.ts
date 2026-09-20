import type { ZoomController, ZoomPreferences } from './ports.js'
import { zoomStepsFromDefault } from './zoom.js'

interface PendingZoom {
  wanted: number
  applied: number | undefined
  working: boolean
}

/** Latest target per screen; independent of geometry and never holds a resize. */
export class ScreenZoom {
  private readonly screens = new Map<number, PendingZoom>()

  constructor(
    private readonly preferences: ZoomPreferences,
    private readonly controller: ZoomController,
  ) {}

  request(pid: number, factor: number): void {
    let state = this.screens.get(pid)
    if (state === undefined) {
      state = { wanted: factor, applied: undefined, working: false }
      this.screens.set(pid, state)
    }
    state.wanted = factor
    if (!state.working && state.applied !== factor) void this.apply(pid, state)
  }

  /** Invalidates pending reads as well as successful targets; pids can be reused. */
  forget(pid: number): void {
    this.screens.delete(pid)
  }

  private async apply(pid: number, state: PendingZoom): Promise<void> {
    state.working = true
    try {
      while (this.screens.get(pid) === state) {
        const level = await this.preferences.defaultZoomLevel(pid)
        if (this.screens.get(pid) !== state || level === undefined) return
        const target = state.wanted
        const steps = zoomStepsFromDefault(level, target)
        if (steps === undefined) return
        const accepted = await this.controller.applyZoom(pid, steps)
        if (this.screens.get(pid) !== state) return
        if (accepted) state.applied = target
        if (state.wanted === target) return
      }
    } catch {
      // Retry on a later layout, without spinning or exposing profile errors.
    } finally {
      state.working = false
    }
  }
}
