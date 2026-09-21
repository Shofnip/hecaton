export interface SidebarView {
  hidden: boolean
  collapsed: boolean
  order: readonly string[]
}

export interface SidebarDragView {
  id: string
  overId: string | undefined
}

interface Drag {
  id: string
  pointerId: number
  from: { x: number; y: number }
  active: boolean
  overId: string | undefined
}

/** Pure session state behind the sidebar's DOM gestures. */
export class SidebarSession {
  private order: string[]
  private collapsed = false
  private drag: Drag | undefined

  constructor(
    private readonly actions: readonly string[],
    private readonly dragThreshold = 6,
  ) {
    this.order = [...actions]
  }

  get dragging(): boolean {
    return this.drag?.active === true
  }

  get tracking(): boolean {
    return this.drag !== undefined
  }

  get dragView(): SidebarDragView | undefined {
    return this.drag?.active ? { id: this.drag.id, overId: this.drag.overId } : undefined
  }

  view(focused: boolean): SidebarView {
    return { hidden: focused, collapsed: this.collapsed, order: [...this.order] }
  }

  toggleCollapsed(): void {
    this.collapsed = !this.collapsed
  }

  move(id: string, overId: string): boolean {
    if (id === overId || !this.actions.includes(id) || !this.actions.includes(overId)) return false
    const toIndex = this.order.indexOf(overId)
    if (toIndex < 0) return false
    const rest = this.order.filter((each) => each !== id)
    rest.splice(toIndex, 0, id)
    this.order = rest
    return true
  }

  beginDrag(id: string, pointerId: number, x: number, y: number): void {
    if (!this.actions.includes(id)) return
    this.drag = { id, pointerId, from: { x, y }, active: false, overId: undefined }
  }

  movePointer(
    pointerId: number,
    x: number,
    y: number,
    buttons: number,
    overId: string | undefined,
  ): 'ignored' | 'ended' | 'moved' {
    if (!this.drag || pointerId !== this.drag.pointerId) return 'ignored'
    if (buttons === 0) {
      this.cancelDrag()
      return 'ended'
    }
    if (!this.drag.active) {
      const travelled = Math.abs(x - this.drag.from.x) + Math.abs(y - this.drag.from.y)
      if (travelled < this.dragThreshold) return 'ignored'
      this.drag.active = true
    }
    this.drag.overId = overId
    return 'moved'
  }

  endDrag(pointerId: number): { dragged: boolean; reordered: boolean } {
    if (!this.drag || pointerId !== this.drag.pointerId) {
      return { dragged: false, reordered: false }
    }
    const drag = this.drag
    this.drag = undefined
    return {
      dragged: drag.active,
      reordered: drag.active && drag.overId !== undefined ? this.move(drag.id, drag.overId) : false,
    }
  }

  cancelDrag(): boolean {
    const active = this.drag?.active === true
    this.drag = undefined
    return active
  }
}
