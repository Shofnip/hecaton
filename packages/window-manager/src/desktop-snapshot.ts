import type { GridCell } from '@hecaton/core'

export interface DesktopWindowSnapshot {
  readonly id: number
  readonly processId: number
  readonly visible: boolean
  readonly titled: boolean
  readonly bounds: GridCell
}

export interface DesktopSnapshot {
  readonly windows: readonly DesktopWindowSnapshot[]
  readonly monitors: readonly GridCell[]
}
