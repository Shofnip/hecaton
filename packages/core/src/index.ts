export { computeGrid } from './grid.js'
export type { GridCell, GridLayout, ScreenBounds } from './grid.js'

export { SLOT_STATES, isLive, transition } from './slot-state.js'
export type { SlotEvent, SlotState } from './slot-state.js'

export { buildRegistry, validateGameDefinition } from './registry.js'
export type { GameDefinition, Viewport } from './registry.js'

export { DEFAULT_GLOBAL_CONFIG, SCHEMA_VERSION, resolveSlotConfig } from './config.js'
export type { GlobalConfig, ResolvedSlotConfig, SlotOverrides } from './config.js'

export { slotProfileDirName } from './slot-profile.js'
