/**
 * The panel — the video wall's control surface (design.md).
 *
 * Holds no rules: it renders what main sends and calls the bridge methods.
 * Anything it asks for is validated again in the main process, so this file is a
 * convenience for an honest caller rather than a boundary.
 *
 * The UI is Portuguese; everything else in the repository is English.
 *
 * Text is set through textContent and DOM is built with createElement /
 * createElementNS, never innerHTML — a slot's error message or name can carry
 * anything, and the CSP forbids inline styles and scripts, so every visual is a
 * class in style.css and every dynamic value is a CSS custom property set through
 * the CSSOM. The one thing this file must never do is paint the screens: the
 * embedded Chrome windows are positioned by main. Here a viewport is just the
 * region they sit over, and its DOM content shows only when a screen is not
 * running.
 */

// ---- the shape of what main sends and what the bridge exposes ----

type SlotState = 'stopped' | 'starting' | 'running' | 'crashed' | 'restarting'

interface SlotSnapshot {
  id: number
  state: SlotState
  gameId?: string
  url?: string
  persistProfile: boolean
  mute: boolean
  name?: string
  volume: number
  muted: boolean
  backgroundThrottling: boolean
  focused: boolean
  lastError?: string
}

interface GameOption {
  id: string
  name: string
}

type Theme = 'dark' | 'light'

interface PanelState {
  slots: SlotSnapshot[]
  games: GameOption[]
  maxSlots: number
  audioFollowsFocus: boolean
  theme: Theme
  configError?: string
}

interface SlotAddition {
  gameId?: string
  url?: string
  persistProfile?: boolean
  mute?: boolean
}

interface HellowebApi {
  startSlot(id: number): Promise<void>
  stopSlot(id: number): Promise<void>
  focusSlot(id: number): Promise<boolean>
  addSlot(slot: SlotAddition): Promise<void>
  removeSlot(id: number): Promise<void>
  readConfig(): Promise<PanelState>
  updateSlot(update: SlotAddition & { id: number }): Promise<void>
  revealLogs(): Promise<void>
  clearArchives(): Promise<void>
  clearSlotCache(id: number): Promise<void>
  clearAllCaches(): Promise<void>
  setAudioFollowsFocus(enabled: boolean): Promise<void>
  renameSlot(id: number, name: string): Promise<void>
  setSlotVolume(id: number, volume: number): Promise<void>
  setSlotMuted(id: number, muted: boolean): Promise<void>
  reloadSlot(id: number): Promise<boolean>
  setTheme(theme: Theme): Promise<void>
  setScreenLayout(placements: unknown): Promise<void>
  onState(listener: (state: PanelState) => void): void
}

declare global {
  interface Window {
    helloweb: HellowebApi
  }
}

const MAX_NAME_LENGTH = 24

// ---- visual status: the design's four screen states over the five slot states ----

type VisualStatus = 'off' | 'loading' | 'on' | 'error'

function statusOf(state: SlotState): VisualStatus {
  switch (state) {
    case 'running':
      return 'on'
    case 'starting':
    case 'restarting':
      return 'loading'
    case 'crashed':
      return 'error'
    default:
      return 'off'
  }
}

// ============================ icons (design references lucide) ============================

const SVG_NS = 'http://www.w3.org/2000/svg'
type Shape = [tag: string, attrs: Record<string, string>]

// Stroked 24×24 glyphs, built as SVG nodes so nothing goes through innerHTML.
const ICONS: Record<string, Shape[]> = {
  power: [
    ['path', { d: 'M12 2v10' }],
    ['path', { d: 'M18.36 6.64a9 9 0 1 1-12.73 0' }],
  ],
  plus: [
    ['path', { d: 'M5 12h14' }],
    ['path', { d: 'M12 5v14' }],
  ],
  settings: [
    [
      'path',
      {
        d: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
      },
    ],
    ['circle', { cx: '12', cy: '12', r: '3' }],
  ],
  volume: [
    ['polygon', { points: '11 5 6 9 2 9 2 15 6 15 11 19 11 5' }],
    ['path', { d: 'M15.54 8.46a5 5 0 0 1 0 7.07' }],
    ['path', { d: 'M19.07 4.93a10 10 0 0 1 0 14.14' }],
  ],
  volumeOff: [
    ['polygon', { points: '11 5 6 9 2 9 2 15 6 15 11 19 11 5' }],
    ['line', { x1: '22', x2: '16', y1: '9', y2: '15' }],
    ['line', { x1: '16', x2: '22', y1: '9', y2: '15' }],
  ],
  reload: [
    ['path', { d: 'M21 12a9 9 0 1 1-2.64-6.36' }],
    ['polyline', { points: '21 3 21 9 15 9' }],
  ],
  focus: [
    ['path', { d: 'M3 5a2 2 0 0 1 2-2' }],
    ['path', { d: 'M19 3a2 2 0 0 1 2 2' }],
    ['path', { d: 'M21 19a2 2 0 0 1-2 2' }],
    ['path', { d: 'M5 21a2 2 0 0 1-2-2' }],
    ['circle', { cx: '12', cy: '12', r: '3' }],
  ],
  maximize: [
    ['polyline', { points: '15 3 21 3 21 9' }],
    ['polyline', { points: '9 21 3 21 3 15' }],
    ['line', { x1: '21', x2: '14', y1: '3', y2: '10' }],
    ['line', { x1: '3', x2: '10', y1: '21', y2: '14' }],
  ],
  minimize: [
    ['polyline', { points: '4 14 10 14 10 20' }],
    ['polyline', { points: '20 10 14 10 14 4' }],
    ['line', { x1: '14', x2: '21', y1: '10', y2: '3' }],
    ['line', { x1: '3', x2: '10', y1: '21', y2: '14' }],
  ],
  pencil: [
    ['path', { d: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z' }],
    ['path', { d: 'm15 5 4 4' }],
  ],
  trash: [
    ['path', { d: 'M3 6h18' }],
    [
      'path',
      { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' },
    ],
    ['line', { x1: '10', x2: '10', y1: '11', y2: '17' }],
    ['line', { x1: '14', x2: '14', y1: '11', y2: '17' }],
  ],
  close: [
    ['path', { d: 'M18 6 6 18' }],
    ['path', { d: 'm6 6 12 12' }],
  ],
  alert: [
    ['path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z' }],
    ['path', { d: 'M12 9v4' }],
    ['path', { d: 'M12 17h.01' }],
  ],
  logs: [
    ['path', { d: 'M15 12h-5' }],
    ['path', { d: 'M15 8h-5' }],
    ['path', { d: 'M19 17V5a2 2 0 0 0-2-2H4' }],
    [
      'path',
      {
        d: 'M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3',
      },
    ],
  ],
  sun: [
    ['circle', { cx: '12', cy: '12', r: '4' }],
    ['path', { d: 'M12 2v2' }],
    ['path', { d: 'M12 20v2' }],
    ['path', { d: 'm4.93 4.93 1.41 1.41' }],
    ['path', { d: 'm17.66 17.66 1.41 1.41' }],
    ['path', { d: 'M2 12h2' }],
    ['path', { d: 'M20 12h2' }],
    ['path', { d: 'm6.34 17.66-1.41 1.41' }],
    ['path', { d: 'm19.07 4.93-1.41 1.41' }],
  ],
  moon: [['path', { d: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z' }]],
  globe: [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['path', { d: 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20' }],
    ['path', { d: 'M2 12h20' }],
  ],
  loader: [['path', { d: 'M21 12a9 9 0 1 1-6.219-8.56' }]],
}

function icon(name: keyof typeof ICONS, size = 16): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  for (const [tag, attrs] of ICONS[name]!) {
    const el = document.createElementNS(SVG_NS, tag)
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
    svg.append(el)
  }
  return svg
}

// ============================ tiny DOM helpers ============================

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function iconButton(
  name: keyof typeof ICONS,
  className: string,
  title: string,
  onClick: () => void,
  size = 16,
): HTMLButtonElement {
  const b = el('button', className)
  b.type = 'button'
  b.title = title
  b.append(icon(name, size))
  b.addEventListener('click', onClick)
  return b
}

/** Errors are shown, never swallowed — a failing action must fail by name. */
function run(action: () => Promise<unknown>): void {
  void action().catch((error: unknown) => {
    configError.textContent = error instanceof Error ? error.message : String(error)
    configError.hidden = false
  })
}

// ============================ DOM refs ============================

const board = document.getElementById('board') as HTMLElement
const configError = document.getElementById('config-error') as HTMLElement
const toastEl = document.getElementById('toast') as HTMLElement
const powerAllBtn = document.getElementById('power-all') as HTMLButtonElement
const addBtn = document.getElementById('add-screen') as HTMLButtonElement
const settingsBtn = document.getElementById('open-settings') as HTMLButtonElement

// ============================ state ============================

let state: PanelState = {
  slots: [],
  games: [],
  maxSlots: 4,
  audioFollowsFocus: true,
  theme: 'dark',
}

// UI-only state main does not own.
let fullscreenId: number | undefined
let volumeOpenId: number | undefined
let thumbHeight = 100
let editingSlotId: number | undefined
let settingsOpen = false
let confirmOpen = false
let draggingVolume = false
let draggingDivider = false

/** A background push must not redraw over an open editor, popover or drag. */
function interacting(): boolean {
  return (
    editingSlotId !== undefined ||
    settingsOpen ||
    confirmOpen ||
    volumeOpenId !== undefined ||
    draggingVolume ||
    draggingDivider
  )
}

function slot(id: number): SlotSnapshot | undefined {
  return state.slots.find((s) => s.id === id)
}

function slotName(s: SlotSnapshot): string {
  return s.name ?? `Tela ${s.id}`
}

// ============================ toasts (design §12) ============================

let toastTimer: ReturnType<typeof setTimeout> | undefined
function showToast(message: string): void {
  toastEl.textContent = message
  toastEl.hidden = false
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastEl.hidden = true
  }, 2600)
}

// ============================ the board ============================

function render(): void {
  document.documentElement.dataset.theme = state.theme
  configError.hidden = state.configError === undefined
  if (state.configError !== undefined) configError.textContent = state.configError

  // Sidebar reflects the running set.
  const anyScreens = state.slots.length > 0
  const allOn = anyScreens && state.slots.every((s) => s.state !== 'stopped')
  powerAllBtn.classList.toggle('all-on', allOn)
  powerAllBtn.classList.toggle('some-off', !allOn)
  powerAllBtn.title = allOn ? 'Desligar todas as telas' : 'Ligar todas as telas'
  const canAdd = state.slots.length < state.maxSlots
  addBtn.disabled = !canAdd
  addBtn.title = canAdd ? 'Adicionar tela' : 'Limite de 4 telas atingido'

  const focused = state.slots.find((s) => s.focused)
  const fs = fullscreenId !== undefined ? slot(fullscreenId) : undefined

  board.className = ''
  board.replaceChildren()

  if (fs) {
    const layer = el('div', 'fullscreen')
    layer.append(card(fs, true))
    board.append(layer)
  } else if (state.slots.length === 0) {
    const empty = el('div', 'stage-empty')
    empty.append(icon('plus', 30))
    empty.append(
      el('span', undefined, 'Nenhuma tela na grade. Use o botão + na lateral para adicionar.'),
    )
    board.append(empty)
  } else if (focused) {
    board.append(focusLayout(focused))
  } else {
    const grid = el('div', `grid count-${state.slots.length}`)
    for (const s of state.slots) grid.append(card(s, false))
    board.append(grid)
  }

  // Every redraw re-emits the embedded-window layout (coalesced to one per frame),
  // so the real screens track whatever the board just became.
  scheduleLayout()
}

function focusLayout(focused: SlotSnapshot): HTMLElement {
  const layout = el('div', 'focus-layout')
  const main = el('div', 'focus-main')
  main.append(card(focused, false))
  layout.append(main)

  const others = state.slots.filter((s) => s.id !== focused.id)
  if (others.length > 0) {
    layout.append(focusDivider())
    const row = el('div', 'thumb-row')
    row.style.setProperty('--thumb-height', `${thumbHeight}px`)
    for (const s of others) row.append(thumb(s))
    layout.append(row)
  }
  return layout
}

function focusDivider(): HTMLElement {
  const divider = el('div', 'focus-divider')
  divider.title = 'Arraste para ajustar o tamanho das miniaturas'
  divider.append(el('span', 'grip'))

  let startY = 0
  let startH = thumbHeight
  divider.addEventListener('pointerdown', (e) => {
    divider.setPointerCapture(e.pointerId)
    draggingVolume = false
    draggingDivider = true
    startY = e.clientY
    startH = thumbHeight
  })
  divider.addEventListener('pointermove', (e) => {
    if (!draggingDivider) return
    const max = Math.round(window.innerHeight * 0.45)
    thumbHeight = Math.max(56, Math.min(max, startH + (startY - e.clientY)))
    // Live: update only the row height, so the drag does not rebuild the board.
    const row = board.querySelector('.thumb-row') as HTMLElement | null
    row?.style.setProperty('--thumb-height', `${thumbHeight}px`)
    scheduleLayout()
  })
  const end = (e: PointerEvent): void => {
    if (!draggingDivider) return
    draggingDivider = false
    if (divider.hasPointerCapture(e.pointerId)) divider.releasePointerCapture(e.pointerId)
    scheduleLayout()
  }
  divider.addEventListener('pointerup', end)
  divider.addEventListener('pointercancel', end)
  divider.addEventListener('dblclick', () => {
    thumbHeight = 100
    render()
    scheduleLayout()
  })
  return divider
}

function card(s: SlotSnapshot, expanded: boolean): HTMLElement {
  const status = statusOf(s.state)
  const running = status === 'on'
  const node = el('article', 'card')
  if (running) node.classList.add('running')
  if (expanded) node.classList.add('expanded')

  // ---- head: LED, name (toggles focus), favicon ----
  const head = el('div', 'card-head')
  const led = el('span', `led ${status}`)
  led.title = LED_TITLES[status]
  const name = el('button', 'card-name', slotName(s))
  name.type = 'button'
  name.title = s.focused ? 'Sair do foco' : 'Focar nesta tela'
  name.addEventListener('click', () => toggleFocus(s.id))
  head.append(led, name, favicon(s))
  node.append(head)

  // ---- viewport ----
  node.append(viewport(s))

  // ---- controls ----
  node.append(controls(s, expanded))
  return node
}

const LED_TITLES: Record<VisualStatus, string> = {
  on: 'Ligada',
  loading: 'Carregando',
  error: 'Erro',
  off: 'Desligada',
}

function targetLabel(s: SlotSnapshot): string {
  if (s.gameId !== undefined) {
    return state.games.find((g) => g.id === s.gameId)?.name ?? s.gameId
  }
  return s.url ?? 'Endereço personalizado'
}

/**
 * The tab-style favicon (design §5.1). Bundled, since the runtime is offline: a
 * game slot shows the packaged game icon, a custom-url slot the generic globe. If
 * the icon file ever fails to load it falls back to the globe rather than a broken
 * image.
 */
function favicon(s: SlotSnapshot): Element {
  const title = targetLabel(s)
  if (s.gameId !== undefined) {
    const img = el('img', 'favicon')
    img.src = './assets/poke.ico'
    img.width = 22
    img.height = 22
    img.alt = title
    img.title = title
    img.addEventListener('error', () => img.replaceWith(globeFavicon(title)))
    return img
  }
  return globeFavicon(title)
}

function globeFavicon(title: string): Element {
  const g = icon('globe', 20)
  g.classList.add('favicon')
  g.setAttribute('title', title)
  return g
}

function viewport(s: SlotSnapshot): HTMLElement {
  const vp = el('div', 'viewport')
  // Tagged so the layout emitter can find every live viewport in the DOM and
  // give main the rectangle to sit that slot's embedded window over. Only cards
  // carry a .viewport — thumbnails show a DOM placeholder, no window.
  vp.dataset.slot = String(s.id)
  const status = statusOf(s.state)

  if (status === 'off') {
    const b = el('button', 'viewport-power')
    b.type = 'button'
    b.title = 'Ligar tela'
    b.append(icon('power', 30), el('span', undefined, 'Ligar'))
    b.addEventListener('click', () => run(() => window.helloweb.startSlot(s.id)))
    vp.append(b)
  } else if (status === 'loading') {
    const box = el('span', 'viewport-loading')
    box.append(icon('loader', 26), el('span', undefined, 'Carregando…'))
    vp.append(box)
  } else if (status === 'error') {
    const box = el('span', 'viewport-error')
    const alert = icon('alert', 26)
    alert.classList.add('alert')
    const message = s.lastError ?? 'Não foi possível carregar a página.'
    const retry = el('button', 'retry-btn')
    retry.type = 'button'
    retry.append(icon('reload', 13), el('span', undefined, 'Tentar novamente'))
    retry.addEventListener('click', () => run(() => window.helloweb.startSlot(s.id)))
    box.append(alert, el('span', undefined, message), retry)
    vp.append(box)
  }
  // 'on': nothing — the embedded Chrome window covers this region.
  return vp
}

function controls(s: SlotSnapshot, expanded: boolean): HTMLElement {
  const status = statusOf(s.state)
  const active = status !== 'off'
  const bar = el('div', 'controls')

  // Power (on/off).
  const power = iconButton(
    'power',
    'icon-btn ctrl' + (active ? ' on' : ''),
    active ? 'Desligar' : 'Ligar',
    () => run(() => (active ? window.helloweb.stopSlot(s.id) : window.helloweb.startSlot(s.id))),
  )
  bar.append(power)

  // Reload (disabled while off; icon spins while loading).
  const reload = iconButton('reload', 'icon-btn ctrl', 'Recarregar', () =>
    run(() => window.helloweb.reloadSlot(s.id)),
  )
  reload.disabled = status === 'off'
  if (status === 'loading') reload.firstElementChild?.classList.add('spin')
  bar.append(reload)

  // Volume (opens the popover).
  bar.append(volumeControl(s))

  bar.append(el('div', 'flex-gap'))

  // Focus.
  bar.append(
    iconButton(
      'focus',
      'icon-btn ctrl' + (s.focused ? ' on' : ''),
      s.focused ? 'Sair do foco' : 'Focar nesta tela',
      () => toggleFocus(s.id),
    ),
  )

  // Fullscreen (maximize / restore).
  bar.append(
    iconButton(
      expanded ? 'minimize' : 'maximize',
      'icon-btn ctrl',
      expanded ? 'Sair da tela cheia' : 'Tela cheia',
      () => {
        fullscreenId = expanded ? undefined : s.id
        render()
        scheduleLayout()
      },
    ),
  )

  // Edit.
  bar.append(iconButton('pencil', 'icon-btn ctrl', 'Editar tela', () => openEditModal(s.id)))

  // Delete (always last).
  bar.append(iconButton('trash', 'icon-btn ctrl danger', 'Apagar tela', () => removeScreen(s.id)))

  return bar
}

// ---- volume control + popover (design §6) ----

function volumeControl(s: SlotSnapshot): HTMLElement {
  const wrap = el('div', 'ctrl-wrap')
  const open = volumeOpenId === s.id
  const silent = s.muted || s.volume === 0
  const btn = iconButton(
    silent ? 'volumeOff' : 'volume',
    'icon-btn ctrl' + (open ? ' on' : silent ? ' muted' : ''),
    'Volume',
    () => {},
  )
  // Replace the default handler so we can stop propagation (the document click
  // listener closes the popover otherwise).
  btn.onclick = (e) => {
    e.stopPropagation()
    volumeOpenId = open ? undefined : s.id
    render()
  }
  wrap.append(btn)
  if (open) wrap.append(volumePopover(s))
  return wrap
}

function volumePopover(s: SlotSnapshot): HTMLElement {
  const pop = el('div', 'volume-popover')
  pop.addEventListener('click', (e) => e.stopPropagation())
  pop.addEventListener('pointerdown', (e) => e.stopPropagation())

  const shown = (): number => (s.muted ? 0 : s.volume)
  const pct = el('span', 'volume-pct', `${shown()}%`)

  const track = el('div', 'volume-track')
  track.title = 'Clique ou arraste para ajustar'
  const fill = el('div', 'volume-fill')
  fill.style.setProperty('--volume-fill', `${shown()}%`)
  track.append(fill)

  const paint = (): void => {
    const v = shown()
    pct.textContent = `${v}%`
    fill.style.setProperty('--volume-fill', `${v}%`)
  }

  const setFromY = (clientY: number): void => {
    const r = track.getBoundingClientRect()
    const v = Math.max(0, Math.min(100, Math.round((1 - (clientY - r.top) / r.height) * 100)))
    applyVolume(s, v)
    paint()
  }
  track.addEventListener('pointerdown', (e) => {
    track.setPointerCapture(e.pointerId)
    draggingVolume = true
    setFromY(e.clientY)
  })
  track.addEventListener('pointermove', (e) => {
    if (draggingVolume) setFromY(e.clientY)
  })
  const end = (e: PointerEvent): void => {
    draggingVolume = false
    if (track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId)
  }
  track.addEventListener('pointerup', end)
  track.addEventListener('pointercancel', end)

  const mute = iconButton(
    s.muted || s.volume === 0 ? 'volumeOff' : 'volume',
    'icon-btn volume-mute' + (s.muted ? ' muted' : ''),
    s.muted ? 'Ativar som' : 'Silenciar',
    () => {
      const next = !s.muted
      s.muted = next
      run(() => window.helloweb.setSlotMuted(s.id, next))
      // Rebuild so the icon on the control bar and popover update together.
      render()
    },
    13,
  )

  pop.append(pct, track, mute)
  return pop
}

/** Volume moved on the slider: apply live, and reconcile the mute flag (§6). */
function applyVolume(s: SlotSnapshot, volume: number): void {
  s.volume = volume
  const shouldMute = volume === 0
  if (s.muted !== shouldMute) {
    s.muted = shouldMute
    run(() => window.helloweb.setSlotMuted(s.id, shouldMute))
  }
  run(() => window.helloweb.setSlotVolume(s.id, volume))
}

// ---- thumbnails (design §7) ----

function thumb(s: SlotSnapshot): HTMLElement {
  const status = statusOf(s.state)
  const b = el('button', 'thumb' + (status === 'on' ? ' running' : ''))
  b.type = 'button'
  b.title = `Focar na ${slotName(s)}`
  b.addEventListener('click', () => toggleFocus(s.id))

  const head = el('div', 'thumb-head')
  const led = el('span', `led ${status}`)
  head.append(led, el('span', 'thumb-name', slotName(s)))

  const body = el('div', 'thumb-body', THUMB_STATE_TEXT[status])
  b.append(head, body)
  return b
}

const THUMB_STATE_TEXT: Record<VisualStatus, string> = {
  on: '▶ em execução',
  loading: 'carregando…',
  error: 'erro ao carregar',
  off: 'desligada',
}

// ============================ actions ============================

function toggleFocus(id: number): void {
  // Server-authoritative: focusSlot flips the orchestrator's focusedSlotId (the
  // audio policy reads it) and main pushes the new snapshot, whose `focused`
  // flag drives the focus layout here.
  volumeOpenId = undefined
  run(() => window.helloweb.focusSlot(id))
}

function powerAll(): void {
  const anyScreens = state.slots.length > 0
  const allOn = anyScreens && state.slots.every((s) => s.state !== 'stopped')
  if (allOn) {
    for (const s of state.slots)
      if (s.state !== 'stopped') run(() => window.helloweb.stopSlot(s.id))
    showToast('Todas as telas desligadas')
  } else {
    for (const s of state.slots)
      if (s.state === 'stopped') run(() => window.helloweb.startSlot(s.id))
    showToast('Ligando todas as telas…')
  }
}

function addScreen(): void {
  const firstGame = state.games[0]
  if (!firstGame) return
  run(async () => {
    await window.helloweb.addSlot({ gameId: firstGame.id })
    showToast('Tela adicionada')
  })
}

function removeScreen(id: number): void {
  const s = slot(id)
  if (!s) return
  openConfirm({
    title: 'Apagar tela',
    message: REMOVE_DETAIL,
    danger: false,
    confirmLabel: 'Sim, apagar',
    onYes: () => {
      if (fullscreenId === id) fullscreenId = undefined
      if (volumeOpenId === id) volumeOpenId = undefined
      run(async () => {
        await window.helloweb.removeSlot(id)
        showToast('Tela removida')
      })
    },
  })
}

const REMOVE_DETAIL =
  'O perfil deste slot será arquivado: o cache, os cookies e as senhas salvas nele deixam de ser ' +
  'usados. Use "Limpar arquivados" para apagá-los de vez.'

// ============================ modals ============================

interface ModalOptions {
  extraClass?: string
  /** Runs on every close path — backdrop, Escape or an explicit close button. */
  onClose?: () => void
}

/**
 * A generic modal shell: backdrop + dialog, closable by backdrop, Escape or the
 * close button. onClose runs on all three, so the interacting() flag a modal
 * sets is always cleared and the board is redrawn to pick up any state that
 * arrived while it was open.
 */
function openModal(
  build: (dialog: HTMLElement, close: () => void) => void,
  options: ModalOptions = {},
): void {
  const backdrop = el('div', 'modal-backdrop')
  const dialog = el('div', `modal ${options.extraClass ?? ''}`.trim())
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  backdrop.append(dialog)

  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    options.onClose?.()
    backdrop.remove()
    document.removeEventListener('keydown', onKey)
    render()
    scheduleLayout()
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close()
  }
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close()
  })
  document.addEventListener('keydown', onKey)

  build(dialog, close)
  document.body.append(backdrop)
  scheduleLayout()
}

function modalHead(dialog: HTMLElement, title: string, close: () => void): void {
  const head = el('div', 'modal-head')
  head.append(el('h2', undefined, title))
  const x = iconButton('close', 'icon-btn modal-close', 'Fechar', close)
  head.append(x)
  dialog.append(head)
}

// ---- toggle control (design §10) ----

function toggle(
  label: string,
  desc: string,
  value: boolean,
  onChange: (v: boolean) => void,
): HTMLElement {
  const b = el('button', 'toggle' + (value ? ' on' : ''))
  b.type = 'button'
  const text = el('div', 'toggle-text')
  text.append(el('span', 'toggle-label', label), el('span', 'toggle-desc', desc))
  const sw = el('span', 'toggle-switch')
  sw.append(el('span', 'toggle-knob'))
  b.append(text, sw)
  b.addEventListener('click', () => {
    const next = !b.classList.contains('on')
    b.classList.toggle('on', next)
    onChange(next)
  })
  return b
}

function dangerButton(label: string, desc: string, onClick: () => void): HTMLElement {
  const b = el('button', 'danger-btn')
  b.type = 'button'
  b.append(icon('alert', 18))
  const text = el('span')
  text.append(el('span', 'danger-label', label), el('span', 'danger-desc', desc))
  b.append(text)
  b.addEventListener('click', onClick)
  return b
}

// ---- settings modal (design §10) ----

function openSettings(): void {
  settingsOpen = true
  openModal(
    (dialog, close) => {
      modalHead(dialog, 'Configurações', close)
      const body = el('div', 'modal-body')

      body.append(
        toggle(
          'Áudio apenas na tela em foco',
          'Silencia automaticamente as telas fora de foco',
          state.audioFollowsFocus,
          (v) => run(() => window.helloweb.setAudioFollowsFocus(v)),
        ),
      )

      const logs = el('button', 'neutral-btn')
      logs.type = 'button'
      logs.append(icon('logs', 18), el('span', undefined, 'Abrir logs'))
      logs.addEventListener('click', () => {
        showToast('Abrindo logs…')
        run(() => window.helloweb.revealLogs())
      })
      body.append(logs)

      body.append(themeRow())

      body.append(el('div', 'risk-divider'))
      body.append(el('span', 'risk-label', 'Zona de risco'))
      body.append(
        dangerButton(
          'Limpar cache das telas',
          'Remove o cache de todas as telas. Pode exigir novo login.',
          () =>
            openConfirm({
              title: 'Limpar cache das telas?',
              message:
                'O cache de todas as telas será apagado. Sessões salvas podem precisar de novo login.',
              danger: true,
              confirmLabel: 'Sim, apagar',
              onYes: () =>
                run(async () => {
                  await window.helloweb.clearAllCaches()
                  showToast('Cache das telas limpo')
                }),
            }),
        ),
      )
      body.append(
        dangerButton(
          'Limpar dados arquivados',
          'Exclui permanentemente os arquivos arquivados. Sem volta.',
          () =>
            openConfirm({
              title: 'Excluir dados arquivados?',
              message:
                'Esta ação é permanente e não pode ser desfeita. Os dados arquivados serão perdidos para sempre.',
              danger: true,
              confirmLabel: 'Sim, apagar',
              onYes: () =>
                run(async () => {
                  await window.helloweb.clearArchives()
                  showToast('Dados arquivados excluídos')
                }),
            }),
        ),
      )

      dialog.append(body)
    },
    {
      onClose: () => {
        settingsOpen = false
      },
    },
  )
}

function themeRow(): HTMLElement {
  const row = el('div', 'setting-row')
  row.append(el('span', 'toggle-label', 'Tema'))
  const seg = el('div', 'segmented')
  const options: { key: Theme; icon: keyof typeof ICONS; label: string }[] = [
    { key: 'light', icon: 'sun', label: 'Claro' },
    { key: 'dark', icon: 'moon', label: 'Escuro' },
  ]
  for (const o of options) {
    const b = el('button', state.theme === o.key ? 'active' : undefined)
    b.type = 'button'
    b.append(icon(o.icon, 15), el('span', undefined, o.label))
    b.addEventListener('click', () => {
      if (state.theme === o.key) return
      state.theme = o.key
      document.documentElement.dataset.theme = o.key
      for (const btn of seg.children) btn.classList.remove('active')
      b.classList.add('active')
      run(() => window.helloweb.setTheme(o.key))
    })
    seg.append(b)
  }
  row.append(seg)
  return row
}

// ---- edit modal (design §8) ----

function openEditModal(id: number): void {
  const s = slot(id)
  if (!s) return
  editingSlotId = id
  openModal(
    (dialog, close) => {
      modalHead(dialog, `Editar ${slotName(s)}`, close)
      const body = el('div', 'modal-body')

      // Name.
      const nameBox = el('div', 'field-box')
      nameBox.append(el('span', 'field-label', 'Nome da tela'))
      const nameInput = el('input', 'field-input')
      nameInput.type = 'text'
      nameInput.maxLength = MAX_NAME_LENGTH
      nameInput.placeholder = `Tela ${s.id}`
      nameInput.value = s.name ?? ''
      nameInput.addEventListener('input', () =>
        run(() => window.helloweb.renameSlot(s.id, nameInput.value)),
      )
      nameInput.addEventListener('blur', () => {
        if (!nameInput.value.trim()) run(() => window.helloweb.renameSlot(s.id, ''))
      })
      nameBox.append(nameInput)
      body.append(nameBox)

      // Keep session.
      let keepSession = s.persistProfile
      body.append(
        toggle(
          'Manter sessão salva',
          'Guarda o login desta tela entre reinícios',
          keepSession,
          (v) => {
            keepSession = v
            saveTarget()
          },
        ),
      )

      // Address: a registry game, or a custom https url.
      const addrBox = el('div', 'field-box')
      addrBox.append(el('span', 'field-label', 'Endereço da tela'))
      const select = el('select', 'field-select')
      for (const g of state.games) {
        const opt = el('option')
        opt.value = `game:${g.id}`
        opt.textContent = g.id === state.games[0]?.id ? `${g.name} (padrão)` : g.name
        if (s.gameId === g.id) opt.selected = true
        select.append(opt)
      }
      const customOpt = el('option')
      customOpt.value = 'custom'
      customOpt.textContent = 'Endereço personalizado'
      if (s.url !== undefined) customOpt.selected = true
      select.append(customOpt)
      addrBox.append(select)

      const urlRow = el('div', 'url-row')
      urlRow.append(icon('globe', 16))
      const urlInput = el('input', 'field-input')
      urlInput.type = 'text'
      urlInput.placeholder = 'https://exemplo.com'
      urlInput.value = s.url ?? ''
      urlRow.append(urlInput)
      urlRow.hidden = s.url === undefined
      addrBox.append(urlRow)

      const saveTarget = (): void => {
        const update: SlotAddition & { id: number } = {
          id: s.id,
          persistProfile: keepSession,
          mute: s.mute,
        }
        if (select.value === 'custom') update.url = urlInput.value.trim()
        else update.gameId = select.value.slice('game:'.length)
        // A blank custom url is not sent — updateSlot would reject it; the screen
        // just keeps its current target until a valid one is typed.
        if (select.value === 'custom' && update.url === '') return
        run(() => window.helloweb.updateSlot(update))
      }

      select.addEventListener('change', () => {
        urlRow.hidden = select.value !== 'custom'
        saveTarget()
      })
      urlInput.addEventListener('change', saveTarget)
      body.append(addrBox)

      // Clear this screen's cache (design §8.4).
      body.append(
        dangerButton('Limpar cache desta tela', `Apaga somente o cache da ${slotName(s)}.`, () =>
          openConfirm({
            title: `Limpar cache da ${slotName(s)}?`,
            message: 'O cache desta tela será apagado. A sessão salva pode exigir novo login.',
            danger: true,
            confirmLabel: 'Sim, apagar',
            onYes: () =>
              run(async () => {
                await window.helloweb.clearSlotCache(s.id)
                showToast(`Cache da ${slotName(s)} limpo`)
              }),
          }),
        ),
      )

      // Changes apply live as they are typed/selected (design §8); this closes the
      // modal with an explicit "done" affordance rather than only the X.
      const footer = el('div', 'modal-actions')
      const done = el('button', 'btn primary', 'Confirmar')
      done.type = 'button'
      done.addEventListener('click', close)
      footer.append(done)
      body.append(footer)

      dialog.append(body)
    },
    {
      onClose: () => {
        editingSlotId = undefined
      },
    },
  )
}

// ---- confirmation (design §9) ----

interface ConfirmOptions {
  title: string
  message: string
  danger: boolean
  confirmLabel: string
  onYes: () => void
}

function openConfirm(opts: ConfirmOptions): void {
  confirmOpen = true
  openModal(
    (dialog, close) => {
      const titleRow = el('div', 'modal-title-row')
      if (opts.danger) titleRow.append(icon('alert', 20))
      titleRow.append(el('h3', undefined, opts.title))
      dialog.append(titleRow)
      dialog.append(el('p', 'modal-desc', opts.message))

      const actions = el('div', 'modal-actions')
      const cancel = el('button', 'btn', 'Cancelar')
      cancel.type = 'button'
      cancel.addEventListener('click', close)
      const confirm = el(
        'button',
        `btn ${opts.danger ? 'destructive' : 'primary'}`,
        opts.confirmLabel,
      )
      confirm.type = 'button'
      confirm.addEventListener('click', () => {
        close()
        opts.onYes()
      })
      actions.append(cancel, confirm)
      dialog.append(actions)
      cancel.focus()
    },
    {
      extraClass: opts.danger ? 'narrow danger' : 'narrow',
      onClose: () => {
        confirmOpen = false
      },
    },
  )
}

// ============================ live embed layout (design §5.2, §13) ============================

interface ScreenPlacement {
  id: number
  bounds?: { x: number; y: number; width: number; height: number }
}

/**
 * The single source of embedded-window geometry (Option 1). Each card's viewport
 * is the region its slot's real Chrome window sits over; the renderer measures
 * those rectangles and tells main where to put the windows. A slot with no
 * visible viewport — a thumbnail in focus mode, or every slot while a panel modal
 * or the volume popover is open — is sent without bounds, which hides its window,
 * because the native window paints over the DOM otherwise (§13).
 *
 * Rectangles are physical pixels in the panel's client area: getBoundingClientRect
 * gives CSS pixels from the client origin (the web content fills the window's
 * client area), and multiplying by devicePixelRatio is the exact CSS-to-device
 * ratio for this window's display. Verified at 1x (this machine and the spike);
 * higher-DPI displays still need a manual check.
 */
function emitLayout(): void {
  const rects = new Map<number, DOMRect>()
  // A modal or the volume popover open ⇒ hide every screen (no rects gathered).
  const blocked =
    editingSlotId !== undefined || settingsOpen || confirmOpen || volumeOpenId !== undefined
  if (!blocked) {
    for (const vp of board.querySelectorAll<HTMLElement>('.viewport[data-slot]')) {
      const id = Number(vp.dataset.slot)
      const rect = vp.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) rects.set(id, rect)
    }
  }

  const dpr = window.devicePixelRatio || 1
  const phys = (v: number, min: number): number => Math.max(min, Math.round(v * dpr))
  const placements: ScreenPlacement[] = state.slots.map((s) => {
    const rect = rects.get(s.id)
    if (!rect) return { id: s.id }
    return {
      id: s.id,
      bounds: {
        x: phys(rect.left, 0),
        y: phys(rect.top, 0),
        width: phys(rect.width, 1),
        height: phys(rect.height, 1),
      },
    }
  })
  run(() => window.helloweb.setScreenLayout(placements))
}

let layoutFrame: number | undefined
/** Coalesces bursts (render, resize, drag) into one emit per animation frame. */
function scheduleLayout(): void {
  if (layoutFrame !== undefined) return
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = undefined
    emitLayout()
  })
}

// ============================ wiring ============================

powerAllBtn.append(icon('power', 19))
addBtn.append(icon('plus', 19))
settingsBtn.append(icon('settings', 19))

powerAllBtn.addEventListener('click', powerAll)
addBtn.addEventListener('click', addScreen)
settingsBtn.addEventListener('click', () => openSettings())

// A click anywhere else closes an open volume popover (design §6).
document.addEventListener('click', () => {
  if (volumeOpenId !== undefined) {
    volumeOpenId = undefined
    render()
  }
})

// The window resizing moves every viewport, so the embedded windows must follow.
// A ResizeObserver on the stage catches sidebar-independent reflow too; both feed
// the same coalesced emit.
window.addEventListener('resize', scheduleLayout)
new ResizeObserver(scheduleLayout).observe(document.getElementById('stage')!)

window.helloweb.onState((next) => {
  // A background push must not redraw over an open editor, popover or drag.
  if (interacting()) {
    state = next
    return
  }
  state = next
  render()
  scheduleLayout()
})

run(async () => {
  state = await window.helloweb.readConfig()
  render()
  scheduleLayout()
})
