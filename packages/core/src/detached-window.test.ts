import { describe, expect, it } from 'vitest'
import { centredOver, isOffScreen } from './detached-window.js'
import type { GridCell } from './grid.js'

const monitor: GridCell = { x: 0, y: 0, width: 1920, height: 1040 }
const second: GridCell = { x: 1920, y: 0, width: 1280, height: 1000 }

describe('isOffScreen', () => {
  it('calls the launch corner off-screen', () => {
    // -32000 is where a screen is born (OFFSCREEN_LAUNCH), and it is where the
    // browser puts a window the page opens afterwards: it positions the new one
    // against where it still believes the opener is, never having been told that
    // Win32 moved it into the panel. That is the whole bug.
    expect(isOffScreen({ x: -32000, y: -32000, width: 700, height: 480 }, [monitor])).toBe(true)
  })

  it('leaves a window sitting on the desktop alone', () => {
    expect(isOffScreen({ x: 300, y: 200, width: 520, height: 640 }, [monitor])).toBe(false)
  })

  it('counts a second monitor as on-screen', () => {
    // Someone with the panel on the left and the login window dragged to the
    // right must not have it yanked back on the next tick.
    expect(isOffScreen({ x: 2000, y: 100, width: 520, height: 640 }, [monitor, second])).toBe(false)
  })

  it('accepts a window that only overlaps a little', () => {
    // Half off the bottom edge is still reachable: the user can see it, drag it,
    // and close it. Moving it would be the app rearranging their desktop.
    expect(isOffScreen({ x: 100, y: 1000, width: 520, height: 640 }, [monitor])).toBe(false)
  })

  it('counts a window touching only the edge as off-screen', () => {
    // Exactly adjacent, no overlapping pixel. Nothing of it can be clicked.
    expect(isOffScreen({ x: 1920, y: 0, width: 520, height: 640 }, [monitor])).toBe(true)
  })

  it('says nothing is on-screen when there are no monitors at all', () => {
    // A locked or disconnected session can answer with no work areas. Reporting
    // "off-screen" here would have the adapter move windows against a desktop
    // that is not there, so the caller is expected to do nothing - the point of
    // the test is that this case is defined rather than accidental.
    expect(isOffScreen({ x: 10, y: 10, width: 100, height: 100 }, [])).toBe(true)
  })
})

describe('centredOver', () => {
  it('centres the window on the area', () => {
    expect(centredOver({ x: -32000, y: -32000, width: 520, height: 640 }, monitor)).toEqual({
      x: 700,
      y: 200,
    })
  })

  it('keeps the size it was given', () => {
    // Only the position moves. A login window sized by the page it belongs to
    // must not be resized by us.
    const moved = centredOver({ x: -32000, y: -32000, width: 520, height: 640 }, monitor)
    expect(moved).not.toHaveProperty('width')
  })

  it('clamps a window taller than the area to its top-left corner', () => {
    // Centring something bigger than the area puts its title bar above the top
    // edge, which is the one position a user cannot drag it out of.
    expect(centredOver({ x: -32000, y: -32000, width: 2400, height: 1200 }, monitor)).toEqual({
      x: 0,
      y: 0,
    })
  })

  it('centres over the area it is given, not over the origin', () => {
    expect(centredOver({ x: 0, y: 0, width: 280, height: 200 }, second)).toEqual({
      x: 2420,
      y: 400,
    })
  })
})
