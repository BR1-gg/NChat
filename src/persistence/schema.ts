import { z } from 'zod'
import { PROVIDER_IDS, type ProviderId } from '../logic/providers'
import { createDefaultRequestSnapshot } from '../types/document'
import { APPEARANCE_NAMES, type AppearanceName } from '../types/settings'

const finite = z.number().finite()

const PositionSchema = z.object({ x: finite, y: finite })

const GenerationParamsSchema = z.object({
  temperature: finite.min(0).max(2).nullable().default(null),
  topP: finite.min(0).max(1).nullable().default(null),
  maxTokens: finite.int().positive().nullable().default(null),
  stop: z.array(z.string()).nullable().default(null),
})

const AppErrorSchema = z.object({
  kind: z.enum([
    'OFFLINE',
    'CORS_BLOCKED',
    'TIMEOUT',
    'MODEL_NOT_LOADED',
    'CONTEXT_OVERFLOW',
    'RATE_LIMIT',
    'SERVER_ERROR',
    'BAD_RESPONSE',
    'GRAPH_CYCLE',
    'CONTEXT_NOT_READY',
    'EMPTY_PROMPT',
    'NO_MODEL',
    'INVALID_CONNECTION',
    'IMPORT_INVALID',
    'ABORTED',
    'STORAGE_FULL',
    'INTERNAL',
    'NOT_FOUND',
  ]),
  message: z.string().min(1),
  hint: z.string().optional(),
  status: finite.int().optional(),
  raw: z.string().optional(),
})

const StatusSchema = z.enum(['queued', 'streaming', 'done', 'error', 'aborted', 'interrupted'])

/**
 * Blender-style collapse, available on every node kind. Declared once and
 * spread into each data schema so a new node kind cannot forget it.
 */
const CollapsedField = { collapsed: z.boolean().optional() }

const PromptDataSchema = z.object({
  kind: z.literal('prompt'),
  ...CollapsedField,
  text: z.string().default(''),
  params: GenerationParamsSchema.default({
    temperature: null,
    topP: null,
    maxTokens: null,
    stop: null,
  }),
  title: z.string().optional(),
  runCount: finite.int().nonnegative().default(0),
  lastRunAt: finite.optional(),
  // These two were missing, and a plain z.object *strips* what it does not know:
  // the Thinking toggle silently reset to its default every time a workspace was
  // reopened. A field that is not in the schema is a field that does not exist.
  thinking: z.boolean().optional(),
  concise: z.boolean().optional(),
})

const RequestSnapshotSchema = z.object({
  model: z.string().default(''),
  params: z.object({
    temperature: finite.min(0).max(2).default(0.7),
    topP: finite.min(0).max(1).default(1),
    maxTokens: finite.int().positive().nullable().default(1024),
    stop: z.array(z.string()).nullable().default(null),
  }),
  systemPrompt: z.string().default(''),
  messageCount: finite.int().nonnegative().default(0),
  estPromptTokens: finite.int().nonnegative().default(0),
})

const StatsSchema = z.object({
  startedAt: finite.default(0),
  finishedAt: finite.optional(),
  firstTokenMs: finite.nonnegative().optional(),
  durationMs: finite.nonnegative().optional(),
  promptTokens: finite.int().nonnegative().optional(),
  completionTokens: finite.int().nonnegative().optional(),
  totalTokens: finite.int().nonnegative().optional(),
  finishReason: z.enum(['stop', 'length', 'content_filter', 'unknown']).optional(),
})

const MessageContentSchema = z.union([
  z.string(),
  z.array(
    z.union([
      z.object({ type: z.literal('text'), text: z.string() }),
      z.object({ type: z.literal('image_url'), image_url: z.object({ url: z.string() }) }),
    ]),
  ),
])

const MessageSnapshotSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  // Not just a string: a run with an image stores the picture in the snapshot so
  // that "Retry same request" reproduces it. Declaring `z.string()` here made
  // every such workspace fail to parse, so it could never be opened again.
  content: MessageContentSchema,
})

const ResponseDataSchema = z.object({
  kind: z.literal('response'),
  ...CollapsedField,
  status: StatusSchema.default('interrupted'),
  text: z.string().default(''),
  reasoning: z.string().optional(),
  parentPromptId: z.string().default(''),
  runIndex: finite.int().nonnegative().default(0),
  promptSnapshot: z.string().default(''),
  requestSnapshot: RequestSnapshotSchema.default(createDefaultRequestSnapshot()),
  messagesSnapshot: z.array(MessageSnapshotSchema).optional(),
  /*
   * La traccia delle note. I campi sono chiusi e obbligatori dentro ogni voce perche' una
   * traccia con un buco e' peggio di nessuna traccia: se un id arriva ma il titolo no, la
   * riga non si puo' mostrare e il conteggio non torna, e il dubbio dell'utente — «le note
   * ci sono? quante?» — riceve una risposta mezza bugiarda invece di niente.
   */
  knowledgeUsed: z
    .object({
      entries: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          hub: z.string().nullable(),
          via: z.enum(['retrieved', 'node']),
        }),
      ),
    })
    .optional(),
  stats: StatsSchema.default({ startedAt: 0 }),
  error: AppErrorSchema.optional(),
  title: z.string().optional(),
})

const SystemDataSchema = z.object({
  kind: z.literal('system'),
  ...CollapsedField,
  text: z.string().default(''),
  title: z.string().optional(),
})

const NoteDataSchema = z.object({
  kind: z.literal('note'),
  ...CollapsedField,
  text: z.string().default(''),
  color: z.enum(['default', 'amber', 'sky', 'rose']).optional(),
})

const SetDataSchema = z.object({
  kind: z.literal('set'),
  ...CollapsedField,
  title: z.string().default('Set'),
  memberIds: z.array(z.string()).default([]),
  pick: z.enum(['latest-done', 'all-done']).default('latest-done'),
  format: z.enum(['plain', 'sections', 'numbered', 'json', 'llm-synthesis']).default('plain'),
  includePromptText: z.boolean().default(true),
  synthesis: z
    .object({
      text: z.string(),
      status: StatusSchema,
      stats: StatsSchema.optional(),
      error: AppErrorSchema.optional(),
    })
    .optional(),
  color: z.string().default('#8b5cf6'),
})

const OutputDataSchema = z.object({
  kind: z.literal('output'),
  ...CollapsedField,
  text: z.string().default(''),
  title: z.string().optional(),
  sourceNodeIds: z.array(z.string()).optional(),
  format: z.enum(['plain', 'sections', 'numbered', 'json', 'llm-synthesis']).optional(),
  includePromptText: z.boolean().optional(),
  synthesis: z
    .object({
      text: z.string(),
      status: StatusSchema,
      stats: StatsSchema.optional(),
      error: AppErrorSchema.optional(),
    })
    .optional(),
})

/*
 * Il gruppo solo visivo.
 *
 * `members` e `title` sopravvivono al salvataggio, il colore viene ripulito: una lista
 * **chiusa**, non una stringa. Il motivo e' che `color` arriva da un file su disco e finisce
 * in uno stile; accettare qualunque stringa significherebbe fidarsi del file, e un valore
 * assurdo — o voluto — finirebbe nel foglio di stile di un altro utente. Il `catch`
 * ricade su `default`, che vuol dire «il colore del tema», e quindi un file rovinato fa
 * perdere una scelta estetica e non il gruppo.
 */
const GroupColorSchema = z
  .enum(['default', 'amber', 'sky', 'rose', 'green', 'violet'])
  .catch('default')
  .default('default')

const GroupDataSchema = z.object({
  kind: z.literal('group'),
  ...CollapsedField,
  title: z.string().default(''),
  color: GroupColorSchema,
  members: z.array(z.string()).default([]),
})

const SummaryDataSchema = z.object({  kind: z.literal('summary'),
  ...CollapsedField,
  text: z.string().default(''),
  status: StatusSchema.default('interrupted'),
  instructions: z.string().optional(),
  coveredNodeIds: z.array(z.string()).default([]),
  coveredMessageCount: finite.int().nonnegative().default(0),
  tokensBefore: finite.int().nonnegative().default(0),
  tokensAfter: finite.int().nonnegative().default(0),
  coverageHash: z.string().default(''),
  requestSnapshot: RequestSnapshotSchema.default(createDefaultRequestSnapshot()),
  messagesSnapshot: z.array(MessageSnapshotSchema).optional(),
  /*
   * La traccia delle note. I campi sono chiusi e obbligatori dentro ogni voce perche' una
   * traccia con un buco e' peggio di nessuna traccia: se un id arriva ma il titolo no, la
   * riga non si puo' mostrare e il conteggio non torna, e il dubbio dell'utente — «le note
   * ci sono? quante?» — riceve una risposta mezza bugiarda invece di niente.
   */
  knowledgeUsed: z
    .object({
      entries: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          hub: z.string().nullable(),
          via: z.enum(['retrieved', 'node']),
        }),
      ),
    })
    .optional(),
  stats: StatsSchema.default({ startedAt: 0 }),
  error: AppErrorSchema.optional(),
  title: z.string().optional(),
})

const ImageDataSchema = z.object({
  kind: z.literal('image'),
  ...CollapsedField,
  name: z.string().default(''),
  mediaType: z.string().default(''),
  isVideo: z.boolean().default(false),
  src: z.string().default(''),
  posterSrc: z.string().optional(),
  width: finite.int().nonnegative().default(0),
  height: finite.int().nonnegative().default(0),
  sizeBytes: finite.int().nonnegative().default(0),
  caption: z.string().optional(),
  title: z.string().optional(),
})

const FileDataSchema = z.object({
  kind: z.literal('file'),
  ...CollapsedField,
  name: z.string().default(''),
  format: z.string().default('text'),
  sizeBytes: finite.int().nonnegative().default(0),
  text: z.string().default(''),
  truncated: z.boolean().default(false),
  error: z.string().optional(),
  title: z.string().optional(),
})

const FolderDataSchema = z.object({
  kind: z.literal('folder'),
  ...CollapsedField,
  name: z.string().default(''),
  fileCount: finite.int().nonnegative().default(0),
  totalBytes: finite.int().nonnegative().default(0),
  text: z.string().default(''),
  truncated: z.boolean().default(false),
  refused: z.array(z.object({ name: z.string(), reason: z.string() })).default([]),
  error: z.string().optional(),
  title: z.string().optional(),
})

const BrainRunSchema = z.object({
  status: z.enum(['idle', 'running', 'done', 'stopped', 'failed']).default('idle'),
  total: finite.int().nonnegative().default(0),
  done: finite.int().nonnegative().default(0),
  startedAt: finite.optional(),
  finishedAt: finite.optional(),
  message: z.string().optional(),
  log: z
    .array(
      z.object({
        path: z.string(),
        status: z.enum(['pending', 'written', 'renamed', 'skipped', 'failed', 'refused']),
        writtenAs: z.string().optional(),
        bytes: finite.int().nonnegative().optional(),
        tokens: finite.int().nonnegative().optional(),
        reason: z.string().optional(),
        durationMs: finite.nonnegative().optional(),
      }),
    )
    .default([]),
  // The copies that make a run reversible. They are kept in the document on
  // purpose: a handle is not serialisable, but a copy of the text is, and losing
  // it would mean losing the only way to undo a write to the disk.
  undo: z
    .array(
      z.object({
        path: z.string(),
        existed: z.boolean(),
        previousText: z.string().nullable(),
        previousSize: finite.int().nonnegative().nullable(),
      }),
    )
    .default([]),
})

const BrainDataSchema = z.object({
  kind: z.literal('brain'),
  ...CollapsedField,
  instruction: z.string().default(''),
  model: z.string().default(''),
  onExisting: z.enum(['rename', 'overwrite', 'skip']).default('rename'),
  run: BrainRunSchema.default({ status: 'idle', total: 0, done: 0, log: [], undo: [] }),
  inputPath: z.string().optional(),
  outputPath: z.string().optional(),
  error: z.string().optional(),
  title: z.string().optional(),
})

/**
 * Il nodo che pesca dall'archivio.
 *
 * `hubId` e' `null` e non facoltativo, perche' «non ho ancora scelto un centro» e «non c'e'
 * un centro salvato» sono la **stessa** risposta e devono restare tali dopo un salvataggio:
 * con un campo facoltativo, un documento senza la chiave aprirebbe come «nessun centro» e uno
 * che ce l'ha come «scelto», e non si saprebbe quale delle due sarebbe diventata alla
 * riapertura.
 *
 * `entryIds` e' una lista di **id**, non di testi, ed e' il punto. Gli id continuano a valere
 * mentre la nota viene riscritta o rinominata; un testo copiato dentro il nodo diventerebbe
 * una seconda copia che invecchia da sola e su cui nessuno avvisa quando non somiglia piu' a
 * quella vera. Gli id che non portano piu' a niente vengono saltati in lettura e non fanno
 * fallire nulla — vedi `resolveKnowledgePick`.
 */
const KnowledgeDataSchema = z.object({
  kind: z.literal('knowledge'),
  ...CollapsedField,
  hubId: z.string().nullable().default(null),
  /*
   * `auto` e' un booleano semplice e non un valore di `hubId`, perche' i due non sono la
   * stessa cosa accettata in modi diversi: sono due modi diversi di scegliere le note. Con un
   * valore sentinella in `hubId` («__auto__») il file salvato avrebbe contenuto una stringa
   * magica che nessun altro pezzo dell'applicazione conosce, e che nessun typecheck avrebbe
   * potuto segnalare come sbagliata.
   */
  auto: z.boolean().default(false),
  includeNotes: z.boolean().default(false),
  entryIds: z.array(z.string()).default([]),
  includeLinked: z.boolean().default(false),
  title: z.string().optional(),
})

const NodeDataSchema = z.discriminatedUnion('kind', [
  PromptDataSchema,
  ResponseDataSchema,
  SystemDataSchema,
  NoteDataSchema,
  SetDataSchema,
  OutputDataSchema,
  SummaryDataSchema,
  ImageDataSchema,
  FileDataSchema,
  FolderDataSchema,
  BrainDataSchema,
  KnowledgeDataSchema,
  GroupDataSchema,
])

export const NodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['prompt', 'response', 'system', 'note', 'set', 'output', 'summary', 'image', 'file', 'folder', 'brain', 'knowledge', 'group']),
  position: PositionSchema,
  width: finite.positive().optional(),
  height: finite.positive().optional(),
  data: NodeDataSchema,
  style: z.record(z.string(), z.unknown()).optional(),
})

export const EdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().nullable().optional(),
  targetHandle: z.string().nullable().optional(),
  kind: z.enum(['run', 'context', 'system', 'display', 'image', 'flow']),
  createdAt: finite.default(0),
})

const DefaultsSchema = z
  .object({
    temperature: finite.min(0).max(2),
    topP: finite.min(0).max(1),
    maxTokens: finite.int().positive(),
    systemPrompt: z.string(),
  })
  .partial()

export const SettingsSchema = z
  .object({
    baseUrl: z.string(),
    useProxy: z.boolean(),
    defaultModel: z.string().nullable(),
    defaults: DefaultsSchema.optional(),
    contextTokenWarning: finite.int().positive(),
    theme: z.enum(['dark', 'light']),
    // L'elenco viene dal tipo e non e' scritto qui: una copia fissa accetterebbe
    // due valori e rifiuterebbe gli altri quattro, e un file salvato da questa
    // versione diventerebbe illeggibile per una piu' vecchia che si riapre.
    appearance: z.enum(APPEARANCE_NAMES as [AppearanceName, ...AppearanceName[]]).optional(),
    provider: z.enum(PROVIDER_IDS as [ProviderId, ...ProviderId[]]).optional(),
    apiKeys: z.record(z.string(), z.string()).optional(),
    /**
     * The single key from before there was more than one provider.
     *
     * Kept in the schema so an old file is not rejected wholesale, and moved to the
     * right provider in `sanitizeSettings`. Dropping it here instead would fail the
     * whole document because of one field, which is a much worse answer than
     * quietly moving the key where it belongs.
     */
    apiKey: z.string().optional(),
    baseUrlOverrides: z.record(z.string(), z.string()).optional(),
    streaming: z.boolean(),
    queueConcurrency: finite.int().min(1).max(4).optional(),
    modelLoadTimeoutMs: finite.int().positive().optional(),
    firstByteTimeoutMs: finite.int().positive().optional(),
    preloadOnTyping: z.boolean().optional(),
    singleModelInMemory: z.boolean().optional(),
    autoCompact: z.enum(['off', 'ask', 'auto']).optional(),
    compactMaxTokens: finite.int().positive().optional(),
    compactSystemPrompt: z.string().optional(),
  })
  .partial()

export const ViewportSchema = z
  .object({ x: finite, y: finite, zoom: finite.positive() })
  .partial()

export const WorkspaceSchema = z.object({
  docVersion: z.number().int().min(1).default(1),
  savedAt: finite.default(0),
  name: z.string().default('Untitled workspace'),
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
  settings: SettingsSchema.default({}),
  viewport: ViewportSchema.default({ x: 0, y: 0, zoom: 1 }),
})

/**
 * Una corsa che ha consumato token, e quanto sono costati.
 *
 * `tokensKnown` e il campo che rende questo schema onesto. Un provider che non manda
 * `usage` nella risposta produce zero token, e senza questo flag finirebbe sommato
 * come se avesse risposto gratis: la schermata dei consumi direbbe «$0.00» e
 * l'utente prenderebbe per vero un numero che non e' stato misurato. Con il flag, un
 * totale senza quei record si sa che e' parziale, e puo' dirlo.
 *
 * Il prezzo **non** e salvato. E' conoscenza che invecchia, e un costo congelato a
 * quando e avvenuta la corsa continuerebbe a mostrare il vecchio listino anche dopo
 * che il provider l'ha cambiato: il totale riprodotto dal costo di oggi e' quello che
 * l'utente puo confrontare con la fattura.
 */
export const UsageRecordSchema = z.object({
  id: z.string(),
  /** Epoch in millisecondi, non una data ISO: e' un orologio, non un documento. */
  at: finite.int().nonnegative(),
  /*
   * L'elenco dei provider viene da `PROVIDER_SPECS`, che e' l'unico posto dove sono
   * scritti. Scriverli anche qui li avrebbe duplicati in due file che possono
   * divergere senza che nessuno se ne accorga: si aggiunge un provider al catalogo,
   * si salva un documento, e la validazione **rifiuta** il file perche' qui quell'id
   * non c'era. Il sintomo sarebbe un provider che funziona finche' non si riavvia.
   */
  provider: z.enum(PROVIDER_IDS as [ProviderId, ...ProviderId[]]),
  model: z.string(),
  promptTokens: finite.int().nonnegative(),
  completionTokens: finite.int().nonnegative(),
  totalTokens: finite.int().nonnegative(),
  tokensKnown: z.boolean().default(true),
  workspaceName: z.string().optional(),
})

export type UsageRecord = z.infer<typeof UsageRecordSchema>
