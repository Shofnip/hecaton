/**
 * Electron main: the only process with I/O, and the only one that trusts
 * anything.
 *
 * It is deliberately thin. Every decision it applies was made and tested
 * elsewhere — the security posture in security.ts, the IPC contract and payload
 * validation in @hecaton/core, the seeding rule in first-run.ts. If an `if`
 * encoding a rule appears here, it is in the wrong file.
 *
 * The liveness timer lives here because a timer is an effect. The orchestrator
 * exposes checkLiveness() as an explicit call precisely so crash handling stays
 * testable without waiting for wall-clock time.
 */
import { BrowserWindow, Menu, app, ipcMain, screen, session, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  IPC_CHANNELS,
  Orchestrator,
  parseAudioFollowsFocus,
  parseConfig,
  parseNoPayload,
  parseOverlayRequest,
  parseScreenLayout,
  parseSlotAddition,
  parseSlotId,
  parseSlotMuted,
  parseSlotRename,
  parseSlotUpdate,
  parseSlotVolume,
  parseTheme,
} from '@hecaton/core'
import { DEFAULT_GLOBAL_CONFIG } from '@hecaton/core'
import type { GlobalConfig, IpcChannel, SlotOverrides, SlotSnapshot, Theme } from '@hecaton/core'
import { ChromeLauncher, FileProfileArchive, WasapiAudioController } from '@hecaton/browser-engine'
import { NativeWindowManager } from '@hecaton/window-manager'
import {
  FileLogger,
  JsonFileStorage,
  appDataDir,
  configFilePath,
  logsDir,
  profilesDir,
} from '@hecaton/storage'
import { buildGameRegistry } from '@hecaton/games'
import { allowsNavigation, cspHeaders, panelWebPreferences } from './security.js'
import { firstRunSlots } from './first-run.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const RENDERER_DIR = join(HERE, '..', 'renderer')
// .cjs, not .js: a sandboxed preload must be CommonJS, and this package is ESM.
const PRELOAD = join(HERE, '..', 'preload', 'preload.cjs')

// Keep Electron's own cache under our data dir, not in the generic, shared
// %APPDATA%/Electron. Two reasons: ADR-0004 says everything the app persists
// lives under %APPDATA%/hecaton, and the shared folder is where "unable to
// move the cache: access denied" comes from - any other Electron app, or a
// still-closing instance of ours, holds it. Must run before the app is ready,
// while the paths can still be set.
app.setPath('userData', join(appDataDir(), 'shell'))

/** How often the shell asks the orchestrator to look for dead browsers. */
const LIVENESS_INTERVAL_MS = 2000

// How often the shell asks the orchestrator to apply the audio policy. The
// policy now follows the app's own focus mode, not the OS foreground, so a tick
// only shells out when a slot's volume or mute actually changed - a quiet tick
// costs nothing. Kept faster than liveness so a focus change is heard promptly.
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
/**
 * The always-on-top window that hosts the modals and the volume popover, so they
 * paint above the embedded game windows instead of being hidden under them. It
 * mirrors the panel's content area and is click-through except while open.
 */
let overlay: BrowserWindow | undefined
/** Surfaced on the panel rather than thrown away when config cannot be read. */
let configError: string | undefined
// The two adapters that own a persistent PowerShell worker. Held here, not just
// inside the orchestrator, so shutdown can dispose them — an undisposed worker
// leaves an orphaned powershell.exe behind after the app closes.
let audioController: WasapiAudioController | undefined
let windowManager: NativeWindowManager | undefined

/**
 * The panel's native window handle, as the number the Win32 worker embeds into.
 *
 * Read lazily by the window adapter at reparent time, not at construction: the
 * orchestrator (and its adapters) is built before the panel exists, and the
 * closure sees `panel` once it does. getNativeWindowHandle hands back a Buffer
 * holding the HWND pointer — 8 bytes on 64-bit Windows — which a real window
 * handle fits inside a JS safe integer.
 */
function panelHwnd(): number | undefined {
  if (!panel) return undefined
  const handle = panel.getNativeWindowHandle()
  return handle.length >= 8 ? Number(handle.readBigUInt64LE(0)) : handle.readUInt32LE(0)
}

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

  // Built before the orchestrator and kept, so shutdown can dispose their
  // workers. The window adapter embeds into the panel, which does not exist yet;
  // panelHwnd is read lazily, at reparent time, by which point it does.
  audioController = new WasapiAudioController()
  windowManager = new NativeWindowManager(panelHwnd)

  orchestrator = new Orchestrator({
    launcher: new ChromeLauncher(profilesDir()),
    windows: windowManager,
    screen: screen.getPrimaryDisplay().workArea,
    globals,
    registry,
    slots,
    autoRestart: true,
    logger,
    profiles,
    audio: audioController,
  })
}

async function saveConfiguration(): Promise<void> {
  // The orchestrator owns the slot list once running - add and remove change it
  // - so its view is the one that gets persisted, never the startup copy.
  const value: PersistedConfig = { ...globals, slots: orchestrator.slotConfigs() }
  await storage.save(value)
}

// A volume-slider drag fires dozens of changes a second; each applies to audio
// at once (the persistent WASAPI worker is ~12ms) but persisting every one would
// thrash config.json. A trailing debounce coalesces the burst into one write of
// the final value.
let saveTimer: ReturnType<typeof setTimeout> | undefined
function saveConfigurationSoon(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = undefined
    void saveConfiguration()
  }, 400)
}

interface PanelState {
  slots: SlotSnapshot[]
  games: { id: string; name: string }[]
  maxSlots: number
  audioFollowsFocus: boolean
  theme: Theme
  configError?: string
}

/** Everything the renderer is allowed to know. */
function currentState(): PanelState {
  const state: PanelState = {
    slots: orchestrator ? orchestrator.snapshot() : [],
    games: GAMES,
    maxSlots: globals.maxSlots,
    audioFollowsFocus: globals.audioFollowsFocus,
    theme: globals.theme,
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
      // Both the panel and the overlay are our own windows, loaded from disk with
      // navigation denied, so neither frame can become hostile — this is belt over
      // braces. The overlay hosts the modals, which call the same bridge methods,
      // so its frame is accepted too.
      const frame = event.senderFrame
      if (frame !== panel?.webContents.mainFrame && frame !== overlay?.webContents.mainFrame) {
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

    'slot:focus': (payload) => {
      // Focus is server-authoritative: the orchestrator flips focusedSlotId (the
      // audio policy reads it) and we push the new snapshot so the renderer, seeing
      // the `focused` flag move, re-lays-out the wall. The boolean is still returned
      // for a caller that wants the immediate result.
      const nowFocused = orchestrator.focus(parseSlotId(payload))
      pushState()
      return nowFocused
    },

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

    'config:setAudioFollowsFocus': async (payload) => {
      // A global on/off for making audio follow focus. The orchestrator holds
      // the live toggle - the next focus tick applies it - and globals holds the
      // persisted copy so it survives a restart.
      const enabled = parseAudioFollowsFocus(payload)
      orchestrator.setAudioFollowsFocus(enabled)
      globals = { ...globals, audioFollowsFocus: enabled }
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

    'slots:rename': async (payload) => {
      const { id, name } = parseSlotRename(payload)
      orchestrator.renameSlot(id, name)
      await saveConfiguration()
      pushState()
    },

    'slots:setVolume': async (payload) => {
      // Apply to the live session immediately (applyAudio touches only the slot
      // whose volume changed), but persist on a debounce: a slider drag must be
      // heard at once yet not write the file every frame. No state echo — the
      // renderer owns the value it just set, and echoing would fight the drag.
      const { id, volume } = parseSlotVolume(payload)
      orchestrator.setSlotVolume(id, volume)
      await orchestrator.applyAudio()
      saveConfigurationSoon()
    },

    'slots:setMuted': async (payload) => {
      // A discrete toggle, so it persists and echoes at once — the icon flips.
      const { id, muted } = parseSlotMuted(payload)
      orchestrator.setSlotMuted(id, muted)
      await orchestrator.applyAudio()
      await saveConfiguration()
      pushState()
    },

    'slots:reload': (payload) => orchestrator.reload(parseSlotId(payload)),

    'ui:setTheme': async (payload) => {
      // Theme is a persisted global with no orchestrator behaviour — main holds
      // it and echoes it back so the renderer reflects the saved value.
      const theme = parseTheme(payload)
      globals = { ...globals, theme }
      await saveConfiguration()
      pushState()
    },

    'screens:layout': (payload) => {
      // The renderer-owned geometry: where each embedded screen goes, or that it
      // is hidden. Fires on every resize/drag frame, so it neither persists nor
      // echoes state — it only drives the windows. Rectangles arrive as physical
      // pixels in the panel's client area (the renderer applied devicePixelRatio,
      // where it is known exactly), so main relays them as-is: a reparented child
      // is a WS_CHILD, clipped to the parent's client area, so an edge rounded a
      // pixel long needs no clamp here.
      orchestrator?.applyScreenLayout(parseScreenLayout(payload))
    },

    'overlay:open': (payload) => {
      // The wall asks to show a modal or the volume popover. Validate the request,
      // then show the overlay (above the games), make it interactive, and hand it
      // the request. The overlay renders it and calls overlay:close when done.
      const request = parseOverlayRequest(payload)
      if (!overlay) return
      overlay.setBounds(panel?.getContentBounds() ?? overlay.getBounds())
      overlay.setIgnoreMouseEvents(false)
      overlay.show()
      overlay.focus() // so a modal's form is typeable at once
      overlay.webContents.send('overlay-open', request)
    },

    'overlay:close': (payload) => {
      // The overlay is done: hide it and make it click-through again so the games
      // beneath take the mouse. Takes no argument.
      parseNoPayload(payload)
      overlay?.hide()
      overlay?.setIgnoreMouseEvents(true, { forward: true })
    },
  }

  for (const channel of IPC_CHANNELS) {
    ipcMain.handle(channel, guard(handlers[channel]))
  }
}

function createPanel(): void {
  // No application menu: it is not in the design, and a native menu bar sits
  // between the title bar and the client area, offsetting where the web content's
  // (0,0) is from where a reparented child window's (0,0) is — the two must agree
  // for the embedded screens to line up with their viewports.
  Menu.setApplicationMenu(null)

  panel = new BrowserWindow({
    width: 900,
    height: 640,
    show: false,
    title: 'Hecaton',
    webPreferences: { ...panelWebPreferences(), preload: PRELOAD },
  })
  lockDownWindow(panel)
  hookChildFocus(panel)
  void panel.loadFile(join(RENDERER_DIR, 'index.html'))
  panel.once('ready-to-show', () => panel?.show())
  panel.on('closed', () => {
    panel = undefined
  })

  createOverlay(panel)
}

/**
 * The overlay window: a frameless, transparent, owned window that sits above the
 * panel and its embedded game windows, so modals and the volume popover render
 * over the games instead of being hidden under them. It mirrors the panel's
 * content rectangle exactly, so the wall and the overlay share one coordinate
 * system — a client rectangle means the same thing in both. Same locked-down
 * webPreferences as the panel; it never embeds anything, only draws DOM.
 */
function createOverlay(parent: BrowserWindow): void {
  overlay = new BrowserWindow({
    parent,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    // Above the panel AND its embedded child game windows; only ever up while a
    // modal is open, so it does not sit over other apps in normal use.
    alwaysOnTop: true,
    webPreferences: { ...panelWebPreferences(), preload: PRELOAD },
  })
  lockDownWindow(overlay)
  overlay.setIgnoreMouseEvents(true, { forward: true })
  void overlay.loadFile(join(RENDERER_DIR, 'overlay.html'))

  // Keep it exactly over the panel's content area. The panel's own move/resize is
  // what changes that rectangle, so following those events is enough.
  const track = (): void => {
    if (overlay) overlay.setBounds(parent.getContentBounds())
  }
  parent.on('move', track)
  parent.on('resize', track)
  parent.on('maximize', track)
  parent.on('unmaximize', track)
  parent.on('restore', track)
  overlay.on('closed', () => {
    overlay = undefined
  })
}

// Windows message + button-down codes for the child-focus hook.
const WM_PARENTNOTIFY = 0x0210
const BUTTON_DOWN = new Set([0x0201, 0x0204, 0x0207, 0x020b]) // L / R / M / X down

/**
 * Forwards keyboard focus to an embedded screen when it is clicked.
 *
 * A reparented Chrome window is a WS_CHILD of the panel but a different process, so
 * clicking it gives it mouse input but not keyboard focus — typing a login went
 * nowhere. The panel receives WM_PARENTNOTIFY when a child is clicked; on a
 * button-down we hand the click point to the window adapter, which hit-tests for
 * the child there and focuses it (finding 0.1). wParam's low word is the event,
 * lParam packs the cursor point in the panel's client coordinates.
 */
function hookChildFocus(window: BrowserWindow): void {
  window.hookWindowMessage(WM_PARENTNOTIFY, (wParam: Buffer, lParam: Buffer) => {
    if (!BUTTON_DOWN.has(wParam.readUInt16LE(0))) return
    const parent = panelHwnd()
    if (parent !== undefined) {
      windowManager?.focusChildAt(parent, lParam.readInt16LE(0), lParam.readInt16LE(2))
    }
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
        void orchestrator.applyAudio().finally(() => {
          audioBusy = false
        })
      }, AUDIO_FOCUS_INTERVAL_MS)
    }
  })

  // The panel is the app. Closing it should not leave a tray-less process behind.
  app.on('window-all-closed', () => app.quit())

  // Dispose the adapters' persistent workers before the process exits, so no
  // orphaned powershell.exe outlives the app. Quit is deferred once while the
  // async teardown (send "exit", then kill the child) runs — Electron does not
  // wait for a promise in a quit handler otherwise.
  let disposed = false
  app.on('before-quit', (event) => {
    if (disposed) return
    disposed = true
    event.preventDefault()
    void Promise.allSettled([audioController?.dispose(), windowManager?.dispose()]).finally(() =>
      app.quit(),
    )
  })
}
