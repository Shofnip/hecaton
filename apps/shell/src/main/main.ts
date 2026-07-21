/**
 * Electron main: the only process with I/O, and the only one that trusts
 * anything.
 *
 * It is deliberately thin. Every decision it applies was made and tested
 * elsewhere — the security posture in security.ts, the IPC contract and payload
 * validation in @helloweb/core, the seeding rule in first-run.ts. If an `if`
 * encoding a rule appears here, it is in the wrong file.
 *
 * The liveness timer lives here because a timer is an effect. The orchestrator
 * exposes checkLiveness() as an explicit call precisely so crash handling stays
 * testable without waiting for wall-clock time.
 */
import { BrowserWindow, app, ipcMain, screen, session, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  IPC_CHANNELS,
  Orchestrator,
  parseConfig,
  parseNoPayload,
  parseSlotId,
  parseSlotUpdate,
} from '@helloweb/core'
import type { GlobalConfig, IpcChannel, SlotOverrides, SlotSnapshot } from '@helloweb/core'
import { ChromeLauncher } from '@helloweb/browser-engine'
import { NativeWindowManager } from '@helloweb/window-manager'
import {
  FileLogger,
  JsonFileStorage,
  configFilePath,
  logsDir,
  profilesDir,
} from '@helloweb/storage'
import { buildGameRegistry } from '@helloweb/games'
import { allowsNavigation, cspHeaders, panelWebPreferences } from './security.js'
import { firstRunSlots } from './first-run.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const RENDERER_DIR = join(HERE, '..', 'renderer')
// .cjs, not .js: a sandboxed preload must be CommonJS, and this package is ESM.
const PRELOAD = join(HERE, '..', 'preload', 'preload.cjs')

/** How often the shell asks the orchestrator to look for dead browsers. */
const LIVENESS_INTERVAL_MS = 2000

interface PersistedConfig extends GlobalConfig {
  slots: SlotOverrides[]
}

const storage = new JsonFileStorage<unknown>(configFilePath())
const logger = new FileLogger(logsDir())
let orchestrator: Orchestrator
let globals: GlobalConfig
let slots: SlotOverrides[]
let panel: BrowserWindow | undefined
/** Surfaced on the panel rather than thrown away when config cannot be read. */
let configError: string | undefined

async function loadConfiguration(): Promise<void> {
  const registry = buildGameRegistry()
  const raw = await storage.load()
  const parsed = parseConfig(raw)
  globals = parsed.globals
  slots = parsed.slots

  if (slots.length === 0) {
    // First run: a full grid of the first shipped game, so the panel opens
    // usable. v1 has no UI for adding a slot.
    const firstGame = [...registry.keys()][0]
    if (firstGame !== undefined) slots = firstRunSlots(firstGame, globals.maxSlots)
  }

  orchestrator = new Orchestrator({
    launcher: new ChromeLauncher(profilesDir()),
    windows: new NativeWindowManager(),
    screen: screen.getPrimaryDisplay().workArea,
    globals,
    registry,
    slots,
    autoRestart: true,
    logger,
  })
}

async function saveConfiguration(): Promise<void> {
  const value: PersistedConfig = { ...globals, slots }
  await storage.save(value)
}

/** Everything the renderer is allowed to know. */
function currentState(): { slots: SlotSnapshot[]; configError?: string } {
  const state: { slots: SlotSnapshot[]; configError?: string } = {
    slots: orchestrator ? orchestrator.snapshot() : [],
  }
  if (configError !== undefined) state.configError = configError
  return state
}

function pushState(): void {
  panel?.webContents.send('state', currentState())
}

/**
 * Locks the session down before anything is loaded.
 *
 * Permissions need three handlers, not one: requests, synchronous checks
 * (navigator.permissions.query) and device access are separate paths, and
 * denying only the first while claiming to deny everything is the kind of
 * partial coverage this project keeps having to correct.
 */
function lockDownSession(): void {
  const defaultSession = session.defaultSession

  defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: cspHeaders(details.responseHeaders) })
  })

  defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  defaultSession.setPermissionCheckHandler(() => false)
  defaultSession.setDevicePermissionHandler(() => false)
}

function lockDownWindow(window: BrowserWindow): void {
  const block = (event: { preventDefault: () => void }, url: string): void => {
    if (allowsNavigation(url)) return
    event.preventDefault()
    console.warn(`[shell] refused navigation to ${url}`)
  }

  window.webContents.on('will-navigate', (event, url) => block(event, url))
  window.webContents.on('will-redirect', (event, url) => block(event, url))
  window.webContents.setWindowOpenHandler(({ url }) => {
    console.warn(`[shell] refused window.open to ${url}`)
    return { action: 'deny' }
  })
  // Redundant while webviewTag is false, and kept because that is one flag away
  // from being true.
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
}

/**
 * One handler per channel, each validating its own payload.
 *
 * The renderer is a separate process, so what arrives is `unknown` and the
 * TypeScript signatures are gone. Validation is the only check there is.
 */
function registerIpc(): void {
  const guard =
    <T>(handler: (payload: unknown) => T | Promise<T>) =>
    async (event: Electron.IpcMainInvokeEvent, payload: unknown): Promise<T> => {
      // With navigation denied the panel frame cannot become hostile, so this
      // is belt over braces rather than the main defence.
      if (event.senderFrame !== panel?.webContents.mainFrame) {
        throw new Error('ipc from an unexpected frame')
      }
      return handler(payload)
    }

  // Keyed by IpcChannel, so a channel added to the contract without a handler
  // here fails to compile. Registering by iterating the same list is what keeps
  // "the surface" one thing rather than two lists that agree today.
  const handlers: Record<IpcChannel, (payload: unknown) => unknown> = {
    'slot:start': async (payload) => {
      await orchestrator.start(parseSlotId(payload))
      pushState()
    },

    'slot:stop': async (payload) => {
      await orchestrator.stop(parseSlotId(payload))
      pushState()
    },

    'slot:focus': (payload) => orchestrator.focus(parseSlotId(payload)),

    'layout:apply': (payload) => {
      parseNoPayload(payload)
      orchestrator.applyLayout()
    },

    'config:read': (payload) => {
      parseNoPayload(payload)
      return currentState()
    },

    'config:updateSlot': async (payload) => {
      const update = parseSlotUpdate(payload, globals)
      const index = slots.findIndex((slot) => slot.id === update.id)
      if (index === -1) throw new Error(`slot ${update.id} is not configured`)
      slots[index] = update
      await saveConfiguration()
      // The orchestrator resolves slots at construction, so a changed slot
      // takes effect at the next launch rather than mid-flight.
      pushState()
    },

    'logs:reveal': async (payload) => {
      // Takes no argument on purpose: main computes the directory. A channel
      // that accepted a path would be "open an arbitrary file" with a friendly
      // name, and it is the app's only handoff to the OS shell.
      parseNoPayload(payload)
      // Ensure the directory exists before opening it: on a run where nothing
      // has been logged yet, openPath on a missing directory just fails and the
      // button appears broken.
      mkdirSync(logsDir(), { recursive: true })
      await shell.openPath(logsDir())
    },
  }

  for (const channel of IPC_CHANNELS) {
    ipcMain.handle(channel, guard(handlers[channel]))
  }
}

function createPanel(): void {
  panel = new BrowserWindow({
    width: 900,
    height: 640,
    show: false,
    title: 'helloweb',
    webPreferences: { ...panelWebPreferences(), preload: PRELOAD },
  })
  lockDownWindow(panel)
  void panel.loadFile(join(RENDERER_DIR, 'index.html'))
  panel.once('ready-to-show', () => panel?.show())
  panel.on('closed', () => {
    panel = undefined
  })
}

app.whenReady().then(async () => {
  lockDownSession()

  try {
    await loadConfiguration()
  } catch (error) {
    // A config the app cannot fully understand stops the slots, not the panel:
    // the user needs somewhere to read why, and the file is left untouched so
    // they can fix it. See decisions 1A and 2A.
    configError = error instanceof Error ? error.message : String(error)
    logger.log({ level: 'error', event: 'config.error', message: configError })
    console.error('[shell] could not load configuration:', configError)
  }

  registerIpc()
  createPanel()

  if (orchestrator) {
    setInterval(() => {
      void orchestrator.checkLiveness().then(pushState)
    }, LIVENESS_INTERVAL_MS)
  }
})

// The panel is the app. Closing it should not leave a tray-less process behind.
app.on('window-all-closed', () => app.quit())
