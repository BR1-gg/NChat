import { nanoid } from 'nanoid'
import {
  buildClipboardPayload,
  externalTextToPrompt,
  materializePaste,
  parseClipboardText,
  type ClipboardPayload,
} from '../logic/clipboard'
import type { ClipboardContents } from '../logic/pastedFiles'
import { pasteExternalFiles } from './externalPaste'
import { getActiveWorkspaceStore, workspaceDocumentFromState, type WorkspaceStoreApi } from '../store/workspaceStore'
import { creationPosition, getLastPointerPosition } from '../logic/placement'
import { useUiStore } from '../store/uiStore'
import { copyToClipboard } from '../utils/clipboard'

/** Fallback used when the browser clipboard permission is denied. */
let internalClipboard: ClipboardPayload | null = null
/** Repeated pastes step by this offset when the pointer has not moved. */
const PASTE_STEP = 24
let lastPaste: { x: number; y: number; at: number } | null = null

const REPEAT_WINDOW_MS = 1_500

function selectedIds(store: WorkspaceStoreApi): string[] {
  return store
    .getState()
    .nodes.filter((node) => node.selected)
    .map((node) => node.id)
}

function currentPayload(store: WorkspaceStoreApi): ClipboardPayload | null {
  const ids = selectedIds(store)
  if (ids.length === 0) return null
  return buildClipboardPayload(workspaceDocumentFromState(store.getState()), ids)
}

function warn(warnings: { message: string }[]): void {
  for (const warning of warnings.slice(0, 3)) {
    useUiStore.getState().addToast({ tone: 'info', title: warning.message })
  }
}

/** Copies the current selection as a NCHAT payload. Returns false if empty. */
export async function copySelection(
  store: WorkspaceStoreApi = getActiveWorkspaceStore(),
): Promise<boolean> {
  const payload = currentPayload(store)
  if (!payload) return false
  payload.sourceWorkspaceId = store.getState().workspaceId
  internalClipboard = payload
  const ok = await copyToClipboard(JSON.stringify(payload))
  if (!ok) {
    useUiStore
      .getState()
      .addToast({ tone: 'info', title: 'Clipboard permission denied.', message: 'Using the in-app clipboard for this copy.' })
  }
  return true
}

/** Copies then deletes, reusing the "Delete branch?" confirmation rules. */
export function cutSelection(store: WorkspaceStoreApi = getActiveWorkspaceStore()): boolean {
  const ids = selectedIds(store)
  const payload = currentPayload(store)
  if (!payload) return false
  payload.sourceWorkspaceId = store.getState().workspaceId
  internalClipboard = payload
  void copyToClipboard(JSON.stringify(payload))
  const state = store.getState()
  const hasChildren = ids.some((id) =>
    state.edges.some((edge) => edge.kind === 'run' && edge.source === id),
  )
  const remove = (): void => store.getState().removeNodes(ids)
  if (hasChildren) {
    useUiStore.getState().requestConfirm({
      title: 'Delete this prompt branch?',
      message: 'The cut selection contains a prompt with generated responses.',
      confirmLabel: 'Cut branch',
      destructive: true,
      onConfirm: remove,
    })
  } else {
    remove()
  }
  return true
}

export interface PasteResult {
  pasted: number
  warnings: { message: string }[]
}

/**
 * Pastes whatever is on the clipboard: a NCHAT payload, files, or plain text.
 *
 * `contents` is what the `paste` event carried. It is a parameter and not something
 * read here, perche' e' l'unico modo per vedere **le immagini**: `readText()` su
 * una schermata copiata dagli appunti restituisce la stringa vuota, quindi leggere
 * da li' faceva fallire in silenzio ogni paste non testuale — il sintomo era che
 * incollare una schermata non faceva nulla e non diceva nulla.
 *
 * Quando manca — la voce «Paste here» del menu, dove non c'e' nessun evento — si
 * ripiega su `readText()`, che e' l'unica cosa che si puo' fare senza l'evento. Li'
 * un'immagine resta irraggiungibile, e non si finge il contrario: lo dice.
 */
export async function pasteAt(
  screenPosition: { x: number; y: number },
  store: WorkspaceStoreApi = getActiveWorkspaceStore(),
  flowPosition?: { x: number; y: number },
  contents?: ClipboardContents,
): Promise<PasteResult | null> {
  let text = contents?.text ?? ''
  let files = contents?.files ?? []
  if (!contents) {
    try {
      text = await navigator.clipboard.readText()
    } catch {
      text = ''
    }
    /*
     * Gli appunti possono contenere un'immagine e nessun testo. `readText()` non lo
     * vede, e senza questo controllo la paste finirebbe sul ramo del testo, con la
     * stringa vuota, e non creerebbe niente. Meglio una frase che dice cosa fare.
     *
     * Il controllo viene **dopo** il ripiego sugli appunti interni, e non prima, per
     * un motivo che e' gia' successo: quando il browser nega la lettura — succede,
     * per la permesso — `readText()` restituisce la stringa vuota anche se la copia
     * e' stata fatta qui, e la copia interna e' l'unica cosa che la puo' salvare.
     * Rifiutando prima, si sarebbe spezzato proprio il ripiego che esiste per
     * quello, e l'utente avrebbe perso una copia riuscendola a rifare ma non
     * sapendo perche'.
     */
    if (!text.trim() && !internalClipboard) {
      useUiStore.getState().addToast({
        tone: 'info',
        title: 'The clipboard has no text in it.',
        message:
          'An image or a file has to come in with the keyboard shortcut, so the browser hands it over. Use Ctrl+V or ⌘V on the canvas.',
      })
      return null
    }
  }

  const payload = parseClipboardText(text) ?? internalClipboard
  const state = store.getState()
  const document = workspaceDocumentFromState(state)

  // Una paste da tastiera non ha coordinate: il gestore DOM passa (0,0). Se
  // non si usa la posizione del puntatore, il nodo finisce sempre nel flow (0,0),
  // lontano da dove si sta lavorando.
  let anchor = creationPosition(flowPosition)
  const now = Date.now()
  if (
    lastPaste &&
    now - lastPaste.at < REPEAT_WINDOW_MS &&
    Math.abs(lastPaste.x - screenPosition.x) < 4 &&
    Math.abs(lastPaste.y - screenPosition.y) < 4
  ) {
    anchor = { x: anchor.x + PASTE_STEP, y: anchor.y + PASTE_STEP }
  }
  lastPaste = { x: screenPosition.x, y: screenPosition.y, at: now }

  if (payload) {
    const result = materializePaste(payload, document, anchor)
    if (result.nodes.length === 0) return null
    store.getState().addNodes(result.nodes, result.edges)
    /*
     * `selectOnlyNodes` e non `setNodeSelected(id, true)`: la seconda **aggiunge**,
     * e dopo un copia-incolla resterebbero selezionati l'originale e la copia. Al
     * primo trascinamento si muoverebbero entrambi, e l'originale sembrerebbe
     * spostarsi da solo. Su un grafo, cioe' nodi che cambiano posizione senza che
     * nessuno li abbia spostati.
     */
    store.getState().selectOnlyNodes(result.nodes.map((node) => node.id))
    warn(result.warnings)
    return { pasted: result.nodes.length, warnings: result.warnings }
  }

  /*
   * I file vanno **prima** del testo. Copiando un'immagine da un'app che mette
   * anche un nome negli appunti, gli appunti hanno sia il file sia una stringa, e
   * con il testo prima la schermata diventerebbe un Prompt con dentro il nome del
   * file — che e' il modo piu' fuorviante di sbagliare, perche' sembra funzionare.
   */
  if (files.length > 0) {
    const { created, unread } = await pasteExternalFiles(files, anchor, store)
    if (created.length === 0) return null
    store.getState().selectOnlyNodes(created)
    return {
      pasted: created.length,
      warnings: unread.map((name) => ({ message: `${name} was not read.` })),
    }
  }

  if (!text.trim()) return null
  if (text.length > 20_000) {
    const ui = useUiStore.getState()
    ui.requestConfirm({
      title: 'Create a prompt from this text?',
      message: `The pasted text is ${text.length.toLocaleString()} characters long.`,
      confirmLabel: 'Create prompt',
      onConfirm: () => {
        const node = externalTextToPrompt(text, anchor)
        store.getState().addNodes([node], [])
        store.getState().selectOnlyNodes([node.id])
      },
    })
    return null
  }
  const node = externalTextToPrompt(text, anchor)
  store.getState().addNodes([node], [])
  store.getState().selectOnlyNodes([node.id])
  return { pasted: 1, warnings: [] }
}

export function hasNodeSelection(store: WorkspaceStoreApi = getActiveWorkspaceStore()): boolean {
  return selectedIds(store).length > 0
}

/**
 * Duplicates the selection at the pointer, so the copy lands where the user is
 * looking instead of at a fixed offset from the original.
 */
export function duplicateSelection(
  store: WorkspaceStoreApi = getActiveWorkspaceStore(),
): string[] {
  const created: string[] = []
  const pointer = getLastPointerPosition()
  for (const id of selectedIds(store)) {
    const copyId = store.getState().duplicateNode(id, pointer ?? undefined)
    if (copyId) created.push(copyId)
  }
  return created
}

export function resetPasteTracking(): void {
  lastPaste = null
}

export function clipboardPayloadForTest(): ClipboardPayload | null {
  return internalClipboard
}

export function makeTestPayload(): ClipboardPayload {
  return {
    type: 'nchat/clipboard',
    version: 2,
    sourceWorkspaceId: 'test',
    nodes: [],
    edges: [],
    bounds: { x: 0, y: 0, width: 0, height: 0 },
  }
}

export { nanoid }
