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
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  IPC_CHANNELS,
  Orchestrator,
  parseAccountEdit,
  parseAccountRename,
  parseAccountSwitch,
  parseAudioFollowsFocus,
  parseConfig,
  parseNoPayload,
  parseOverlayRequest,
  parseScreenLayout,
  parseSlotAddition,
  parseSlotId,
  shouldOfferUpdate,
  parseSlotMuted,
  parseSlotRename,
  parseSlotUpdate,
  parseSlotVolume,
  parseTheme,
  requireEveryScreenStopped,
  verifyUserDataDeletion,
} from '@hecaton/core'
import {
  TERMS_VERSION,
  accountDirName,
  claimExistingAccount,
  claimInstance,
  defaultAccountName,
  ensureBrowserReadable,
  interpretUpdateCheck,
  needsTermsAcknowledgement,
  nextAccountId,
  stalePanelCaches,
} from '@hecaton/core'
import type { InstanceClaimVerdict, MachineSeal } from '@hecaton/core'
import { changelogSection, displayNotes, needsReleaseNotes } from '@hecaton/core'
import type { UpdateCheck } from '@hecaton/core'
import { DEFAULT_GLOBAL_CONFIG } from '@hecaton/core'
import type { GlobalConfig, IpcChannel, SlotOverrides, SlotSnapshot, Theme } from '@hecaton/core'
import {
  ChromeLauncher,
  FileProfileArchive,
  IcaclsBrowserAccess,
  WasapiAudioController,
  bundledBrowserPath,
} from '@hecaton/browser-engine'
import { NativeWindowManager } from '@hecaton/window-manager'
import { MutexInstanceLock, WmiMachineIdentity } from '@hecaton/machine-lock'
import {
  appDirName,
  accountMutexPrefix,
  ELECTRON_DIR_NAME,
  FileLogger,
  CorruptJsonError,
  JsonFileStorage,
  accountConfigFilePath,
  accountDir,
  accountProfilesDir,
  appDataDir,
  deleteUserData,
  listAccountIds,
  logsDir,
  panelCacheDir,
  panelCachesDir,
  machineSealPath,
  migrateLegacyLayout,
} from '@hecaton/storage'
import { buildGameRegistry } from '@hecaton/games'
import { allowsNavigation, cspHeaders, panelWebPreferences } from './security.js'
import { firstRunSlots } from './first-run.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const RENDERER_DIR = join(HERE, '..', 'renderer')
// Copied into dist by the build, so this one path is right in development and in
// the packaged app alike - no `app.isPackaged` branch, and no second load path
// that only exists after packaging.
const CHANGELOG = join(HERE, '..', 'CHANGELOG.md')
// .cjs, not .js: a sandboxed preload must be CommonJS, and this package is ESM.
const PRELOAD = join(HERE, '..', 'preload', 'preload.cjs')
// The browser the app ships, and the only one it will launch (ADR-0016). Same
// single load path as the changelog above and for the same reason: extraResources
// puts the tree under <app>/resources in the package, and
// `node scripts/fetch-chromium.mjs` links it under Electron's own resources
// directory in development - measured 2026-08-20, process.resourcesPath is
// node_modules/electron/dist/resources there. So no `app.isPackaged` branch, and
// the load path that is tested is the load path that ships.
const BROWSER = bundledBrowserPath(process.resourcesPath)

// Keep Electron's own cache under our data dir, not in the generic, shared
// %APPDATA%/Electron. Two reasons: ADR-0004 says everything the app persists
// lives under %APPDATA%/hecaton, and the shared folder is where "unable to
// move the cache: access denied" comes from - any other Electron app, or a
// still-closing instance of ours, holds it. Must run before the app is ready,
// while the paths can still be set.
//
// **One directory per launch, named by pid** (ADR-0021). Several windows run at
// once, so one shared directory brings that same error back against ourselves -
// and per *account* does not work either, because `setPath` cannot be moved
// after Electron resolves its session, so a window that switches accounts would
// keep holding the directory of the account it left. A pid is known here, before
// `ready`, and is never shared. `pruneStaleCaches` clears the ones whose process
// is gone.
app.setPath('userData', panelCacheDir(process.pid))

// There is deliberately no "--delete-user-data" branch here.
//
// One existed, for the NSIS uninstaller to call when the user ticked its
// delete-my-data checkbox. When the installer was dropped for a portable zip, the
// checkbox went with it and the flag was left behind as apparently harmless dead
// code. It was not dead: it was a bare argv flag that removed %APPDATA%/hecaton -
// every logged-in profile - with no confirmation anywhere, because the only
// confirmation had ever lived in NSIS. ADR-0005's guarantee reads "no live profile
// is ever deleted ... never by a flag", and a flag is exactly what it had become.
//
// The installer came back on 2026-08-21 (ADR-0019) and this did not, and then the
// installer went away again (ADR-0020). The round trip is the point: the premise
// the flag needed is what was rejected, not the packaging that happened to remove
// it - probe P1 measured that an update runs the *previous* release's uninstaller
// silently, so a deletion decided in NSIS is frozen into every copy already handed
// out. Whichever format comes back next, wiring this up because something can call
// it would undo that reasoning without meeting it.
//
// `planUserDataDeletion` in the core and `deleteUserData` in storage stay: they are
// tested, they were never installer-specific, and the caller they were waiting for
// now exists - the `data:deleteAll` handler below, reachable only from the panel,
// behind an explicit confirmation, on an enumerated channel that takes no path.

/**
 * The app's entire network surface, as two constants (D7).
 *
 * Constants, and never anything else. `RELEASES_PAGE` is what
 * `shell.openExternal` receives; a url arriving from the renderer, or read out of
 * the document `RELEASES_API` returned, would make that call "open whatever
 * someone else says" — which is the arbitrary-open surface ADR-0007 decision 3
 * refused for IPC, and the reason `logs:reveal` takes no argument either.
 *
 * Two entrances since 2026-09-18, one address: the button in Configurações, and
 * `offerUpdateIfAny` once per launch (ADR-0023, superseding part of ADR-0014).
 * Nothing runs on a timer or in the background, and there is no second network
 * surface anywhere in the app - the single `fetch` below is still the whole of
 * it. What the launch check costs, and why the owner took it over D7/D8's
 * refusal, is written down in the ADR rather than inferred from here.
 */
const RELEASES_API = 'https://api.github.com/repos/Shofnip/hecaton/releases/latest'
const RELEASES_PAGE = 'https://github.com/Shofnip/hecaton/releases/latest'

/**
 * What the request says about the user, which is less than saying nothing.
 *
 * That reads backwards and is the measured result (probe P3). Omitting the
 * header does not send an empty one: Electron's `fetch` supplies Chromium's
 * default, which on 2026-08-09, on Electron 43.2.0, was
 * `Mozilla/5.0 (Windows NT 10.0; Win64; x64) … Chrome/150.0.7871.129
 * Electron/43.2.0 Safari/537.36` — Windows build, architecture, Chromium version
 * and the Electron version, which pins the app's version range anyway. The exact
 * string moves with every Electron bump, which is the point rather than a
 * caveat: replacing it with the product name is a *reduction*, and stays one.
 *
 * The version is deliberately not appended. The comparison happens on this
 * machine, so sending it would buy nothing and leave "this IP runs version X" in
 * a log the owner never sees. (A bare `curl` with no User-Agent at all gets 403
 * from this API; that is a property of curl's request, not a reason for this
 * constant.)
 */
const UPDATE_USER_AGENT = 'Hecaton'

/** Long enough for a slow connection, short enough that the button is not stuck. */
const UPDATE_TIMEOUT_MS = 8000

/**
 * A ceiling on the response, because it is unbounded and comes from the network.
 * A real release document here is a few kilobytes; the largest on GitHub are
 * ~150 KB, all of it asset listings. A megabyte is well past anything genuine and
 * well short of what would hurt to buffer.
 */
const UPDATE_BODY_MAX = 1_000_000

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

/**
 * The account this window owns, and the two adapters bound to its directory.
 *
 * Rebuilt rather than reconfigured when the user switches accounts: every path
 * either of them holds belongs to one account, and a half-switched pair - new
 * config, old profiles - is how one account's screens would open another
 * account's sessions. Assigned before the panel exists, by `openAccount`.
 */
let accountId = 0
let storage: JsonFileStorage<unknown>
let profiles: FileProfileArchive
const logger = new FileLogger(logsDir())
// Built once from static registry data. The panel needs id and name (name is
// the Portuguese label, UI text) to offer a game picker; it never needs the url.
const GAMES = [...buildGameRegistry().values()].map((game) => ({ id: game.id, name: game.name }))

/**
 * The account list the panel last saw.
 *
 * Cached rather than read on every push: state goes out several times a second
 * and reading every account's config that often would be a disk read per
 * account per tick, for a list that changes only when somebody renames, creates
 * or switches. Refreshed at those three moments and when the settings modal
 * opens, which is the only place it is shown.
 */
let knownAccounts: { id: number; name: string }[] = []

function refreshAccounts(): void {
  knownAccounts = readAccounts()
}

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
/**
 * The name a corrupt `config.json` was kept under, once it has been set aside.
 *
 * Sent to the panel as a name rather than a sentence: what to tell the user is
 * the renderer's, in Portuguese, like every other string they read.
 */
let configQuarantinedAs: string | undefined
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

/**
 * Points this window at an account: its directory, its config, its profiles.
 *
 * Creating the directory here rather than in the claim is deliberate. The claim
 * decides **which** account, holding its lock while it does; only then is there
 * a reason for the directory to exist, and only the window holding that lock
 * ever writes inside it (ADR-0021).
 */
function openAccount(id: number): void {
  // The directory first, and `accountId` only once it is there. The other order
  // leaves the window claiming an account whose paths were never built when
  // `mkdirSync` throws - holding the new lock while `storage` and `profiles`
  // still point at the account it was leaving, which after a deletion is a
  // directory that no longer exists.
  mkdirSync(accountDir(id), { recursive: true })
  storage = new JsonFileStorage<unknown>(accountConfigFilePath(id))
  profiles = new FileProfileArchive(accountProfilesDir(id))
  accountId = id
}

/**
 * Removes the cache directories of launches that are gone.
 *
 * Which ones may go is `stalePanelCaches` in the core; this only asks Windows
 * whether a pid is alive and does the removing. `process.kill(pid, 0)` is the
 * same liveness check the launcher uses for browsers - it signals nothing and
 * throws when the process is not there.
 *
 * Failure is ignored on purpose: a directory that will not go is a few megabytes,
 * and a launch that refused to start over it would be trading the user's app for
 * tidiness.
 */
function pruneStaleCaches(): void {
  try {
    const root = panelCachesDir()
    if (!existsSync(root)) return
    for (const name of stalePanelCaches(readdirSync(root), process.pid, isProcessAlive)) {
      try {
        rmSync(join(root, name), { recursive: true, force: true })
      } catch {
        // Another window may have just started using it, or Windows may still be
        // letting go. Either way, not worth a word.
      }
    }
  } catch {
    // The whole sweep is optional.
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** What the panel shows in the account dropdown: every account, named. */
function readAccounts(): { id: number; name: string }[] {
  return listAccountIds().map((id) => {
    if (id === accountId) return { id, name: globals.accountName ?? defaultAccountName(id) }
    // Another account's config is **read** and never written: its owner may be
    // running right now. A file that will not parse costs a name, not a launch.
    try {
      const raw = readFileSync(accountConfigFilePath(id), 'utf8')
      const name = (JSON.parse(raw) as { accountName?: unknown }).accountName
      return { id, name: typeof name === 'string' && name ? name : defaultAccountName(id) }
    } catch {
      return { id, name: defaultAccountName(id) }
    }
  })
}

async function loadConfiguration(): Promise<void> {
  const registry = buildGameRegistry()
  const raw = await readConfigOrRecover()
  const parsed = parseConfig(raw)
  globals = parsed.globals
  slots = parsed.slots

  if (slots.length === 0) {
    // First run: a single slot on the first shipped game, filling the screen.
    // The user adds more from the panel, at which point the grid splits.
    const firstGame = [...registry.keys()][0]
    if (firstGame !== undefined) slots = firstRunSlots(firstGame, 1)
  }

  buildOrchestrator(registry, slots)
}

/**
 * Builds the orchestrator and the two adapters that own a worker, bound to the
 * account this window currently holds.
 *
 * Separate from `loadConfiguration` so a switch can still produce a usable
 * orchestrator when the new account's config will not parse. Leaving the
 * previous account's orchestrator in place there would be the worst outcome
 * available: this window holds the new account's lock, so its screens would
 * launch into profiles it no longer owns, and another window may already be
 * running them.
 */
function buildOrchestrator(
  registry: ReturnType<typeof buildGameRegistry>,
  list: SlotOverrides[],
): void {
  // Built before the orchestrator and kept, so shutdown can dispose their
  // workers. The window adapter embeds into the panel, which does not exist yet;
  // panelHwnd is read lazily, at reparent time, by which point it does.
  audioController = new WasapiAudioController()
  windowManager = new NativeWindowManager(panelHwnd)
  const launcher = new ChromeLauncher(accountProfilesDir(accountId), BROWSER)

  orchestrator = new Orchestrator({
    launcher,
    windows: windowManager,
    zoom: { preferences: launcher, controller: windowManager },
    screen: screen.getPrimaryDisplay().workArea,
    globals,
    registry,
    slots: list,
    autoRestart: true,
    logger,
    profiles,
    audio: audioController,
  })
}

/**
 * Reads `config.json`, and gets out of a hole if it is not JSON at all.
 *
 * The hole was real: the file was named in an error, the slots did not start,
 * and there was nothing the user could do from inside the app. Now it is
 * renamed beside itself and the app starts from defaults — the bad file is kept,
 * because it is the only copy of what they had configured.
 *
 * Only for a file that will not parse. A config that is valid JSON with a
 * rejected setting in it still stops the load and is left untouched, so a typo
 * costs one line rather than the whole file (see `config-recovery.ts`).
 *
 * If the rename itself fails there is nothing clever to do: the original error
 * stands, and the panel shows it as before.
 */
async function readConfigOrRecover(): Promise<unknown> {
  try {
    return await storage.load()
  } catch (error) {
    if (!(error instanceof CorruptJsonError)) throw error
    configQuarantinedAs = await storage.quarantine(new Date().toISOString())
    logger.log({
      level: 'warn',
      event: 'config.quarantined',
      message: `config.json was not valid JSON; kept as ${configQuarantinedAs}`,
    })
    return undefined
  }
}

async function saveConfiguration(): Promise<void> {
  // Nothing is written back after the user deleted their data: the app is on its
  // way out, and a save here would put config.json straight back into a directory
  // the user just emptied. Blocked at the one place every write goes through
  // rather than at each caller.
  if (userDataDeleted) return
  // The orchestrator owns the slot list once running - add and remove change it
  // - so its view is the one that gets persisted, never the startup copy.
  const value: PersistedConfig = { ...globals, slots: orchestrator.slotConfigs() }
  await storage.save(value)
}

/**
 * Set once the user has deleted their data, and never cleared.
 *
 * Between the deletion and the app closing, everything that writes under
 * `%APPDATA%/hecaton` has to stay quiet — otherwise a debounced config save or a
 * log line recreates part of what was just removed, and the user watches their
 * "delete everything" put files back.
 */
let userDataDeleted = false
/** The two repeating effects, held so the deletion can stop them. */
let livenessTimer: ReturnType<typeof setInterval> | undefined
let audioTimer: ReturnType<typeof setInterval> | undefined

// A volume-slider drag fires dozens of changes a second; each applies to audio
// at once (the persistent WASAPI worker is ~12ms) but persisting every one would
// thrash config.json. A trailing debounce coalesces the burst into one write of
// the final value.
let saveTimer: ReturnType<typeof setTimeout> | undefined
function saveConfigurationSoon(): void {
  cancelPendingSave()
  saveTimer = setTimeout(() => {
    saveTimer = undefined
    void saveConfiguration()
  }, 400)
}

/**
 * Drops a pending debounced save.
 *
 * Both deletions call this before removing anything: the queued write still
 * points at the config file inside the directory about to go, and a save landing
 * after the removal recreates part of what the user just deleted.
 */
function cancelPendingSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = undefined
}

interface PanelState {
  slots: SlotSnapshot[]
  games: { id: string; name: string }[]
  maxSlots: number
  audioFollowsFocus: boolean
  theme: Theme
  /**
   * Whether the terms warning is still owed. Sent as the answer rather than as
   * the stored number, because comparing it against the current version is the
   * core's rule and the renderer has no business holding a copy of it.
   */
  needsTerms: boolean
  /**
   * The running version, so the panel can show it beside the update check.
   * Suggested complement 4, and not really optional once there is a check: "há
   * uma atualização" is meaningless without saying from what.
   */
  version: string
  configError?: string
  /** File name a corrupt config was kept under; the panel phrases the rest. */
  configQuarantinedAs?: string
  /**
   * What changed in the version now running, whenever the changelog says.
   *
   * Read from a file in the package, never from the network: the notes for the
   * version already running would need a request at launch, and ADR-0014 is
   * precisely the decision that the app makes none the user did not ask for.
   */
  releaseNotes?: string
  /**
   * Whether those notes should open by themselves, which is only true until the
   * user dismisses them once. Kept apart from the text for the same reason
   * `needsTerms` is kept apart from the warning: the panel offers the notes
   * again from Configurações afterwards, and "available" is not "due".
   */
  needsReleaseNotes: boolean
  /**
   * The update this launch found, when there is one the user has not already
   * answered "não lembrar mais" about.
   *
   * Sent as the finished offer rather than as a raw check: whether to interrupt
   * somebody's launch is the core's rule (`shouldOfferUpdate`), and the panel
   * only draws what it is given. Absent is the normal case - offline, up to
   * date, or dismissed.
   */
  updateOffer?: { version: string; notes: string }
  /** The account this window owns: what the dropdown shows as selected. */
  account: { id: number; name: string }
  /**
   * Every account on the machine, for the dropdown.
   *
   * No "in use" flag, and that absence is a decision: finding out whether
   * another window holds an account means taking its lock, and a probe that
   * takes a lock for a moment can push a window that is starting up onto a
   * different account. A switch to a busy account fails and says so instead.
   */
  accounts: { id: number; name: string }[]
}

/** Everything the renderer is allowed to know. */
function currentState(): PanelState {
  const state: PanelState = {
    slots: orchestrator ? orchestrator.snapshot() : [],
    games: GAMES,
    maxSlots: globals.maxSlots,
    audioFollowsFocus: globals.audioFollowsFocus,
    theme: globals.theme,
    needsTerms: needsTermsAcknowledgement(globals.termsAcknowledged),
    needsReleaseNotes: needsReleaseNotes(globals.releaseNotesShownFor, version()),
    version: version(),
    account: { id: accountId, name: globals.accountName ?? defaultAccountName(accountId) },
    accounts: knownAccounts,
  }
  if (configError !== undefined) state.configError = configError
  if (configQuarantinedAs !== undefined) state.configQuarantinedAs = configQuarantinedAs
  const notes = releaseNotes()
  if (notes !== undefined) state.releaseNotes = notes
  if (updateOffer !== undefined) state.updateOffer = updateOffer
  return state
}

function pushState(): void {
  const state = currentState()
  panel?.webContents.send('state', state)
  // The overlay too, and it was missing: the settings modal renders **there**,
  // so without this the account dropdown showed whatever the state was when the
  // window opened. Creating an account then looked like nothing had happened -
  // the wall stopped its screens and the modal, reopened, still named the old
  // account. The overlay keeps the copy and redraws nothing on its own (it would
  // wipe a half-typed field), so this is only ever a fresher snapshot.
  overlay?.webContents.send('state', state)
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

    'data:reveal': async (payload) => {
      // Same shape as logs:reveal, and the same reason it takes no argument:
      // main computes the directory, so this cannot become "open any folder".
      // Only %APPDATA%/hecaton — never the temp directory a clean-session screen
      // uses, which is outside the app's own data and not ours to open.
      parseNoPayload(payload)
      mkdirSync(appDataDir(), { recursive: true })
      await shell.openPath(appDataDir())
    },

    'data:deleteAccount': async (payload) => {
      // The narrower of the two deletions, and the one the panel offers first:
      // this account's screens, config and cache, and nothing belonging to any
      // other account - which another window may be running right now
      // (ADR-0021). Guarded exactly like the wider one below.
      parseNoPayload(payload)
      requireEveryScreenStopped((orchestrator ? orchestrator.snapshot() : []).map((s) => s.state))

      const deleted = accountId
      // Where this window will live afterwards, decided **before** anything is
      // removed. A window with no account has no config to write and no
      // profiles to launch, and the app used to answer that by quitting; the
      // owner asked for the other answer, so a deletion with nowhere to go is
      // refused and nothing is touched. Claimed rather than counted: whether
      // another window holds an account is only knowable by taking its lock.
      const successor = await claimSuccessor(deleted)
      if (!successor) {
        logger.log({ level: 'info', event: 'accounts.delete-refused', message: 'no-successor' })
        return { ok: false, reason: 'no-successor' }
      }
      // Nothing may write into the account between here and the deletion. A
      // debounced save is the one thing that could: it fires 400ms after the
      // last change, still pointing at the config file about to be removed, and
      // would put the "deleted" account back on disk as an empty directory.
      cancelPendingSave()
      // A failed removal is **not** a reason to stay on the account. By the time
      // anything here throws, `rmSync` has already taken most of the directory
      // (probe P4: it removes what it can and then raises), so the window would
      // be left pointing at a gutted profile - where the next volume drag would
      // write its config.json back. The move happens either way; the failure is
      // reported afterwards.
      let removalError: unknown
      try {
        // The leaf is the account id, which is also the directory name: the
        // core's allowlist is checking main against the same number it used to
        // build the path.
        const remaining = deleteUserData([
          { path: accountDir(deleted), leaf: accountDirName(deleted) },
        ])
        // Nothing of this window's is held open inside the account: its Electron
        // cache lives in `shell/<pid>`, outside. So **nothing** may survive, and
        // anything that does is a browser that was still running - the failure
        // this check exists to name.
        verifyUserDataDeletion(remaining, [])
        logger.log({ level: 'info', event: 'accounts.deleted', message: String(deleted) })
      } catch (error) {
        removalError = error
        logger.log({
          level: 'error',
          event: 'accounts.delete-failed',
          message: error instanceof Error ? error.message : String(error),
        })
      }

      // And the window stays open on the account claimed above rather than
      // closing. The wide deletion below still quits, because after it there
      // is no account to move to and nowhere to write.
      try {
        await adoptAccount(successor.lock, successor.id)
      } catch (error) {
        // The successor's lock is held from before the deletion, and a throw
        // here would strand it: nobody would hold a reference to release it, so
        // that account would be unopenable by every window - including this one,
        // which would be told "already open in another window" about a lock it
        // owns itself. The switch has carried this guard since it was written;
        // the deletion was missing it.
        if (instanceLock !== successor.lock) await successor.lock.release()
        throw error
      }
      logger.log({ level: 'info', event: 'accounts.switched', message: String(successor.id) })
      // Reported only now, with the window already somewhere safe: what the user
      // has to know is that something of the old profile is still on disk.
      if (removalError !== undefined) throw removalError
      return { ok: true }
    },

    'data:deleteAll': async (payload) => {
      // The wider of the two paths that delete a live profile, and the one that
      // exists because nothing else can ask the question: the artifact is a zip and there
      // is no uninstaller (ADR-0020), and while there was one it deliberately did
      // not ask (ADR-0019). Three
      // things guard it, and none of them is the confirmation dialog: the panel's
      // confirmation is UX.
      //
      // 1. Every screen must be stopped. Chrome holds its profile open, so a
      //    deletion underneath a running browser half-succeeds (probe P4).
      // 2. The path is computed here, from storage's own function; the channel
      //    carries no payload at all, so nothing the renderer sends can steer it.
      //    The leaf comes from `appDirName()`, the same function the path is
      //    built from, so the core's allowlist is checking main against itself -
      //    and a development run, whose directory is `hecaton-dev`, is checked
      //    against its own name rather than against the production constant.
      // 3. What survived is judged by the core - see below.
      //
      // **It reaches every account, including ones another window is running.**
      // That is the difference from `data:deleteAccount` above and the reason the
      // panel words them differently: this one is the honest "all of it", and a
      // second window losing its profiles mid-session is a consequence the user
      // is told about before confirming.
      parseNoPayload(payload)
      requireEveryScreenStopped((orchestrator ? orchestrator.snapshot() : []).map((s) => s.state))

      // `appDirName()`, not the `APP_DIR_NAME` constant: the core refuses a path
      // whose last segment is not the declared leaf, and a development run
      // resolves `%APPDATA%/hecaton-dev` (ADR-0022). With the constant this
      // action threw there - failing closed, but failing.
      const remaining = deleteUserData([{ path: appDataDir(), leaf: appDirName() }])
      // One tolerated name, again. This window's Electron cache lives in
      // `shell/<pid>` (per launch, not per account), so what survives is the
      // `shell` directory holding it - and nothing inside `accounts/`, whatever
      // another window may be running. That is deliberate: the wide delete is
      // the honest "all of it", and a second window losing its profiles
      // mid-session is what the confirmation warns about.
      verifyUserDataDeletion(remaining, [ELECTRON_DIR_NAME])

      quitAfterDeletion()
    },

    'terms:acknowledge': async (payload) => {
      // The panel says "the user pressed the button", not "the user has read
      // version N" — which version was on screen is main's own knowledge, since
      // main is what decided to show it.
      parseNoPayload(payload)
      globals = { ...globals, termsAcknowledged: TERMS_VERSION }
      await saveConfiguration()
      pushState()
    },

    'notes:acknowledge': async (payload) => {
      // Same shape as terms:acknowledge, and no payload for the same reason:
      // which version's notes were on screen is main's knowledge, since main is
      // what read the file and decided to send them.
      parseNoPayload(payload)
      globals = { ...globals, releaseNotesShownFor: version() }
      await saveConfiguration()
      pushState()
    },

    'update:check': async (payload) => {
      parseNoPayload(payload)
      return checkForUpdates()
    },

    'update:dismiss': async (payload) => {
      // "Não lembrar mais", about the version this launch offered - which is
      // main's own knowledge, so the channel carries nothing. The other two
      // answers write nothing at all: "atualizar agora" opens the page, and
      // "lembrar depois" is the absence of an answer, which is what brings the
      // offer back at the next launch.
      parseNoPayload(payload)
      if (updateOffer === undefined) return
      globals = { ...globals, updateDismissedFor: updateOffer.version }
      updateOffer = undefined
      await saveConfiguration()
      pushState()
    },

    'update:openPage': async (payload) => {
      // The one handoff to the user's own browser. It takes no argument and
      // opens a constant, so there is nothing here for a payload or a fetched
      // document to steer. D7's shape: the app never downloads or runs an
      // installer — it hands the user a page and gets out of the way.
      parseNoPayload(payload)
      await shell.openExternal(RELEASES_PAGE)
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

    'slots:cancelLogin': (payload) => {
      // Closes the windows that screen opened for itself - the provider login -
      // and leaves the screen alone. The state is pushed at once rather than
      // waiting for the next sweep, so the control disappears with the window it
      // closed instead of a tick later.
      orchestrator.closeExtraWindows(parseSlotId(payload))
      pushState()
    },

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
      // DPI only informs the core's zoom policy; geometry stays untouched.
      const dpiScale = panel ? screen.getDisplayMatching(panel.getBounds()).scaleFactor : 1
      orchestrator?.applyScreenLayout(parseScreenLayout(payload), dpiScale)
    },

    'overlay:open': (payload) => {
      // The wall asks to show a modal or the volume popover. Validate the request,
      // then show the overlay (above the games), make it interactive, and hand it
      // the request. The overlay renders it and calls overlay:close when done.
      const request = parseOverlayRequest(payload)
      // The settings modal is the only place the account list is shown, so this
      // is where it is worth a handful of small reads - rather than on every
      // state push, several times a second, for a list nobody is looking at.
      if (request.kind === 'settings') {
        refreshAccounts()
        pushState()
      }
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

    'accounts:rename': async (payload) => {
      // Writes this window's own config and no other. The channel carries no id
      // for that reason — see ipc.ts.
      globals = { ...globals, accountName: parseAccountRename(payload) }
      await saveConfiguration()
      refreshAccounts()
      pushState()
    },

    'accounts:switch': async (payload) => {
      // An existing account only. Creating one is `accounts:create`, which works
      // the next id out from the disk - a switch that created its target would
      // let the panel name a directory, which is the thing that channel's
      // comment says it must not be able to do.
      const target = parseAccountSwitch(payload)
      if (!listAccountIds().includes(target)) {
        throw new Error(`no account ${target}`)
      }
      return switchAccount(target)
    },

    'accounts:create': async (payload) => {
      // The next id is worked out here, from what is on disk. A channel that
      // accepted one would let the panel point a "new" account at an existing
      // account's profile directory.
      parseNoPayload(payload)
      return switchAccount(nextAccountId(listAccountIds()))
    },

    'accounts:createOnly': async (payload) => {
      // The same creation without the move: the profile appears in the list and
      // this window stays where it is, which is how somebody prepares the
      // profile a second Hecaton will open.
      //
      // The lock is taken for the length of the creation and released at once.
      // Not ceremony: two windows creating at the same instant both compute the
      // same next id, and the lock is what makes one of them lose - the same
      // rule a launch follows. Releasing immediately is the point of the
      // feature; an account nobody is running is one any window may take.
      parseNoPayload(payload)
      const id = nextAccountId(listAccountIds())
      const lock = new MutexInstanceLock(accountMutexPrefix())
      const claim = await lock.claim(id)
      if (claim !== 'free') {
        await lock.release()
        return { ok: false, reason: claim }
      }
      try {
        // A directory is what makes an account exist - `listAccountIds` reads
        // the disk - and it is deliberately all that is written. The config is
        // the owning window's to create, and writing one here would be this
        // window writing into a profile it does not hold.
        mkdirSync(accountDir(id), { recursive: true })
        logger.log({ level: 'info', event: 'accounts.created', message: String(id) })
      } finally {
        await lock.release()
        refreshAccounts()
        pushState()
      }
      return { ok: true, id, name: defaultAccountName(id) }
    },

    'accounts:renameAt': async (payload) => {
      // Renaming a profile this window is not on. The name lives in that
      // account's own config, which is a file only its owner is supposed to
      // write - so the owner is what this becomes, for as long as the write
      // takes, by holding its lock.
      const { id, name } = parseAccountEdit(payload)
      if (id === accountId) {
        globals = { ...globals, accountName: name }
        await saveConfiguration()
        refreshAccounts()
        pushState()
        return { ok: true }
      }
      return withAccountHeld(id, async () => {
        // Read-modify-write, and the read is what keeps it honest: the file
        // holds that account's screens, and writing a config with only a name
        // in it would delete them. A file that will not parse is a refusal, not
        // an excuse to replace it.
        const storageForAccount = new JsonFileStorage<unknown>(accountConfigFilePath(id))
        // `undefined` is the honest answer for a profile created but never
        // opened - `accounts:createOnly` writes a directory and no config - and
        // the core reads it as the shipped defaults, which is exactly what that
        // profile would get on its first launch anyway.
        const parsed = parseConfig(await storageForAccount.load())
        await storageForAccount.save({
          ...parsed.globals,
          accountName: name,
          slots: parsed.slots,
        })
        logger.log({ level: 'info', event: 'accounts.renamed', message: String(id) })
      })
    },

    'accounts:deleteAt': async (payload) => {
      // Deleting a profile this window is not on. Same lock, for a stronger
      // reason: the directory holds logged-in browser profiles, and removing one
      // under a running Chrome half-succeeds (probe P4).
      const id = parseAccountSwitch(payload)
      if (id === accountId) {
        // This window's own account has to stop its screens and move somewhere,
        // which is `data:deleteAccount` and nothing this channel should repeat.
        throw new Error('use data:deleteAccount for this window own account')
      }
      return withAccountHeld(id, async () => {
        const remaining = deleteUserData([{ path: accountDir(id), leaf: accountDirName(id) }])
        // Nothing may survive: no window holds this account - that is what the
        // lock just proved - so anything left is a browser that outlived its
        // window, and the caller has to hear about it.
        verifyUserDataDeletion(remaining, [])
        logger.log({ level: 'info', event: 'accounts.deleted', message: String(id) })
      })
    },
  }

  for (const channel of IPC_CHANNELS) {
    ipcMain.handle(channel, guard(handlers[channel]))
  }
}

/**
 * Asks GitHub what the latest release is, and hands the answer to the core.
 *
 * Thin on purpose: everything that decides anything — what a status code means,
 * whether a tag is newer, what may be carried out of the body — is
 * `interpretUpdateCheck`, in the fast suite. This function's whole job is to turn
 * "the network" into a status code and a parsed value, and to make sure it always
 * returns rather than throwing. Failure is an ordinary outcome here, not an
 * exception: no connection, GitHub down and a rate limit are all things that
 * happen to a check that runs once, on a click.
 */
async function checkForUpdates(): Promise<UpdateCheck> {
  let response: Response
  try {
    response = await fetch(RELEASES_API, {
      headers: { 'User-Agent': UPDATE_USER_AGENT, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS),
    })
  } catch {
    // No network, DNS failure, or the timeout above. Indistinguishable from here
    // and identical to the user: the check could not be made.
    return { status: 'unavailable', reason: 'offline' }
  }

  // The body is only read for a 200. Every other status is answered by the core
  // from the number alone, so a 500 page or an error document is never parsed.
  if (response.status !== 200) return interpretUpdateCheck(response.status, undefined, version())

  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > UPDATE_BODY_MAX) return { status: 'unavailable', reason: 'malformed' }

  let parsed: unknown
  try {
    const text = await response.text()
    // The check that actually does the work. Probe P3 measured `content-length`
    // coming back **null** for the largest real response tried, because GitHub
    // sends it chunked - so the header above is a cheap early exit and nothing
    // more. Dropping this line would leave the ceiling unenforced exactly where
    // it matters.
    if (text.length > UPDATE_BODY_MAX) return { status: 'unavailable', reason: 'malformed' }
    parsed = JSON.parse(text)
  } catch {
    return { status: 'unavailable', reason: 'malformed' }
  }

  return interpretUpdateCheck(200, parsed, version())
}

/**
 * What this launch's check found, held for the panel and for the dismissal.
 *
 * Main keeps it rather than the renderer, for the reason every "which version?"
 * in this app is main's: the dismissal channel carries no payload, so the
 * version it records has to be one the panel could not have chosen.
 */
let updateOffer: { version: string; notes: string } | undefined

/**
 * The check the app makes by itself, once, just after the panel appears.
 *
 * This is new behaviour and it reverses a decision: D7/D8 said the app's only
 * network request would follow a click and never a launch or a timer. The owner
 * asked for the launch check on 2026-09-18 and chose "every launch" over "once a
 * day" knowing the cost — `api.github.com` sees an address every time a Hecaton
 * opens, and two windows are two requests. ADR-0023 records it.
 *
 * Three things keep it from being more than that. It runs **after** the panel is
 * up, so a slow or hanging request delays nothing the user is waiting for. It
 * never throws: `checkForUpdates` answers failure as a state, and an offline
 * launch simply says nothing. And whether an answer is worth interrupting for is
 * `shouldOfferUpdate` in the core, which keeps quiet about a version the user
 * has already refused.
 */
async function offerUpdateIfAny(): Promise<void> {
  const check = await checkForUpdates()
  if (!shouldOfferUpdate(check, globals.updateDismissedFor)) return
  // Narrowed by the guard above; `status` is the only thing that says so.
  if (check.status !== 'update-available') return
  updateOffer = { version: check.version, notes: check.notes }
  logger.log({ level: 'info', event: 'update.offered', message: check.version })
  pushState()
}

/**
 * The notes for the running version, whenever the changelog has a section for it.
 *
 * Sent regardless of whether they are still owed, because the panel offers them
 * twice: once automatically after an update, and afterwards as an entry in
 * Configurações. Whether to open the modal by itself is the separate
 * `needsReleaseNotes` flag - the text being available is not the same question
 * as the text being due.
 *
 * Missing file, unreadable file, or a version nobody wrote notes for are all the
 * same ordinary answer: nothing to show. That is what keeps the changelog
 * optional rather than a file the app depends on - a release whose notes were
 * not written says nothing instead of failing.
 */
function releaseNotes(): string | undefined {
  try {
    const section = changelogSection(readFileSync(CHANGELOG, 'utf8'), version())
    return section === undefined ? undefined : displayNotes(section)
  } catch {
    return undefined
  }
}

/** The running version, which is what a published tag is compared against. */
function version(): string {
  return app.getVersion()
}

/** Long enough for the panel's "data deleted" toast to be read, and no longer. */
const QUIT_AFTER_DELETION_MS = 1200

/**
 * Closes the app once the user's data is gone.
 *
 * Staying open is not an option: the config the panel is showing no longer exists
 * on disk, and the next change would write it back. Quitting is also what the
 * confirmation told the user would happen.
 *
 * Everything that writes under the deleted directory stops first — the debounced
 * save, the liveness tick and the audio tick — so that nothing recreates a
 * fragment of it during the second this waits. The delay is only so the panel can
 * say what happened before its window disappears; the deletion is already done
 * when this is called.
 */
function quitAfterDeletion(): void {
  userDataDeleted = true
  // Nothing may write under the data directory from here on, and a log line is a
  // write: `FileLogger.log` creates the directory it writes into, so one line
  // after the deletion puts `logs/` back.
  logger.silence()
  cancelPendingSave()
  if (livenessTimer) clearInterval(livenessTimer)
  if (audioTimer) clearInterval(audioTimer)
  setTimeout(() => app.quit(), QUIT_AFTER_DELETION_MS)
}

/**
 * Held for the life of the process, and swapped when the user switches accounts.
 *
 * The mutex it owns is what makes "one window per account" true across Windows
 * logon sessions (ADR-0021, replacing ADR-0018's one-per-machine).
 */
let instanceLock = new MutexInstanceLock(accountMutexPrefix())

/** What a switch did, for the panel to turn into a toast. */
interface AccountSwitch {
  ok: boolean
  /** Why not, when it failed: the lock's own word for it. */
  reason?: 'held-by-this-user' | 'held-by-another-user' | 'unavailable'
}

/**
 * Starts the two sweeps the app runs on a clock, and restarts them after a
 * switch.
 *
 * Idempotent, because a switch rebuilds the orchestrator and the old timers
 * would go on calling the one that was thrown away: the previous handles are
 * cleared first. Guarded on there being an orchestrator at all - a config that
 * will not parse leaves the panel up with no screens to sweep.
 */
function startTimers(): void {
  if (livenessTimer) clearInterval(livenessTimer)
  if (audioTimer) clearInterval(audioTimer)
  livenessTimer = undefined
  audioTimer = undefined
  if (!orchestrator) return

  livenessTimer = setInterval(() => {
    // Two jobs on one timer, and deliberately so: both are sweeps over the live
    // screens that exist because there is no CDP to tell the app anything. One
    // notices a browser that died; the other notices a window a page opened - a
    // provider login - which the browser places off the edge of the world (see
    // detached-window.ts). Synchronous and silent when there is nothing to move,
    // so it costs the tick nothing.
    orchestrator.revealDetachedWindows()
    void orchestrator.checkLiveness().then(pushState)
  }, LIVENESS_INTERVAL_MS)

  // Make audio follow focus on its own faster timer. A tick still crosses a
  // process boundary to mute a slot - ~12 ms through the persistent WASAPI
  // worker, down from the ~270 ms a fresh shell-out cost - so a busy flag keeps
  // ticks from overlapping rather than stacking work when the interval is
  // shorter than the tick.
  let audioBusy = false
  audioTimer = setInterval(() => {
    if (audioBusy) return
    audioBusy = true
    void orchestrator.applyAudio().finally(() => {
      audioBusy = false
    })
  }, AUDIO_FOCUS_INTERVAL_MS)
}

/**
 * Moves this window to another account, or reports why it cannot.
 *
 * **The new lock is taken before the old one is released**, and that order is
 * the whole design. Released first, the window would spend a moment owning
 * nothing: another instance could take the account it just left, and a failed
 * claim on the target would leave it with no account at all and no way back.
 * Taking the target first costs a second lock worker for the length of the
 * switch and cannot strand anybody.
 *
 * Everything else follows from "one account per window": the screens stop
 * (their profiles belong to the account being left), the adapters that own a
 * PowerShell worker are disposed rather than reused, and the orchestrator is
 * rebuilt by `loadConfiguration` against the new account's config.
 */
async function switchAccount(targetId: number): Promise<AccountSwitch> {
  if (targetId === accountId) return { ok: true }

  const candidate = new MutexInstanceLock(accountMutexPrefix())
  const state = await candidate.claim(targetId)
  if (state !== 'free') {
    await candidate.release()
    logger.log({ level: 'info', event: 'accounts.switch-refused', message: state })
    return { ok: false, reason: state }
  }

  try {
    await stopEveryScreen()
    if (orchestrator) await saveConfiguration()
    await adoptAccount(candidate, targetId)
    logger.log({ level: 'info', event: 'accounts.switched', message: String(targetId) })
    return { ok: true }
  } catch (error) {
    // Anything unexpected between taking the new lock and finishing the switch.
    // The lock must not be stranded: a worker nobody references keeps the account
    // unopenable by any window, including this one, for the rest of the session.
    logger.log({
      level: 'error',
      event: 'accounts.switch-failed',
      message: error instanceof Error ? error.message : String(error),
    })
    if (instanceLock !== candidate) await candidate.release()
    return { ok: false, reason: 'unavailable' }
  }
}

/**
 * Stops every screen this window is running.
 *
 * Not politeness before a switch: the browsers hold this account's
 * profiles open, and a profile still being written while another window claims
 * the account - or while the directory is removed - is the collision the lock
 * exists to prevent. A screen that will not stop is not a reason to abandon the
 * operation: its process is the launcher's to reap.
 */
async function stopEveryScreen(): Promise<void> {
  for (const slot of orchestrator?.snapshot() ?? []) {
    if (slot.state === 'stopped' || slot.state === 'crashed') continue
    try {
      await orchestrator.stop(slot.id)
    } catch {
      // Reported on the slot's own card; the sweep carries on.
    }
  }
}

/**
 * Hands this window over to an account whose lock is already held.
 *
 * Shared by the switch and by deleting the current account, because the second
 * half is identical: let the old lock and the old workers go, point every path
 * at the new account, rebuild, and say so. The caller owns the claim, which is
 * what keeps the window from ever being between two accounts.
 */
async function adoptAccount(lock: MutexInstanceLock, targetId: number): Promise<void> {
  // An offer belongs to the account whose config would record the dismissal, so
  // it does not travel: `update:dismiss` writes into whichever account this
  // window holds when the user answers, and an offer outliving the move would
  // write the answer into the wrong one.
  updateOffer = undefined
  // Creating the target's directory is the only step here that can fail, so it
  // runs **before** anything is swapped: a throw then leaves this window exactly
  // as it was, for the caller to clean up. Once the old lock is released and the
  // new one installed there is no such thing as "as it was" - the window would
  // hold one account's lock and another's paths. `openAccount` repeats the
  // `mkdirSync`, which is idempotent.
  mkdirSync(accountDir(targetId), { recursive: true })
  await Promise.allSettled([audioController?.dispose(), windowManager?.dispose()])
  if (instanceLock !== lock) await instanceLock.release()
  instanceLock = lock

  openAccount(targetId)
  configError = undefined
  configQuarantinedAs = undefined
  try {
    await loadConfiguration()
  } catch (error) {
    // The window is **already** on the new account here - the lock is held and
    // the paths are switched - so it must not be left with the previous
    // account's orchestrator, which would launch screens into profiles this
    // window no longer owns. An empty configuration for this account is the
    // honest state, and the panel shows why.
    configError = error instanceof Error ? error.message : String(error)
    logger.log({ level: 'error', event: 'config.error', message: configError })
    buildOrchestrator(buildGameRegistry(), [])
  }
  startTimers()
  refreshAccounts()
  pushState()
}

/**
 * Runs something against an account this window does not own, with that
 * account's lock held for exactly as long as it takes.
 *
 * The whole safety of editing another profile (owner's decision, 2026-09-19).
 * Reading whether a window has it open and then acting on the answer would leave
 * a gap in which one opens; taking the lock **is** the question and the answer.
 * A profile somebody is running is refused, in the lock's own words, and the
 * panel phrases it.
 *
 * The lock is always released, including when the work throws: this window is
 * not adopting the account, only borrowing it, and a lock left behind would make
 * that profile unopenable until the app closed.
 */
async function withAccountHeld(
  id: number,
  work: () => Promise<void>,
): Promise<{ ok: boolean; reason?: string }> {
  if (!listAccountIds().includes(id)) throw new Error(`no account ${id}`)
  const lock = new MutexInstanceLock(accountMutexPrefix())
  const state = await lock.claim(id)
  if (state !== 'free') {
    await lock.release()
    logger.log({ level: 'info', event: 'accounts.edit-refused', message: state })
    return { ok: false, reason: state }
  }
  try {
    await work()
    return { ok: true }
  } finally {
    await lock.release()
    refreshAccounts()
    pushState()
  }
}

/**
 * Takes the lock of an account this window could move to when the one it is on
 * is deleted, or answers that there is none.
 *
 * Only accounts that already exist, which is the whole difference from a launch:
 * a launch with every account busy makes a new one, and doing that here would
 * turn "remove this profile" into "remove this profile and be given an empty
 * one". The owner asked for a refusal instead, with the panel pointing at
 * clearing the cache — the action that empties a profile without removing it.
 *
 * The lock is taken and **kept**: it is handed to `adoptAccount`, so between the
 * deletion and the adoption no other window can take the account this one is
 * about to land on.
 */
async function claimSuccessor(
  deletedId: number,
): Promise<{ lock: MutexInstanceLock; id: number } | undefined> {
  const lock = new MutexInstanceLock(accountMutexPrefix())
  const id = await claimExistingAccount(
    listAccountIds().filter((existing) => existing !== deletedId),
    async (candidateId) => (await lock.claim(candidateId)) === 'free',
  )
  if (id === undefined) {
    await lock.release()
    return undefined
  }
  return { lock, id }
}

/**
 * The refusal screen, for the launches that never get a panel.
 *
 * A real window loading a real file, because there is no alternative: the app's
 * own error banner lives in the panel and arrives over IPC, and neither exists
 * yet at this point. `dialog.showErrorBox` was the other option and was not
 * taken - it renders one unstyled paragraph with no room to explain the recourse
 * for a foreign seal, which is the one refusal a legitimate user can hit.
 *
 * The verdict travels as the URL fragment and selects one section with CSS
 * `:target`, so the page carries no script and no new IPC channel - `ipc.ts`
 * says any channel beyond the ones it lists stops the work for the owner, and a
 * refusal screen is not the place to spend that.
 */
function showBlocked(verdict: InstanceClaimVerdict): void {
  Menu.setApplicationMenu(null)
  const blocked = new BrowserWindow({
    width: 620,
    height: 460,
    title: 'Hecaton',
    resizable: false,
    webPreferences: panelWebPreferences(),
  })
  lockDownWindow(blocked)
  void blocked.loadFile(join(RENDERER_DIR, 'blocked.html'), { hash: verdict })
}

/**
 * Takes the machine claim, reserves an account, and puts a refusal on screen.
 *
 * The decision itself is `claimInstance` in the core; this hands it the three
 * adapters plus the accounts it found on disk, and turns a refusal into a
 * window. On success it opens the account the core picked — creating its
 * directory, which is the first moment anything is written for it.
 *
 * The catch-all keeps the deliberate fail-open of the machine gate: resolving
 * the seal path can throw, and refusing to start because `%ProgramData%` could
 * not be located would charge the user for the app's own instrument failing. It
 * falls back to account 1, because a window with no account at all cannot show
 * anything — and the lock, not this path, is what keeps two windows apart.
 */
async function claimMachine(): Promise<InstanceClaimVerdict> {
  try {
    const claim = await claimInstance({
      identity: new WmiMachineIdentity(),
      lock: instanceLock,
      accountIds: listAccountIds(),
      seal: new JsonFileStorage<MachineSeal>(machineSealPath()),
      logger,
    })
    if (claim.verdict !== 'allow' || !claim.account) {
      showBlocked(claim.verdict)
      return claim.verdict
    }
    openAccount(claim.account.id)
    return 'allow'
  } catch (error) {
    // **Refused, not opened.** This used to fall back to account 1, reasoning
    // that the machine gate fails open everywhere else and the lock is what
    // keeps windows apart - which is exactly backwards, because this path is the
    // one that skips the lock. Anything that throws here (a `%ProgramData%` that
    // will not resolve, a directory listing racing another window's delete)
    // would open an unlocked account 1, and a second window doing the same puts
    // two browsers on one profile. That is the one cost this feature does not
    // pay; the rest of the machine gate still fails open inside the core.
    logger.log({
      level: 'error',
      event: 'instance.claim-failed',
      message: error instanceof Error ? error.message : String(error),
    })
    showBlocked('no-account')
    return 'no-account'
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
  // Electron can raise its own input HWND during activation. Run after that
  // callback; unchanged geometry must not leave it covering the game (ADR-0029).
  panel.on('focus', () => {
    setImmediate(() => windowManager?.restoreEmbeddedZOrder())
  })
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
    // **Not** alwaysOnTop, since 2026-09-18: that flag put the settings modal in
    // front of every other program on the machine, and the owner asked for it
    // back inside the app. Being owned by the panel is enough, and the claim was
    // measured rather than quoted (spike/overlay-z): an owned, non-topmost
    // window still paints over a WS_CHILD window embedded in its owner - which
    // is what every game screen is - while another application activated over it
    // comes in front, as any other window would. The same probe reproduced the
    // old behaviour by setting the flag back, so this is the one line that
    // caused it.
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
 * Several windows are allowed now, one per account (ADR-0021).
 *
 * `app.requestSingleInstanceLock` used to stand here and quit the second launch,
 * on the reasoning that two instances would race over one config file and one
 * set of profiles. That reasoning was right and is answered differently: each
 * window owns an account, and nothing inside `%APPDATA%/hecaton` is written by
 * two of them - not the config, not the profiles, not even Electron's own cache.
 * Electron's lock cannot express that, because it fires before there is any way
 * to know which account this window will get.
 */
{
  app.whenReady().then(async () => {
    // Retention, at the one moment it is safe: today's file is not open yet, and
    // nothing is racing the writer. A day per file forever is a directory that
    // only grows on someone else's disk, and the rule for which files may go is
    // the core's, not this adapter's.
    logger.prune()

    // First of all, and synchronously: a data directory written before accounts
    // existed is moved into account 1. Everything below resolves paths under an
    // account, so a launch that skipped this would create an empty account 1
    // beside the user's real profiles and look like it had lost them. ADR-0021.
    try {
      const outcome = migrateLegacyLayout()
      if (outcome !== 'nothing-to-do') {
        logger.log({ level: 'info', event: 'accounts.migrated', message: outcome })
      }
    } catch (error) {
      // Nothing was deleted - the move is renames into a staging directory, and
      // a failed one leaves the old layout where it was. Starting anyway would
      // create an empty account over a directory that still holds the user's
      // sessions, so this is one of the few things that stops the launch.
      logger.log({
        level: 'error',
        event: 'accounts.migration-failed',
        message: error instanceof Error ? error.message : String(error),
      })
      showBlocked('no-account')
      return
    }

    // Before the panel, and before anything can write a config file - which is
    // the point. json-file-storage.ts leans on one process per config, and what
    // makes that true with several windows running is the per-account lock this
    // claim takes.
    if ((await claimMachine()) !== 'allow') return
    refreshAccounts()

    // The caches of launches that are gone. After the claim rather than before,
    // so a window that is refused does not touch the disk at all.
    pruneStaleCaches()

    lockDownSession()

    // Before any screen can be launched, and after the claim so a refused launch
    // does not touch the disk at all. Chromium's network service runs in an
    // AppContainer and cannot start unless the browser's own files admit
    // `ALL APPLICATION PACKAGES`; a folder the user extracted a zip into does
    // not, and the symptom is every screen opening grey with no page ever
    // loading. The rule, and why it fails open, are in browser-access.ts.
    await ensureBrowserReadable({
      access: new IcaclsBrowserAccess(),
      browserDir: dirname(BROWSER),
      logger,
    })

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

    startTimers()

    // Last, and not awaited: the launch must not wait on the network for
    // anything, least of all for news. The panel is already on screen when this
    // resolves, and the offer arrives as a state push like any other.
    void offerUpdateIfAny()
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
    void Promise.allSettled([
      audioController?.dispose(),
      windowManager?.dispose(),
      instanceLock.release(),
    ]).finally(() => app.quit())
  })
}
