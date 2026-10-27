/**
 * Incollare roba presa fuori da qui: una schermata, un file, piu' file.
 *
 * Prima esisteva solo la paste del testo, perche' la paste guardava `readText()` e
 * quello su un'immagine degli appunti restituisce la stringa vuota. Il risultato
 * era che copiare una schermata e incollare non faceva niente — e non diceva niente,
 * che e' il modo peggiore in cui una funzione puo' fallire: l'utente vede che non
 * e' successo niente e non ha niente su cui ragionare.
 *
 * Qui ogni file viene instradato con la **stessa** regola del trascinamento, e per
 * un motivo che non e' la brevita': se le due strade dessero risultati diversi, un
 * utente che copia un file e lo incolla otterrebbe qualcosa di diverso da chi lo
 * trascina, e non potrebbe fidarsi di nessuna delle due. La regola di smistamento e
 * in `logic/pastedFiles.ts`, ed e' la stessa che chiama `FlowCanvas.onDrop`.
 */

import { createFileNodeFromFile } from './fileActions'
import { createImageNodeFromFile } from './imageActions'
import { classifyPastedFile } from '../logic/pastedFiles'
import { useUiStore } from '../store/uiStore'
import { getActiveWorkspaceStore, type WorkspaceStoreApi } from '../store/workspaceStore'
import type { NodeId } from '../types/document'
import type { XYPosition } from '@xyflow/react'

/**
 * Lo scarto fra due file incollati, in pixel di tela.
 *
 * Senza, cinque file incollati insieme finiscono **tutti nello stesso punto**, e il
 * risultato e' un nodo visibile e quattro nascosti sotto. Che sembri casuale e non lo
 * e': e' l'unico modo che hanno due file di stare sovrapposti, e con un file solo lo
 * scarto non si vede — quindi il difetto compare solo quando si incolla piu' di una
 * cosa, che e' proprio il caso in cui l'utente si accorge di aver perso qualcosa.
 */
export const PASTED_FILE_STEP = 28

/**
 * Turns pasted files into nodes, one per file, in reading order.
 *
 * Un file per nodo e non un nodo che li contiene: sono pezzi che l'utente ha copiato
 * separatamente e che vuole usare separatamente. Un nodo File che ne contiene tre
 * obbligherebbe a creare un nodo nuovo per usare il secondo.
 *
 * **Ogni file incollato lascia un nodo, anche quando non si puo' leggere.** E' la
 * regola che chiude il difetto di fondo di questa funzione, e la prima stesura la
 * violava: un'immagine che non si decodifica veniva rifiutata da `createImageNodeFromFile`
 * senza creare nulla, e il messaggio diceva lo stesso «il nodo c'e', non si e' perso
 * niente» di quello di un file di testo. Era falso. L'utente leggeva la rassicurazione,
 * poi guardava la tela e non trovava niente — e con piu' suspicioni di prima, perche'
 * una rassicurazione falsa e' peggio di un avviso.
 *
 * Quindi il fallimento produce un nodo che contiene il **motivo**, non un avviso
 * effimero: un rifiuto che sparisce e' indistinguibile da una paste mai avvenuta, che
 * e' il difetto che questa funzione chiude.
 */
export async function pasteExternalFiles(
  files: File[],
  anchor: XYPosition,
  store: WorkspaceStoreApi = getActiveWorkspaceStore(),
): Promise<{ created: NodeId[]; unread: string[] }> {
  const created: NodeId[] = []
  const unread: string[] = []

  for (const [index, file] of files.entries()) {
    const position = {
      x: anchor.x + index * PASTED_FILE_STEP,
      y: anchor.y + index * PASTED_FILE_STEP,
    }
    const verdict = classifyPastedFile(file)

    if (verdict.kind === 'image') {
      const result = await createImageNodeFromFile(file, position, store)
      if (result.nodeId) {
        created.push(result.nodeId)
        continue
      }
      // Non decodificata. `createImageNodeFromFile` ha gia' spiegato il perche'; qui
      // si lascia comunque un nodo, cosi' la promessa del messaggio e' vera.
      const id = store.getState().addNode('file', position, {
        name: file.name,
        error: 'The image could not be decoded by this browser.',
      })
      created.push(id)
      unread.push(file.name)
      continue
    }

    if (verdict.kind === 'text') {
      // `createFileNodeFromFile` crea gia' un nodo con l'errore dentro quando la
      // lettura fallisce, quindi in quel caso il nodo **esiste** e va selezionato:
      // restare senza nodo sarebbe la stessa perdita di cui sopra.
      const id = await createFileNodeFromFile(file, position, store)
      const state = store.getState()
      const node = id ? state.nodes.find((candidate) => candidate.id === id) : undefined
      const hasError = node?.data.kind === 'file' ? Boolean(node.data.error) : false
      const createdId = id ?? state.nodes[state.nodes.length - 1]?.id
      if (createdId) created.push(createdId)
      if (!id || hasError) unread.push(file.name)
      continue
    }

    /*
     * Non leggibile per formato. Il nodo lo dice, perche' un file rifiutato senza un
     * nodo e' un file che sparisce — e l'utente non saprebbe se la paste e' fallita o
     * se quel file non gli interessava. Qui vede il nodo, legge dentro perche', e
     * sceglie.
     */
    const id = store.getState().addNode('file', position, {
      name: file.name,
      error: verdict.reason ?? 'This file cannot be read as text.',
    })
    created.push(id)
    unread.push(file.name)
  }

  if (unread.length > 0) {
    useUiStore.getState().addToast({
      tone: 'warning',
      title: unread.length === 1 ? `${unread[0]} was not read.` : `${unread.length} files were not read.`,
      // «It is still there» e' adesso vero: ogni file ha lasciato un nodo.
      message: 'Each one left a node that says why. Nothing was dropped silently.',
    })
  }
  return { created, unread }
}
