/**
 * Grid layout maths.
 *
 * Pure by design: it takes numbers and returns numbers, so it can be tested
 * exhaustively without opening a window. The window-manager adapter is the only
 * thing that turns these cells into real window bounds.
 */

/** A screen (or work area) in virtual-desktop coordinates. */
export interface ScreenBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Where a single slot's window goes. */
export interface GridCell {
  x: number
  y: number
  width: number
  height: number
}

export interface GridLayout {
  columns: number
  rows: number
}

/**
 * Default layout: as square as possible, filling rows left to right.
 * 1 slot -> 1x1, 2 -> 2x1, 4 -> 2x2, 5 -> 3x2 (last row short).
 */
function defaultLayout(slotCount: number): GridLayout {
  const columns = Math.ceil(Math.sqrt(slotCount))
  return { columns, rows: Math.ceil(slotCount / columns) }
}

function assertPositiveInteger(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${what} must be a positive integer, got ${value}`)
  }
}

/**
 * Edge of the n-th division of `total`, measured from `origin`.
 *
 * Deriving both edges this way instead of multiplying a rounded cell size is
 * what makes the grid cover the screen exactly: any remainder is spread across
 * cells rather than left as a dead strip on the right or bottom edge.
 */
function edge(origin: number, total: number, index: number, divisions: number): number {
  return origin + Math.round((total * index) / divisions)
}

/**
 * Positions for `slotCount` windows tiled over `screen`.
 *
 * Cells are returned in reading order: left to right, then top to bottom, so
 * index N is always slot N. When the count does not fill the last row, the
 * remaining cells are simply absent — cells keep a uniform size rather than
 * stretching, so the grid stays stable as slots come and go.
 */
export function computeGrid(
  slotCount: number,
  screen: ScreenBounds,
  layout?: GridLayout,
): GridCell[] {
  assertPositiveInteger(slotCount, 'slot count')
  assertPositiveInteger(screen.width, 'screen width')
  assertPositiveInteger(screen.height, 'screen height')
  if (!Number.isInteger(screen.x) || !Number.isInteger(screen.y)) {
    // x/y may legitimately be negative or zero: Windows reports negative
    // coordinates for monitors left of or above the primary one.
    throw new Error(`screen origin must be integers, got ${screen.x},${screen.y}`)
  }

  const { columns, rows } = layout ?? defaultLayout(slotCount)
  assertPositiveInteger(columns, 'columns')
  assertPositiveInteger(rows, 'rows')

  const capacity = columns * rows
  if (capacity < slotCount) {
    throw new Error(`layout ${columns}x${rows} holds only ${capacity} slots, need ${slotCount}`)
  }

  const cells: GridCell[] = []
  for (let i = 0; i < slotCount; i++) {
    const column = i % columns
    const row = Math.floor(i / columns)

    const left = edge(screen.x, screen.width, column, columns)
    const right = edge(screen.x, screen.width, column + 1, columns)
    const top = edge(screen.y, screen.height, row, rows)
    const bottom = edge(screen.y, screen.height, row + 1, rows)

    cells.push({ x: left, y: top, width: right - left, height: bottom - top })
  }
  return cells
}
