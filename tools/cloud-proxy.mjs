// Proxy locale per i modelli in cloud.
//
// Perche esiste, in una riga: un browser non puo chiamare un provider cloud con
// una chiave senza esporre la chiave, e molti provider non si lasciano chiamare
// da una pagina nemmeno. Questo processo sta in mezzo: la pagina non manda mai
// la chiave, e non sa nemmeno l'indirizzo del provider.
//
// Regole che il codice sotto non puo dimenticare:
//
// 1. **La chiave non esce mai.** Va in una variabile e basta. Nessuna risposta la
//    contiene, nessun log la contiene, e non viene scritta su disco: quando questo
//    processo muore, la chiave muore con lui. E il motivo per cui la si reinserisce
//    a ogni avvio, e un costo accettato per non avere la chiave in IndexedDB.
//
// 2. **Gli indirizzi sono qui, non vengono dalla pagina.** Se la pagina potesse
//    scegliere la destinazione, un sito qualsiasi aprto nel browser registrerebbe
//    la propria baseUrl sotto un provider noto e la chiave del provider finirebbe
//    li'. L'unica baseUrl che la pagina può indicare e quella di `custom`, che
//    serve esattamente per questo. Tutte le altre sono in `PROVIDERS` qui sotto.
//
// 3. **Solo localhost, e solo da una pagina localhost.** Si ascolta su 127.0.0.1 e
//    una richiesta con un `Origin` non locale viene respinta. Un'altra scheda del
//    browser delega il passaggio a `Origin`, quindi e il buco che si chiude
//    davvero; un programma locale puo gia leggere i file dell'utente.
//
// Nessuna dipendenza: solo `node:http` e la `fetch` globale di Node 20.

import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

/**
 * L'unica tabella degli indirizzi. Se un provider li cambia, si corregge qui e in
 * un posto solo.
 *
 * NVIDIA e Google, non uno solo: sono due servizi che esistono davvero, con indirizzi
 * che si possono leggere, e aggiungerne uno non costa un indirizzo scritto a mano.
 * Non c'e pero una voce "qualunque servizio OpenAI-compatible": quella
 * sarebbe una promessa che questo progetto non puo onorare, perche l'indirizzo
 * sarebbe scritto dall'utente e l'app non potrebbe verificarlo.
 *
 * Google passa dal **livello di compatibilita OpenAI** che espone
 * `generativelanguage.googleapis.com/v1beta/openai`, e non dall'API nativa: il
 * client di questa app parla OpenAI, e la chiave si mette nell'intestazione
 * `Authorization` come in tutti gli altri posti. Il percorso finisce in `openai`
 * perche e cosi che l'app aggiunge `/chat/completions` e ottiene
 * `/v1beta/openai/chat/completions`, che e l'indirizzo giusto.
 */
export const PROVIDERS = {
  nvidia: { baseUrl: 'https://integrate.api.nvidia.com/v1', envKey: 'NVIDIA_API_KEY' },
  google: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    envKey: 'GOOGLE_API_KEY',
  },

  /*
   * Gli altri provider, tutti con lo stesso contratto: `/v1/chat/completions` e la
   * chiave in `Authorization: Bearer`. Non serve altro perche' e' esattamente la
   * forma che il client di questa app parla gia', quindi aggiungerne uno e' una riga.
   *
   * Quello che **non** e' una riga e' `quirks`, sotto: sono le deviazioni dai valori
   * di default che ogni provider accetta in silenzio eIgnora, o rifiuta. Un 400 che
   * dice solo `400` e' il risultato piu' inutile che si possa dare a un utente, e per
   * ognuno di questi casi il rimando e' gia' scritto.
   */

  openai: {
    baseUrl: 'https://api.openai.com/v1',
    envKey: 'OPENAI_API_KEY',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    envKey: 'ANTHROPIC_API_KEY',
    /*
     * Claude ha uno **strato di compatibilita OpenAI** a questo indirizzo, quindi il
     * client funziona — ma non e' l'API nativa, e lo dice la documentazione: e pensata
     * per valutare i modelli, non per la produzione, e ci sono limiti noti.
     *
     * Quello che conta qui: `temperature` e accettata solo da 0 a 1 (oltre, viene
     * ridotta a 1) e `reasoning_effort` e **ignorato in silenzio**. Il primo e un
     * numeri che questa app lascia salire fino a 2, quindi una corsa con 1.4 su Claude
     * non da errore: dà solo risultati diversi da quelli chiesti, che e' peggio di un
     * rifiuto. Per onestà la temperatura viene ridotta a 1 **prima** di partire, e
     * l'interruttore "thinking" viene tolto perche' su questo livello non farebbe niente.
     */
    maxTemperature: 1,
    dropParams: ['reasoning_effort'],
    quirks: {
      temperature:
        'Claude accepts a temperature from 0 to 1. Values above 1 are reduced to 1, so this run used 1.',
      reasoning_effort:
        'Claude ignores reasoning_effort on the compatibility layer, so the Thinking switch has no effect here.',
    },
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    envKey: 'GROQ_API_KEY',
  },
  mistral: {
    baseUrl: 'https://api.mistral.ai/v1',
    envKey: 'MISTRAL_API_KEY',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    envKey: 'DEEPSEEK_API_KEY',
  },
  xai: {
    baseUrl: 'https://api.x.ai/v1',
    envKey: 'XAI_API_KEY',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    envKey: 'OPENROUTER_API_KEY',
  },
  together: {
    baseUrl: 'https://api.together.xyz/v1',
    envKey: 'TOGETHER_API_KEY',
  },
  cerebras: {
    baseUrl: 'https://api.cerebras.ai/v1',
    envKey: 'CEREBRAS_API_KEY',
    /*
     * Cerebras **rifiuta** `frequency_penalty`, `presence_penalty` e `logit_bias` con
     * un 400 invece di ignorarli. Questa app non li manda, quindi oggi non incide: la
     * nota e' qui perche' il giorno in cui arrivassero, il 400 avrebbe una causa che
     * non si trova leggendo il messaggio.
     */
    quirks: {
      penalties:
        'Cerebras rejects frequency_penalty, presence_penalty and logit_bias with a 400 instead of ignoring them.',
    },
  },
  fireworks: {
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    envKey: 'FIREWORKS_API_KEY',
  },
}

const LOCAL_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/

/**
 * Le correzioni di un provider, e cosa ne resta da dire.
 *
 * Restituiscono il corpo da mandare e l'elenco delle cose cambiate. Il secondo valore
 * non e' un di piu' per la pagina: e' l'unico modo che ha l'utente di sapere che una
 * richiesta e' partita diversa da come l'ha scritta, e senza questo un provider che
 * riduce un parametro in silenzio fa sembrare l'app strana invece di dichiarare cosa ha
 * fatto.
 *
 * Un corpo che non e' JSON o non e' un oggetto passa inalterato: sono richieste che
 * questa tabella non conosce, e modificarle alla cieca sarebbe peggio che lasciarle
 * andare. Il `try` e per quello, non per un errore atteso.
 */
export function applyQuirks(text, spec) {
  const notes = []
  if (!spec || (!spec.maxTemperature && !spec.dropParams?.length)) return { body: text, notes }
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    return { body: text, notes }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { body: text, notes }
  }

  if (spec.dropParams) {
    for (const param of spec.dropParams) {
      if (param in payload) {
        delete payload[param]
        const why = spec.quirks?.[param]
        if (why) notes.push(why)
      }
    }
  }

  if (typeof spec.maxTemperature === 'number' && typeof payload.temperature === 'number') {
    if (payload.temperature > spec.maxTemperature) {
      notes.push(
        spec.quirks?.temperature ??
          `This provider accepts a temperature up to ${spec.maxTemperature}; ${payload.temperature} was reduced to ${spec.maxTemperature}.`,
      )
      payload.temperature = spec.maxTemperature
    }
  }

  /*
   * Se non e' cambiato niente, si rimanda il corpo **cosi' com'e'**.
   *
   * Non e' una questione di stile: `JSON.stringify` riordina le chiavi e riformatta
   * gli spazi, quindi riscrivere un corpo che non aveva bisogno di cambiamenti
   * manderebbe al provider una richiesta diversa da quella scritta, e un provider che
   * confronta il corpo — per firmarlo, per dedurre il formato — la rifiuterebbe. Il
   * proxy non deve toccare cio che non deve toccare.
   */
  if (notes.length === 0) return { body: text, notes }
  return { body: JSON.stringify(payload), notes }
}

/** Un id che non e nel catalogo non puo diventare una destinazione. */
function isKnown(id) {
  return Object.hasOwn(PROVIDERS, id)
}

/** Tetto assoluto oltre il quale si smette di leggere, e si chiude. */
const HARD_CEILING = 64 * 1024 * 1024

/**
 * Le credenziali, in memoria.
 *
 * `baseUrl` e null solo per i provider noti, e viene riempito solo per `custom`:
 * e l'unico modo che ha la pagina di scegliere una destinazione, ed esiste
 * perche serve.
 *
 * Sta dentro la factory e non a modulo perche due istanze di proxy non devono
 * condividere le chiavi: un test che ne apre una non deve trovarsi la chiave
 * messa da un test precedente, che era esattamente il difetto della prima
 * versione.
 */
function createRegistry() {
  return new Map()
}

/**
 * Legge il corpo, e dice se era troppo grande invece di far saltare la connessione.
 *
 * Distinguere le due cose e cio che rende utile la risposta: un client che
 * riceve 413 sa cosa e successo, un client con la socket chiusa penserebbe che
 * il servizio e caduto. Il corpo si scorre comunque, altrimenti la richiesta non
 * finisce mai; il tetto duro serve solo a non leggere all'infinito.
 */
function readBody(request, limit = 4096) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let tooLarge = false
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        // Una chiave sta in qualche decina di caratteri. Oltre, non e una chiave.
        tooLarge = true
        chunks.length = 0
        if (size > HARD_CEILING) {
          reject(new Error('body too large'))
          request.destroy()
        }
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve({ text: Buffer.concat(chunks).toString('utf8'), tooLarge }))
    request.on('error', reject)
  })
}

function sendJson(response, status, value, extra = {}) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...extra,
  })
  response.end(body)
}

/**
 * Un Origin presente e non locale e una pagina web: si chiude.
 * Un Origin assente non e una pagina (e il test, che gira su Node).
 */
function originAllowed(request) {
  const origin = request.headers.origin
  if (origin === undefined) return true
  return LOCAL_ORIGIN.test(origin)
}

/**
 * Dove può andare una richiesta con `custom`.
 *
 * `https` sempre. `http` solo in loopback, e non per generosità: la richiesta
 * finisce sulla stessa macchina, quindi non attraversa la rete e non c'è niente
 * da intercettare. È ciò che rende `custom` utile anche per un gateway locale —
 * Ollama, un router, un reverse proxy — e non solo per un provider remoto.
 *
 * Esportata perché la regola merita un test proprio: è il posto dove una scelta
 * comoda diventa una chiave mandata in chiaro.
 */
export function destinazioneAmmessa(parsed) {
  if (parsed.protocol === 'https:') return true
  if (parsed.protocol !== 'http:') return false
  const host = parsed.hostname.toLowerCase()
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1'
}

/**
 * Le intestazioni che il browser pretende prima di lasciar parlare due origini.
 *
 * Senza queste il `PUT` che registra la chiave viene bloccato dal preflight e
 * l'app conclude che il servizio non e in esecuzione, anche se e in ascolto. Il
 * sintomo e indistinguibile da un servizio spento, ed e un bug che solo si vede
 * nel browser: i test di questo proxy girano su Node, dove CORS non esiste.
 *
 * L'origine ammessa viene **riflessa**, non fissata a `*`: e la pagina dell'utente
 * che parla con il servizio, e un `*` le darebbe accesso anche da siti terzi.
 */
function corsHeaders(request) {
  const origin = request.headers.origin
  const headers = { vary: 'Origin' }
  if (origin && LOCAL_ORIGIN.test(origin)) {
    headers['access-control-allow-origin'] = origin
    headers['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
    headers['access-control-allow-headers'] = 'content-type, authorization'
    headers['access-control-max-age'] = '600'
  }
  return headers
}

/** Instrada una richiesta. Esposta per essere testata senza aprire una porta. */
export async function handle(request, response, registry) {
  /*
   * Le intestazioni si calcolano **prima** del controllo sull'origine, perche
   * anche la risposta di rifiuto ne ha bisogno. Dichiarate dopo, finivano nella
   * zona morta temporale e il 403 diventava un 500, che e l'errore peggiore
   * possibile: dice "il servizio e rotto" quando invece ha fatto esattamente
   * quello che doveva.
   */
  const cors = corsHeaders(request)

  if (!originAllowed(request)) {
    sendJson(response, 403, { error: 'origin not allowed' }, cors)
    return
  }

  // Il preflight va risposto prima di ogni altra cosa, e senza corpo.
  if (request.method === 'OPTIONS') {
    response.writeHead(204, cors)
    response.end()
    return
  }

  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  const parts = url.pathname.split('/').filter(Boolean)

  // /status: quali provider hanno una chiave, mai quale chiave.
  if (parts[0] === 'status' && request.method === 'GET') {
    sendJson(response, 200, {
      ok: true,
      providers: Object.keys(PROVIDERS),
      registered: [...registry.keys()].filter((id) => Boolean(registry.get(id)?.key)),
    }, cors)
    return
  }

  // /provider/<id>  body: { key, baseUrl? }
  if (parts[0] === 'provider' && parts[1]) {
    const id = parts[1]
    if (!isKnown(id)) {
      sendJson(response, 404, { error: `unknown provider: ${id}` }, cors)
      return
    }
    if (request.method === 'DELETE') {
      registry.delete(id)
      sendJson(response, 200, { ok: true }, cors)
      return
    }
    if (request.method !== 'PUT' && request.method !== 'POST') {
      sendJson(response, 405, { error: 'use PUT, POST or DELETE' }, cors)
      return
    }
    let body
    try {
      body = await readBody(request)
    } catch {
      sendJson(response, 413, { error: 'body too large' }, cors)
      return
    }
    if (body.tooLarge) {
      sendJson(response, 413, { error: 'body too large' }, cors)
      return
    }
    let payload
    try {
      payload = JSON.parse(body.text || '{}')
    } catch {
      sendJson(response, 400, { error: 'body is not JSON' }, cors)
      return
    }
    const key = typeof payload.key === 'string' ? payload.key.trim() : ''
    if (!key) {
      sendJson(response, 400, { error: 'a key is required' }, cors)
      return
    }
    let baseUrl = PROVIDERS[id].baseUrl
    let overridden = false
    if (payload.baseUrl) {
      /*
       * Un indirizzo mandato dalla pagina puo cambiare la destinazione, anche per
       * un provider noto. La versione precedente lo vietava, e aveva una buona
       * ragione: se un'altra pagina potesse scegliere dove va la chiave, la
       * chiave del provider finirebbe li'. Ma l'utente e la pagina sono la stessa
       * persona: se lui scrive un indirizzo nella sua app, non e un attacco, e
       * senza questa via gli indirizzi di questa tabella sono conoscenza mia e
       * non misurazioni, e un provider che li cambia lascerebbe l'utente senza
       * uscita.
       *
       * La difesa vera non e questa, e non si sposta: e il controllo su `Origin`
       * sotto, che chiude le altre schede del browser, uniche a poter parlare con
       * questo servizio. Qui si valida solo che l'indirizzo sia plausibile.
       */
      let parsed
      try {
        parsed = new URL(payload.baseUrl)
      } catch {
        sendJson(response, 400, { error: 'baseUrl is not a URL' }, cors)
        return
      }
      if (!destinazioneAmmessa(parsed)) {
        sendJson(response, 400, { error: 'baseUrl must be https, or http on a loopback address' }, cors)
        return
      }
      baseUrl = payload.baseUrl.replace(/\/+$/, '')
      overridden = true
    }
    if (!baseUrl) {
      sendJson(response, 400, { error: 'baseUrl is required for this provider' }, cors)
      return
    }
    registry.set(id, { key, baseUrl })
    // Niente key nella risposta, e niente nel log.
    sendJson(response, 200, { ok: true, provider: id, baseUrl, overridden }, cors)
    return
  }

  // /p/<id>/<resto>
  if (parts[0] === 'p' && parts[1]) {
    const id = parts[1]
    if (!isKnown(id)) {
      sendJson(response, 404, { error: `unknown provider: ${id}` }, cors)
      return
    }
    const entry = registry.get(id)
    if (!entry?.key) {
      // 401 e non 502: al client va detto chiaramente che il problema e la chiave
      // e non il provider, altrimenti si mette a ricaricare il modello.
      sendJson(response, 401, { error: `no key registered for ${id}` }, cors)
      return
    }
    const rest = parts.slice(2).join('/')
    const search = url.search
    const target = `${entry.baseUrl}/${rest}${search}`

    const headers = { authorization: `Bearer ${entry.key}`, accept: request.headers.accept ?? 'application/json' }
    if (request.headers['content-type']) headers['content-type'] = request.headers['content-type']

    let body
    /*
     * Le note su cio' che il proxy ha corretto, raccolte **mentre** corregge.
     *
     * Vanno tenute qui e non ricalcolate dopo: `applyQuirks` restituisce gia' la lista,
     * e rilanciarlo sul corpo gia' corretto produrrebbe una seconda risposta senza
     * modifiche — quindi nessuna nota — su una richiesta che invece e' stata cambiata.
     */
    const notes = []
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      // 8 MB: un'immagine finisce nel corpo come data URL, e un prompt con parecchie
      // immagini e grosso. Oltre, non e una richiesta che questa app fa.
      const read = await readBody(request, 8 * 1024 * 1024)
      if (read.tooLarge) {
        sendJson(response, 413, { error: 'request too large' }, cors)
        return
      }
      /*
       * Le correzioni del provider, applicate **qui** e non nella pagina.
       *
       * Il posto e' questo perche' e l'unico che conosce i provider: la pagina sa
       * quale provider ha scelto l'utente, ma non cosa quel provider accetta. E il
       * proxy ha gia' in mano la tabella degli indirizzi perche' e lui che sceglie la
       * destinazione.
       *
       * Il caso che rende necessario farlo qui e' la temperatura di Claude: il suo
       * strato di compatibilita **riduce** a 1 un valore piu' alto invece di rifiutarlo.
       * Mandata cosi', la richiesta va a buon fine e restituisce qualcos'altro da
       * quello chiesto, senza una parola di avvertimento.
       */
      const fixed = applyQuirks(read.text, PROVIDERS[id])
      body = fixed.body
      notes.push(...fixed.notes)
    }

    let upstream
    try {
      upstream = await fetch(target, { method: request.method, headers, body, redirect: 'follow' })
    } catch (error) {
      sendJson(response, 502, {
        error: 'could not reach the provider',
        detail: error instanceof Error ? error.message : String(error),
      }, cors)
      return
    }

    /*
     * Cosa e' stato corretto, detto alla pagina.
     *
     * Una correzione silenziosa e' una correzione che l'utente non puo' vedere: se la
     * temperatura e scesa da 1.4 a 1, i risultati cambiano e niente lo spiega. Quindi
     * quello che il proxy ha fatto torna indietro in un'intestazione, e l'app lo
     * mostra. Un header e' il posto giusto perche' la risposta resta in streaming e non
     * puo' essere anticipata da un avviso nel corpo.
     */
    response.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
      ...(notes.length > 0 ? { 'x-nchat-adjusted': notes.join(' | ') } : {}),
      ...cors,
    })
    // Non si accumula: le risposte in streaming restano in streaming, altrimenti
    // il primo token arriva tutto insieme alla fine e lo streaming non serve.
    if (upstream.body) {
      const reader = upstream.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!response.write(Buffer.from(value))) {
          await new Promise((resolve) => response.once('drain', resolve))
        }
      }
    }
    response.end()
    return
  }

  sendJson(response, 404, { error: 'not found' }, cors)
}

export function createProxyServer() {
  const registry = createRegistry()
  return createServer((request, response) => {
    handle(request, response, registry).catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: 'proxy failed' }, corsHeaders(request))
      else response.end()
    })
  })
}

// Avviato come programma e non importato. Il confronto e sui nomi di file
// risolti, perche il percorso arriva come URL e il resto come percorso di sistema,
// e su Windows i due non hanno la stessa forma.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  const port = Number(process.env.NCHAT_PROXY_PORT ?? 1235)
  const server = createProxyServer()
  server.listen(port, '127.0.0.1', () => {
    // Una riga, senza chiavi: il tray la usa per il tooltip e per la disponibilita.
    process.stdout.write(`nchat cloud proxy on http://127.0.0.1:${port}\n`)
  })
  const stop = () => server.close(() => process.exit(0))
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
