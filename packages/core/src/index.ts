export { computeGrid } from './grid.js'
export type { GridCell, GridLayout, ScreenBounds } from './grid.js'

export { SLOT_STATES, isLive, transition } from './slot-state.js'
export type { SlotEvent, SlotState } from './slot-state.js'

export { buildRegistry, validateGameDefinition } from './registry.js'
export type { GameDefinition, Viewport } from './registry.js'

export {
  DEFAULT_GLOBAL_CONFIG,
  MAX_SLOT_NAME_LENGTH,
  SCHEMA_VERSION,
  resolveSlotConfig,
} from './config.js'
export type { GlobalConfig, ResolvedSlotConfig, SlotOverrides, Theme } from './config.js'

export { parseConfig, parseSlotOverrides } from './parse-config.js'
export type { ParsedConfig } from './parse-config.js'

export { LOG_FILES_KEPT, expiredLogFiles, formatLogRecord, redactUrls } from './log.js'
export { quarantineFileName } from './config-recovery.js'
export { changelogSection, displayNotes, needsReleaseNotes } from './changelog.js'
export type { LogEntry, LogLevel, LogRecord, Logger } from './log.js'

export {
  IPC_CHANNELS,
  parseAudioFollowsFocus,
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
} from './ipc.js'
export type { IpcChannel, OverlayRequest, ScreenPlacement } from './ipc.js'

export { normalizeUrl } from './normalize-url.js'

export {
  canonicalMachineId,
  claimInstance,
  evaluateInstanceClaim,
  isVirtualMachine,
  sealToWrite,
} from './instance-claim.js'
export type {
  InstanceClaimFacts,
  InstanceClaimVerdict,
  InstanceGuardDeps,
  InstanceLockState,
  MachineFacts,
  MachineSeal,
} from './instance-claim.js'

export { TERMS_VERSION, needsTermsAcknowledgement } from './terms.js'

export { UPDATE_NOTES_MAX, interpretUpdateCheck, isNewerVersion } from './update.js'
export type { UpdateCheck, UpdateFailure } from './update.js'

export {
  planUserDataDeletion,
  requireEveryScreenStopped,
  verifyUserDataDeletion,
} from './user-data.js'
export type { UserDataTarget } from './user-data.js'

export { slotProfileDirName } from './slot-profile.js'

export { Orchestrator } from './orchestrator.js'
export type { OrchestratorDeps, SlotSnapshot } from './orchestrator.js'

export type {
  AudioController,
  BrowserLauncher,
  InstanceLock,
  LaunchRequest,
  MachineIdentity,
  ProfileArchive,
  Storage,
  WindowManager,
} from './ports.js'
