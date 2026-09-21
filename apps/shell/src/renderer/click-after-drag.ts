/**
 * Distinguishes the click a completed drag may synthesize from a later click.
 *
 * Chromium does not promise a click when pointerdown and pointerup land on
 * different buttons. If it omits that click, the next deliberate press must
 * clear the armed suppression before its own click arrives.
 */
export class ClickAfterDrag {
  private armed = false

  pointerStarted(): void {
    this.armed = false
  }

  dragEnded(): void {
    this.armed = true
  }

  consumeClick(): boolean {
    if (!this.armed) return false
    this.armed = false
    return true
  }
}
