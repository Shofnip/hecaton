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
  parseSlotAddition,
  parseSlotId,
  parseSlotUpdate,
} from '@helloweb/core'
import { DEFAULT_GLOBAL_CONFIG } from '@helloweb/core'
import type { GlobalConfig, IpcChannel, SlotOverrides, SlotSnapshot } from '@helloweb/core'
import { ChromeLauncher, FileProfileArchive, WasapiAudioController } from '@helloweb/browser-engine'
import { NativeWindowManager } from '@helloweb/window-manager'
import {
  FileLogger,
  JsonFileStorage,
  appDataDir,
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

// Keep Electron's own cache under our data dir, not in the generic, shared
// %APPDATA%/Electron. Two reasons: ADR-0004 says everything the app persists
// lives under %APPDATA%/helloweb, and the shared folder is where "unable to
// move the cache: access denied" comes from - any other Electron app, or a
// still-closing instance of ours, holds it. Must run before the app is ready,
// while the paths can still be set.
app.setPath('userData', join(appDataDir(), 'shell'))

/** How often the shell asks the orchestrator to look for dead browsers. */
const LIVENESS_INTERVAL_MS = 2000

// How often the shell tells the orchestrator to make audio follow focus. Faster
// than liveness because this is what the user hears the moment they switch
// windows: the foreground lookup is cheap and only a real focus change shells
// out to mute anything, so a short interval costs little.
const AUDIO_FOCUS_INTERVAL_MS = 300

interface PersistedConfig extends GlobalConfig {
  slots: SlotOverrides[]
}

const storage = new JsonFileStorage<unknown>(configFilePath())
const logger = new FileLogger(logsDir())
const profiles = new FileProfileArchive(profilesDir())
// Built once from static registry data. The panel needs id and name (name is
// the Portuguese label, UI text) to offer a game picker; it never needs the url.
const GAMES = [...buildGameRegistry().values()].map((game) => ({ id: game.id, name: game.name }))

let orchestrator: Orchestrator
// Starts at the shipped defaults so maxSlots is available even if a config that
// cannot be parsed leaves the real globals unloaded.
let globals: GlobalConfig = DEFAULT_GLOBAL_CONFIG
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
    // First run: a single slot on the first shipped game, filling the screen.
    // The user adds more from the panel, at which point the grid splits.
    const firstGame = [...registry.keys()][0]
    if (firstGame !== undefined) slots = firstRunSlots(firstGame, 1)
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
    profiles,
    audio: new WasapiAudioController(),
  })
}

async function saveConfiguration(): Promise<void> {
  // The orchestrator owns the slot list once running - add and remove change it
  // - so its view is the one that gets persisted, never the startup copy.
  const value: PersistedConfig = { ...globals, slots: orchestrator.slotConfigs() }
  await storage.save(value)
}

interface PanelState {
  slots: SlotSnapshot[]
  games: { id: string; name: string }[]
  maxSlots: number
  configError?: string
}

/** Everything the renderer is allowed to know. */
function currentState(): PanelState {
  const state: PanelState = {
    slots: orchestrator ? orchestrator.snapshot() : [],
    games: GAMES,
    maxSlots: globals.maxSlots,
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

    'slot:add': async (payload) => {
      orchestrator.addSlot(parseSlotAddition(payload, globals))
      await saveConfiguration()
      pushState()
    },

    'slot:remove': async (payload) => {
      // The panel confirms with the user before calling this. The confirmation
      // is UX, not the safeguard: removeSlot archives the profile rather than
      // deleting it, so a skipped confirmation costs an archived (recoverable)
      // session at worst, never a destroyed one.
      await orchestrator.removeSlot(parseSlotId(payload))
      await saveConfiguration()
      pushState()
    },

    'layout:apply': (payload) => {
      parseNoPayload(payload)
      orchestrator.applyLayout()
    },

    'config:read': (payload) => {
      parseNoPayload(payload)
      return currentState()
    },

    'config:updateSlot': async (payload) => {
      // updateSlot throws if the id is not configured, so no separate check.
      // A changed slot takes effect at its next launch, not mid-flight.
      orchestrator.updateSlot(parseSlotUpdate(payload, globals))
      await saveConfiguration()
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

    'profiles:clearArchives': async (payload) => {
      // The one permanent deletion in the app: it removes the archived profiles
      // of slots removed earlier. The panel confirms before calling; only the
      // .old- archives are ever touched, never a live profile.
      parseNoPayload(payload)
      await profiles.clearArchives()
    },

    'profiles:clearSlotCache': async (payload) => {
      // Frees disk without logging anyone out: only the cache sub-directories
      // go, never the session. Routed through the orchestrator, not the adapter
      // directly, because refusing a running slot and mapping the id to its
      // profile dir are both its decisions - the id never carries a path.
      await orchestrator.clearSlotCache(parseSlotId(payload))
    },

    'profiles:clearAllCaches': async (payload) => {
      // Same as above for every stopped slot; running slots are skipped by the
      // orchestrator, not failed.
      parseNoPayload(payload)
      await orchestrator.clearAllCaches()
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

/**
 * One instance only. A second one would orchestrate the same slots, spawn a
 * second Chrome per slot, and race the first over config.json and the profile
 * directories - and share the cache, which is what "unable to move the cache"
 * was. A second launch quits at once and surfaces the existing panel instead.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!panel) return
    if (panel.isMinimized()) panel.restore()
    panel.focus()
  })

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

      // Make audio follow focus on its own faster timer. A tick can shell out to
      // mute a slot (~270ms), so a busy flag keeps ticks from overlapping rather
      // than stacking PowerShell calls when the interval is shorter than the work.
      let audioBusy = false
      setInterval(() => {
        if (audioBusy) return
        audioBusy = true
        void orchestrator.updateAudioFocus().finally(() => {
          audioBusy = false
        })
      }, AUDIO_FOCUS_INTERVAL_MS)
    }
  })

  // The panel is the app. Closing it should not leave a tray-less process behind.
  app.on('window-all-closed', () => app.quit())
}
