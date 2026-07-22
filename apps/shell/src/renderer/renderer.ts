/**
 * The panel.
 *
 * Holds no rules: it renders what main sends and calls the bridge methods.
 * Anything it asks for is validated again in the main process, so this file is a
 * convenience for an honest caller rather than a boundary.
 *
 * The UI is Portuguese; everything else in the repository is English.
 *
 * Text is set through textContent, never innerHTML. A slot's error message can
 * carry a path, and the habit of never building DOM from strings matters more
 * than this one page.
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

interface GameOption {
  id: string
  name: string
}

interface PanelState {
  slots: SlotSnapshot[]
  games: GameOption[]
  maxSlots: number
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
  applyLayout(): Promise<void>
  readConfig(): Promise<PanelState>
  updateSlot(update: SlotAddition & { id: number }): Promise<void>
  revealLogs(): Promise<void>
  clearArchives(): Promise<void>
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
const addButton = document.getElementById('add-slot') as HTMLButtonElement

/** The last state main sent, so an edit can re-read it without asking again. */
let lastState: PanelState = { slots: [], games: [], maxSlots: 4 }
/**
 * Which slot is being edited, if any. While a card is open for editing, pushed
 * state is not re-rendered: the periodic liveness push would otherwise wipe a
 * half-typed url out from under the user.
 */
let editingSlotId: number | undefined

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

function targetLabel(slot: SlotSnapshot): string {
  if (slot.gameId !== undefined) {
    return lastState.games.find((game) => game.id === slot.gameId)?.name ?? slot.gameId
  }
  return slot.url ?? 'sem jogo ou endereço'
}

function renderSlotView(slot: SlotSnapshot, position: number): HTMLElement {
  const card = element('article', 'slot')

  const head = element('div', 'slot-head')
  head.append(
    // The number shown is the position, so it stays 1..N with no gaps: remove
    // the middle slot and the ones after it renumber. Commands still use the
    // slot's real id (slot.id), which is stable and names its profile - so a
    // renumber changes only the label, never which session a slot holds.
    element('span', 'slot-title', `Slot ${position}`),
    element('span', `state state-${slot.state}`, STATE_LABELS[slot.state]),
  )
  card.append(head)

  card.append(element('div', 'slot-target', targetLabel(slot)))

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

  const secondary = element('div', 'slot-actions')
  secondary.append(
    button('Editar', false, () => {
      editingSlotId = slot.id
      render(lastState)
    }),
    button('Remover', lastState.slots.length <= 1, () =>
      run(() => window.helloweb.removeSlot(slot.id)),
    ),
  )
  card.append(secondary)

  return card
}

function renderSlotEditor(slot: SlotSnapshot, position: number): HTMLElement {
  const card = element('article', 'slot slot-editing')
  card.append(element('div', 'slot-title', `Editar slot ${position}`))

  // Target: a game from the registry, or a custom https url.
  const targetRow = element('div', 'field')
  const isCustom = slot.url !== undefined
  const select = document.createElement('select')
  for (const game of lastState.games) {
    const option = document.createElement('option')
    option.value = `game:${game.id}`
    option.textContent = game.name
    if (slot.gameId === game.id) option.selected = true
    select.append(option)
  }
  const customOption = document.createElement('option')
  customOption.value = 'custom'
  customOption.textContent = 'Endereço personalizado (https)'
  if (isCustom) customOption.selected = true
  select.append(customOption)
  targetRow.append(select)
  card.append(targetRow)

  const urlInput = document.createElement('input')
  urlInput.type = 'url'
  urlInput.placeholder = 'https://…'
  urlInput.value = slot.url ?? ''
  urlInput.hidden = !isCustom
  card.append(urlInput)
  select.addEventListener('change', () => {
    urlInput.hidden = select.value !== 'custom'
  })

  const persist = checkbox('Manter sessão salva', slot.persistProfile)
  const mute = checkbox('Sem áudio', slot.mute)
  card.append(persist.row, mute.row)

  const actions = element('div', 'slot-actions')
  actions.append(
    button('Salvar', false, () => {
      const update: SlotAddition & { id: number } = {
        id: slot.id,
        persistProfile: persist.input.checked,
        mute: mute.input.checked,
      }
      if (select.value === 'custom') update.url = urlInput.value.trim()
      else update.gameId = select.value.slice('game:'.length)
      run(async () => {
        await window.helloweb.updateSlot(update)
        editingSlotId = undefined
      })
    }),
    button('Cancelar', false, () => {
      editingSlotId = undefined
      render(lastState)
    }),
  )
  card.append(actions)

  return card
}

function checkbox(label: string, checked: boolean): { row: HTMLElement; input: HTMLInputElement } {
  const row = element('label', 'field-check')
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.checked = checked
  row.append(input, document.createTextNode(` ${label}`))
  return { row, input }
}

function render(state: PanelState): void {
  lastState = state
  configErrorElement.hidden = state.configError === undefined
  configErrorElement.textContent = state.configError ?? ''

  addButton.disabled = state.slots.length >= state.maxSlots

  slotsElement.replaceChildren(
    ...state.slots.map((slot, index) =>
      slot.id === editingSlotId
        ? renderSlotEditor(slot, index + 1)
        : renderSlotView(slot, index + 1),
    ),
  )
}

addButton.addEventListener('click', () => {
  // A new slot points at the first shipped game, ready to use; the user edits
  // it afterwards if they want a custom url. With no games there is nothing to
  // point it at, so the button does nothing.
  const firstGame = lastState.games[0]
  if (firstGame) run(() => window.helloweb.addSlot({ gameId: firstGame.id }))
})
document
  .getElementById('apply-layout')
  ?.addEventListener('click', () => run(() => window.helloweb.applyLayout()))
document
  .getElementById('reveal-logs')
  ?.addEventListener('click', () => run(() => window.helloweb.revealLogs()))
document
  .getElementById('clear-archives')
  ?.addEventListener('click', () => run(() => window.helloweb.clearArchives()))

// The "i" next to the password hint toggles the risk disclaimer.
document.getElementById('hint-toggle')?.addEventListener('click', () => {
  const detail = document.getElementById('hint-detail')
  if (detail) detail.hidden = !detail.hidden
})

window.helloweb.onState((state) => {
  // Do not redraw over an open editor: a background push must not discard a
  // half-typed url.
  if (editingSlotId === undefined) render(state)
  else lastState = state
})
run(async () => render(await window.helloweb.readConfig()))
