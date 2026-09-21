import { afterEach, describe, expect, it, vi } from 'vitest'
import { HoverClose } from './hover-close.js'

afterEach(() => vi.useRealTimers())

describe('HoverClose', () => {
  it('closes a hover-opened popover that the pointer never enters', () => {
    vi.useFakeTimers()
    const close = vi.fn()
    const intent = new HoverClose(close, () => false, 260)

    intent.opened()
    vi.advanceTimersByTime(260)

    expect(close).toHaveBeenCalledOnce()
  })

  it('keeps an entered popover open until the pointer leaves it', () => {
    vi.useFakeTimers()
    const close = vi.fn()
    const intent = new HoverClose(close, () => false, 260)

    intent.opened()
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

    intent.opened()
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
