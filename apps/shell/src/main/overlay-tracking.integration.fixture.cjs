const { app, BrowserWindow } = require('electron')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  const { trackOverlayBounds } = await import('../../dist/main/overlay-tracking.js')
  const parent = new BrowserWindow({ show: true, width: 600, height: 400 })
  const overlay = new BrowserWindow({ parent, show: false, frame: false, transparent: true })
  await parent.loadURL('data:text/html,<body>parent</body>')
  await overlay.loadURL('data:text/html,<body>overlay</body>')

  const sync = trackOverlayBounds(parent, overlay)
  sync()
  const initial = overlay.getBounds()

  parent.setSize(800, 600)
  await sleep(150)
  const hidden = overlay.getBounds()

  sync()
  const opened = overlay.getBounds()
  overlay.showInactive()
  parent.setSize(900, 700)
  await sleep(150)
  const visible = overlay.getBounds()

  process.stdout.write(
    `OVERLAY_RESULT ${JSON.stringify({ initial, hidden, opened, visible, content: parent.getContentBounds() })}\n`,
  )
  parent.close()
  app.quit()
})
