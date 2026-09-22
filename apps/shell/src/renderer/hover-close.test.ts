import { afterEach, describe, expect, it, vi } from 'vitest'
import { HoverClose } from './hover-close.js'

afterEach(() => vi.useRealTimers())

describe('HoverClose', () => {
  it.each(['volume', 'zoom'])(
    'keeps a stationary pointer from cycling the %s popover across both windows',
    () => {
      vi.useFakeTimers()
      const close = vi.fn()
      const intent = new HoverClose(close, () => false, 260)

      // The wall opened the overlay while the pointer was still over the
      // trigger. Making that second window interactive takes hover away from
      // the wall, but it is not a genuine leave of the shared trigger/popover
      // lifetime.
      intent.opened(true)
      vi.advanceTimersByTime(2_000)
      expect(close).not.toHaveBeenCalled()

      // The overlay owns input now, so it can observe the real departure.
      intent.left()
      vi.advanceTimersByTime(260)
      expect(close).toHaveBeenCalledOnce()
    },
  )

  it('closes when the pointer left the trigger before the overlay took input', () => {
    vi.useFakeTimers()
    const close = vi.fn()
    const intent = new HoverClose(close, () => false, 260)

    intent.opened(false)
    vi.advanceTimersByTime(260)

    expect(close).toHaveBeenCalledOnce()
  })

  it('keeps an entered popover open until the pointer leaves it', () => {
    vi.useFakeTimers()
    const close = vi.fn()
    const intent = new HoverClose(close, () => false, 260)

    intent.opened(true)
    intent.entered()
    vi.advanceTimersByTime(500)
    expect(close).not.toHaveBeenCalled()

    intent.left()
    vi.advanceTimersByTime(260)
    expect(close).toHaveBeenCalledOnce()
  })

  it('rechecks after a drag instead of losing the close forever', () => {
    vi.useFakeTimers()
    let dragging = true
    const close = vi.fn()
    const intent = new HoverClose(close, () => dragging, 260)

    intent.opened(true)
    intent.left()
    vi.advanceTimersByTime(260)
    expect(close).not.toHaveBeenCalled()

    dragging = false
    vi.advanceTimersByTime(260)
    expect(close).toHaveBeenCalledOnce()
  })

  it('cancels pointer-drag state when the popover is disposed', () => {
    const cancelDrag = vi.fn()
    const intent = new HoverClose(vi.fn(), () => true, 260, cancelDrag)

    intent.dispose()

    expect(cancelDrag).toHaveBeenCalledOnce()
  })
})
