/**
 * "Compact" deve significare la stessa cosa premuto su **qualsiasi** nodo.
 *
 * Prima il comando esisteva sul prompt e sulla risposta, e su tutto il resto non
 * c'era niente. Il difetto non e' un bottone mancante: e' che la compattazione
 * agisce sul **prompt**, mentre il contesto che fa crescere sta su altri nodi —
 * un file, una nota, un'immagine, un gruppo. Premere «compatta» su quei nodi non
 * aveva senso senza sapere di chi era il contesto, quindi non c'era.
 *
 * Qui si risolve la domanda una volta sola, e la stessa risposta alimenta il menu,
 * la finestra e il rifiuto. Il perche' di `logic/compactionTarget.ts` spiega la
 * regola; questo file spiega solo perche' l'azione esiste.
 */

import { compactPromptContext } from './compactContext'
import {
  refusalMessage,
  resolveCompactionTarget,
  type CompactionResolution,
} from '../logic/compactionTarget'
import { useUiStore } from '../store/uiStore'
import {
  getActiveWorkspaceStore,
  workspaceDocumentFromState,
  type WorkspaceStoreApi,
} from '../store/workspaceStore'
import type { NodeId } from '../types/document'

/** What the dialog would do, without doing it. Drives the enabled state of the button. */
export function previewCompaction(
  nodeId: NodeId,
  store: WorkspaceStoreApi = getActiveWorkspaceStore(),
): CompactionResolution {
  return resolveCompactionTarget(workspaceDocumentFromState(store.getState()), nodeId)
}

/**
 * Opens the compaction window for a node, or explains why it cannot be opened.
 *
 * Il rifiuto si gestisce **qui** e non nella finestra: se non c'e' niente da
 * compattare, una finestra che si apre e dice «non c'e' niente» e' una finestra
 * inutile. Il messaggio e' lo stesso che l'utente avrebbe letto in una bolla, ma
 * senza il fotogramma vuoto in mezzo.
 */
export function openCompactionDialog(
  nodeId: NodeId,
  store: WorkspaceStoreApi = getActiveWorkspaceStore(),
): void {
  const resolution = previewCompaction(nodeId, store)
  if (!resolution.ok) {
    const { title, message } = refusalMessage(resolution.refusal)
    useUiStore.getState().addToast({ tone: 'warning', title, message })
    return
  }
  useUiStore.getState().openDialog('compact', undefined, nodeId)
}

/**
 * Compacts whatever the dialog resolved to.
 *
 * Il prompt e' gia' stato risolto quando la finestra si e' aperta, e viene risolto
 * di nuovo qui perche' nel frattempo la tela e' cambiata: se nel dialog aperto
 * l'utente ha scollegato un file, il pulsante deve accorgersene e non produrre
 * un riassunto di un contesto che non esiste piu'.
 */
export async function compactFromAnyNode(
  nodeId: NodeId,
  store: WorkspaceStoreApi = getActiveWorkspaceStore(),
): Promise<NodeId | null> {
  const resolution = resolveCompactionTarget(workspaceDocumentFromState(store.getState()), nodeId)
  if (!resolution.ok) {
    const { title, message } = refusalMessage(resolution.refusal)
    useUiStore.getState().addToast({ tone: 'warning', title, message })
    return null
  }
  return compactPromptContext(resolution.target.promptId, store)
}
