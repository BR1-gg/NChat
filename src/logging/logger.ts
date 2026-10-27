/**
 * Il registro degli errori.
 *
 * Esiste perche «non funziona» non e un messaggio d'errore. Un errore del provider
 * e un'eccezione dell'app hanno due forme diverse, e senza un posto dove leggerle
 * si confonde l'una con l'altra: si riavvia, si cambia una chiave, si tocca un
 * timeout, e non si scopre mai quale delle due fosse.
 *
 * Tre scelte che contano, e che sono tutte conseguenze di qualcosa:
 *
 * - **La chiave non ci entra mai.** Il log finisce in un file che l'utente
 *   incolla per farlo leggere, e una chiave in quel file sarebbe un danno che
 *   nessuno puo piu annullare. `redact` e l'unico posto che decide cosa esce, e
 *   ogni valore passa di li.
 * - **Un anello, non una lista.** Il registro non cresce per sempre: un loop che
 *   sbaglia mille volte al secondo deve riempire la memoria una volta sola, non
 *   far cadere la scheda che lo sta scrivendo.
 * - **Sopravvive al riavvio.** L'errore che ti interessa e spesso quello che ha
 *   fatto cadere la pagina, e un registro in memoria muore con la pagina. Gli
 *   ultimi duecento finiscono in `localStorage` e tornano all'avvio, marcati come
 *   provenienti dalla sessione prima: altrimenti sembrerebbero appena successi.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * Da dove viene la voce.
 *
 * `provider` e cio che ha risposto un servizio, `app` e cio che e successo dentro
 * l'applicazione. tenerli distinti e il punto: sono problemi opposti, e un utente
 * che li confonde perde tempo a riavviare un server invece che a correggere una
 * condizione.
 */
export type LogSource = 'provider' | 'app' | 'llm' | 'persistence' | 'proxy'

export interface LogEntry {
  id: number
  at: number
  level: LogLevel
  source: LogSource
  /** Una riga: cosa e successo, in italiano, leggibile. */
  message: string
  /** Dettagli: stato HTTP, provider, endpoint, durata. Mai una chiave. */
  detail?: Record<string, unknown>
  /** True se viene dalla sessione precedente, cioe da prima di un riavvio. */
  fromPreviousSession?: boolean
}

const RING_LIMIT = 500
const PERSIST_KEY = 'nchat.log.v1'
const PERSIST_LIMIT = 200
const PERSIST_DEBOUNCE_MS = 800
/** Oltre questo, un valore viene tagliato: i body JSON di un provider sono enormi. */
const MAX_VALUE_CHARS = 400

let nextId = 1
let entries: LogEntry[] = []
const listeners = new Set<() => void>()
let persistTimer: number | undefined

/**
 * Cancella quello che sembra una credenziale, ovunque passi.
 *
 * Non e una difesa contro un attaccante: e una difesa contro **me**, che potrei
 * registrare per disattenzione un valore che viene da una richiesta. Per quello
 * basta togliere i pattern noti e **non registrare mai il valore della chiave**.
 */
export function redact(value: string): string {
  return value
    /*
     * Il separatore e **- o _**, non solo `_`: le chiavi OpenAI sono `sk-` con il
     * trattino, e una regex che accettava solo l'underscore le lasciava passare.
     * Le chiavi vere sono lunghe e finivano coperte dalla regola sotto, ma e una
     * coperta per caso, non una garanzia — e qui conta la garanzia.
     */
    .replace(/\b(nvapi|sk|ghp|gho|ghu|ghs|ghr|xai|api)[-_][A-Za-z0-9_-]{8,}/g, '[chiave rimossa]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{10,}/g, '[chiave rimossa]')
    // Qualsiasi cosa dopo "Bearer", anche se non somiglia a nessuna chiave nota.
    .replace(/(bearer\s+)[A-Za-z0-9._-]{8,}/gi, '$1[chiave rimossa]')
    // Una stringa lunga che sembra una chiave, perche non sappiamo come si chiama.
    .replace(/[A-Za-z0-9_-]{40,}/g, '[valore lungo omesso]')
}

function sanitizeDetail(detail: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!detail) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(detail)) {
    // Il nome del campo e la parte piu pericolosa: `apiKey` nel dettaglio
    // significa la chiave nel log, e nessuna regex sulla chiave lo fermerebbe.
    if (/key|token|secret|password|authorization|cookie/i.test(key)) {
      out[key] = '[non registrato]'
      continue
    }
    if (typeof value === 'string') {
      out[key] = value.length > MAX_VALUE_CHARS
        ? `${redact(value.slice(0, MAX_VALUE_CHARS))}… (${value.length} caratteri)`
        : redact(value)
      continue
    }
    if (value === null || typeof value !== 'object') {
      out[key] = value
      continue
    }
    // Un oggetto annidato viene serializzato in testo e poi passato da redact,
    // perche un body di provider puo contenere qualunque cosa.
    let text: string
    try {
      text = JSON.stringify(value)
    } catch {
      text = String(value)
    }
    out[key] = text.length > MAX_VALUE_CHARS
      ? `${redact(text.slice(0, MAX_VALUE_CHARS))}… (${text.length} caratteri)`
      : redact(text)
  }
  return out
}

function emit(entry: LogEntry): void {
  entries.push(entry)
  if (entries.length > RING_LIMIT) entries = entries.slice(-RING_LIMIT)
  for (const listener of listeners) listener()
  schedulePersist()
}

function schedulePersist(): void {
  if (persistTimer !== undefined) globalThis.clearTimeout(persistTimer)
  persistTimer = globalThis.setTimeout(() => {
    persistTimer = undefined
    try {
      localStorage.setItem(PERSIST_KEY, JSON.stringify(entries.slice(-PERSIST_LIMIT)))
    } catch {
      // Se non si puo scrivere, si tiene in memoria: un log che sparisce e male,
      // ma non e un motivo per far fallire quello che stiamo registrando.
    }
  }, PERSIST_DEBOUNCE_MS)
}

function write(level: LogLevel, source: LogSource, message: string, detail?: Record<string, unknown>): void {
  const entry: LogEntry = {
    id: nextId++,
    at: Date.now(),
    level,
    source,
    message: redact(message),
    ...(detail ? { detail: sanitizeDetail(detail) } : {}),
  }
  emit(entry)
  // Anche in console: chi sta con gli strumenti per sviluppatore aperti continua
  // a trovarli li, e il log non e un posto alternativo, e quello buono.
  const line = `[${source}] ${message}`
  if (level === 'error') console.error(line, detail ?? '')
  else if (level === 'warn') console.warn(line, detail ?? '')
  else if (level === 'debug') console.debug(line, detail ?? '')
  else console.info(line, detail ?? '')
}

export const log = {
  debug: (source: LogSource, message: string, detail?: Record<string, unknown>) =>
    write('debug', source, message, detail),
  info: (source: LogSource, message: string, detail?: Record<string, unknown>) =>
    write('info', source, message, detail),
  warn: (source: LogSource, message: string, detail?: Record<string, unknown>) =>
    write('warn', source, message, detail),
  error: (source: LogSource, message: string, detail?: Record<string, unknown>) =>
    write('error', source, message, detail),
}

/** Tutto quello che c e, dal piu recente. */
export function logEntries(): LogEntry[] {
  return entries
}

export function clearLog(): void {
  entries = []
  for (const listener of listeners) listener()
  try {
    localStorage.removeItem(PERSIST_KEY)
  } catch {
    /* senza localStorage non c e niente da togliere */
  }
}

export function subscribeLog(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Rimette dentro quello che era rimasto dall'ultima sessione.
 *
 * Va chiamata una volta, all'avvio, e prima di ogni altra scrittura: altrimenti le
 * voci precedenti verrebbero sovrascritte da un `setItem` con l'anello ancora
 * vuoto — che e il modo piu veloce per perdere esattamente il log che serviva.
 */
export function restoreLog(): number {
  let restored = 0
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        entries = parsed
          .filter(
            (entry): entry is LogEntry =>
              typeof entry === 'object' &&
              entry !== null &&
              typeof (entry as LogEntry).message === 'string',
          )
          .map((entry) => ({ ...entry, fromPreviousSession: true }))
        restored = entries.length
        // Il log della sessione nuova parte dopo quello vecchio.
        nextId = entries.reduce((max, entry) => Math.max(max, entry.id), 0) + 1
      }
    }
  } catch {
    entries = []
  }
  return restored
}

let globalHandlersInstalled = false

/**
 * Gli errori che nessuno ha scritto.
 *
 * Un'eccezione non gestita non finisce da nessuna parte: il toast non c'e, la
 * risposta non c'e, e l'unica traccia e una riga in console che hai gia chiuso.
 * Qui finiscono, con lo stack, che e la cosa che serve per capire *dove*.
 */
export function installGlobalErrorHandlers(): () => void {
  if (globalHandlersInstalled) return () => {}
  globalHandlersInstalled = true

  const onError = (event: ErrorEvent): void => {
    log.error('app', `Uncaught: ${event.message}`, {
      source: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined,
      stack: event.error instanceof Error ? event.error.stack : undefined,
    })
  }
  const onRejection = (event: PromiseRejectionEvent): void => {
    const reason = event.reason
    log.error('app', 'Promessa rifiutata senza gestione', {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    })
  }

  globalThis.addEventListener('error', onError)
  globalThis.addEventListener('unhandledrejection', onRejection)
  return () => {
    globalThis.removeEventListener('error', onError)
    globalThis.removeEventListener('unhandledrejection', onRejection)
    globalHandlersInstalled = false
  }
}
