/**
 * The panel.
 *
 * Holds no rules: it renders what main sends and calls the seven bridge
 * methods. Anything it asks for is validated again in the main process, so this
 * file is a convenience for an honest caller rather than a boundary.
 *
 * The UI is Portuguese; everything else in the repository is English.
 *
 * Text is set through textContent, never innerHTML. A slot's error message can
 * carry a path or a url, and the CSP would stop a script from running but not a
 * mangled layout - and the habit is what matters more than this page.
 */

interface SlotSnapshot {
  id: number
  state: 'stopped' | 'starting' | 'running' | 'crashed' | 'restarting'
  gameId?: string
  url?: string
  persistProfile: boolean
  mute: boolean
  lastError?: string
}

interface PanelState {
  slots: SlotSnapshot[]
  configError?: string
}

interface HellowebApi {
  startSlot(id: number): Promise<void>
  stopSlot(id: number): Promise<void>
  focusSlot(id: number): Promise<boolean>
  applyLayout(): Promise<void>
  readConfig(): Promise<PanelState>
  updateSlot(update: unknown): Promise<void>
  revealLogs(): Promise<void>
  onState(listener: (state: PanelState) => void): void
}

declare global {
  interface Window {
    helloweb: HellowebApi
  }
}

const STATE_LABELS: Record<SlotSnapshot['state'], string> = {
  stopped: 'parado',
  starting: 'iniciando',
  running: 'em execução',
  crashed: 'com falha',
  restarting: 'reiniciando',
}

const slotsElement = document.getElementById('slots') as HTMLElement
const configErrorElement = document.getElementById('config-error') as HTMLElement

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function button(label: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
  const node = document.createElement('button')
  node.type = 'button'
  node.textContent = label
  node.disabled = disabled
  node.addEventListener('click', onClick)
  return node
}

/** Errors are shown, never swallowed - a failing action must fail by name. */
function run(action: () => Promise<unknown>): void {
  void action().catch((error: unknown) => {
    configErrorElement.textContent = error instanceof Error ? error.message : String(error)
    configErrorElement.hidden = false
  })
}

function renderSlot(slot: SlotSnapshot): HTMLElement {
  const card = element('article', 'slot')

  const head = element('div', 'slot-head')
  head.append(
    element('span', 'slot-title', `Slot ${slot.id}`),
    element('span', `state state-${slot.state}`, STATE_LABELS[slot.state]),
  )
  card.append(head)

  card.append(element('div', 'slot-target', slot.gameId ?? slot.url ?? 'sem jogo ou endereço'))

  const tags = element('div', 'tags')
  tags.append(element('span', 'tag', slot.persistProfile ? 'sessão salva' : 'sessão limpa'))
  if (slot.mute) tags.append(element('span', 'tag', 'sem áudio'))
  card.append(tags)

  if (slot.lastError !== undefined) {
    card.append(element('p', 'slot-error', slot.lastError))
  }

  const running = slot.state === 'running'
  const busy = slot.state === 'starting' || slot.state === 'restarting'
  const actions = element('div', 'slot-actions')
  actions.append(
    button('Iniciar', running || busy, () => run(() => window.helloweb.startSlot(slot.id))),
    button('Parar', slot.state === 'stopped', () => run(() => window.helloweb.stopSlot(slot.id))),
    button('Focar', !running, () => run(() => window.helloweb.focusSlot(slot.id))),
  )
  card.append(actions)

  return card
}

function render(state: PanelState): void {
  configErrorElement.hidden = state.configError === undefined
  configErrorElement.textContent = state.configError ?? ''

  slotsElement.replaceChildren(...state.slots.map(renderSlot))
}

document
  .getElementById('apply-layout')
  ?.addEventListener('click', () => run(() => window.helloweb.applyLayout()))
document
  .getElementById('reveal-logs')
  ?.addEventListener('click', () => run(() => window.helloweb.revealLogs()))

window.helloweb.onState(render)
run(async () => render(await window.helloweb.readConfig()))
