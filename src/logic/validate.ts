import type { NodeId, WorkspaceDocument } from '../types/document'
import { appError, isAppError, type AppError } from '../types/errors'
import { assembleMessages, type AssembledRequest } from './assemble'
import { contextResponsesForPrompt, graphHasCycle, nodeById } from './graph'
import { resolveModel } from './params'
import { isCloudProvider, type ProviderId } from './providers'
import type { KnowledgeEntry, KnowledgeHub, KnowledgeId } from '../types/knowledge'

export interface RunValidationOptions {
  allowPendingContext?: boolean
  /**
   * Already-retrieved saved knowledge, as the text that will be sent.
   *
   * Passata **qui** e non aggiunta dopo, per un motivo che sembra pedante e non lo e': il
   * conteggio dei token esce da `assembleMessages`. Se la conoscenza fosse aggiunta dopo la
   * validazione, `estTokens` direbbe il conto sbagliato — e quella e' la cifra che fa
   * scattare l'avviso di contesto troppo grande e che finisce nella risposta come «~N
   * tok». Un archivio che aggiunge mille token invisibili al conto peggiorerebbe esattamente
   * il numero che serve per capire quando il contesto e' troppo grande.
   *
   * Resta un parametro e non una lettura dallo store per la stessa ragione del modello: questa
   * funzione e' pura, e deve restarlo perche' e' su di lei che si verifica il comportamento.
   */
  knowledge?: string
  /**
   * L'archivio intero, per i nodi che lo puntano.
   *
   * Passato come parametro e non letto dallo store per la stessa ragione di `knowledge` e del
   * modello: questa funzione e' pura e deve restarlo, perche' e' su di lei che si verifica il
   * comportamento. Senza, il conteggio dei token che esce da `assembleMessages` non saprebbe
   * nulla delle note che un nodo ha scelto — e il prompt costerebbe meno di quanto costa
   * davvero, che e' il modo peggiore in cui un conteggio sbaglia.
   */
  knowledgeEntries?: readonly KnowledgeEntry[]
  knowledgeHubs?: readonly KnowledgeHub[]
  /**
   * Gli id delle note che il recupero ha reso in `knowledge`, per la traccia sulla risposta.
   * Passati come parametro e non ricalcolati: la validazione deve dire la verita' su
   * quello che sta andando, e rifacendo la ricerca rischierebbe di descrivere una
   * richiesta diversa da quella che parte.
   */
  knowledgeEntryIds?: readonly KnowledgeId[]
  /**
   * The model actually selected right now.
   *
   * It lives in the app settings, not in the document, and the two go out of step
   * the moment the user picks a different model: the document is only rewritten
   * when the workspace is saved. So a validation that read only the document
   * refused a run saying "no model is selected" while the menu had a model
   * highlighted — with a cloud provider, where scegliere il provider azzera il
   * modello e lo ricarica, capitava ogni volta.
   *
   * Passarlo dentro tiene questa funzione pura e verificabile, che e il motivo per
   * cui non legge lo store.
   */
  model?: string | null
  /**
   * The provider actually selected right now, for the same reason as `model`.
   *
   * Il provider vive nelle impostazioni dell'app e nel documento c'e una copia che
   * si riscrive solo al salvataggio. Leggerlo dal documento meantrava che, cambiando
   * provider dalla barra, questa funzione decideva ancora con il provider di prima:
   * con Google selezionato e una copia del documento con `lmstudio`, una corsa
   * veniva rifiutata **prima di partire** con «The LM Studio base URL is invalid»,
   * un errore che nomina un indirizzo e un programma che quella richiesta non usa.
   *
   * Il sintomo era lo stesso di quello del modello: il menu diceva Google e la
   * validazione ragionava da locali.
   */
  provider?: ProviderId
}

export interface RunValidation {
  error: AppError | null
  assembled?: AssembledRequest
  softWarnings: AppError[]
}

function validBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function validateRunDetailed(
  document: WorkspaceDocument,
  promptId: NodeId,
  options: RunValidationOptions = {},
): RunValidation {
  const prompt = nodeById(document, promptId)
  if (!prompt || prompt.data.kind !== 'prompt') {
    return {
      error: appError('BAD_RESPONSE', 'The prompt node is no longer available.'),
      softWarnings: [],
    }
  }

  if (!prompt.data.text.trim()) {
    return {
      error: appError('EMPTY_PROMPT', 'Write something first.'),
      softWarnings: [],
    }
  }

  /*
   * Il provider: quello passato, se c'e; altrimenti quello del documento, che e il
   * caso di un documento senza workspace aperto.
   *
   * Una variabile sola perche le due decisioni qui sotto — il rimando quando non c'e
   * un modello, e il controllo dell'indirizzo — devono valutare **lo stesso**
   * provider. Con due letture una poteva vedere la copia del documento e l'altra no,
   * e il risultato era un messaggio che nominava un provider diverso da quello
   * selezionato nella barra.
   */
  const provider = options.provider ?? document.settings.provider
  const cloud = isCloudProvider(provider)

  /*
   * Il modello: quello passato, se c'e; altrimenti quello del documento, che e
   * il caso di un documento senza workspace aperto.
   */
  const selected = options.model === undefined ? resolveModel(document.settings) : options.model
  if (!selected) {
    /*
     * Il rimando dipende dal provider, e senza questa distinzione un utente con
     * un provider cloud veniva mandato ad aprire LM Studio, che non c'entra e non
     * e neanche in esecuzione.
     */
    return {
      error: appError('NO_MODEL', 'No model is selected.', {
        hint: cloud
          ? 'Pick a model from the list in the top bar. If it is empty, the provider has not answered yet.'
          : 'Open LM Studio, load a model, then reload the model list.',
      }),
      softWarnings: [],
    }
  }

  if (graphHasCycle(document)) {
    return {
      error: appError('GRAPH_CYCLE', 'This would create a loop.', {
        hint: 'Remove one of the context edges that closes the loop.',
      }),
      softWarnings: [],
    }
  }

  let assembled: AssembledRequest
  try {
    assembled = assembleMessages(document, promptId, {
      knowledge: options.knowledge,
      knowledgeEntries: options.knowledgeEntries,
      knowledgeHubs: options.knowledgeHubs,
      knowledgeEntryIds: options.knowledgeEntryIds,
    })
  } catch (error: unknown) {
    return {
      error: isAppError(error)
        ? error
        : appError('GRAPH_CYCLE', 'The request graph could not be assembled.'),
      softWarnings: [],
    }
  }

  const notReady = contextResponsesForPrompt(document, promptId).find(
    (response) => response.data.status !== 'done' && response.data.status !== 'aborted',
  )
  if (notReady && !options.allowPendingContext) {
    return {
      error: appError(
        'CONTEXT_NOT_READY',
        'An answer this prompt depends on is still running.',
        { hint: 'Wait for the connected answer to finish, or remove its context edge.' },
      ),
      assembled,
      softWarnings: assembled.warnings,
    }
  }

  /*
   * L'indirizzo del server locale si controlla **solo** quando il provider e locale.
   *
   * Con Google o NVIDIA la richiesta non passa da `baseUrl`: va al servizio locale,
   * che poi sceglie la destinazione. Quindi un `baseUrl` vuoto o malformato non
   * impedisce niente a una corsa in cloud, ma questo controllo lo impediva lo stesso,
   * e con un messaggio che nominava LM Studio: l'utente con un provider cloud si
   * trovava una corsa rifiutata da un indirizzo che quella corsa non usa neanche.
   *
   * In locale il controllo resta identico, perche li e l'unica cosa che decide se
   * la richiesta arriva da qualche parte.
   */
  if (!cloud && !validBaseUrl(document.settings.baseUrl)) {
    return {
      error: appError('OFFLINE', 'The LM Studio base URL is invalid.', {
        hint: 'Use a full URL such as http://localhost:1234/v1.',
      }),
      assembled,
      softWarnings: assembled.warnings,
    }
  }

  return { error: null, assembled, softWarnings: assembled.warnings }
}

export function validateRun(document: WorkspaceDocument, promptId: NodeId): AppError | null {
  return validateRunDetailed(document, promptId).error
}
