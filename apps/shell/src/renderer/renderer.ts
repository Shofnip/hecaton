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
  /** Whether the terms warning is still owed. Main compares the versions. */
  needsTerms: boolean
  /** The running version, shown beside the update check. */
  version: string
  configError?: string
  configQuarantinedAs?: string
  releaseNotes?: string
}

/** What an update check came back with (mirrors the core's UpdateCheck). */
type UpdateCheck =
  | { status: 'update-available'; version: string; notes: string }
  | { status: 'up-to-date'; version: string }
  | { status: 'none-published' }
  | {
      status: 'unavailable'
      reason: 'offline' | 'rate-limited' | 'server' | 'malformed' | 'unexpected'
    }

interface SlotAddition {
  gameId?: string
  url?: string
  persistProfile?: boolean
  mute?: boolean
}

interface HecatonApi {
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
  revealUserData(): Promise<void>
  deleteAllUserData(): Promise<void>
  acknowledgeTerms(): Promise<void>
  acknowledgeReleaseNotes(): Promise<void>
  checkForUpdates(): Promise<UpdateCheck>
  openReleasesPage(): Promise<void>
  setAudioFollowsFocus(enabled: boolean): Promise<void>
  renameSlot(id: number, name: string): Promise<void>
  setSlotVolume(id: number, volume: number): Promise<void>
  setSlotMuted(id: number, muted: boolean): Promise<void>
  reloadSlot(id: number): Promise<boolean>
  setTheme(theme: Theme): Promise<void>
  setScreenLayout(placements: unknown): Promise<void>
  openOverlay(request: OverlayRequest): Promise<void>
  closeOverlay(): Promise<void>
  onState(listener: (state: PanelState) => void): void
  onOverlayOpen(listener: (request: OverlayRequest) => void): void
}

/** What the wall asks the overlay window to show (mirrors the core's validator). */
type OverlayRequest =
  | { kind: 'edit'; id: number }
  | { kind: 'volume'; id: number; anchor: Anchor }
  | { kind: 'settings' }
  | { kind: 'confirmRemove'; id: number }

declare global {
  interface Window {
    hecaton: HecatonApi
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

/** Shows a failed action by name. The overlay has no banner; the wall does. */
function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  if (configError) {
    configError.textContent = message
    configError.hidden = false
  } else {
    console.error('[hecaton]', message)
  }
}

/** Errors are shown, never swallowed — a failing action must fail by name. */
function run(action: () => Promise<unknown>): void {
  void action().catch(showError)
}

// ============================ DOM refs ============================
// The wall's elements (null in the overlay window, where they are never touched);
// the cross-mode ones (configError, toast) are guarded at use.

const board = document.getElementById('board') as HTMLElement
const configError = document.getElementById('config-error') as HTMLElement | null
const toastEl = document.getElementById('toast') as HTMLElement | null
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
  // False until main says otherwise, so a stray frame before the first push
  // cannot flash the warning at someone who has already read it.
  needsTerms: false,
  version: '',
}

// UI-only state main does not own. The modal/editor flags moved to the overlay
// window with the modals; the wall's only live interaction is the focus divider.
let fullscreenId: number | undefined
let thumbHeight = 100
let draggingVolume = false
let draggingDivider = false

/** A background push must not redraw the wall out from under a divider drag. */
function interacting(): boolean {
  return draggingDivider
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
  if (!toastEl) return // the overlay has no toast strip; toasts are the wall's
  toastEl.textContent = message
  toastEl.hidden = false
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    if (toastEl) toastEl.hidden = true
  }, 2600)
}

// ============================ the terms warning (D3b) ============================

/**
 * The warning the app shows before the first login, and the only text a user
 * cannot miss.
 *
 * It was to appear in three places. The installer's licence page was the one that
 * could not be skipped past, and it went with the installer; a zip carries
 * `LICENSE.txt` and `NOTICE.txt` but no README. So this is the whole of it, which
 * is why the same text is also reachable from Configurações afterwards rather
 * than shown once and lost.
 *
 * What it must not do is soften. The product's central capability is what most
 * game terms restrict, the consequence lands on the user and never on the author,
 * and saying so plainly is the point — the rules summarised here were read on
 * 2026-07-30 and the date travels with them.
 */
const TERMS_PARAGRAPHS = [
  'O Hecaton abre várias contas do mesmo jogo lado a lado. É justamente isso que a maioria ' +
    'dos termos de jogos restringe.',
  'O aplicativo não automatiza nada e não injeta nada nas páginas: ele abre janelas comuns do ' +
    'Chrome e as organiza. Isso não o coloca fora das regras.',
  'Nas regras do Poke IdleWorld, lidas em 30/07/2026: usar qualquer programa, script ou extensão ' +
    'sem permissão da equipe é proibido. O Hecaton é um programa usado junto com o jogo. Ele não ' +
    'simula sua presença e não roda macros nem auto-clickers — que são citados à parte e são o ' +
    'alvo mais claro da regra —, mas o texto é amplo o bastante para alcançá-lo, e só a equipe do ' +
    'jogo pode dizer se aceita.',
  'As punições aumentam com o histórico: advertência, suspensão, remoção de itens, banimento ' +
    'permanente.',
  'A consequência é sua, não do autor. Cada tela roda dentro da sua própria sessão logada; não ' +
    'há infraestrutura compartilhada e ninguém pode absorver um banimento por você. Se a conta ' +
    'importa, pergunte à equipe do jogo antes de apontar o Hecaton para ela.',
  'Os termos mudam, e o resumo acima é uma fotografia com data — não é orientação jurídica. ' +
    'Confira as regras você mesmo.',
]

function termsBody(): HTMLElement {
  const box = el('div', 'terms-body')
  for (const paragraph of TERMS_PARAGRAPHS) box.append(el('p', 'terms-p', paragraph))
  return box
}

/**
 * The first-run gate: the warning over everything, with one way past it.
 *
 * It covers the sidebar too, deliberately. D3b took the cost of a discouraging
 * first impression on purpose, because this is the last moment the warning can
 * still change what the user does — it precedes logging an account in, and after
 * that it is advice about a decision already taken.
 *
 * Drawn in the wall's own DOM rather than the overlay window: at startup no
 * screen is running, so nothing is embedded over the panel and there is nothing
 * to paint above.
 */
function renderTermsGate(): void {
  const existing = document.getElementById('terms-gate')
  if (!state.needsTerms) {
    existing?.remove()
    return
  }
  if (existing) return // already up; redrawing would scroll it back to the top

  const gate = el('div', 'terms-gate')
  gate.id = 'terms-gate'
  const sheet = el('div', 'terms-sheet')
  sheet.setAttribute('role', 'dialog')
  sheet.setAttribute('aria-modal', 'true')

  const head = el('div', 'terms-head')
  head.append(icon('alert', 22), el('h2', undefined, 'Leia antes de logar uma conta'))
  sheet.append(head)
  sheet.append(termsBody())

  const actions = el('div', 'terms-actions')
  const accept = el('button', 'btn primary', 'Entendi, continuar')
  accept.type = 'button'
  accept.addEventListener('click', () => run(() => window.hecaton.acknowledgeTerms()))
  actions.append(accept)
  sheet.append(actions)

  gate.append(sheet)
  document.body.append(gate)
  // preventScroll matters here and was found by looking at the thing rather than
  // at the code: the text is taller than the default window, so a plain focus()
  // scrolls the button into view and the warning opens halfway down, title off
  // screen. The keyboard still lands on the button; the eye still starts at the
  // top.
  accept.focus({ preventScroll: true })
}

/**
 * What to say when the config file could not be read at all.
 *
 * It names the file it was kept as, because that file is the only copy of what
 * the user had configured and "we started fresh" without it reads as "we threw
 * your settings away". Two consequences are stated rather than left to be
 * discovered: the screens are back to one, and the terms warning appears again
 * because the acknowledgement was in the file that went.
 */
function configRecoveredMessage(savedAs: string | undefined): string | undefined {
  if (savedAs === undefined) return undefined
  return (
    `Sua configuração não pôde ser lida e o aplicativo começou do zero. O arquivo antigo foi ` +
    `guardado como ${savedAs}, na mesma pasta (Configurações → Seus dados) — nada foi apagado. ` +
    `Suas contas continuam logadas; só a lista de telas e as preferências voltaram ao padrão.`
  )
}

/**
 * What changed in the version now running, shown once after an update.
 *
 * A modal rather than a gate: the terms warning precedes a decision the user is
 * about to take, and this precedes nothing — it is news. Dismissing is what marks
 * it read, so closing the app without opening it leaves the notes owed.
 *
 * It waits for the terms gate, which does have to be answered first.
 */
let releaseNotesShown = false
function renderReleaseNotes(): void {
  if (releaseNotesShown || state.needsTerms || state.releaseNotes === undefined) return
  releaseNotesShown = true

  const notes = state.releaseNotes
  openModal(
    (dialog, close) => {
      modalHead(dialog, `Novidades da versão ${state.version}`, close)
      const body = el('div', 'modal-body')
      // textContent, like the update check's notes. This text comes from a file
      // in the package rather than the network, and rendering it as markup would
      // still be a habit worth not forming.
      const pre = el('pre', 'update-notes')
      pre.textContent = notes
      body.append(pre)
      dialog.append(body)
    },
    // onClose rather than the X button's handler: Escape and a click on the
    // backdrop close it too, and a dismissal that did not count as one would
    // bring the notes back at every launch.
    { onClose: () => run(() => window.hecaton.acknowledgeReleaseNotes()) },
  )
}

// ============================ the board ============================

function render(): void {
  renderTermsGate()
  renderReleaseNotes()
  document.documentElement.dataset.theme = state.theme
  if (configError) {
    // Two different things share the banner, and the error wins: if the load
    // failed outright there is nothing reassuring to say. The recovery message
    // is phrased here rather than in main because it is text the user reads.
    const banner = state.configError ?? configRecoveredMessage(state.configQuarantinedAs)
    configError.hidden = banner === undefined
    if (banner !== undefined) configError.textContent = banner
  }

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
    b.addEventListener('click', () => run(() => window.hecaton.startSlot(s.id)))
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
    retry.addEventListener('click', () => run(() => window.hecaton.startSlot(s.id)))
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
    () => run(() => (active ? window.hecaton.stopSlot(s.id) : window.hecaton.startSlot(s.id))),
  )
  bar.append(power)

  // Reload (disabled while off; icon spins while loading).
  const reload = iconButton('reload', 'icon-btn ctrl', 'Recarregar', () =>
    run(() => window.hecaton.reloadSlot(s.id)),
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

  // Edit — opens in the overlay window, above the games.
  bar.append(
    iconButton('pencil', 'icon-btn ctrl', 'Editar tela', () =>
      run(() => window.hecaton.openOverlay({ kind: 'edit', id: s.id })),
    ),
  )

  // Delete (always last) — its confirmation opens in the overlay too.
  bar.append(
    iconButton('trash', 'icon-btn ctrl danger', 'Apagar tela', () =>
      run(() => window.hecaton.openOverlay({ kind: 'confirmRemove', id: s.id })),
    ),
  )

  return bar
}

// ---- volume control + popover (design §6) ----

function volumeControl(s: SlotSnapshot): HTMLElement {
  // The popover renders in the overlay, above the games; the button just asks for
  // it, handing over its own rectangle so the overlay can anchor the popover to
  // it. Both windows share the panel's client coordinates, so the rect carries
  // over unchanged.
  const silent = s.muted || s.volume === 0
  const btn = iconButton(
    silent ? 'volumeOff' : 'volume',
    'icon-btn ctrl' + (silent ? ' muted' : ''),
    'Volume',
    () => {
      const r = btn.getBoundingClientRect()
      run(() =>
        window.hecaton.openOverlay({
          kind: 'volume',
          id: s.id,
          anchor: {
            x: Math.round(r.left),
            y: Math.round(r.top),
            width: Math.round(r.width),
            height: Math.round(r.height),
          },
        }),
      )
    },
  )
  return btn
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
  track.append(fill)

  const mute = el('button', 'icon-btn volume-mute')
  mute.type = 'button'

  // Repaints the popover in place — no full render, so it works in the overlay
  // window, which has no wall to redraw. The control bar's own icon updates from
  // the state push setSlotMuted triggers.
  const paint = (): void => {
    const v = shown()
    pct.textContent = `${v}%`
    fill.style.setProperty('--volume-fill', `${v}%`)
    mute.replaceChildren(icon(s.muted || s.volume === 0 ? 'volumeOff' : 'volume', 13))
    mute.title = s.muted ? 'Ativar som' : 'Silenciar'
    mute.classList.toggle('muted', s.muted)
  }
  paint()

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

  mute.addEventListener('click', () => {
    s.muted = !s.muted
    run(() => window.hecaton.setSlotMuted(s.id, s.muted))
    paint()
  })

  pop.append(pct, track, mute)
  return pop
}

/** Volume moved on the slider: apply live, and reconcile the mute flag (§6). */
function applyVolume(s: SlotSnapshot, volume: number): void {
  s.volume = volume
  const shouldMute = volume === 0
  if (s.muted !== shouldMute) {
    s.muted = shouldMute
    run(() => window.hecaton.setSlotMuted(s.id, shouldMute))
  }
  run(() => window.hecaton.setSlotVolume(s.id, volume))
}

// ---- thumbnails (design §7) ----

function thumb(s: SlotSnapshot): HTMLElement {
  const status = statusOf(s.state)
  const running = status === 'on'
  const wrap = el('div', 'thumb' + (running ? ' running' : ''))

  // The header changes focus; a running screen's body hosts the live window (a
  // click there reaches the game), so focus moves from the header, like the main
  // card's name. A non-running body has no window, so it is clickable to focus.
  const head = el('div', 'thumb-head')
  head.title = `Focar na ${slotName(s)}`
  head.addEventListener('click', () => toggleFocus(s.id))
  const led = el('span', `led ${status}`)
  head.append(led, el('span', 'thumb-name', slotName(s)))
  wrap.append(head)

  if (running) {
    const body = el('div', 'thumb-body')
    body.dataset.slot = String(s.id)
    wrap.append(body)
  } else {
    const body = el('div', 'thumb-body', THUMB_STATE_TEXT[status])
    body.title = `Focar na ${slotName(s)}`
    body.addEventListener('click', () => toggleFocus(s.id))
    wrap.append(body)
  }
  return wrap
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
  run(() => window.hecaton.focusSlot(id))
}

// How long to let a freshly launched screen open and settle before starting the
function powerAll(): void {
  const anyScreens = state.slots.length > 0
  const allOn = anyScreens && state.slots.every((s) => s.state !== 'stopped')
  // All at once: what made this freeze was the synchronous PowerShell shell-outs
  // in the launcher blocking the main thread, and those are async now, so four
  // browsers can start (or stop) together without stalling the cursor.
  if (allOn) {
    for (const s of state.slots) if (s.state !== 'stopped') run(() => window.hecaton.stopSlot(s.id))
    showToast('Todas as telas desligadas')
  } else {
    for (const s of state.slots)
      if (s.state === 'stopped') run(() => window.hecaton.startSlot(s.id))
    showToast('Ligando todas as telas…')
  }
}

function addScreen(): void {
  const firstGame = state.games[0]
  if (!firstGame) return
  run(async () => {
    await window.hecaton.addSlot({ gameId: firstGame.id })
    showToast('Tela adicionada')
  })
}

// Runs in the overlay: the remove confirmation, above the games. Removal pushes
// state, so the wall redraws without the slot on its own — no local cleanup here.
function openConfirmRemove(id: number): void {
  openConfirm({
    title: 'Apagar tela',
    message: REMOVE_DETAIL,
    danger: false,
    confirmLabel: 'Sim, apagar',
    onYes: () => run(() => window.hecaton.removeSlot(id)),
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
 * How many overlay surfaces (modals, the volume popover) are open. The overlay
 * window is hidden again only when the last one closes — a confirm opened over
 * settings must not tear the whole overlay down when it alone is dismissed.
 */
let overlayDepth = 0

/** Hides the overlay window once nothing is left open in it. */
function overlayClosed(): void {
  if (--overlayDepth === 0) void window.hecaton.closeOverlay()
}

/**
 * A generic modal shell for the overlay window: backdrop + dialog, closable by
 * backdrop, Escape or the close button. onClose runs on all three. When the last
 * open surface closes, the overlay window hides itself, so the games take the
 * mouse again.
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
  overlayDepth++

  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    options.onClose?.()
    backdrop.remove()
    document.removeEventListener('keydown', onKey)
    overlayClosed()
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

function dangerButton(label: string, desc: string, onClick: () => void): HTMLButtonElement {
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
  openModal((dialog, close) => {
    modalHead(dialog, 'Configurações', close)
    const body = el('div', 'modal-body')

    body.append(
      toggle(
        'Áudio apenas na tela em foco',
        'Silencia automaticamente as telas fora de foco',
        state.audioFollowsFocus,
        (v) => run(() => window.hecaton.setAudioFollowsFocus(v)),
      ),
    )

    const logs = el('button', 'neutral-btn')
    logs.type = 'button'
    logs.append(icon('logs', 18), el('span', undefined, 'Abrir logs'))
    logs.addEventListener('click', () => {
      showToast('Abrindo logs…')
      run(() => window.hecaton.revealLogs())
    })
    body.append(logs)

    const terms = el('button', 'neutral-btn')
    terms.type = 'button'
    terms.append(icon('alert', 18), el('span', undefined, 'Aviso sobre os termos do jogo'))
    terms.addEventListener('click', openTerms)
    body.append(terms)

    body.append(updateRow())

    body.append(themeRow())

    body.append(el('div', 'risk-divider'))
    body.append(el('span', 'section-label', 'Seus dados'))
    body.append(userDataBox())

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
                await window.hecaton.clearAllCaches()
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
                await window.hecaton.clearArchives()
                showToast('Dados arquivados excluídos')
              }),
          }),
      ),
    )
    body.append(deleteEverythingButton())

    dialog.append(body)
  })
}

/**
 * The version, and the only button in the app that touches the network.
 *
 * The check happens on this click and nowhere else — never at launch, never on a
 * timer (D7/D8). The version sits beside it because "há uma atualização" says
 * nothing without saying from what.
 */
function updateRow(): HTMLElement {
  const box = el('div', 'field-box')

  const row = el('div', 'update-row')
  row.append(el('span', 'field-label', `Versão ${state.version}`))
  const check = el('button', 'btn', 'Procurar atualizações')
  check.type = 'button'
  row.append(check)
  box.append(row)

  const result = el('span', 'data-note')
  result.hidden = true
  box.append(result)

  const say = (text: string): void => {
    result.textContent = text
    result.hidden = false
  }

  check.addEventListener('click', () => {
    check.disabled = true
    say('Verificando…')
    run(async () => {
      try {
        show(await window.hecaton.checkForUpdates(), box, say)
      } finally {
        check.disabled = false
      }
    })
  })

  return box
}

/** Phrases an outcome, and offers the release page when there is one to offer. */
function show(check: UpdateCheck, box: HTMLElement, say: (text: string) => void): void {
  box.querySelector('.update-open')?.remove()
  box.querySelector('.update-notes')?.remove()

  switch (check.status) {
    case 'up-to-date':
      say(`Você está na versão mais recente (${check.version}).`)
      return
    case 'none-published':
      // Today's normal answer: the repository exists and has no release yet.
      say('Nenhuma versão foi publicada ainda.')
      return
    case 'unavailable':
      say(UPDATE_FAILURES[check.reason])
      return
    case 'update-available': {
      say(`Versão ${check.version} disponível. Você está na ${state.version}.`)
      if (check.notes !== '') {
        // textContent, never innerHTML: these notes came off the network, and
        // this is the one place in the app that shows text from outside it.
        const notes = el('pre', 'update-notes')
        notes.textContent = check.notes
        box.append(notes)
      }
      const open = el('button', 'btn primary update-open', 'Abrir página da versão')
      open.type = 'button'
      open.addEventListener('click', () => {
        showToast('Abrindo no navegador…')
        run(() => window.hecaton.openReleasesPage())
      })
      box.append(open)
      return
    }
  }
}

/**
 * A failed check is an ordinary outcome, so each reason says what to do rather
 * than that something went wrong.
 */
const UPDATE_FAILURES: Record<
  'offline' | 'rate-limited' | 'server' | 'malformed' | 'unexpected',
  string
> = {
  offline: 'Não foi possível verificar: sem conexão com a internet.',
  'rate-limited': 'O GitHub recusou por excesso de tentativas. Tente de novo daqui a pouco.',
  server: 'O GitHub está indisponível no momento. Tente de novo mais tarde.',
  malformed: 'A resposta recebida não foi compreendida. Nada foi alterado.',
  unexpected: 'Não foi possível verificar agora. Tente de novo mais tarde.',
}

/**
 * The same warning, re-readable.
 *
 * The gate is shown once and then never again; without this the text would be
 * visible exactly one time in the app's life, and a zip carries no README to fall
 * back on. Reading it later changes no decision, which is why the gate exists —
 * but "I remember something about bans" deserves somewhere to go.
 */
function openTerms(): void {
  openModal((dialog, close) => {
    modalHead(dialog, 'Aviso sobre os termos do jogo', close)
    const body = el('div', 'modal-body')
    body.append(termsBody())
    dialog.append(body)
  })
}

/**
 * Where the user's data lives, and a way to open it.
 *
 * It names **both** places on purpose. A screen with a clean session does not use
 * `%APPDATA%`: it gets a throwaway profile in the Windows temp directory, deleted
 * when the screen stops. A "where is my data" text that mentions only the first is
 * wrong, and this is the only place in the app that answers the question.
 *
 * The button opens the first one only. The temp directory is not the app's to
 * open, and the throwaway profile inside it is normally gone by the time anyone
 * looks.
 */
function userDataBox(): HTMLElement {
  const box = el('div', 'field-box')
  box.append(
    el(
      'span',
      'data-note',
      'Seus logins, a configuração e os logs ficam em %APPDATA%\\hecaton — fora da pasta do ' +
        'aplicativo, por isso trocar a pasta por uma versão nova não desloga ninguém.',
    ),
  )
  box.append(
    el(
      'span',
      'data-note',
      'Uma tela com sessão limpa não usa essa pasta: ela recebe um perfil temporário na pasta ' +
        'Temp do Windows, apagado quando a tela para. Se o aplicativo for encerrado à força, esse ' +
        'perfil fica lá até o Windows recolher.',
    ),
  )

  // The password disclosure (ADR-0009, Correction of 2026-08-08). It lived in the
  // panel, went with the video-wall rework, and nothing replaced it. Here rather
  // than on the first-run gate because it is about a decision the user takes at
  // every login, not once — and this is the section that already talks about what
  // the profiles hold.
  box.append(
    el(
      'span',
      'data-note',
      'Deixar o Chrome salvar a senha do jogo acelera bastante o relogin, que neste jogo acontece ' +
        'toda vez que a tela reinicia. Em troca, a senha fica guardada na sua máquina, dentro do ' +
        'perfil do Chrome: quem tiver acesso à máquina pode extraí-la. O Hecaton nunca guarda ' +
        'senhas nem preenche formulários — quem faz isso é o gerenciador do próprio Chrome.',
    ),
  )

  const open = el('button', 'neutral-btn')
  open.type = 'button'
  open.append(icon('logs', 18), el('span', undefined, 'Abrir pasta dos dados'))
  open.addEventListener('click', () => {
    showToast('Abrindo pasta…')
    run(() => window.hecaton.revealUserData())
  })
  box.append(open)
  return box
}

/**
 * The one action in the app that deletes a live profile.
 *
 * Disabled while any screen is still open, which is the UX echo of the real
 * safeguard: main refuses the same thing, because Chrome holds its profile open
 * and a deletion underneath a running browser only half-succeeds.
 */
function deleteEverythingButton(): HTMLElement {
  const open = state.slots.filter((s) => s.state !== 'stopped').length
  const button = dangerButton(
    'Apagar todos os meus dados',
    open > 0
      ? `Pare todas as telas primeiro (${open} ainda aberta${open > 1 ? 's' : ''}).`
      : 'Perfis, configuração e logs. Você sai de todas as contas e o aplicativo fecha.',
    () =>
      openConfirm({
        title: 'Apagar todos os meus dados?',
        message:
          'Isto apaga %APPDATA%\\hecaton: os perfis — você sai de todas as contas do jogo —, a ' +
          'configuração e os logs. É permanente e não pode ser desfeito. O aplicativo fecha em ' +
          'seguida, e uma pasta com o cache dele continua lá, sem nenhum login dentro.',
        danger: true,
        confirmLabel: 'Sim, apagar tudo',
        onYes: () =>
          run(async () => {
            await window.hecaton.deleteAllUserData()
            showToast('Dados apagados. Fechando o aplicativo…')
          }),
      }),
  )
  button.disabled = open > 0
  return button
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
      run(() => window.hecaton.setTheme(o.key))
    })
    seg.append(b)
  }
  row.append(seg)
  return row
}

// ---- edit modal (design §8) ----

function openEditModal(id: number): void {
  const s = slot(id)
  if (!s) {
    void window.hecaton.closeOverlay()
    return
  }
  openModal((dialog, close) => {
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
      run(() => window.hecaton.renameSlot(s.id, nameInput.value)),
    )
    nameInput.addEventListener('blur', () => {
      if (!nameInput.value.trim()) run(() => window.hecaton.renameSlot(s.id, ''))
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
      run(() => window.hecaton.updateSlot(update))
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
              await window.hecaton.clearSlotCache(s.id)
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
  })
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
    { extraClass: opts.danger ? 'narrow danger' : 'narrow' },
  )
}

// ---- volume popover in the overlay, anchored to the wall's button ----

interface Anchor {
  x: number
  y: number
  width: number
  height: number
}

function openVolume(id: number, anchor: Anchor): void {
  const s = slot(id)
  if (!s) {
    void window.hecaton.closeOverlay()
    return
  }
  overlayDepth++
  const catcher = el('div', 'overlay-catcher')
  const pop = volumePopover(s)
  // The overlay shares the wall's client coordinates, so the button's rectangle
  // places the popover directly: centered on the button, its base 10px above it.
  pop.style.position = 'fixed'
  pop.style.left = `${anchor.x + anchor.width / 2}px`
  pop.style.bottom = `${window.innerHeight - anchor.y + 10}px`
  pop.style.transform = 'translateX(-50%)'

  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    catcher.remove()
    pop.remove()
    document.removeEventListener('keydown', onKey)
    overlayClosed()
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close()
  }
  // A click anywhere but the popover closes it (the popover stops its own clicks).
  catcher.addEventListener('click', close)
  document.addEventListener('keydown', onKey)
  document.body.append(catcher, pop)
}

// ============================ live embed layout (design §5.2, §13) ============================

interface ScreenPlacement {
  id: number
  bounds?: { x: number; y: number; width: number; height: number }
}

/**
 * The single source of embedded-window geometry (Option 1). Every region with a
 * data-slot — a card viewport, or a running thumbnail's body in focus mode — is
 * where that slot's real Chrome window sits; the renderer measures those and tells
 * main where to put the windows. A slot with no such region, or one covered by an
 * open modal or volume popover, is sent without bounds, which hides its window.
 *
 * Only the region an occluder actually overlaps is hidden, not every screen: the
 * native window paints over the DOM, so a screen under the modal must go, but the
 * others keep showing (the owner's call — the games stay watchable while a volume
 * popover or an edit modal is open).
 *
 * Rectangles are physical pixels in the panel's client area: getBoundingClientRect
 * gives CSS pixels from the client origin (the web content fills the window's
 * client area), and multiplying by devicePixelRatio is the exact CSS-to-device
 * ratio for this window's display. Verified at 1x (this machine and the spike);
 * higher-DPI displays still need a manual check.
 */
function emitLayout(): void {
  // Open modal dialogs and the volume popover occlude whatever they cover.
  const occluders = [...document.querySelectorAll('.modal, .volume-popover')].map((e) =>
    e.getBoundingClientRect(),
  )
  const covered = (r: DOMRect): boolean =>
    occluders.some(
      (o) => r.left < o.right && r.right > o.left && r.top < o.bottom && r.bottom > o.top,
    )

  const rects = new Map<number, DOMRect>()
  for (const region of board.querySelectorAll<HTMLElement>('[data-slot]')) {
    const id = Number(region.dataset.slot)
    const rect = region.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0 && !covered(rect)) rects.set(id, rect)
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
  run(() => window.hecaton.setScreenLayout(placements))
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
// The same bundle runs in both windows; the body's data-mode picks which half.

/** The panel window: the video wall. Triggers modals open in the overlay. */
function initWall(): void {
  powerAllBtn.append(icon('power', 19))
  addBtn.append(icon('plus', 19))
  settingsBtn.append(icon('settings', 19))

  powerAllBtn.addEventListener('click', powerAll)
  addBtn.addEventListener('click', addScreen)
  settingsBtn.addEventListener('click', () =>
    run(() => window.hecaton.openOverlay({ kind: 'settings' })),
  )

  // The window resizing moves every viewport, so the embedded windows must
  // follow. A ResizeObserver on the stage catches sidebar-independent reflow too.
  window.addEventListener('resize', scheduleLayout)
  new ResizeObserver(scheduleLayout).observe(document.getElementById('stage')!)

  window.hecaton.onState((next) => {
    // A background push must not redraw the wall out from under a divider drag.
    state = next
    if (!interacting()) {
      render()
      scheduleLayout()
    }
  })

  run(async () => {
    state = await window.hecaton.readConfig()
    render()
    scheduleLayout()
  })
}

/** The overlay window: modals and the volume popover, above the games. */
function initOverlay(): void {
  // It keeps a fresh copy of the state so a modal renders current data, but it
  // never redraws on a push — that would wipe a half-typed field. It only draws
  // when the wall asks it to.
  window.hecaton.onState((next) => {
    state = next
  })
  window.hecaton.onOverlayOpen((request) => {
    switch (request.kind) {
      case 'edit':
        openEditModal(request.id)
        break
      case 'settings':
        openSettings()
        break
      case 'confirmRemove':
        openConfirmRemove(request.id)
        break
      case 'volume':
        openVolume(request.id, request.anchor)
        break
    }
  })
  run(async () => {
    state = await window.hecaton.readConfig()
  })
}

if (document.body.dataset.mode === 'overlay') initOverlay()
else initWall()
