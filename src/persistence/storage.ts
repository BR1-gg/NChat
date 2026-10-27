import { nanoid } from 'nanoid'
import type {
  AppEdge,
  AppNode,
  EdgeKind,
  GenerationParams,
  ImageNode,
  NoteColor,
  NoteNode,
  OutputNode,
  PromptNode,
  ResponseNode,
  ResponseNodeData,
  ResponseStatus,
  SetNode,
  SummaryNode,
  SystemNode,
  WorkspaceDocument,
} from '../types/document'
import type {
  BrainNode,
  FileNode,
  FolderNode,
  GroupColor,
  GroupNode,
  KnowledgeNode,
} from '../types/document'
import {
  createDefaultRequestSnapshot,
  createEmptyDocument,
  DOC_VERSION,
  type RequestSnapshot,
  type ResponseStats,
} from '../types/document'
import { appError, isAppError, type AppError } from '../types/errors'
import type { KnowledgeTrail } from '../types/knowledge'
import { isProviderId, providerSpec } from '../logic/providers'
import type { ProviderId } from '../logic/providers'
import { UsageRecordSchema, type UsageRecord } from './schema'
import {
  cloneSettings,
  DEFAULT_UI_PREFERENCES,
  isAppearanceName,
  sanitizeUiScale,
  splitSettings,
  type AppSettings,
  type Settings,
  type UiPreferences,
} from '../types/settings'
import { migrate } from './migrations'
import { WorkspaceSchema } from './schema'

export const WORKSPACE_KEY = 'nchat.workspace.v1'
export const BACKUP_KEY = 'nchat.backup'
export const UI_KEY = 'nchat.ui.v1'
/**
 * I consumi, in una chiave separata dalle preferenze.
 *
 * Separata perche' hanno un ciclo di vita diverso: le preferenze si scrivono a ogni
 * cambiamento di un interruttore, i consumi una volta per corsa. Con la stessa chiave
 * ogni corsa riscriverebbe anche le preferenze, e il bottone che mostra la spesa
 * finirebbe colplistare ogni scelta fatta nella schermata delle impostazioni.
 */
const USAGE_KEY = 'nchat.usage.v1'
const CORRUPT_KEY = 'nchat.workspace.corrupt'
const DEBOUNCE_MS = 500
const STORAGE_WARNING_BYTES = 3 * 1024 * 1024

export interface SaveResult {
  ok: boolean
  bytes: number
  warning?: string
  error?: AppError
}

export interface LoadResult {
  doc: WorkspaceDocument
  problem?: AppError
  droppedNodes: number
  droppedEdges: number
  repairedResponses: number
}

export interface NormalizeResult {
  document: WorkspaceDocument
  droppedNodes: number
  droppedEdges: number
  repairedResponses: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function sanitizeParams(value: unknown): GenerationParams {
  if (!isRecord(value)) {
    return { temperature: null, topP: null, maxTokens: null, stop: null }
  }
  const temperature =
    typeof value.temperature === 'number' && Number.isFinite(value.temperature)
      ? clamp(value.temperature, 0, 2)
      : null
  const topP =
    typeof value.topP === 'number' && Number.isFinite(value.topP)
      ? clamp(value.topP, 0, 1)
      : null
  const maxTokens =
    typeof value.maxTokens === 'number' && Number.isInteger(value.maxTokens) && value.maxTokens > 0
      ? value.maxTokens
      : null
  const stop = Array.isArray(value.stop)
    ? value.stop.filter((item): item is string => typeof item === 'string')
    : null
  return { temperature, topP, maxTokens, stop }
}

function sanitizeSnapshot(value: unknown): RequestSnapshot {
  const fallback = createDefaultRequestSnapshot()
  if (!isRecord(value)) return fallback
  const params = sanitizeParams({
    temperature: value.temperature,
    topP: value.topP,
    maxTokens: value.maxTokens,
    stop: value.stop,
  })
  return {
    model: typeof value.model === 'string' ? value.model : '',
    params: {
      temperature: params.temperature ?? fallback.params.temperature,
      topP: params.topP ?? fallback.params.topP,
      maxTokens: params.maxTokens ?? fallback.params.maxTokens,
      stop: params.stop,
    },
    systemPrompt: typeof value.systemPrompt === 'string' ? value.systemPrompt : '',
    messageCount: Math.max(0, Math.trunc(numberOr(value.messageCount, 0))),
    estPromptTokens: Math.max(0, Math.trunc(numberOr(value.estPromptTokens, 0))),
  }
}

function sanitizeStats(value: unknown, savedAt: number): ResponseStats {
  if (!isRecord(value)) return { startedAt: savedAt, finishedAt: savedAt }
  const optionalNumber = (key: string): number | undefined => {
    const candidate = value[key]
    return typeof candidate === 'number' && Number.isFinite(candidate)
      ? candidate
      : undefined
  }
  const finishReason = value.finishReason
  return {
    startedAt: numberOr(value.startedAt, savedAt),
    ...(optionalNumber('finishedAt') !== undefined
      ? { finishedAt: optionalNumber('finishedAt') }
      : {}),
    ...(optionalNumber('firstTokenMs') !== undefined
      ? { firstTokenMs: optionalNumber('firstTokenMs') }
      : {}),
    ...(optionalNumber('durationMs') !== undefined
      ? { durationMs: optionalNumber('durationMs') }
      : {}),
    ...(optionalNumber('promptTokens') !== undefined
      ? { promptTokens: optionalNumber('promptTokens') }
      : {}),
    ...(optionalNumber('completionTokens') !== undefined
      ? { completionTokens: optionalNumber('completionTokens') }
      : {}),
    ...(optionalNumber('totalTokens') !== undefined
      ? { totalTokens: optionalNumber('totalTokens') }
      : {}),
    ...(finishReason === 'stop' ||
    finishReason === 'length' ||
    finishReason === 'content_filter' ||
    finishReason === 'unknown'
      ? { finishReason }
      : {}),
  }
}

function sanitizeMessages(value: unknown): ResponseNodeData['messagesSnapshot'] {
  if (!Array.isArray(value)) return undefined
  const messages: NonNullable<ResponseNodeData['messagesSnapshot']> = []
  for (const message of value) {
    if (!isRecord(message)) continue
    if (
      (message.role !== 'system' && message.role !== 'user' && message.role !== 'assistant') ||
      typeof message.content !== 'string'
    ) {
      continue
    }
    messages.push({ role: message.role, content: message.content })
  }
  return messages.length > 0 ? messages : undefined
}

/**
 * The knowledge trail, or `undefined` when it is absent or not usable.
 *
 * Una voce senza id o senza titolo non si puo' mostrare, quindi si scarta. Ma **una voce non
 * si scarta**: se due note su cinque sono integre, la traccia vale ancora per quello che e'
 * arrivato, e mentire sul numero — Showing zero note quando cinque sono arrivate — e' il
 * difetto che questa struttura esiste per evitare.
 */
function sanitizeKnowledgeTrail(value: unknown): KnowledgeTrail | undefined {
  if (!isRecord(value) || !Array.isArray(value.entries)) return undefined
  const entries = value.entries.flatMap((item) => {
    if (!isRecord(item)) return []
    if (typeof item.id !== 'string' || !item.id) return []
    if (typeof item.title !== 'string') return []
    const via: KnowledgeTrail['entries'][number]['via'] = item.via === 'node' ? 'node' : 'retrieved'
    return [{ id: item.id, title: item.title, hub: typeof item.hub === 'string' ? item.hub : null, via }]
  })
  return { entries }
}
function sanitizeError(value: unknown): AppError | undefined {
  return isAppError(value) ? value : undefined
}

function sanitizeStatus(value: unknown): ResponseStatus {
  return value === 'queued' ||
    value === 'streaming' ||
    value === 'done' ||
    value === 'error' ||
    value === 'aborted' ||
    value === 'interrupted'
    ? value
    : 'interrupted'
}

function validPosition(value: unknown): value is { x: number; y: number } {
  return (
    isRecord(value) &&
    typeof value.x === 'number' &&
    Number.isFinite(value.x) &&
    typeof value.y === 'number' &&
    Number.isFinite(value.y)
  )
}

/*
 * I colori accettati per un gruppo.
 *
 * `satisfies` e' il punto: se il tipo `GroupColor` perde un colore, **questa riga non
 * compila piu'**. Senza, la lista qui sarebbe una copia — e una copia non avvisa nessuno
 * quando si disallinea: il colore nuovo semplicemente verrebbe scartato in silenzio al
 * salvataggio, e l'utente che lo aveva scelto lo perderebbe senza che nessuno lo dica.
 */
const GROUP_COLOR_VALUES = [
  'default',
  'amber',
  'sky',
  'rose',
  'green',
  'violet',
] satisfies readonly GroupColor[]
const GROUP_COLORS = new Set<string>(GROUP_COLOR_VALUES)

function nodeFromUnknown(value: unknown, savedAt: number): AppNode | null {
  if (!isRecord(value)) return null
  const { id, type, data, style } = value
  if (
    typeof id !== 'string' ||
    !id ||
    /*
     * La lista dei tipi accettati. Stava qui a mano e si era allineata col tempo in modo
     * da sembrare giusta: mancavano `file`, `folder` e `brain`, quindi un documento con
     * un nodo di quei tipi veniva scartato **tutto intero**, nodo e dati, perche' questa
     * funzione non e' un ripiego ma il posto dove il documento viene ripulito prima di
     * entrare nel programma. `file`, `folder`, `brain` e `group` ci sono adesso, e sono
     * gli stessi del catalogo: se un tipo e' in `NodeSchema` e non qui, i due percorsi
     * si contraddicono e il piu' stretto vince, in silenzio.
     */
    (type !== 'prompt' &&
      type !== 'response' &&
      type !== 'system' &&
      type !== 'note' &&
      type !== 'set' &&
      type !== 'output' &&
      type !== 'summary' &&
      type !== 'image' &&
      type !== 'file' &&
      type !== 'folder' &&
      type !== 'brain' &&
      type !== 'knowledge' &&
      type !== 'group') ||
    !validPosition(value.position) ||
    !isRecord(data) ||
    data.kind !== type
  ) {
    return null
  }

  // Collapse e come width/height: stato del nodo, non del testo. Si propaga in
  // tutti i rami porque vale per ogni tipo di nodo.
  const collapse = data.collapsed === true ? { collapsed: true as const } : {}

  const base = {
    id,
    position: { x: value.position.x, y: value.position.y },
    ...(typeof value.width === 'number' && value.width > 0 ? { width: value.width } : {}),
    ...(typeof value.height === 'number' && value.height > 0 ? { height: value.height } : {}),
    ...(isRecord(style) ? { style } : {}),
  }

  if (type === 'prompt') {
    return {
      ...base,
      type: 'prompt',
      data: {
        kind: 'prompt',
        ...collapse,
        text: typeof data.text === 'string' ? data.text : '',
        params: sanitizeParams(data.params),
        ...(typeof data.title === 'string' ? { title: data.title } : {}),
        runCount: Math.max(0, Math.trunc(numberOr(data.runCount, 0))),
        ...(typeof data.lastRunAt === 'number' && Number.isFinite(data.lastRunAt)
          ? { lastRunAt: data.lastRunAt }
          : {}),
      },
    } satisfies PromptNode
  }

  if (type === 'response') {
    const colorlessStyle = base.style
    const messagesSnapshot = sanitizeMessages(data.messagesSnapshot)
    const knowledgeUsed = sanitizeKnowledgeTrail(data.knowledgeUsed)
    return {
      ...base,
      type: 'response',
      data: {
        kind: 'response',
        ...collapse,
        status: sanitizeStatus(data.status),
        text: typeof data.text === 'string' ? data.text : '',
        ...(typeof data.reasoning === 'string' && data.reasoning
          ? { reasoning: data.reasoning }
          : {}),
        parentPromptId: typeof data.parentPromptId === 'string' ? data.parentPromptId : '',
        runIndex: Math.max(0, Math.trunc(numberOr(data.runIndex, 0))),
        promptSnapshot:
          typeof data.promptSnapshot === 'string' ? data.promptSnapshot : '',
        requestSnapshot: sanitizeSnapshot(data.requestSnapshot),
        ...(messagesSnapshot ? { messagesSnapshot } : {}),
        /*
         * La traccia delle note, ricostruita campo per campo.
         *
         * Il trattamento e' **identico** a quello di `messagesSnapshot`: si copia solo se
         * c'e' ed e' ben fatto, e una traccia malformata si perde. Il perche' e' che questa e'
         * un'informazione **derivata** — le note sono nell'archivio e si possono rileggere —
         * mentre i messaggi inviati non sono da nessuna parte. Perdere una traccia e'
         * dimenticare una riga in una lista; perdere i messaggi e' perdere la prova di cosa
         * e' successo. Per questo il secondo si tiene anche se non e' perfetto, e il primo no.
         */
        ...(knowledgeUsed ? { knowledgeUsed } : {}),
        stats: sanitizeStats(data.stats, savedAt),
        ...(sanitizeError(data.error) ? { error: sanitizeError(data.error) } : {}),
        ...(typeof data.title === 'string' ? { title: data.title } : {}),
      },
      ...(colorlessStyle ? { style: colorlessStyle } : {}),
    } satisfies ResponseNode
  }

  if (type === 'system') {
    return {
      ...base,
      type: 'system',
      data: {
        kind: 'system',
        ...collapse,
        text: typeof data.text === 'string' ? data.text : '',
        ...(typeof data.title === 'string' ? { title: data.title } : {}),
      },
    } satisfies SystemNode
  }

  if (type === 'set') {
    const synthesis = isRecord(data.synthesis)
      ? {
          text: typeof data.synthesis.text === 'string' ? data.synthesis.text : '',
          status: sanitizeStatus(data.synthesis.status),
          ...(isRecord(data.synthesis.stats)
            ? { stats: sanitizeStats(data.synthesis.stats, savedAt) }
            : {}),
          ...(sanitizeError(data.synthesis.error)
            ? { error: sanitizeError(data.synthesis.error) }
            : {}),
        }
      : undefined
    return {
      ...base,
      type: 'set',
      data: {
        kind: 'set',
        ...collapse,
        title: typeof data.title === 'string' ? data.title : 'Set',
        memberIds: Array.isArray(data.memberIds)
          ? data.memberIds.filter((id): id is string => typeof id === 'string')
          : [],
        pick: data.pick === 'all-done' ? 'all-done' : 'latest-done',
        format:
          data.format === 'numbered' || data.format === 'json' || data.format === 'llm-synthesis'
            ? data.format
            : 'sections',
        includePromptText: data.includePromptText !== false,
        ...(synthesis ? { synthesis } : {}),
        color: typeof data.color === 'string' ? data.color : '#8b5cf6',
      },
    } satisfies SetNode
  }

  if (type === 'output') {
    return {
      ...base,
      type: 'output',
      data: {
        kind: 'output',
        ...collapse,
        text: typeof data.text === 'string' ? data.text : '',
        ...(typeof data.title === 'string' ? { title: data.title } : {}),
        ...(Array.isArray(data.sourceNodeIds)
          ? { sourceNodeIds: data.sourceNodeIds.filter((id): id is string => typeof id === 'string') }
          : {}),
        ...(data.format === 'numbered' || data.format === 'json' || data.format === 'llm-synthesis'
          ? { format: data.format }
          : {}),
        ...(typeof data.includePromptText === 'boolean'
          ? { includePromptText: data.includePromptText }
          : {}),
      },
    } satisfies OutputNode
  }

  if (type === 'image') {
    // Solo i campi veri vengono tenuti: `src` e `posterSrc` sono data URL e
    // vengono ricostruite come stringhe, mai trattate come numeri.
    const src = typeof data.src === 'string' ? data.src : ''
    const posterSrc = typeof data.posterSrc === 'string' ? data.posterSrc : undefined
    return {
      ...base,
      type: 'image',
      data: {
        kind: 'image',
        ...collapse,
        name: typeof data.name === 'string' ? data.name : '',
        mediaType: typeof data.mediaType === 'string' ? data.mediaType : '',
        isVideo: data.isVideo === true,
        src,
        ...(posterSrc ? { posterSrc } : {}),
        width: Math.max(0, Math.trunc(numberOr(data.width, 0))),
        height: Math.max(0, Math.trunc(numberOr(data.height, 0))),
        sizeBytes: Math.max(0, Math.trunc(numberOr(data.sizeBytes, 0))),
        ...(typeof data.title === 'string' ? { title: data.title } : {}),
      },
    } satisfies ImageNode
  }

  if (type === 'summary') {
    const messagesSnapshot = sanitizeMessages(data.messagesSnapshot)
    const knowledgeUsed = sanitizeKnowledgeTrail(data.knowledgeUsed)
    if (data.status === 'queued' || data.status === 'streaming') {
      data.status = 'interrupted'
    }
    return {
      ...base,
      type: 'summary',
      data: {
        kind: 'summary',
        ...collapse,
        text: typeof data.text === 'string' ? data.text : '',
        status: sanitizeStatus(data.status),
        ...(typeof data.instructions === 'string'
          ? { instructions: data.instructions }
          : {}),
        coveredNodeIds: Array.isArray(data.coveredNodeIds)
          ? data.coveredNodeIds.filter((id): id is string => typeof id === 'string')
          : [],
        coveredMessageCount: Math.max(0, Math.trunc(numberOr(data.coveredMessageCount, 0))),
        tokensBefore: Math.max(0, Math.trunc(numberOr(data.tokensBefore, 0))),
        tokensAfter: Math.max(0, Math.trunc(numberOr(data.tokensAfter, 0))),
        coverageHash: typeof data.coverageHash === 'string' ? data.coverageHash : '',
        requestSnapshot: sanitizeSnapshot(data.requestSnapshot),
        ...(messagesSnapshot ? { messagesSnapshot } : {}),
        /*
         * La traccia delle note, ricostruita campo per campo.
         *
         * Il trattamento e' **identico** a quello di `messagesSnapshot`: si copia solo se
         * c'e' ed e' ben fatto, e una traccia malformata si perde. Il perche' e' che questa e'
         * un'informazione **derivata** — le note sono nell'archivio e si possono rileggere —
         * mentre i messaggi inviati non sono da nessuna parte. Perdere una traccia e'
         * dimenticare una riga in una lista; perdere i messaggi e' perdere la prova di cosa
         * e' successo. Per questo il secondo si tiene anche se non e' perfetto, e il primo no.
         */
        ...(knowledgeUsed ? { knowledgeUsed } : {}),
        stats: sanitizeStats(data.stats, savedAt),
        ...(sanitizeError(data.error) ? { error: sanitizeError(data.error) } : {}),
        ...(typeof data.title === 'string' ? { title: data.title } : {}),
      },
    } satisfies SummaryNode
  }

  if (type === 'group') {
    return {
      ...base,
      type: 'group',
      data: {
        kind: 'group',
        ...collapse,
        title: typeof data.title === 'string' ? data.title : '',
        color: GROUP_COLORS.has(data.color as string) ? (data.color as GroupColor) : 'default',
        ...(Array.isArray(data.members)
          ? { members: data.members.filter((id): id is string => typeof id === 'string') }
          : { members: [] }),
      },
    } satisfies GroupNode
  }

/*
   * File, cartella e Brain.
   *
   * Questi tre rami mancavano, e la loro assenza **non** era un tipo scartato: la lista in
   * cima accettava `file`, `folder` e `brain`, quindi il nodo passava il controllo del tipo e
   * poi finiva sulla **nota** di fondo, con `text: ''`. Un nodo File diventava una nota
   * vuota, e con lei spariva il testo del file che era stato letto dal disco.
   *
   * Il difetto e' invisibile finche' non si rilegge un grafo che ne aveva, e poi e' impossibile
   * da non notare: i file si salvano, si rilegge, e al posto dei file ci sono palline vuote.
   * Non c'e' nessun errore, perche' in nessun punto il programma accetta che quel nodo sia di
   * un tipo diverso da quello che era.
   *
   * La ragione per cui la lista e la catena possono divergere e' che sono due elenchi distinti,
   * e aggiungere un tipo al primo non tocca il secondo. Ora che anche il secondo e' coperto,
   * `nodeTypesRoundtrip.test.ts` chiede a ogni tipo del catalogo se sopravvive: la domanda non
   * e' piu' quella di chi ha scritto questo codice.
   */
  if (type === 'file') {
    return {
      ...base,
      type: 'file',
      data: {
        kind: 'file',
        ...collapse,
        name: typeof data.name === 'string' ? data.name : '',
        format: typeof data.format === 'string' ? data.format : 'text',
        sizeBytes: Math.max(0, Math.trunc(numberOr(data.sizeBytes, 0))),
        text: typeof data.text === 'string' ? data.text : '',
        truncated: data.truncated === true,
        ...(typeof data.error === 'string' && data.error ? { error: data.error } : {}),
        ...(typeof data.title === 'string' ? { title: data.title } : {}),
      },
    } satisfies FileNode
  }

  if (type === 'folder') {
    return {
      ...base,
      type: 'folder',
      data: {
        kind: 'folder',
        ...collapse,
        name: typeof data.name === 'string' ? data.name : '',
        fileCount: Math.max(0, Math.trunc(numberOr(data.fileCount, 0))),
        totalBytes: Math.max(0, Math.trunc(numberOr(data.totalBytes, 0))),
        text: typeof data.text === 'string' ? data.text : '',
        truncated: data.truncated === true,
        /*
         * `refused` elenca i file saltati e perche'. Perderlo qui vuol dire che il contesto
         * diventa piu' piccolo senza che nulla lo dica, e l'utente crede che il modello abbia
         * letto anche quelli — che e' il difetto per cui il campo esiste.
         */
        refused: Array.isArray(data.refused)
          ? data.refused
              .filter(
                (item): item is { name: string; reason: string } =>
                  isRecord(item) && typeof item.name === 'string' && typeof item.reason === 'string',
              )
              .map((item) => ({ name: item.name, reason: item.reason }))
          : [],
        ...(typeof data.error === 'string' && data.error ? { error: data.error } : {}),
        ...(typeof data.title === 'string' ? { title: data.title } : {}),
      },
    } satisfies FolderNode
  }

  if (type === 'brain') {
    return {
      ...base,
      type: 'brain',
      data: {
        kind: 'brain',
        ...collapse,
        instruction: typeof data.instruction === 'string' ? data.instruction : '',
        model: typeof data.model === 'string' ? data.model : '',
        onExisting:
          data.onExisting === 'overwrite' || data.onExisting === 'skip' ? data.onExisting : 'rename',
        /*
         * Il registro della corsa torna **vuoto**, non a «in corso».
         *
         * Un Brain salvato mentre stava lavorando, riaprirtolo come «in corso» mostrerebbe un
         * lavoro finito da un pezzo, che nessuno puo' piu' concludere: l'unica cosa da fare
         * sarebbe ricominciare, senza sapere quanto era stato fatto. Il registro inoltre non
         * sopravvive a nulla — i file sono sul disco e il comando che li ha scritti no — quindi
         * ripartire da zero e' la cosa onesta.
         */
        run: { status: 'idle', total: 0, done: 0, log: [], undo: [] },
        ...(typeof data.inputPath === 'string' ? { inputPath: data.inputPath } : {}),
        ...(typeof data.outputPath === 'string' ? { outputPath: data.outputPath } : {}),
        ...(typeof data.error === 'string' && data.error ? { error: data.error } : {}),
        ...(typeof data.title === 'string' ? { title: data.title } : {}),
      },
    } satisfies BrainNode
  }
  if (type === 'knowledge') {
    /*
     * Questo ramo e' quello che rende vero il commento in cima alla lista dei tipi.
     *
     * Senza, un nodo Knowledge non verrebbe nemmeno scartato — verrebbe **convertito in una
     * nota**: la lista dei tipi lo accetterebbe, e la catena di `if` finirebbe sulla nota con
     * `text: ''`. Il risultato e' un nodo che esiste, sembra uguale a prima, e ha perso tutto:
     * il centro scelto, le note, i legami. Non si vede niente e non c'e' errore, e il difetto
     * si scopre solo al ricaricamento — cioe' dopo che il lavoro e' stato fatto.
     *
     * I valori di ripiego sono quelli del nodo nuovo, perche' un nodo salvato da una versione
     * che non aveva ancora questo tipo **deve** aprire come non configurato. Il contrario
     * sarebbe inventare un centro che l'utente non ha mai scelto, e mandare note a un gruppo
     * che non esiste.
     */
    const entryIds = Array.isArray(data.entryIds)
      ? data.entryIds.filter((id): id is string => typeof id === 'string')
      : []
    return {
      ...base,
      type: 'knowledge',
      data: {
        kind: 'knowledge',
        ...collapse,
        hubId: typeof data.hubId === 'string' && data.hubId ? data.hubId : null,
        /*
         * Un nodo salvato quando esisteva solo la modalita' per punto di contesto apre
         * «scegli un centro», che e' la risposta giusta: e' quello che il file diceva, e
         * inventare un recupero automatico significherebbe mandare note che nessuno aveva
         * chiesto di mandare.
         */
        auto: data.auto === true,
        includeNotes: data.includeNotes === true,
        entryIds,
        includeLinked: data.includeLinked === true,
        ...(typeof data.title === 'string' ? { title: data.title } : {}),
      },
    } satisfies KnowledgeNode
  }

  const color: NoteColor =
    data.color === 'amber' || data.color === 'sky' || data.color === 'rose'
      ? data.color
      : 'default'
  return {
    ...base,
    type: 'note',
    data: {
      kind: 'note',
      ...collapse,
      text: typeof data.text === 'string' ? data.text : '',
      color,
    },
  } satisfies NoteNode
}

/**
 * Keeps only the overrides that could be meant: a known provider, a string, and a
 * plausible address.
 *
 * A document arrives da un file che l'utente puo aver modificato a mano, e un
 * override che punta a un indirizzo assurdo fa fallire ogni richiesta con un
 * errore che non spiega niente. Qui si scarta alla porta, dove il motivo e chiaro.
 */
function sanitizeOverrides(value: unknown): Partial<Record<ProviderId, string>> {
  if (!isRecord(value)) return {}
  const out: Partial<Record<ProviderId, string>> = {}
  for (const [id, raw] of Object.entries(value)) {
    if (!isProviderId(id) || id === 'lmstudio') continue
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (!trimmed) continue
    out[id] = trimmed
  }
  return out
}

/**
 * Keeps the keys that could be meant: a known provider that needs one, and a string.
 *
 * Same reasoning as the overrides, and one more reason: `lmstudio` is not a cloud
 * provider, so a key stored under it would be a string that looks like a credential
 * and is never used, which is exactly the kind of thing that ends up in a log or a
 * backup file for nothing.
 *
 * The last two arguments carry the single key from before there was more than one
 * provider. It is moved to whichever provider the document names, because the key
 * that was there belonged to the one that was selected: retyping an API key because
 * the app changed shape is a needless way to lose one.
 *
 * It is used only when `apiKeys` is **absent altogether**, not when it is present
 * but missing this provider. The reason is who could have written the file: a
 * document that has `apiKeys` was written by a version that has per-provider keys,
 * and that version never writes `apiKey`. So an `apiKey` sitting next to a real
 * `apiKeys` is either hand-edited or left over, and honouring it could bring back a
 * key the user had already replaced — which is peggio che perderla, perche nulla
 * direbbe che era stata sostituita.
 */
function sanitizeKeys(
  value: unknown,
  selected: ProviderId,
  legacyKey: unknown,
): Partial<Record<ProviderId, string>> {
  const out: Partial<Record<ProviderId, string>> = {}
  if (isRecord(value)) {
    for (const [id, raw] of Object.entries(value)) {
      if (!isProviderId(id) || !providerSpec(id).needsKey) continue
      if (typeof raw !== 'string') continue
      const trimmed = raw.trim()
      if (!trimmed) continue
      out[id] = trimmed
    }
    return out
  }
  if (typeof legacyKey === 'string' && providerSpec(selected).needsKey) {
    const trimmed = legacyKey.trim()
    if (trimmed) out[selected] = trimmed
  }
  return out
}

/**
 * The app settings, from whatever was stored, checked.
 *
 * The app settings are the one thing this project reads from storage **without**
 * going through `normalizeDocument`, because they belong to the installation and not
 * to a workspace. That made them the one place where the checks in `sanitizeSettings`
 * never ran, and the consequences were not theoretical: a `provider` id from
 * IndexedDB went straight into the request path without ever passing
 * `isProviderId`, which is the check that stops a hand-edited value from becoming a
 * destination.
 *
 * So the same sanitization runs here, and the same function decides. A second
 * implementation of these rules is a second set of rules that will drift.
 */
export function sanitizeAppSettings(value: unknown): AppSettings {
  return splitSettings(sanitizeSettings(value)).app
}

function sanitizeSettings(value: unknown): Settings {
  const settings = cloneSettings()
  if (!isRecord(value)) return settings

  const defaults = isRecord(value.defaults) ? value.defaults : {}
  const provider = isProviderId(value.provider) ? value.provider : settings.provider
  return {
    baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : settings.baseUrl,
    useProxy: typeof value.useProxy === 'boolean' ? value.useProxy : settings.useProxy,
    defaultModel:
      typeof value.defaultModel === 'string' || value.defaultModel === null
        ? value.defaultModel
        : settings.defaultModel,
    defaults: {
      temperature: clamp(numberOr(defaults.temperature, settings.defaults.temperature), 0, 2),
      topP: clamp(numberOr(defaults.topP, settings.defaults.topP), 0, 1),
      maxTokens: Math.max(
        1,
        Math.trunc(numberOr(defaults.maxTokens, settings.defaults.maxTokens)),
      ),
      systemPrompt:
        typeof defaults.systemPrompt === 'string'
          ? defaults.systemPrompt
          : settings.defaults.systemPrompt,
    },
    contextTokenWarning: Math.max(
      1,
      Math.trunc(numberOr(value.contextTokenWarning, settings.contextTokenWarning)),
    ),
    theme: value.theme === 'light' ? 'light' : value.theme === 'dark' ? 'dark' : settings.theme,
    /*
     * L'aspetto si valida contro l'elenco degli aspetti, e non con una catena di
     * uguaglianze.
     *
     * Qui c'era `value.appearance === 'glass' ? 'glass' : 'default'`, che accettava due
     * valori e buttava via tutto il resto — **senza avvisare**. Quindi un aspetto nuovo
     * aggiunto al tipo e alla tendina si perdeva al primo ricaricamento, e non si
     * vedeva: la tendina semplicemente tornava a «Solid», e la scelta dell'utente era
     * sparita. Lo stesso vale per un valore scritto a mano in un file importato: qui
     * deve diventare il default, e basta.
     */
    appearance: isAppearanceName(value.appearance) ? value.appearance : settings.appearance,
    // Un id che non e nel catalogo non puo diventare una destinazione, quindi qui
    // si accetta solo un provider che l'app conosce. Senza, un file importato a
    // mano potrebbe far puntare le richieste dove vuole.
    provider,
    apiKeys: sanitizeKeys(value.apiKeys, provider, value.apiKey),
    baseUrlOverrides: sanitizeOverrides(value.baseUrlOverrides),
    streaming: typeof value.streaming === 'boolean' ? value.streaming : settings.streaming,
    queueConcurrency: clamp(Math.trunc(numberOr(value.queueConcurrency, settings.queueConcurrency)), 1, 4),
    modelLoadTimeoutMs: Math.max(
      1_000,
      Math.trunc(numberOr(value.modelLoadTimeoutMs, settings.modelLoadTimeoutMs)),
    ),
    firstByteTimeoutMs: Math.max(
      5_000,
      Math.trunc(numberOr(value.firstByteTimeoutMs, settings.firstByteTimeoutMs)),
    ),
    preloadOnTyping:
      typeof value.preloadOnTyping === 'boolean'
        ? value.preloadOnTyping
        : settings.preloadOnTyping,
    singleModelInMemory:
      typeof value.singleModelInMemory === 'boolean'
        ? value.singleModelInMemory
        : settings.singleModelInMemory,
    autoCompact:
      value.autoCompact === 'ask' || value.autoCompact === 'auto'
        ? value.autoCompact
        : settings.autoCompact,
    compactMaxTokens: Math.max(
      1,
      Math.trunc(numberOr(value.compactMaxTokens, settings.compactMaxTokens)),
    ),
    compactSystemPrompt:
      typeof value.compactSystemPrompt === 'string'
        ? value.compactSystemPrompt
        : settings.compactSystemPrompt,
  }
}

function edgeFromUnknown(value: unknown, nodeIds: Set<string>): AppEdge | null {
  if (!isRecord(value)) return null
  const { source, target } = value
  const kind = value.kind
  if (
    typeof source !== 'string' ||
    typeof target !== 'string' ||
    !nodeIds.has(source) ||
    !nodeIds.has(target) ||
    (kind !== 'run' && kind !== 'context' && kind !== 'system' && kind !== 'display')
  ) {
    return null
  }

  const handles: Record<EdgeKind, { source: string; target: string }> = {
    run: { source: 'out', target: 'in' },
    context: { source: 'context', target: 'context' },
    system: { source: 'out', target: 'system' },
    display: { source: 'out', target: 'in' },
    image: { source: 'out', target: 'image' },
    flow: { source: 'out', target: 'in' },
  }
  const handle = handles[kind]
  return {
    id: typeof value.id === 'string' && value.id ? value.id : nanoid(12),
    source,
    target,
    sourceHandle: typeof value.sourceHandle === 'string' ? value.sourceHandle : handle.source,
    targetHandle: typeof value.targetHandle === 'string' ? value.targetHandle : handle.target,
    kind,
    createdAt: numberOr(value.createdAt, 0),
  }
}

export function normalizeDocument(value: unknown, now = Date.now()): NormalizeResult {
  const source = isRecord(value) ? value : {}
  const rawNodes = Array.isArray(source.nodes) ? source.nodes : []
  const nodes: AppNode[] = []
  const nodeIds = new Set<string>()
  let droppedNodes = 0

  for (const rawNode of rawNodes) {
    const node = nodeFromUnknown(rawNode, numberOr(source.savedAt, now))
    if (!node || nodeIds.has(node.id)) {
      droppedNodes += 1
      continue
    }
    nodeIds.add(node.id)
    nodes.push(node)
  }

  const rawEdges = Array.isArray(source.edges) ? source.edges : []
  const edges: AppEdge[] = []
  const edgeIds = new Set<string>()
  let droppedEdges = 0
  for (const rawEdge of rawEdges) {
    const edge = edgeFromUnknown(rawEdge, nodeIds)
    if (!edge || edgeIds.has(edge.id)) {
      droppedEdges += 1
      continue
    }
    edgeIds.add(edge.id)
    edges.push(edge)
  }

  let repairedResponses = 0
  for (const node of nodes) {
    if (node.type !== 'response') continue
    if (node.data.status === 'queued' || node.data.status === 'streaming') {
      node.data.status = 'interrupted'
      node.data.stats.finishedAt = now
    }

    const runEdges = edges.filter(
      (edge) => edge.kind === 'run' && edge.target === node.id,
    )
    if (runEdges.length === 0) {
      const parent = nodes.find(
        (candidate) =>
          candidate.id === node.data.parentPromptId && candidate.data.kind === 'prompt',
      )
      if (parent) {
        edges.push({
          id: nanoid(12),
          source: parent.id,
          target: node.id,
          sourceHandle: 'out',
          targetHandle: 'in',
          kind: 'run',
          createdAt: node.data.stats.startedAt,
          label: `run #${node.data.runIndex + 1}`,
        })
      } else {
        node.data.status = 'error'
        node.data.error = appError(
          'IMPORT_INVALID',
          'Original prompt missing',
          { hint: 'This response can be retained, but it cannot be retried until reattached.' },
        )
      }
      repairedResponses += 1
    } else {
      const [primary, ...duplicates] = runEdges
      if (primary) {
        primary.source = node.data.parentPromptId || primary.source
      }
      for (const duplicate of duplicates) {
        const index = edges.indexOf(duplicate)
        if (index >= 0) edges.splice(index, 1)
        droppedEdges += 1
      }
    }
  }

  for (const promptNode of nodes) {
    if (promptNode.type !== 'prompt') continue
    const children = edges
      .filter((edge) => edge.kind === 'run' && edge.source === promptNode.id)
      .map((edge) => nodes.find((node) => node.id === edge.target))
      .filter((node): node is ResponseNode => node?.data.kind === 'response')
    const derived = children.reduce(
      (maximum, child) => Math.max(maximum, child.data.runIndex + 1),
      0,
    )
    promptNode.data.runCount = Math.max(promptNode.data.runCount, derived)
  }

  for (const node of nodes) {
    if (node.data.kind === 'set') {
      node.data.memberIds = [...new Set(node.data.memberIds)].filter(
        (id) => nodeIds.has(id) && id !== node.id,
      )
    } else if (node.data.kind === 'output') {
      if (node.data.sourceNodeIds) {
        node.data.sourceNodeIds = [...new Set(node.data.sourceNodeIds)].filter(
          (id) => nodeIds.has(id) && id !== node.id,
        )
      }
    } else if (node.data.kind === 'group') {
      /*
       * Come per `set` e `output`: si tolgono i doppioni e gli id che non esistono piu'.
       *
       * Il caso reale e' un altro tab che ha cancellato un nodo mentre questo aveva la
       * copia vecchia in memoria. Senza questo filtro, la cornice continuerebbe a
       * contare quel nodo nella sua etichetta e a provare a spostarlo — e `expandGroupMove`
       * semplicemente lo salterebbe, quindi il numero sulla cornice direbbe «4 nodi» per
       * tre, senza che nulla sembri rotto.
       */
      node.data.members = [...new Set(node.data.members)].filter(
        (id) => nodeIds.has(id) && id !== node.id,
      )
    } else if (node.data.kind === 'summary') {
      node.data.coveredNodeIds = [...new Set(node.data.coveredNodeIds)].filter((id) =>
        nodeIds.has(id),
      )
      if (node.data.status === 'queued' || node.data.status === 'streaming') {
        node.data.status = 'interrupted'
        node.data.stats.finishedAt = now
      }
    }
  }

  const viewportSource = isRecord(source.viewport) ? source.viewport : {}
  const result: WorkspaceDocument = {
    docVersion: DOC_VERSION,
    savedAt: numberOr(source.savedAt, now),
    name: typeof source.name === 'string' && source.name.trim() ? source.name : 'Untitled workspace',
    nodes,
    edges,
    settings: sanitizeSettings(source.settings),
    viewport: {
      x: numberOr(viewportSource.x, 0),
      y: numberOr(viewportSource.y, 0),
      zoom: clamp(numberOr(viewportSource.zoom, 1), 0.2, 2.5),
    },
  }

  return {
    document: result,
    droppedNodes,
    droppedEdges,
    repairedResponses,
  }
}

export function serializeDocument(document: WorkspaceDocument): WorkspaceDocument {
  const nodes = document.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: { x: node.position.x, y: node.position.y },
    ...(node.width ? { width: node.width } : {}),
    ...(node.height ? { height: node.height } : {}),
    data: node.data,
    ...(node.style ? { style: node.style } : {}),
  })) as AppNode[]

  const edges = document.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    kind: edge.kind,
    createdAt: edge.createdAt,
  })) as AppEdge[]

  return {
    docVersion: DOC_VERSION,
    savedAt: Date.now(),
    name: document.name,
    nodes,
    edges,
    settings: {
      defaults: { ...document.settings.defaults },
      contextTokenWarning: document.settings.contextTokenWarning,
    } as Settings,
    viewport: { ...document.viewport },
  }
}

export function saveNow(document: WorkspaceDocument): SaveResult {
  const serialized = serializeDocument(document)
  const json = JSON.stringify(serialized)
  const bytes = new Blob([json]).size
  try {
    localStorage.setItem(WORKSPACE_KEY, json)
    return {
      ok: true,
      bytes,
      ...(bytes > STORAGE_WARNING_BYTES
        ? {
            warning:
              'This workspace is over 3 MB. Export it and remove old nodes to avoid browser storage limits.',
          }
        : {}),
    }
  } catch (error: unknown) {
    const quota =
      error instanceof DOMException &&
      (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
    return {
      ok: false,
      bytes,
      error: appError(
        quota ? 'STORAGE_FULL' : 'INTERNAL',
        quota ? 'Browser storage is full.' : 'The workspace could not be saved.',
        {
          ...(quota
            ? { hint: 'Export your workspace and delete old nodes to free space.' }
            : {}),
          raw: error instanceof Error ? error.message : String(error),
        },
      ),
    }
  }
}

let saveTimer: number | undefined

export function scheduleSave(getDocument: () => WorkspaceDocument): () => void {
  if (saveTimer !== undefined) globalThis.clearTimeout(saveTimer)
  saveTimer = globalThis.setTimeout(() => {
    saveTimer = undefined
    saveNow(getDocument())
  }, DEBOUNCE_MS)
  return () => {
    if (saveTimer !== undefined) {
      globalThis.clearTimeout(saveTimer)
      saveTimer = undefined
    }
  }
}

export function cancelScheduledSave(): void {
  if (saveTimer !== undefined) {
    globalThis.clearTimeout(saveTimer)
    saveTimer = undefined
  }
}

export function load(): LoadResult {
  const empty = createEmptyDocument()
  let raw: string | null
  try {
    raw = localStorage.getItem(WORKSPACE_KEY)
  } catch {
    return {
      doc: empty,
      droppedNodes: 0,
      droppedEdges: 0,
      repairedResponses: 0,
      problem: appError('INTERNAL', 'Browser storage is unavailable in this context.'),
    }
  }
  if (!raw) return { doc: empty, droppedNodes: 0, droppedEdges: 0, repairedResponses: 0 }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    try {
      localStorage.setItem(CORRUPT_KEY, raw)
    } catch {
      // The original workspace remains untouched when a backup cannot be written.
    }
    return {
      doc: empty,
      droppedNodes: 0,
      droppedEdges: 0,
      repairedResponses: 0,
      problem: appError('IMPORT_INVALID', 'Saved workspace data is corrupt.', {
        hint: 'A fresh workspace was opened. A backup of the corrupt data was kept when storage allowed.',
      }),
    }
  }

  const version = isRecord(parsed) ? parsed.docVersion : undefined
  if (typeof version === 'number' && version > DOC_VERSION) {
    return {
      doc: empty,
      droppedNodes: 0,
      droppedEdges: 0,
      repairedResponses: 0,
      problem: appError(
        'IMPORT_INVALID',
        'This workspace was saved by a newer version of NCHAT.',
        { hint: 'Update NCHAT before opening this workspace.' },
      ),
    }
  }

  const normalized = normalizeDocument(migrate(parsed))
  return {
    doc: normalized.document,
    droppedNodes: normalized.droppedNodes,
    droppedEdges: normalized.droppedEdges,
    repairedResponses: normalized.repairedResponses,
  }
}

export function parseImport(raw: string): WorkspaceDocument {
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    throw appError('IMPORT_INVALID', "That file isn't a valid NCHAT workspace.", {
      hint: 'Choose a JSON file exported by NCHAT.',
    })
  }

  const version = isRecord(value) ? value.docVersion : undefined
  if (typeof version === 'number' && version > DOC_VERSION) {
    throw appError('IMPORT_INVALID', 'This file was created by a newer NCHAT version.', {
      hint: 'Update NCHAT, then import the file again.',
    })
  }

  const migrated = migrate(value)
  const parsed = WorkspaceSchema.safeParse(migrated)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'document'}: ${issue.message}`)
      .join('\n')
    throw appError('IMPORT_INVALID', "That file isn't a valid NCHAT workspace.", {
      hint: 'Fix the listed fields or choose a file exported by this version.',
      raw: issues.slice(0, 2_000),
    })
  }
  const normalized = normalizeDocument(parsed.data)
  if (normalized.droppedNodes > 0 || normalized.droppedEdges > 0) {
    throw appError('IMPORT_INVALID', "That file isn't a valid NCHAT workspace.", {
      hint: 'The file contains duplicate ids, dangling edges, or invalid node records.',
      raw: [
        normalized.droppedNodes ? `${normalized.droppedNodes} invalid nodes` : '',
        normalized.droppedEdges ? `${normalized.droppedEdges} invalid edges` : '',
      ]
        .filter(Boolean)
        .join('; '),
    })
  }
  return normalized.document
}

export function saveBackup(document: WorkspaceDocument): void {
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(serializeDocument(document)))
  } catch {
    // Backup failure must not block the primary user action.
  }
}

export function loadUiPreferences(): UiPreferences {
  try {
    const raw = localStorage.getItem(UI_KEY)
    if (!raw) return { ...DEFAULT_UI_PREFERENCES }
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return { ...DEFAULT_UI_PREFERENCES }
    return {
      developerMode:
        typeof parsed.developerMode === 'boolean'
          ? parsed.developerMode
          : DEFAULT_UI_PREFERENCES.developerMode,
      inspectorOpen:
        typeof parsed.inspectorOpen === 'boolean'
          ? parsed.inspectorOpen
          : DEFAULT_UI_PREFERENCES.inspectorOpen,
      minimapOpen:
        typeof parsed.minimapOpen === 'boolean'
          ? parsed.minimapOpen
          : DEFAULT_UI_PREFERENCES.minimapOpen,
      // 'bezier' was the old name for the curve React Flow 12 calls 'default',
      // so a stored 'bezier' must keep meaning the curve, not fall to smoothstep.
      edgeStyle: parsed.edgeStyle === 'smoothstep' ? 'smoothstep' : 'default',
      reopenTabsOnStartup:
        typeof parsed.reopenTabsOnStartup === 'boolean'
          ? parsed.reopenTabsOnStartup
          : DEFAULT_UI_PREFERENCES.reopenTabsOnStartup,
      // Un fattore che arriva da fuori viene ripulito, non adottato: `uiScale: 40`
      // renderebbe l'app inutilizzabile, e senza un limite qui l'utente non avrebbe
      // piu' modo di tornare indietro senza cancellare le preferenze a mano.
      uiScale: sanitizeUiScale(parsed.uiScale),
    }
  } catch {
    return { ...DEFAULT_UI_PREFERENCES }
  }
}

export function saveUiPreferences(preferences: UiPreferences): void {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(preferences))
  } catch {
    // UI preferences are optional.
  }
}

export function clearNCHATData(): void {
  const keys: string[] = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key?.startsWith('nchat.')) keys.push(key)
  }
  for (const key of keys) localStorage.removeItem(key)
}

/**
 * I consumi letti da `localStorage`, o `[]`.
 *
 * In `localStorage` e non nel documento perche' la spesa e della persona e non del
 * grafo: dividerla per workspace nasconderebbe proprio il numero per cui si apre la
 * schermata. E in `localStorage` e non in IndexedDB perche' sono numeri piccoli e
 * l'app li mostra subito all'avvio, senza aspettare che il database sia pronto.
 *
 * Ogni record passa da `UsageRecordSchema`, e un record che non lo supera viene
 * scartato invece di far fallire tutto: la lista dei consumi e' un registro accessorio,
 * e un file corrotto non deve impedire all'app di aprire. Meglio perdere una riga
 * che perdere la schermata.
 */
export function loadUsageRecords(): UsageRecord[] | null {
  try {
    const raw = localStorage.getItem(USAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry) => {
      const result = UsageRecordSchema.safeParse(entry)
      return result.success ? [result.data] : []
    })
  } catch {
    return []
  }
}

export function saveUsageRecords(records: UsageRecord[]): void {
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(records))
  } catch {
    // I consumi sono un registro: perderne la persistenza non deve fermare la corsa.
  }
}
