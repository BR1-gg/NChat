import { estimateMessages } from '../llm/tokens'
import type { ChatMessage, ChatRole } from '../llm/types'
import type { AppNode, NodeId, ResponseNode, WorkspaceDocument } from '../types/document'
import { appError, type AppError } from '../types/errors'
import { collectAggregate, aggregateReadiness } from './aggregation/registry'
import { formatAggregate } from './aggregation/strategies'
import { fileBlock } from './filetext'
import { incomingContextEdges, incomingSystemEdge, nodeById } from './graph'
import { resolveKnowledgePick } from './knowledgeNode'
import { knowledgeTrail, renderKnowledgeBlock, retrieveKnowledge } from './knowledge'
import type { KnowledgeEntry, KnowledgeHub, KnowledgeId, KnowledgeTrail } from '../types/knowledge'

export interface AssembledRequest {
  messages: ChatMessage[]
  estTokens: number
  warnings: AppError[]
  /**
   * What notes from the archive actually went into this request.
   *
   * Serve a rispondere a «l'AI ha usato i miei appunti?», che nessuna delle altre cose
   * qui riesce a rispondere: il blocco dice *cosa ci metterei*, il conteggio dice *quanto
   * costerebbe*, e nessuno dei due dice *cosa e' arrivato davvero*.
   *
   * Vuota quando non c'era nessuna nota, ed e' una risposta vera e non un caso mancante:
   * «questa risposta non ha note» e' informazione, e senza questo campo non si potrebbe
   * distinguere da «non lo so».
   */
  knowledgeUsed: KnowledgeTrail
}

type ImagePart = { type: 'image_url'; image_url: { url: string } }

/**
 * Images connected to a prompt's image input, in the order the edges were made.
 *
 * A video contributes its poster frame, not the clip: no chat model accepts
 * video, and sending the file bytes as an image would be nonsense. The node says
 * so on its face, so this is not a silent substitution.
 */
function collectImageParts(
  document: WorkspaceDocument,
  promptId: NodeId,
): ImagePart[] {
  return document.edges
    .filter((edge) => edge.kind === 'image' && edge.target === promptId)
    .sort((a, b) => a.createdAt - b.createdAt)
    .flatMap((edge) => {
      const source = nodeById(document, edge.source)
      return source ? imagePartsOf(document, source, new Set()) : []
    })
}

/**
 * The picture a node contributes, following a group down to the image nodes it
 * encloses. Grouping a photo together with some answers therefore still lets the
 * model *see* it: without this, a grouped image would reach it as the text marker
 * `[image: name]` and nothing else.
 */
function imagePartsOf(
  document: WorkspaceDocument,
  node: AppNode,
  seen: Set<NodeId>,
): ImagePart[] {
  if (seen.has(node.id)) return []
  seen.add(node.id)
  if (node.data.kind === 'image') {
    const url = node.data.isVideo ? node.data.posterSrc : node.data.src
    return url ? [{ type: 'image_url', image_url: { url } }] : []
  }
  if (node.data.kind === 'output' && node.data.sourceNodeIds?.length) {
    return node.data.sourceNodeIds.flatMap((id) => {
      const member = nodeById(document, id)
      return member ? imagePartsOf(document, member, seen) : []
    })
  }
  return []
}

/**
 * The optional question attached to an image, in the order the edges were made.
 *
 * It becomes its own line inside the **user** message rather than a message of
 * its own: with the picture and the question apart, a model answers whichever it
 * saw last, and the answer would silently be about the question alone.
 *
 * **Perche' questa funzione esiste ancora.** La domanda si scrive adesso in un nodo
 * Prompt — il bottone «Ask about it» lo crea e ci collega l'immagine — quindi per i
 * documenti nuovi questo elenco e' vuoto e il ramo sparirebbe senza che nessuno se ne
 * accorgesse.
 *
 * Non si accetta pero' di spostare la domanda nel prompt e **lasciare qui il resto**:
 * il campo viaggia nelle richieste, e un documento gia' salvato puo' avere una
 * domanda scritta a mano. Se sparisse, il prompt cambierebbe silenziosamente — la
 * stessa domanda, senza — e l'utente riceverebbe una risposta diversa da quella che si
 * aspettava, senza nessun avviso. Il perche' e' in `ImageNodeData.caption`.
 */
function collectImageCaptions(document: WorkspaceDocument, promptId: NodeId): string[] {
  return document.edges
    .filter((edge) => edge.kind === 'image' && edge.target === promptId)
    .sort((a, b) => a.createdAt - b.createdAt)
    .flatMap((edge) => {
      const source = nodeById(document, edge.source)
      if (source?.data.kind !== 'image') return []
      const caption = source.data.caption?.trim()
      return caption ? [caption] : []
    })
}

/**
 * Extra material that is not part of the document.
 *
 * La conoscenza salvata e' **fuori** dal documento — vive in un archivio suo — quindi non
 * puo' arrivare qui leggendo i nodi. Ed e' per questo che arriva come **parametro** e non
 * come lettura da uno store: `assembleMessages` resta una funzione pura dei suoi argomenti,
 * che e' la proprieta' su cui poggiano i test che la chiamano e il motivo per cui non si
 * rompe nulla quando l'archivio e' vuoto.
 *
 * Un parametro che non c'e' resta comodo: senza, `assembleMessages` si comporta esattamente
 * come prima, e il percorso di validazione — che non ha niente a che fare con la
 * conoscenza — non la vede nemmeno.
 */
export interface AssembleOptions {
  /** Already-retrieved knowledge, rendered as the text handed to the model. */
  knowledge?: string
  /**
   * L'archivio, per i nodi che lo **puntano**.
   *
   * Anche questo arriva come parametro e non come lettura da uno store, per la stessa
   * ragione di `knowledge`: `assembleMessages` resta pura dei suoi argomenti, ed e' quella
   * proprieta' che le permette di essere chiamata da un test senza archivio, dal percorso di
   * validazione, e dalla corsa senza che ognuna di queste cose debba sapere che esiste una
   * conoscenza.
   *
   * Assente significa archivio vuoto, e un nodo che punta a un centro inesistente manda
   * **niente** — che e' la risposta giusta: senza note non c'e' niente da mandare, e mandare
   * un blocco vuoto sembrerebbe che il nodo funzioni.
   */
  knowledgeEntries?: readonly KnowledgeEntry[]
  knowledgeHubs?: readonly KnowledgeHub[]
  /**
   * Gli id delle note che il recupero automatico ha messo in knowledge.
   *
   * Viaggiano separati dal testo perche' il testo reso non porta con se' la provenienza, e
   * senza questi id la traccia saprebbe che c'erano delle note ma non quali. Non e' un
   * doppione del lavoro: il recupero e' gia' stato fatto e il chiamante ha gia' il
   * risultato in mano, quindi passare gli id costa una riga e non un secondo recupero.
   */
  knowledgeEntryIds?: readonly KnowledgeId[]
}

/**
 * The text of the prompt being assembled, which is what the question *is*.
 *
 * Serve al ramo `auto` dei nodi Knowledge: il recupero per somiglianza ha bisogno di qualcosa
 * su cui misurare la somiglianza, e la domanda e' l'unica parte del contesto che dice di che
 * si sta parlando **adesso**. Il resto — risposte passate, note, altri prompt — parla di
 * tutto, e cercare in quello produrrebbe note su argomenti che non c'entrano con la domanda.
 *
 * Per questo e' una funzione e non un inline: la domanda va riletta in due punti della
 * ricostruzione della richiesta, e due letture con due forme diverse della stessa verifica
 * (una che accetta un prompt, una che no) finirebbero per mandare la stessa nota due volte o
 * per non mandarla. Qui la verifica e' una sola.
 */
function questionFor(document: WorkspaceDocument, promptId: NodeId): string | null {
  const prompt = nodeById(document, promptId)
  if (!prompt || prompt.data.kind !== 'prompt') return null
  const text = prompt.data.text.trim()
  return text === '' ? null : text
}

export function assembleMessages(
  document: WorkspaceDocument,
  promptId: NodeId,
  options: AssembleOptions = {},
): AssembledRequest {
  const emittedPrompts = new Set<NodeId>()
  const emittedResponses = new Set<NodeId>()
  const visiting = new Set<NodeId>()
  const messages: ChatMessage[] = []
  const warnings: AppError[] = []
  /*
   * Le note che sono passate davvero, in ordine di arrivo.
   *
   * Due percorsi alimentano questa lista — il recupero automatico e i nodi Knowledge — e
   * per questo e' una lista e non un campo: una richiesta puo' avere entrambi, e mostrare
   * solo uno dei due sarebbe una risposta vera solo per meta'.
   */
  const knowledgeUsed: KnowledgeTrail['entries'] = []

  const push = (role: ChatRole, content: ChatMessage['content']): void => {
    messages.push({ role, content })
  }

  const emitResponse = (response: ResponseNode): void => {
    if (emittedResponses.has(response.id)) return
    emittedResponses.add(response.id)
    visitPrompt(response.data.parentPromptId, true)

    const text = response.data.text.trim()
    if (text) {
      push('assistant', text)
    } else if (response.data.status === 'error') {
      warnings.push(
        appError('CONTEXT_NOT_READY', 'An empty error response was skipped.', {
          hint: 'Retry the response or remove its context edge.',
        }),
      )
    }
  }

  const appendSystem = (content: string): void => {
    if (!content.trim()) return
    const firstSystem = messages.find((message) => message.role === 'system')
    // I messaggi system sono sempre testo semplice, ma il tipo e una union:
    // si normalizza per non interpolare un array.
    if (firstSystem) {
      const existing = typeof firstSystem.content === 'string' ? firstSystem.content : ''
      firstSystem.content = `${existing}\n\n${content.trim()}`
    }
    else messages.unshift({ role: 'system', content: content.trim() })
  }

  function visitPrompt(id: NodeId, includeOwnText: boolean): void {
    if (visiting.has(id)) {
      throw appError('GRAPH_CYCLE', 'This graph contains a loop.', {
        hint: 'Remove one of the context edges that closes the loop.',
      })
    }
    if (emittedPrompts.has(id)) return

    const prompt = nodeById(document, id)
    if (!prompt || prompt.data.kind !== 'prompt') {
      throw appError('BAD_RESPONSE', `Prompt node ${id} is missing.`, {
        hint: 'Repair or remove the dangling context edge.',
      })
    }

    visiting.add(id)

    const systemEdge = incomingSystemEdge(document, id)
    if (systemEdge) {
      const system = nodeById(document, systemEdge.source)
      if (system?.data.kind === 'system' && system.data.text.trim()) {
        push('system', system.data.text.trim())
      }
    }

    const aggregatePrefixes: string[] = []
    const aggregateImages: ImagePart[] = []
    for (const edge of incomingContextEdges(document, id)) {
      const source = nodeById(document, edge.source)
      if (isResponseNode(source)) {
        emitResponse(source)
        continue
      }
      if (source?.data.kind === 'summary') {
        if (source.data.status === 'done' || source.data.status === 'aborted') {
          appendSystem(`## Summary of the earlier conversation\n${source.data.text.trim()}`)
        }
        continue
      }
      if (source?.data.kind === 'set') {
        const readiness = aggregateReadiness(document, source)
        if (readiness === 'failed' || readiness === 'missing') {
          throw appError('CONTEXT_NOT_READY', 'A Set member is not ready.', {
            hint: 'Run the missing Set members before running this prompt.',
          })
        }
        const items = collectAggregate(document, source, {
          includePromptText: source.data.includePromptText,
        })
        const text = formatAggregate(source.data.format, items, source.data.includePromptText)
        if (text.trim()) aggregatePrefixes.push(text.trim())
      }
      if (source?.data.kind === 'file') {
        // The file's own text, headed by its name. A node with an error is
        // skipped with a warning instead of sending an empty block, so the user
        // finds out why the context is missing.
        if (source.data.error) {
          warnings.push(
            appError('CONTEXT_NOT_READY', `${source.data.name} was not read: ${source.data.error}`, {
              hint: 'Open the file on disk and paste the text into a Note, or pick a text format.',
            }),
          )
          continue
        }
        if (source.data.text.trim()) {
          aggregatePrefixes.push(fileBlock(source.data))
        }
      }
      if (source?.data.kind === 'folder') {
        if (source.data.error) {
          warnings.push(
            appError('CONTEXT_NOT_READY', `${source.data.name} was not read: ${source.data.error}`, {
              hint: 'Pick the folder again from the node.',
            }),
          )
          continue
        }
        if (source.data.text.trim()) {
          aggregatePrefixes.push(source.data.text)
        }
      }
      if (source?.data.kind === 'note') {
        /*
         * Il testo di una nota entra nel contesto come un blocco con un'intestazione.
         *
         * Con l'intestazione, e non come testo nudo: un prompt che riceve tre note non
         * sa quale sia un'istruzione, quale un esempio e quale un appunto. Il modello non
         * lo distingue da solo, e senza dirglielo mescola le tre in una risposta che non
         * risponde a nessuna delle tre domande.
         *
         * Una nota vuota non viene inviata: è un segnaposto, non un contesto, e mandare
         * un blocco vuoto consumerebbe token per non dire niente.
         */
        if (source.data.text.trim()) {
          aggregatePrefixes.push(`## Note\n${source.data.text.trim()}`)
        }
      }
      if (source?.data.kind === 'knowledge') {
        /*
         * Le note che l'utente ha **scelto** dall'archivio entrano nel contesto con la stessa
         * forma di quelle che il recupero trova, e non con una forma nuova.
         *
         * E' la parte che rende questo nodo affidabile: se le note scelte a mano arrivassero
         * con un'intestazione diversa, il modello le leggerebbe come qualcosa di altro da
         * quello che aveva trovato prima — e senza quell'avviso di sola lettura che il resto
         * dell'archivio porta, potrebbe promettere di modificarle. La promessa «il modello non
         * tocca l'archivio» deve valere per **tutto** quello che esce dall'archivio, non per
         * quello che e' stato trovato per somiglianza.
         */
const entries = options.knowledgeEntries ?? []
        const hubs = options.knowledgeHubs ?? []

        /*
         * Il recupero automatico, e **solo** quando il nodo lo chiede esplicitamente.
         *
         * Fino a poco fa questo non era un ramo ma il comportamento di ogni prompt: il recupero
         * girava su qualunque domanda, mandava un blocco con le istruzioni comprese, e il
         * numero in alto saliva per una domanda che dell'archivio non sapeva niente. Il canale
         * era aperto senza che nessuno lo avesse chiesto, e il costo — le istruzioni, non le
         * note — si pagava a ogni richiesta dell'applicazione.
         *
         * Ora e' una scelta, e per questo vive **qui**: e' l'unico punto in cui la domanda e'
         * disponibile, perche' `assembleMessages` la legge dal nodo prompt che sta assemblando.
         * Un prompt senza questo nodo non entra qui e non costa nulla.
         */
        if (source.data.auto === true) {
          const question = questionFor(document, promptId)
          const retrieval = question ? retrieveKnowledge(question, entries, { hubs }) : null
          if (retrieval && retrieval.entryIds.length > 0) {
            const block = renderKnowledgeBlock(retrieval)
            if (block) aggregatePrefixes.push(block)
            knowledgeUsed.push(...knowledgeTrail('node', retrieval.entryIds, entries, hubs))
          } else if (retrieval?.nothingRelevant) {
            /*
             * «Nessuna nota somiglia a questa domanda» e' un fatto, non un silenzio. Senza
             * dirlo, un nodo in questa modalita' sembra configurato ma spento, che e'
             * indistinguibile da un canale rotto. Non e' un avviso che blocca la corsa: e' una
             * riga che spiega che il canale ha funzionato e non aveva niente da mandare, e
             * senza la quale l'utente non ha modo di sapere quale delle due cose sia.
             */
            warnings.push(
              appError('CONTEXT_NOT_READY', 'No saved note matches this question.', {
                hint: 'Pick a main point on the node instead, or put a note under one.',
              }),
            )
          }
        }

        const pick = resolveKnowledgePick(source.data, entries, hubs)
        if (pick.block) aggregatePrefixes.push(pick.block)
        knowledgeUsed.push(...knowledgeTrail('node', pick.notes.map((entry) => entry.id), entries, hubs))
        /*
         * Una nota che non c'e' piu' e' un **avviso**, non un errore che ferma la corsa.
         *
         * Fermarsi lascerebbe l'utente con un prompt che non parte e nessuna spiegazione, e
         * la spiegazione — «una delle note che avevi scelto e' stata cancellata» — arriva in
         * una riga che non blocca niente. Il contesto che arriva e' comunque quello giusto:
         * quello che esiste.
         */
        for (const id of pick.missing) {
          warnings.push(
            appError('CONTEXT_NOT_READY', `A note in this node is no longer in your knowledge: ${id}.`, {
              hint: 'Open the node and pick what is there now.',
            }),
          )
        }
      }
      if (source?.data.kind === 'output') {
        // A grouped output feeds the next prompt as plain context.
        const text = source.data.synthesis?.status === 'done' ? source.data.synthesis.text : source.data.text
        if (text.trim()) aggregatePrefixes.push(text.trim())
        // A photo grouped with the answers travels with them.
        aggregateImages.push(...imagePartsOf(document, source, new Set()))
      }
    }

    if (includeOwnText && prompt.data.text.trim()) {
      const aggregate = aggregatePrefixes.join('\n\n---\n\n')
      const body = aggregate ? `${aggregate}\n\n---\n\n${prompt.data.text.trim()}` : prompt.data.text.trim()
      // The per-image question, if any, goes with the question and above the
      // picture, in the same message. It is a line and not a message because a
      // message of its own would be the last thing the model saw.
      const captions = collectImageCaptions(document, id)
      const captionBlock = captions.length > 0 ? `## About the image\n${captions.map((c) => `- ${c}`).join('\n')}\n\n` : ''
      const text = `${captionBlock}${body}`
      const images = [...collectImageParts(document, id), ...aggregateImages]
      if (images.length === 0) {
        push('user', text)
      } else {
        // Testo e immagini sullo stesso messaggio: e il formato multimodale
        // OpenAI, ed e l'unico modo perche un modello con visione legga sia la
        // domanda sia la foto. Le immagini stanno su questo messaggio e non su
        // uno separato, altrimenti il modello risponderebbe all'ultimo.
        push('user', [{ type: 'text', text }, ...images])
      }
    }

    visiting.delete(id)
    emittedPrompts.add(id)
  }

  visitPrompt(promptId, true)

  const hasSystem = messages.some((message) => message.role === 'system')
  const fallback = document.settings.defaults.systemPrompt.trim()
  if (!hasSystem && fallback) messages.unshift({ role: 'system', content: fallback })

  /*
   * La conoscenza va **ultima**, dopo tutto il resto.
   *
   * L'ordine conta perche' e' quello che il modello legge: contesto del documento, poi
   * archivio, poi la domanda. Messa prima, la conoscenza finisce in mezzo alla
   * conversazione e i due si confondono; messa dopo, e' l'ultima cosa che il modello ha
   * letto prima della domanda, ed e' li che la userà.
   *
   * Va come messaggio **system** perche' e' l'unico modo che funziona con ogni provider:
   * non richiede capacita' particolari e non finisce nel mezzo del contesto dell'utente.
   */
  if (options.knowledge) appendSystem(options.knowledge)
  /*
   * E il recupero automatico, che arriva qui come **testo gia' reso** e quindi senza id.
   *
   * Per questo gli id passano accanto, in `knowledgeEntryIds`: il testo e' cio' che va al
   * modello, ma non porta con se' la provenienza, e senza gli id la traccia non potrebbe
   * dire *quali* note erano — solo che ce n'era qualcuna. Il doppione e' una riga di codice
   * e una firma di parametro, ed e' il prezzo di non far girare il recupero due volte solo
   * per ricavarne la provenienza.
   */
  knowledgeUsed.push(
    ...knowledgeTrail(
      'retrieved',
      options.knowledgeEntryIds ?? [],
      options.knowledgeEntries ?? [],
      options.knowledgeHubs ?? [],
    ),
  )

  const estTokens = estimateMessages(messages)
  if (messages.length > 50) {
    warnings.push(
      appError('CONTEXT_OVERFLOW', `This request has ${messages.length} messages.`, {
        hint: 'Consider removing older context to keep the request manageable.',
      }),
    )
  }
  if (estTokens > document.settings.contextTokenWarning) {
    warnings.push(
      appError(
        'CONTEXT_OVERFLOW',
        `Estimated request size is ~${estTokens.toLocaleString()} tokens.`,
        {
          hint: `This exceeds the configured warning threshold of ${document.settings.contextTokenWarning.toLocaleString()}.`,
        },
      ),
    )
  }

  /*
   * Le note si mettono **prima** del recupero automatico nella lista, anche se il recupero
   * viene aggiunto al contesto per primo.
   *
   * L'ordine della lista non e' quello del contesto, e la ragione e' che la lista e' un
   * elenco di provenienza: quelle scelte a mano sono la scelta esplicita dell'utente, quindi
   * vanno in cima. Se un domani si chiedera' perche' l'ordine e' questo, la risposta e'
   * «perche' in testa c'e' quello che l'utente ha scelto», e non «perche' arriva prima nel
   * messaggio».
   */
  return {
    messages,
    estTokens,
    warnings,
    knowledgeUsed: { entries: [...knowledgeUsed].sort((a, b) => (a.via === b.via ? 0 : a.via === 'node' ? -1 : 1)) },
  }
}

function isResponseNode(node: AppNode | undefined): node is ResponseNode {
  return node?.data.kind === 'response'
}
