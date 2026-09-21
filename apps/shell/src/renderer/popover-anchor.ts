interface Rectangle {
  left: number
  top: number
  width: number
  height: number
}

export interface PopoverAnchor {
  x: number
  y: number
  width: number
  height: number
}

/** A hover timeout may outlive the button a redraw replaced; detached elements have no anchor. */
export function popoverAnchor(rect: Rectangle, connected: boolean): PopoverAnchor | undefined {
  if (!connected) return undefined
  const anchor = {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }
  return anchor.width >= 1 && anchor.height >= 1 ? anchor : undefined
}
