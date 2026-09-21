import { describe, expect, it } from 'vitest'
import { popoverAnchor } from './popover-anchor.js'

describe('popover anchor', () => {
  it('rounds the live button rectangle for IPC', () => {
    expect(popoverAnchor({ left: 10.4, top: 20.6, width: 19.7, height: 20.2 }, true)).toEqual({
      x: 10,
      y: 21,
      width: 20,
      height: 20,
    })
  })

  it('drops a delayed hover after redraw detached its button', () => {
    expect(popoverAnchor({ left: 0, top: 0, width: 0, height: 0 }, false)).toBeUndefined()
  })

  it('never sends a zero-sized rounded rectangle', () => {
    expect(popoverAnchor({ left: 10, top: 20, width: 0.4, height: 20 }, true)).toBeUndefined()
  })
})
