/**
 * Cosa deve fare il bottone **Run** di un prompt, quando l'utente lo preme.
 *
 * Il difetto che questo file chiude e' che il Run di un nodo girava **solo** quel
 * nodo, anche con cinque prompt selezionati. Il menu del tasto destro aveva gia' «Run
 * N prompts», quindi la funzionalita c'era — ma bisognava aprire il menu, e il
 * pulsante che l'utente vede addosso al nodo diceva un'altra cosa.
 *
 * Due bottoni che fanno cose diverse con lo stesso nome sono peggio di un bottone
 * solo. O il menu sparisce e il bottone fa tutto, o il bottone fa una cosa e il menu
 * un'altra — e in quel caso l'utente preme «Run» e non sa quale delle due sta
 * usando. Qui il bottone fa tutto quello che il nome promette: **i prompt selezionati,
 * tutti**, e lo dice con il numero scritto sopra.
 *
 * Sul **numero**: senza, un utente con tre prompt selezionati preme «Run» e non sa se
 * sta per spendere una richiesta o tre. E la scoperta arriva dopo — dalla bolletta, o
 * peggio, dal fatto che la coda si sia riempita. Il numero lo dice prima, sul bottone
 * stesso, dove l'utente sta guardando.
 *
 * La regola sul **chi** e' stretta, e conta piu' della precedente: si girano i prompt
 * selezionati **solo se questo nodo e' fra quelli selezionati**. Premere Run su un
 * nodo che non fa parte della selezione girerebbe altri nodi che l'utente non ha
 * scelto — e un'azione che tocca nodi non scelti non e' un'azione, e' una sorpresa
 * che costa denaro.
 */

import { runSelectionTopologically } from './runSelection'
import { runPrompt } from './runPrompt'
import { workspaceDocumentFromState, type WorkspaceStoreApi } from '../store/workspaceStore'
import { useUiStore } from '../store/uiStore'
import type { AppNode, NodeId, WorkspaceDocument } from '../types/document'

/** A prompt node is runnable when it has something to send. */
function isRunnablePrompt(node: AppNode | undefined): node is AppNode & {
  data: { kind: 'prompt'; text: string }
} {
  return Boolean(node && node.data.kind === 'prompt' && node.data.text.trim())
}

/** Every prompt in the given ids that has text, in the order given. */
export function selectedRunnablePrompts(
  document: WorkspaceDocument,
  ids: NodeId[],
): NodeId[] {
  return ids.filter((id) => isRunnablePrompt(document.nodes.find((node) => node.id === id)))
}

export interface RunIntent {
  /** The prompt ids this press will actually run. Empty when not runnable. */
  promptIds: NodeId[]
  /** Whether the Run button should be clickable. */
  enabled: boolean
  /** The label to put on the button, which has room for a number and nothing else. */
  label: string
  /** The tooltip, which has room to explain. */
  title: string
  /** Prompts that were selected but have no text, so they cannot run. */
  skipped: NodeId[]
}

/**
 * The decision, as a pure function of the document and the selection.
 *
 * `selectedIds` e' un parametro e non qualcosa letto dallo store, perche' la decisione
 * serve in due momenti diversi e con due esigenze opposte. **Al render** il
 * componente deve dipendere dalla selezione **di tutti** i nodi, non solo dalla
 * propria: React Flow passa `selected` come prop, quindi un nodo si ridisegna solo
 * quando cambia la sua selezione, e resterebbe con un numero vecchio quando cambiano
 * le altre. **Alla pressione** invece lo stato va riletto fresco, perche' fra il
 * render e il clic la selezione puo' essere cambiata.
 *
 * Il difetto che questa divisione chiude e' reale: con tre prompt selezionati, quello
 * gia' selezionato prima continuava a dire «Run» mentre gli altri due dicevano
 * «Run 3». Un numero vecchio su un bottone che avvia richieste a pagamento e' peggio di
 * nessun numero — l'utente preme e non sa cosa sta lanciando.
 */
export function runIntent(
  nodeId: NodeId,
  document: WorkspaceDocument,
  selectedIds: NodeId[],
): RunIntent {
  const thisNode = document.nodes.find((node) => node.id === nodeId)
  const runnable = selectedRunnablePrompts(document, selectedIds)

  /*
   * I prompt **selezionati**, con o senza testo: e` questa lista, e non quella dei
   * runnable, che decide se questo bottone parla della selezione.
   *
   * La distinzione conta in un caso preciso, ed e' quello che rendeva sbagliata la
   * prima stesura: tre prompt selezionati, due pieni e uno vuoto. Se si guardasse chi
   * e' eseguibile, il bottone sul nodo vuoto risulterebbe «non della selezione» e
   * resterebbe spento — e l'utente, che ha selezionato tre nodi per lanciarli, si
   * troverebbe l'unico bottone premibile spento e nessun modo di partire.
   */
  const selectedPrompts = selectedIds.filter((id) => {
    const node = document.nodes.find((candidate) => candidate.id === id)
    return node?.data.kind === 'prompt'
  })
  const emptySelected = selectedPrompts.filter((id) => !runnable.includes(id))
  const thisIsSelected = selectedPrompts.includes(nodeId)

  const single: RunIntent = {
    promptIds: isRunnablePrompt(thisNode) ? [nodeId] : [],
    enabled: isRunnablePrompt(thisNode),
    label: 'Run',
    title: 'Run this prompt',
    skipped: emptySelected,
  }

  // Questo nodo non e' fra i selezionati. Girare gli altri toccherebbe nodi che
  // l'utente non ha scelto, quindi si gira solo questo — che e' anche quello che il
  // bottone dice. Il controllo viene **prima** di tutto il resto perche' e' la regola
  // che non si puo' violare: un'azione che tocca nodi non scelti non e' un'azione.
  if (!thisIsSelected) {
    return {
      ...single,
      title: 'Run this prompt. It is not part of the current selection, so the others stay put.',
    }
  }

  // Due o piu' prompt eseguibili nella selezione: il bottone gira tutti, e scrive il
  // numero. Vale anche se questo nodo e' vuoto: e' nella selezione, quindi il bottone
  // parla della selezione, e spegnersi qui lascerebbe l'utente senza comando.
  if (runnable.length >= 2) {
    return {
      promptIds: runnable,
      enabled: true,
      label: `Run ${runnable.length}`,
      title: `Run all ${runnable.length} selected prompts, in the order they depend on each other`,
      skipped: emptySelected,
    }
  }

  // Nella selezione c'e' al massimo un prompt eseguibile: si gira quello, quale che
  // sia. Se e' questo, il caso normale e il bottone dice «Run». Se e' un altro, questo
  // bottone e' un modo per lanciare quello, e va detto perche' altrimenti premere un
  // nodo e vederne girare un altro sembrerebbe un errore.
  if (runnable.length === 1) {
    const only = runnable[0]
    if (only === nodeId || only === undefined) return single
    return {
      promptIds: [only],
      enabled: true,
      label: 'Run 1',
      title: 'Run the one selected prompt that has text. This one is empty.',
      skipped: emptySelected,
    }
  }

  // Solo prompt vuoti nella selezione: non c'e' niente da mandare, e il bottone dice
  // perche' invece di restare spento senza spiegazione.
  return {
    promptIds: [],
    enabled: false,
    label: 'Run',
    title: 'Every selected prompt is empty, so there is nothing to send.',
    skipped: emptySelected,
  }
}

/**
 * The same decision, read fresh from the store.
 *
 * Usata dalla **pressione** del bottone, dove lo stato va riletto al momento: fra il
 * render e il clic la selezione puo' essere cambiata da un altro click, e un bottone
 * che eseguisse il numero mostrato un secondo fa eseguirebbe la cosa sbagliata.
 */
export function runIntentFor(nodeId: NodeId, store: WorkspaceStoreApi): RunIntent {
  const state = store.getState()
  return runIntent(
    nodeId,
    workspaceDocumentFromState(state),
    state.nodes.filter((node) => node.selected).map((node) => node.id),
  )
}

/**
 * Carries out the intent, and says what it left out.
 *
 * Il conto e' sui prompt **eseguiti**, non su quelli selezionati: se tre sono
 * selezionati e uno e' vuoto, ne girano due e il bottone deve averlo detto. Senza, il
 * numero sul bottone prometterebbe tre richieste e l'utente ne riceverebbe due,
 * aspettandosi la terza per sempre.
 */
export async function runFromNode(nodeId: NodeId, store: WorkspaceStoreApi): Promise<number> {
  const intent = runIntentFor(nodeId, store)
  if (intent.skipped.length > 0) {
    useUiStore.getState().addToast({
      tone: 'info',
      title:
        intent.skipped.length === 1
          ? 'One selected prompt is empty.'
          : `${intent.skipped.length} selected prompts are empty.`,
      message: 'An empty prompt has nothing to send, so it was left out. The others ran.',
    })
  }
  if (intent.promptIds.length === 0) return 0
  const [first] = intent.promptIds
  if (intent.promptIds.length === 1 && first) {
    void runPrompt(first, store)
    return 1
  }
  return runSelectionTopologically(intent.promptIds, store)
}
