import { describe, expect, it } from 'vitest'
import { computeGrid } from './grid.js'
import type { GridCell, ScreenBounds } from './grid.js'

const FULL_HD: ScreenBounds = { x: 0, y: 0, width: 1920, height: 1080 }

/** Total area of the cells, used to prove the grid neither overlaps nor leaves gaps. */
function totalArea(cells: readonly GridCell[]): number {
  return cells.reduce((sum, c) => sum + c.width * c.height, 0)
}

function overlaps(a: GridCell, b: GridCell): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

describe('computeGrid', () => {
  it('gives a single slot the whole screen', () => {
    expect(computeGrid(1, FULL_HD)).toEqual([{ x: 0, y: 0, width: 1920, height: 1080 }])
  })

  it('splits two slots into side-by-side columns', () => {
    expect(computeGrid(2, FULL_HD)).toEqual([
      { x: 0, y: 0, width: 960, height: 1080 },
      { x: 960, y: 0, width: 960, height: 1080 },
    ])
  })

  it('arranges four slots as 2x2, the default layout', () => {
    expect(computeGrid(4, FULL_HD)).toEqual([
      { x: 0, y: 0, width: 960, height: 540 },
      { x: 960, y: 0, width: 960, height: 540 },
      { x: 0, y: 540, width: 960, height: 540 },
      { x: 960, y: 540, width: 960, height: 540 },
    ])
  })

  it('grows to three columns at five slots, leaving the last row short', () => {
    const cells = computeGrid(5, FULL_HD)
    expect(cells).toHaveLength(5)
    expect(cells[0]).toEqual({ x: 0, y: 0, width: 640, height: 540 })
    expect(cells[3]).toEqual({ x: 0, y: 540, width: 640, height: 540 })
    expect(cells[4]).toEqual({ x: 640, y: 540, width: 640, height: 540 })
  })

  it('covers the screen exactly when the size does not divide evenly', () => {
    // 1921 / 3 is not an integer: naive floor division would leave a dead strip.
    const screen: ScreenBounds = { x: 0, y: 0, width: 1921, height: 1080 }
    const cells = computeGrid(3, screen)
    const topRow = cells.slice(0, 2)
    expect(topRow.reduce((sum, c) => sum + c.width, 0)).toBe(1921)
    expect(Math.min(...cells.map((c) => c.x))).toBe(0)
    expect(Math.max(...cells.map((c) => c.x + c.width))).toBe(1921)
  })

  it('produces a full 2x2 tiling with no overlap and no gap', () => {
    const cells = computeGrid(4, { x: 0, y: 0, width: 1921, height: 1081 })
    expect(totalArea(cells)).toBe(1921 * 1081)
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        expect(overlaps(cells[i]!, cells[j]!)).toBe(false)
      }
    }
  })

  it('honours a screen that does not start at the origin', () => {
    // Second monitor, to the right of the primary one.
    const second: ScreenBounds = { x: 1920, y: 0, width: 1920, height: 1080 }
    expect(computeGrid(2, second)).toEqual([
      { x: 1920, y: 0, width: 960, height: 1080 },
      { x: 2880, y: 0, width: 960, height: 1080 },
    ])
  })

  it('handles a negative origin, as Windows reports for monitors left of the primary', () => {
    const left: ScreenBounds = { x: -1920, y: 0, width: 1920, height: 1080 }
    const cells = computeGrid(2, left)
    expect(cells[0]!.x).toBe(-1920)
    expect(cells[1]!.x).toBe(-960)
  })

  it('accepts an explicit layout, overriding the square-ish default', () => {
    const cells = computeGrid(4, FULL_HD, { columns: 4, rows: 1 })
    expect(cells).toEqual([
      { x: 0, y: 0, width: 480, height: 1080 },
      { x: 480, y: 0, width: 480, height: 1080 },
      { x: 960, y: 0, width: 480, height: 1080 },
      { x: 1440, y: 0, width: 480, height: 1080 },
    ])
  })

  it('rejects a layout too small to hold every slot', () => {
    expect(() => computeGrid(5, FULL_HD, { columns: 2, rows: 2 })).toThrow(/holds only 4/i)
  })

  it.each([0, -1, 2.5, Number.NaN])('rejects a slot count of %p', (bad) => {
    expect(() => computeGrid(bad, FULL_HD)).toThrow(/positive integer/i)
  })

  it.each([
    { x: 0, y: 0, width: 0, height: 1080 },
    { x: 0, y: 0, width: 1920, height: -10 },
    { x: 0, y: 0, width: 1.5, height: 1080 },
  ])('rejects screen bounds %o', (bad) => {
    expect(() => computeGrid(2, bad)).toThrow(/positive integer/i)
  })

  it('never returns a cell narrower or shorter than one pixel', () => {
    const cells = computeGrid(9, { x: 0, y: 0, width: 100, height: 100 })
    for (const c of cells) {
      expect(c.width).toBeGreaterThan(0)
      expect(c.height).toBeGreaterThan(0)
    }
  })
})
