import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppNodeData, NodeType } from '../types/document'
import { useUiStore } from '../store/uiStore'
import { useWorkspaceStore } from '../store/workspaceStore'

export function useNodeData<T extends AppNodeData>(
  id: string,
  kind: NodeType,
): T | undefined {
  return useWorkspaceStore((state) => {
    const node = state.nodes.find((candidate) => candidate.id === id)
    return node?.data.kind === kind ? (node.data as T) : undefined
  })
}

/**
 * Whether the **user** gave this node an explicit size.
 *
 * Non e la stessa cosa del `width`/`height` che React Flow passa al componente, e
 * la confusione e gia costata un difetto grosso.
 *
 * React Flow misura ogni nodo e passa sempre `width` e `height` al componente,
 * quindi `Boolean(width ?? height)` e **sempre vero**: la classe `has-explicit-size`
 * era su tutti i nodi, sempre, e con lei due regole che dovevano valere solo per i
 * nodi ridimensionati a mano.
 *
 * - `.has-explicit-size .node-textarea { max-height: none; flex: 1 }`: la casella di
 *   scrittura non cresceva piu con il testo, restava alta quanto il nodo e scorreva.
 *   Ecco perche un prompt lungo non allargava il nodo.
 * - `.has-explicit-size .response-body { max-height: none; flex: 1 }`: il corpo della
 *   risposta perdeva il suo tetto.
 *
 * Le dimensioni vere sono `node.width` / `node.height`, che il ridimensionamento
 * scrive e che restano assenti se l'utente non ha toccato il nodo. La decisione e
 * qui, in un posto solo, perche dieci componenti che calcolano la stessa cosa per
 * conto proprio sono dieci occasioni di sbagliare di nuovo.
 */
export function useNodeHasExplicitSize(id: string): boolean {
  return useWorkspaceStore((state) => {
    const node = state.nodes.find((candidate) => candidate.id === id)
    return node?.width !== undefined || node?.height !== undefined
  })
}

/**
 * The size **we** stored for a node, which is not the size React Flow measured.
 *
 * Serve alle cornici, e serve perche' per loro le due misure non possono coincidere.
 *
 * Una cornice non ha una dimensione sua: la ha per costrutta, calcolata dai nodi che
 * circonda (`computeGroupFrame`), e `setGroupFrame` la scrive in `node.width`. Ma
 * React Flow **misura** ogni nodo e per il disegno usa la sua misura, ignorando la
 * nostra. Quindi se il componente prende `width` dalle props — come farebbe un nodo
 * normale — la cornice viene disegnata alla misura di React Flow e il nostro calcolo
 * continua a insistere su un'altra: due verita' che si correggono a vicenda, e il
 * risultato e' una cornice che respira.
 *
 * Il caso e' peggio di quanto sembri perche' la misura di React Flow dipende dal
 * **contenuto**: `.group-frame` non aveva larghezza, quindi si stringeva attorno alla
 * barra del titolo (243px) mentre il calcolo chiedeva 320px — la differenza non era un
 * dettaglio, era il difetto.
 *
 * Per questo qui si legge il documento e non le props. Le props restano giuste per un
 * nodo normale, dove la misura e' dell'utente o del contenuto; per una cornice no.
 *
 * Due selettori **separati** e non uno che restituisce un oggetto: un oggetto nuovo a
 * ogni lettura fa ricadere `PromptNode` nel "Maximum update depth exceeded", e la
 * regola e gia scritta in `selectorStability.test.ts`.
 */
export function useNodeStoredSize(id: string): { width?: number; height?: number } {
  const width = useWorkspaceStore((state) => {
    const node = state.nodes.find((candidate) => candidate.id === id)
    return node?.width
  })
  const height = useWorkspaceStore((state) => {
    const node = state.nodes.find((candidate) => candidate.id === id)
    return node?.height
  })
  return { width, height }
}

export function useNodeDraft(id: string, value: string): {
  value: string
  setValue: (next: string) => void
  flush: () => void
} {
  const [draft, setDraft] = useState(value)
  const draftRef = useRef(value)
  const timerRef = useRef<number | undefined>(undefined)
  const valueRef = useRef(value)

  useEffect(() => {
    valueRef.current = value
    if (timerRef.current === undefined) {
      draftRef.current = value
      setDraft(value)
    }
  }, [value])

  const flush = useCallback(() => {
    if (timerRef.current !== undefined) {
      globalThis.clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
    if (draftRef.current !== valueRef.current) {
      useWorkspaceStore.getState().updateNodeData(id, { text: draftRef.current })
    }
  }, [id])

  const setValue = useCallback(
    (next: string) => {
      draftRef.current = next
      setDraft(next)
      if (timerRef.current !== undefined) globalThis.clearTimeout(timerRef.current)
      timerRef.current = globalThis.setTimeout(() => {
        timerRef.current = undefined
        useWorkspaceStore.getState().updateNodeData(id, { text: next })
        valueRef.current = next
      }, 150)
    },
    [id],
  )

  useEffect(() => flush, [flush])
  return { value: draft, setValue, flush }
}

export function useFocusOnCreate(id: string): void {
  const focusNodeId = useUiStore((state) => state.focusNodeId)
  useEffect(() => {
    if (focusNodeId !== id) return
    const element = document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`)
    window.setTimeout(() => {
      element?.querySelector<HTMLElement>('textarea, input, [tabindex="0"]')?.focus()
      useWorkspaceStore.getState().selectOnlyNode(id)
      useUiStore.getState().setFocusNode(null)
    }, 0)
  }, [focusNodeId, id])
}
