import { retrieveKnowledge, type RetrievalResult } from '../logic/knowledge'
import {
  ensureKnowledgeLoaded,
  knowledgeEntries,
  knowledgeHubs,
  useKnowledgeStore,
} from '../store/knowledgeStore'
import { useUiStore } from '../store/uiStore'
import { getActiveWorkspaceStore } from '../store/workspaceStore'
import { sourceFromNode, type KnowledgeDraft, type KnowledgeEntry } from '../types/knowledge'

/**
 * Il ponte fra l'archivio e la richiesta.
 *
 * Sta in tre pezzi piccoli e non in un posto solo, perche' i tre hanno bisogni diversi:
 *
 * - **salvare** e' un gesto dell'utente, e quindi vive in `savePassage`;
 * - **recuperare** e' una funzione pura, e quindi vive in `logic/knowledge.ts`;
 * - **il testo finale** e' quello che finisce nel messaggio, e quindi entra da
 *   `logic/assemble.ts`.
 *
 * Il perche' di non metterli insieme e' che insieme diventerebbero una cosa sola che si puo'
 * solo provare con un modello in esecuzione. Separati, il pezzo che decide **cosa** arriva
 * al modello e' testabile da solo, che e' l'unica parte in cui un errore costa qualcosa di
 * vero.
 */

/**
 * Finds the notes worth giving the model for this prompt.
 *
 * La domanda usata per cercare e' **il testo del prompt**, non il contesto che lo circonda.
 * Il motivo e' che il prompt e' l'unica parte che dice di che si sta parlando *adesso*: il
 * contesto puo' contenere dieci risposte in cui si parla di tutto, e cercare in quello
 * produrrebbe note su argomenti che non c'entrano con la domanda.
 *
 * Se il prompt e' vuoto non si cerca niente. Meglio silenzio che una ricerca fatta su una
 * domanda che non c'e': restituirebbe note a caso, e il modello le prenderebbe per pertinenti
 * solo perche' gliele hanno date.
 */
export function knowledgeForPrompt(promptText: string): RetrievalResult {
  const query = promptText.trim()
  if (!query) {
    return {
      heading: 'Saved knowledge',
      body: '',
      entryIds: [],
      estimatedTokens: 0,
      hits: [],
      nothingRelevant: false,
    }
  }
  return retrieveKnowledge(query, knowledgeEntries(), { hubs: knowledgeHubs() })
}

/*
 * Il testo per `assembleMessages` era qui, in `knowledgeTextForPrompt`, e non c'e' piu'.
 *
 * La funzione serviva e faceva il suo lavoro, ma rendeva impossibile sapere **quali** note
 * aveva messo nel blocco: restituiva una stringa, e dalla stringa non si ricava la provenienza.
 * Per mettere la traccia sulla risposta servivano gli id, quindi chi chiama ora fa il recupero
 * e tiene il risultato, e usa `renderKnowledgeBlock` per il testo. Il recupero e' una volta
 * sola — prima ne faceva due, una qui dentro e una li', e due ricerche su un archivio che
 * l'utente puo' cambiare possono dare risultati diversi: la traccia avrebbe potuto registrare
 * note diverse da quelle partite.
 */

/**
 * Saves a passage the user chose.
 *
 * Niente di tutto questo e' raggiungibile dal modello: questa funzione si chiama da un
 * bottone e da nient'altro. E' il punto in cui la promessa «solo l'utente scrive» diventa
 * concreta — non una regola da ricordare, ma un posto in cui il modello non arriva.
 */
export async function savePassage(draft: KnowledgeDraft): Promise<KnowledgeEntry | null> {
  await ensureKnowledgeLoaded()
  const text = draft.text.trim()
  if (!text) return null
  return useKnowledgeStore.getState().save(draft)
}

/**
 * What a node contributes when the user saves from it.
 *
 * Si usa il **testo gia' scelto** e non si rilegge il nodo per ricostruire una selezione che
 * non esiste piu' al momento del clic: fra il momento in cui l'utente vede la frase e quello
 * in cui preme il bottone il testo puo' essere cambiato, e il testo scelto e' l'unica fonte
 * che non puo' cambiare sotto di lui.
 *
 * Se non c'e' selezione si salva la risposta intera. E' una comodita' che vale la pena perche'
 * il caso piu' comune e' «salva questo pezzo di ragionamento» e non capita sempre di
 * selezionare; ed e' esplicito, perche' il pulsante dice in una riga cosa sta per fare.
 */
export function draftFromNode(
  selectedText: string,
  fallbackText: string,
  node: Parameters<typeof sourceFromNode>[0],
  origin: Parameters<typeof sourceFromNode>[1],
): KnowledgeDraft {
  const chosen = selectedText.trim() || fallbackText.trim()
  return { text: chosen, source: sourceFromNode(node, origin) }
}

/**
 * The selection, but only if it is really **inside this node**.
 *
 * Il controllo non e' pignolo: e' la differenza fra salvare il passaggio che l'utente ha
 * scelto e salvare quello che e' capitato di essere selezionato. La selezione e' globale
 * al documento, quindi un utente che ha sottolineato tre righe in un prompt e poi preme il
 * pulsante su una risposta avrebbe salvato — senza che nulla sembri andato storto — il testo
 * del prompt, dentro la risposta. Il risultato sarebbe una nota attribuita alla risposta
 * che parla d'altra cosa, che e' il modo peggiore di sbagliare in un archivio: invisibile,
 * e con una fonte che sembra confermare invece di smentire.
 *
 * Percio' si controlla **dove** nasce la selezione e, se non e' dentro il nodo che si sta
 * salvando, si prende il testo intero: che e' almeno quello che l'utente ha davanti.
 */
function selectionInside(nodeId: string): string {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return ''
  const text = selection.toString().trim()
  if (!text) return ''
  const anchor = selection.anchorNode
  if (!anchor) return ''
  const element = anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : (anchor as Element)
  const shell = element?.closest<HTMLElement>(`[data-node-id="${CSS.escape(nodeId)}"]`)
  return shell ? text : ''
}

/**
 * Saves from a node: the selected passage if there is one here, otherwise the whole text.
 *
 * **Non salva niente**: apre la finestra che chiede **dove** mettere il passaggio, e il
 * salvataggio avviene solo quando l'utente ha risposto. Il motivo e' che l'archivio ha due
 * cose che il programma puo' indovinare e una che puo' solo chiedere — il testo e' gia'
 * scelto, il posto fra le note simili si deduce dalle parole, ma «questa nota parla
 * dell'argomento di quel centro» e' una domanda sul **come** l'utente raggruppa, e
 * indovinarla produrrebbe una mappa con dentro ordini che nessuno ha scritto.
 *
 * Il messaggio finale dice **dove** e' finita la nota, perche' «salvata» da solo non dice
 * niente: la parte interessante dell'archivio e' che una nota si accosta a un'altra perche'
 * parlano dello stesso argomento, e sapere quale e' quella che e' appena finita accanto e'
 * quello che permette di fidarsi del resto della mappa. Se non ha trovato parentele, lo
 * dice — anche perche' quello e' un risultato, non un fallimento.
 */
export async function askWhereToSaveFromNode(
  nodeId: string,
  fallbackText: string,
): Promise<boolean> {
  const store = getActiveWorkspaceStore()
  const state = store.getState()
  const node = state.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return false
  const origin = { workspaceId: state.workspaceId ?? null, workspaceName: state.name }
  const chosen = selectionInside(nodeId)
  const draft = draftFromNode(chosen, fallbackText, node, origin)
  if (!draft.text.trim()) return false
  // L'archivio viene caricato **prima** di aprire la finestra: se lo si facesse dopo,
  // l'elenco dei punti di contesto che la finestra mostra sarebbe vuoto alla prima apertura
  // e l'utente finirebbe per creare un centro che ne esisteva gia' uno uguale.
  await ensureKnowledgeLoaded()
  useUiStore.getState().askWhereToSave(draft)
  return true
}

/**
 * Puts the passage in the archive, where the user said to.
 *
 * Il centro scelto viaggia **dentro** il passaggio e non in una variabile separata. E' il
 * punto: se la finestra scrivesse il centro da una parte e il testo dall'altra, un
 * salvataggio riuscito con il centro sbagliato lascerebbe la nota nel gruppo vecchio senza
 * che nulla lo dica — e la mappa e la finestra direbbero due cose diverse, e l'utente si
 * fiderebbe di quella che vede per prima, cioe' di quella sbagliata.
 *
 * Il testo e' quello che il pulsante aveva gia' letto al momento del clic e non quello
 * della selezione al momento della conferma: rileggere la selezione qui salverebbe quello
 * che l'utente sta toccando in quel momento — spesso niente — al posto della frase che
 * aveva scelto.
 */
export async function savePendingPassage(draft: KnowledgeDraft): Promise<KnowledgeEntry | null> {
  return savePassage(draft)
}
