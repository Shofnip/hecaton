type Timer = ReturnType<typeof setTimeout>

/**
 * The lifetime of a popover opened by hover.
 *
 * Opening samples the overlay's mirror of the wall trigger: remaining over
 * that shared region starts disarmed, while a genuine departure starts armed.
 * Entering the popover disarms it; leaving arms it again. A drag merely postpones
 * the decision rather than losing it, because pointer capture can legitimately
 * keep a slider active outside the popover.
 */
export class HoverClose {
  private timer: Timer | undefined
  private disposed = false

  constructor(
    private readonly close: () => void,
    private readonly dragging: () => boolean,
    private readonly delayMs: number,
    private readonly cancelDrag: () => void = () => {},
  ) {}

  opened(insideTrigger: boolean): void {
    // A hover request is sent while the pointer is over the wall's trigger.
    // Making the overlay interactive takes hover away from that other window,
    // but it is not a real departure from the shared trigger/popover region.
    // The overlay now owns input and calls `left` when it observes one.
    if (insideTrigger) this.disarm()
    else this.arm()
  }

  entered(): void {
    if (this.disposed) return
    this.disarm()
  }

  left(): void {
    if (this.disposed) return
    this.arm()
  }

  dispose(): void {
    this.disposed = true
    this.disarm()
    this.cancelDrag()
  }

  private arm(): void {
    if (this.disposed) return
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
