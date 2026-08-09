/**
 * The only bridge between the renderer and the main process.
 *
 * Runs sandboxed, so it has no Node beyond what Electron polyfills for
 * preloads. That is the intent: this file exposes a fixed set of named methods
 * and nothing else — no ipcRenderer, no require, no channel taken from the
 * caller. A renderer compromise can call exactly this fixed set of methods,
 * with arguments the main process re-validates anyway.
 *
 * `.cts` on purpose. The package is ESM, so a `.ts` file here emits an ES
 * module, and Electron cannot load an ESM preload — it fails with "Cannot use
 * import statement outside a module", leaving the bridge undefined and the
 * panel blank with nothing on stdout. `.cts` emits `preload.cjs`, which is what
 * a sandboxed preload has to be. Verified by loading the built files, not by
 * reading the docs.
 *
 * Channel names are literals here and come from IPC_CHANNELS in main. A
 * sandboxed preload may only require `electron` and a few built-ins, so it
 * cannot import the shared constant; preload.test.ts is what keeps the two
 * lists from drifting.
 */
// import-equals rather than an ESM import: `verbatimModuleSyntax` requires a
// .cts file to say what it means, and what it means here is `require`.
import electron = require('electron')

const { contextBridge, ipcRenderer } = electron

const api = {
  startSlot: (id: number) => ipcRenderer.invoke('slot:start', id),
  stopSlot: (id: number) => ipcRenderer.invoke('slot:stop', id),
  focusSlot: (id: number) => ipcRenderer.invoke('slot:focus', id),
  addSlot: (slot: unknown) => ipcRenderer.invoke('slot:add', slot),
  removeSlot: (id: number) => ipcRenderer.invoke('slot:remove', id),
  readConfig: () => ipcRenderer.invoke('config:read'),
  updateSlot: (update: unknown) => ipcRenderer.invoke('config:updateSlot', update),
  setAudioFollowsFocus: (enabled: boolean) =>
    ipcRenderer.invoke('config:setAudioFollowsFocus', enabled),
  revealLogs: () => ipcRenderer.invoke('logs:reveal'),
  clearArchives: () => ipcRenderer.invoke('profiles:clearArchives'),
  clearSlotCache: (id: number) => ipcRenderer.invoke('profiles:clearSlotCache', id),
  clearAllCaches: () => ipcRenderer.invoke('profiles:clearAllCaches'),
  revealUserData: () => ipcRenderer.invoke('data:reveal'),
  deleteAllUserData: () => ipcRenderer.invoke('data:deleteAll'),
  acknowledgeTerms: () => ipcRenderer.invoke('terms:acknowledge'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  openReleasesPage: () => ipcRenderer.invoke('update:openPage'),

  // The video-wall runtime controls (UI rework, decision 7).
  renameSlot: (id: number, name: string) => ipcRenderer.invoke('slots:rename', { id, name }),
  setSlotVolume: (id: number, volume: number) =>
    ipcRenderer.invoke('slots:setVolume', { id, volume }),
  setSlotMuted: (id: number, muted: boolean) => ipcRenderer.invoke('slots:setMuted', { id, muted }),
  reloadSlot: (id: number) => ipcRenderer.invoke('slots:reload', id),
  setTheme: (theme: 'dark' | 'light') => ipcRenderer.invoke('ui:setTheme', theme),
  setScreenLayout: (placements: unknown) => ipcRenderer.invoke('screens:layout', placements),

  // The overlay window (modals + volume popover, above the games). The wall asks
  // to open one; the overlay renders it and asks to close when done.
  openOverlay: (request: unknown) => ipcRenderer.invoke('overlay:open', request),
  closeOverlay: () => ipcRenderer.invoke('overlay:close'),
  onOverlayOpen: (listener: (request: unknown) => void) => {
    ipcRenderer.on('overlay-open', (_event, request) => listener(request))
  },

  /**
   * State pushed by main. The listener receives only the payload: handing over
   * the Electron event would leak `sender`, and with it a way back into the
   * main process from renderer code.
   */
  onState: (listener: (state: unknown) => void) => {
    ipcRenderer.on('state', (_event, state) => listener(state))
  },
}

contextBridge.exposeInMainWorld('hecaton', api)
