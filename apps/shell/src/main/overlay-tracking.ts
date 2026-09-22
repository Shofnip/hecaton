import type { BrowserWindow } from 'electron'

/**
 * Keeps a visible overlay aligned with its owner without paying native resize
 * work for the normal hidden state. Opening already calls the returned sync
 * before showing the overlay, so skipping hidden frames cannot expose stale
 * bounds.
 */
export function trackOverlayBounds(parent: BrowserWindow, overlay: BrowserWindow): () => void {
  const sync = (): void => overlay.setBounds(parent.getContentBounds())
  const trackVisible = (): void => {
    if (overlay.isVisible()) sync()
  }
  parent.on('move', trackVisible)
  parent.on('resize', trackVisible)
  parent.on('maximize', trackVisible)
  parent.on('unmaximize', trackVisible)
  parent.on('restore', trackVisible)
  return sync
}
