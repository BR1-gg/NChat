/**
 * Da **qualsiasi nodo** al prompt di cui il contesto si puo' compattare.
 *
 * Il difetto che questo file chiude e' che la compattazione esisteva solo su due
 * nodi: il prompt e la risposta. Su tutto il resto — una nota, un file, un'immagine,
 * un gruppo — non c'era niente, e il motivo per cui si voleva compattare e' proprio
 * su quelli: sono i nodi che fanno crescere il contesto.
 *
 * Il problema e' che compattare non e' un'azione su un nodo: e' un'azione sul
 * **prompt** che riceve quel nodo come contesto. Un file non ha un contesto, ha un
 * testo che finisce nel contesto di qualcun altro. Quindi la domanda da cui parte
 * tutto e' «di chi e' il contesto che questo nodo fa crescere?», e la risposta si
 * trova seguendo i collegamenti in uscita fino al primo prompt.
 *
 * Tutto qui dentro e' puro e senza effetti: la stessa regola serve al menu, alla
 * finestra di anteprima e ai test, e tre copie della stessa ricerca in tre posti
 * divergono. Sta in un file solo perche' una divergenza qui non da una feature
 * diversa: da una finestra che dice «compatta questo» e compatta un'altra cosa.
 */

import { assembleMessages } from './assemble'
import type { ChatMessage } from '../llm/types'
import { estimateMessages } from '../llm/tokens'
import type { AppNode, NodeId, WorkspaceDocument } from '../types/document'

/**
 * Why a node cannot be compacted.
 *
 * Sono motivi **diversi** e non uno solo, perche' dicono cose diverse all'utente e
 * gli rimedi sono diversi. Un menu che dice solo «nothing to compact» Costringerebbe
 * a indovinare quale dei tre casi sia.
 */
export type CompactionRefusal =
  | { reason: 'no-node' }
  /** The node is fine, but nothing downstream of it is a prompt. */
  | { reason: 'not-connected-to-prompt'; reachable: NodeId[] }
  /** A prompt was found, but it has no history yet, so there is nothing to shrink. */
  | { reason: 'nothing-to-compact'; promptId: NodeId }
  /**
   * The context is already one summary, so there is no conversation left to shorten.
   *
   * Un rifiuto **suo**, e non un ripetizione di `nothing-to-compact`, perche' i due
   * casi si curano in modo opposto. Qui il prompt ha un contesto — si vede, e la
   * finestra lo mostrerebbe — ma e' gia' stato ridotto a un riassunto. Dirgli
   * «collega qualcosa al prompt» sarebbe falso: l'utente ha gia' collegato tutto, e
   * si metterebbe a collegare roba per farlo smettere di dirlo.
   */
  | { reason: 'already-compact'; promptId: NodeId }
  /** The graph cannot be assembled — a cycle, a missing file. Not the user's fault. */
  | { reason: 'cannot-assemble'; promptId: NodeId; message: string }

export interface CompactionTarget {
  /** The prompt whose context would be compacted. */
  promptId: NodeId
  /** The node the user actually clicked, for wording. */
  fromNodeId: NodeId
  /** The history that would be summarised, without the question being asked now. */
  messages: ChatMessage[]
  /** What the prompt will send right now, question included. */
  fullContext: ChatMessage[]
  /** Tokens of `messages`. What the summary has to beat to be worth having. */
  tokensBefore: number
  /** Tokens of the whole request as it stands. */
  tokensNow: number
}

export type CompactionResolution =
  | { ok: true; target: CompactionTarget }
  | { ok: false; refusal: CompactionRefusal }

/**
 * The history a prompt would summarise: everything except the system message and the
 * question being asked now.
 *
 * Esattamente la regola di `compactContext.contextMessages`, e per lo stesso motivo:
 * comprimere anche la domanda produrrebbe un riassunto di una conversazione che
 * finisce a metà, e il prompt si ritroverebbe a non avere piu' niente da chiedere.
 */
export function compactableHistory(messages: ChatMessage[]): ChatMessage[] {
  const withoutSystem = messages.filter((message) => message.role !== 'system')
  const lastUserIndex = withoutSystem.map((message) => message.role).lastIndexOf('user')
  return lastUserIndex >= 0 ? withoutSystem.slice(0, lastUserIndex) : withoutSystem
}

/**
 * I prompt reachable from a node by following outgoing edges.
 *
 * La ricerca e' in larghezza e si ferma al **primo** prompt: con due prompt che
 * ricevono la stessa risposta, compattare l'uno non compatta l'altro, e
 * scegliere a caso sarebbe peggio che non scegliere. Il primo in ordine di
 * scoperta e' quello che l'utente ha costruito per primo, quindi e' quello che
 * sta guardando.
 *
 * Si attraversano i bordi di ogni tipo, non solo quelli di contesto: una risposta
 * che alimenta un prompt con un bordo `run` — cioe' «continua da qui» — porta
 * comunque la propria cronologia in quel prompt, ed e' il caso piu' comune.
 */
export function promptsReachableFrom(document: WorkspaceDocument, nodeId: NodeId): NodeId[] {
  const found: NodeId[] = []
  const seen = new Set<NodeId>([nodeId])
  let frontier: NodeId[] = [nodeId]
  while (frontier.length > 0) {
    const next: NodeId[] = []
    for (const current of frontier) {
      for (const edge of document.edges) {
        if (edge.source !== current) continue
        if (seen.has(edge.target)) continue
        seen.add(edge.target)
        const target = document.nodes.find((node) => node.id === edge.target)
        if (!target) continue
        if (target.data.kind === 'prompt') found.push(target.id)
        else next.push(target.id)
      }
    }
    frontier = next
  }
  return found
}

/**
 * Resolves what "compact" means when the user picked this node.
 *
 * Un prompt e' gia' il suo stesso target. Per tutto il resto si segue la catena di
 * collegamenti in uscita fino al primo prompt: cosi' il comando e' lo stesso da
 * qualsiasi nodo, e la finestra dice sempre **cosa** sta per compattare, che e'
 * l'informazione che manca quando si preme un bottone su una nota.
 */
export function resolveCompactionTarget(
  document: WorkspaceDocument,
  nodeId: NodeId,
): CompactionResolution {
  const node = document.nodes.find((candidate) => candidate.id === nodeId) as AppNode | undefined
  if (!node) return { ok: false, refusal: { reason: 'no-node' } }

  const promptId = node.data.kind === 'prompt' ? nodeId : promptsReachableFrom(document, nodeId)[0]
  if (!promptId) {
    // `reachable` non e' vuoto solo se esiste un prompt irraggiungibile: in pratica
    // resta vuoto, ma e' la prova che il nodo ha dei collegamenti e che il problema
    // non e' la connessione.
    return { ok: false, refusal: { reason: 'not-connected-to-prompt', reachable: [] } }
  }

  let assembled: { messages: ChatMessage[] }
  try {
    assembled = assembleMessages(document, promptId)
  } catch (error: unknown) {
    return {
      ok: false,
      refusal: {
        reason: 'cannot-assemble',
        promptId,
        message: error instanceof Error ? error.message : 'The context could not be assembled.',
      },
    }
  }

  const messages = compactableHistory(assembled.messages)
  if (messages.length === 0) {
    /*
     * Un contesto fatto solo di un riassunto non si puo' compattare ancora, e non per
     * un casoforte: `assemble` mette il riassunto in un messaggio **system**, insieme
     * alle eventuali istruzioni che l'utente ha scritto. Comprimerlo significherebbe
     * riscrivere «rispondi in italiano» in forma parafrasata — cioe' cambiare il
     * comportamento del prompt per farlo piu' corto. L'unica riduzione utile a quel
     * punto e' un'altra operazione, non un'altra passata di riassunto.
     *
     * E va detto diversamente da «non c'e' niente da compattare», perche' qui il
     * contesto **c'e'**: e l'utente lo vede. Dirgli di collegare qualcosa sarebbe
     * falso, e gli farebbe collegare roba inutile per far smettere all'app di
     * segnalarlo.
     */
    const alreadySummarised = document.edges.some((edge) => {
      if (edge.kind !== 'context' || edge.target !== promptId) return false
      const source = document.nodes.find((node) => node.id === edge.source)
      return source?.data.kind === 'summary' && source.data.status !== 'queued'
    })
    return {
      ok: false,
      refusal: alreadySummarised
        ? { reason: 'already-compact', promptId }
        : { reason: 'nothing-to-compact', promptId },
    }
  }

  return {
    ok: true,
    target: {
      promptId,
      fromNodeId: nodeId,
      messages,
      fullContext: assembled.messages,
      tokensBefore: estimateMessages(messages),
      tokensNow: estimateMessages(assembled.messages),
    },
  }
}

/**
 * Wording for a refusal, in one place.
 *
 * Un menu che spiega perche' un bottone non ha fatto niente e' la differenza fra
 * «rotto» e «non c'era niente da fare». Ogni rifiuto ha una frase propria perche'
 * ognuno rimanda a un rimedio diverso, e un messaggio unico costringerebbe
 * l'utente a scoprirlo da solo.
 */
export function refusalMessage(refusal: CompactionRefusal): { title: string; message: string } {
  switch (refusal.reason) {
    case 'no-node':
      return { title: 'That node is gone.', message: 'It was deleted in the meantime.' }
    case 'not-connected-to-prompt':
      return {
        title: 'Nothing downstream to compact.',
        message:
          'Compaction shortens a prompt, so this node has to reach one. Connect it to a prompt and try again.',
      }
    case 'nothing-to-compact':
      return {
        title: 'There is no earlier conversation to compact.',
        message:
          'Connect something to the prompt first — a previous answer, a file, a note. On its own a prompt has nothing before the question.',
      }
    case 'already-compact':
      return {
        title: 'This context is already a summary.',
        message:
          'Compacting it again would rewrite the prompt’s own instructions along with it, which changes what the prompt does rather than what it costs. Connect the original answers back to the prompt to start over.',
      }
    case 'cannot-assemble':
      return { title: 'The context could not be read.', message: refusal.message }
  }
}
