type Timer = ReturnType<typeof setTimeout>

/**
 * The lifetime of a popover opened by hover.
 *
 * It starts armed because the pointer may leave the button sideways and never
 * enter the popover. Entering disarms it; leaving arms it again. A drag merely
 * postpones the decision rather than losing it, because pointer capture can
 * legitimately keep a slider active outside the popover.
 */
export class HoverClose {
  private timer: Timer | undefined

  constructor(
    private readonly close: () => void,
    private readonly dragging: () => boolean,
    private readonly delayMs: number,
    private readonly cancelDrag: () => void = () => {},
  ) {}

  opened(): void {
    this.arm()
  }

  entered(): void {
    this.disarm()
  }

  left(): void {
    this.arm()
  }

  dispose(): void {
    this.disarm()
    this.cancelDrag()
  }

  private arm(): void {
    this.disarm()
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.dragging()) {
        this.arm()
        return
      }
      this.close()
    }, this.delayMs)
  }

  private disarm(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }
}
