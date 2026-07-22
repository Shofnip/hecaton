export { computeGrid } from './grid.js'
export type { GridCell, GridLayout, ScreenBounds } from './grid.js'

export { SLOT_STATES, isLive, transition } from './slot-state.js'
export type { SlotEvent, SlotState } from './slot-state.js'

export { buildRegistry, validateGameDefinition } from './registry.js'
export type { GameDefinition, Viewport } from './registry.js'

export { DEFAULT_GLOBAL_CONFIG, SCHEMA_VERSION, resolveSlotConfig } from './config.js'
export type { GlobalConfig, ResolvedSlotConfig, SlotOverrides } from './config.js'

export { parseConfig, parseSlotOverrides } from './parse-config.js'
export type { ParsedConfig } from './parse-config.js'

export { formatLogRecord, redactUrls } from './log.js'
export type { LogEntry, LogLevel, LogRecord, Logger } from './log.js'

export {
  IPC_CHANNELS,
  parseNoPayload,
  parseSlotAddition,
  parseSlotId,
  parseSlotUpdate,
} from './ipc.js'
export type { IpcChannel } from './ipc.js'

export { normalizeUrl } from './normalize-url.js'

export { slotProfileDirName } from './slot-profile.js'

export { Orchestrator } from './orchestrator.js'
export type { OrchestratorDeps, SlotSnapshot } from './orchestrator.js'

export type { BrowserLauncher, LaunchRequest, Storage, WindowManager } from './ports.js'
