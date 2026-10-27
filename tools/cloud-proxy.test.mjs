// Test del proxy, con un provider finto.
//
// Non si puo provare contro NVIDIA: servirebbe una chiave vera, e una chiave non
// e una cosa da mettere in un test. Si mette invece un upstream in ascolto sulla
// loopback e si verifica il comportamento che conta: la chiave non esce, la
// destinazione non si puo dirottare a caso, e lo streaming arriva a pezzi.
//
// Esegue con:  node --test tools/cloud-proxy.test.mjs

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createProxyServer, PROVIDERS, applyQuirks } from './cloud-proxy.mjs'

/** Un finto provider che risponde e annota cosa ha ricevuto. */
function startUpstream() {
  const seen = { authorization: null, url: null, body: null }
  const server = createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', async () => {
      seen.authorization = request.headers.authorization ?? null
      seen.url = request.url ?? null
      seen.body = Buffer.concat(chunks).toString('utf8')

      if (request.url?.startsWith('/models')) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ data: [{ id: 'finto-1' }] }))
        return
      }
      if (request.url?.startsWith('/stream')) {
        // Due scatti con un Flush in mezzo: e cio che distingue lo streaming vero
        // da una risposta intera arrivata tutta insieme alla fine.
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write('data: {"choices":[{"delta":{"content":"uno"}}]}\n\n')
        await new Promise((resolve) => setTimeout(resolve, 25))
        response.write('data: {"choices":[{"delta":{"content":"due"}}]}\n\n')
        response.end('data: [DONE]\n\n')
        return
      }
      if (request.url?.startsWith('/boom')) {
        response.writeHead(429, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'troppe richieste' }))
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true }))
    })
  })
  return { server, seen }
}

/**
 * Il proxy come lo usa l'app: su una porta libera, con `nvidia` puntato al finto
 * upstream. `http` perche il test e in locale; in vita vera l'indirizzo deve essere
 * `https`, e quello e controllato a parte.
 */
async function withProxy(run, { register = true } = {}) {
  const upstream = startUpstream()
  upstream.server.listen(0, '127.0.0.1')
  await once(upstream.server, 'listening')
  const upstreamPort = upstream.server.address().port

  const proxy = createProxyServer()
  proxy.listen(0, '127.0.0.1')
  await once(proxy, 'listening')
  const base = `http://127.0.0.1:${proxy.address().port}`

  try {
    if (register) {
      const response = await fetch(`${base}/provider/nvidia`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'sk-finta-non-segreta', baseUrl: `http://127.0.0.1:${upstreamPort}` }),
      })
      assert.equal(response.status, 200)
    }
    await run({ base, seen: upstream.seen, upstreamPort })
  } finally {
    proxy.close()
    upstream.server.close()
  }
}

describe('proxy cloud', () => {
  it('conosce i provider che il catalogo dell-app offre', () => {
    // Il catalogo dell'app e quello del proxy: se divergono, una delle due liste
    // offre qualcosa che l'altra non instrada. Il test nell'app confronta i due
    // file perche sono due file.
    assert.deepEqual(Object.keys(PROVIDERS), [
      'nvidia',
      'google',
      'openai',
      'anthropic',
      'groq',
      'mistral',
      'deepseek',
      'xai',
      'openrouter',
      'together',
      'cerebras',
      'fireworks',
    ])
    for (const [id, entry] of Object.entries(PROVIDERS)) {
      assert.match(entry.baseUrl, /^https:\/\//, id)
      // Senza slash finale: l'app aggiunge `/chat/completions`, e un doppio slash
      // qui diventerebbe un percorso che quel servizio non conosce.
      assert.equal(entry.baseUrl.endsWith('/'), false, id)
      assert.match(entry.envKey, /^[A-Z0-9_]+$/, id)
    }
  })

  /*
   * Le correzioni per provider.
   *
   * Il caso che le rende necessarie e' Claude: il suo strato di compatibilita OpenAI
   * accetta la temperatura solo fino a 1 e **riduce** i valori maggiori invece di
   * rifiutarli. Mandata cosi', la richiesta va a buon fine e restituisce qualcos'altro
   * da quello chiesto, senza dire niente. Il proxy riduce, e — questo e' il punto —
   * **dice quale valore ha usato**: una correzione silenziosa e' una correzione che
   * l'utente non puo' vedere, e che sembra un difetto dell'app.
   */
  describe('correzioni per provider', () => {
    const body = (extra) => JSON.stringify({ model: 'claude-sonnet-4-6', messages: [], ...extra })

    it('riduce la temperatura di Claude al massimo che accetta, e lo dice', () => {
      const result = applyQuirks(body({ temperature: 1.4 }), PROVIDERS.anthropic)
      assert.equal(JSON.parse(result.body).temperature, 1)
      assert.equal(result.notes.length, 1)
      assert.match(result.notes[0], /temperature/i)
    })

    it('non tocca una temperatura che Claude accetta gia', () => {
      const result = applyQuirks(body({ temperature: 0.8 }), PROVIDERS.anthropic)
      assert.equal(JSON.parse(result.body).temperature, 0.8)
      assert.deepEqual(result.notes, [])
    })

    it('tira via reasoning_effort da Claude, che lo ignora in silenzio', () => {
      // Ignorato e diverso da rifiutato: senza questa riga l'interruttore "Thinking"
      // resterebbe acceso e non farebbe niente, che e' il caso peggiore perche' sembra
      // funzionare.
      const result = applyQuirks(body({ reasoning_effort: 'none' }), PROVIDERS.anthropic)
      assert.equal('reasoning_effort' in JSON.parse(result.body), false)
      assert.equal(result.notes.length, 1)
    })

    it('lascia passare tutto senza toccare niente per un provider senza correzioni', () => {
      // Il caso normale: la maggior parte dei provider accetta cio che l'app manda, e
      // una correzione che non serve sarebbe una modifica non richiesta a ogni
      // richiesta.
      const original = body({ temperature: 1.4, reasoning_effort: 'none', top_p: 0.5 })
      for (const id of ['openai', 'google', 'nvidia', 'groq', 'mistral', 'deepseek']) {
        const result = applyQuirks(original, PROVIDERS[id])
        assert.equal(result.body, original, id)
        assert.deepEqual(result.notes, [], id)
      }
    })

    it('non inventa niente su un corpo che non capisce', () => {
      // Una richiesta che non e' un oggetto JSON non e' una di quelle che la tabella
      // conosce: modificarla alla cieca sarebbe peggio che lasciarla andare.
      for (const text of ['', 'non e json', '[1,2,3]', '"una stringa"', 'null']) {
        const result = applyQuirks(text, PROVIDERS.anthropic)
        assert.equal(result.body, text)
        assert.deepEqual(result.notes, [])
      }
    })

    it('non perde gli altri campi della richiesta', () => {
      // Correggere un campo non deve costare gli altri: una richiesta senza messaggi o
      // senza modello verrebbe rifiutata dal provider, e l'errore parlerebbe di una
      // cosa che non e' successa.
      const result = applyQuirks(
        JSON.stringify({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'ciao' }], temperature: 1.8, stream: true, top_p: 0.9 }),
        PROVIDERS.anthropic,
      )
      const sent = JSON.parse(result.body)
      assert.equal(sent.model, 'claude-sonnet-4-6')
      assert.deepEqual(sent.messages, [{ role: 'user', content: 'ciao' }])
      assert.equal(sent.stream, true)
      assert.equal(sent.top_p, 0.9)
      assert.equal(sent.temperature, 1)
    })
  })

  it('aggiunge la chiave che la pagina non ha mai mandato', async () => {
    await withProxy(async ({ base, seen }) => {
      const response = await fetch(`${base}/p/nvidia/models`)
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { data: [{ id: 'finto-1' }] })
      assert.equal(seen.authorization, 'Bearer sk-finta-non-segreta')
    })
  })

  it('non lascia mai la chiave in una risposta', async () => {
    await withProxy(async ({ base }) => {
      for (const path of ['/status', '/p/nvidia/models']) {
        const text = await (await fetch(`${base}${path}`)).text()
        assert.equal(text.includes('sk-finta-non-segreta'), false, path)
      }
    })
  })

  it('detta quali provider hanno una chiave, senza dire quale', async () => {
    await withProxy(async ({ base }) => {
      const body = await (await fetch(`${base}/status`)).json()
      assert.deepEqual(body.registered, ['nvidia'])
      assert.equal(JSON.stringify(body).includes('sk-finta'), false)
    })
  })

  it('accetta un indirizzo diverso, ma solo https', async () => {
    /*
     * Gli indirizzi di questo progetto sono conoscenza mia, non misurazioni, e un
     * provider che li cambia deve poter essere corretto senza uscire dal progetto.
     * La difesa non e questa: e il controllo su `Origin` sotto, che chiude le altre
     * schede del browser.
     */
    await withProxy(async ({ base }) => {
      const accepted = await fetch(`${base}/provider/nvidia`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'sk-x', baseUrl: 'https://integrate.api.nvidia.com/v1' }),
      })
      assert.equal(accepted.status, 200)
      const body = await accepted.json()
      assert.equal(body.overridden, true)
      assert.equal(body.baseUrl, 'https://integrate.api.nvidia.com/v1')

      // In chiaro su un indirizzo remoto no: la chiave ci viaggerebbe in chiaro.
      const refused = await fetch(`${base}/provider/nvidia`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'sk-x', baseUrl: 'http://integrate.api.nvidia.com/v1' }),
      })
      assert.equal(refused.status, 400)
    })
  })

  it('segnala quando la destinazione e quella di default', async () => {
    // Serve perche l'app possa dire "stai usando l'indirizzo scritto da te"
    // invece di lasciare che l'utente scopra che la sua correzione e in uso o no.
    await withProxy(
      async ({ base }) => {
        const body = await (
          await fetch(`${base}/provider/nvidia`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key: 'sk-x' }),
          })
        ).json()
        assert.equal(body.overridden, false)
        assert.equal(body.baseUrl, 'https://integrate.api.nvidia.com/v1')
      },
      { register: false },
    )
  })

  it('non conosce un id che non e nel catalogo', async () => {
    // La difesa contro il dirottamento: un id che non e qui non puo diventare una
    // destinazione, perche non c'e nessun indirizzo a cui andare.
    //
    // Gli id qui sono volutamente inventati e **non** provider reali. Usare un nome
    // vero come esempio smette di funzionare nel giorno in cui quel provider viene
    // aggiunto, e il test fallirebbe perche' il codice ha fatto bene: e il tipo di
    // errore che fa perdere tempo a rincorrere un difetto che non esiste.
    await withProxy(async ({ base }) => {
      for (const id of ['attaccante', 'custom', 'non-esiste', 'my-provider', 'ollama']) {
        const put = await fetch(`${base}/provider/${id}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key: 'sk-x', baseUrl: 'https://esempio.attaccante.test' }),
        })
        assert.equal(put.status, 404, id)
        const call = await fetch(`${base}/p/${id}/models`)
        assert.equal(call.status, 404, id)
      }
    })
  })

  it('rifiuta una pagina che non e di questa macchina', async () => {
    await withProxy(async ({ base }) => {
      const response = await fetch(`${base}/p/nvidia/models`, {
        headers: { origin: 'https://pagina-estrana.example' },
      })
      assert.equal(response.status, 403)
    })
  })

  it('accetta una pagina localhost', async () => {
    await withProxy(async ({ base }) => {
      for (const origin of ['http://127.0.0.1:5173', 'http://localhost:4173']) {
        const response = await fetch(`${base}/status`, { headers: { origin } })
        assert.equal(response.status, 200, origin)
      }
    })
  })

  it('risponde 401 quando non c e una chiave, e lo dice', async () => {
    await withProxy(
      async ({ base }) => {
        const response = await fetch(`${base}/p/nvidia/models`)
        assert.equal(response.status, 401)
        // La parola conta: il client deve capire che il problema e la chiave e non
        // che il provider e rotto, altrimenti si mette a ricaricare il modello.
        assert.match((await response.json()).error, /no key registered/)
      },
      { register: false },
    )
  })

  it('propaga in streaming invece di accumulare', async () => {
    await withProxy(async ({ base }) => {
      const response = await fetch(`${base}/p/nvidia/stream`)
      assert.equal(response.status, 200)
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      const first = await reader.read()
      const text = decoder.decode(first.value)
      // Il primo scatto arriva prima della fine: e tutto il punto dello streaming.
      assert.match(text, /uno/)
      assert.equal(text.includes('due'), false)
      let rest = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        rest += decoder.decode(value, { stream: true })
      }
      assert.match(text + rest, /uno/)
      assert.match(text + rest, /due/)
    })
  })

  it('porta il corpo della richieste e il metodo', async () => {
    await withProxy(async ({ base, seen }) => {
      await fetch(`${base}/p/nvidia/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'finto-1', messages: [{ role: 'user', content: 'ciao' }] }),
      })
      assert.equal(seen.url, '/chat/completions')
      assert.deepEqual(JSON.parse(seen.body), { model: 'finto-1', messages: [{ role: 'user', content: 'ciao' }] })
    })
  })

  it('propaga lo stato di errore del provider invece di inventare un successo', async () => {
    await withProxy(async ({ base }) => {
      const response = await fetch(`${base}/p/nvidia/boom`)
      // Riscrivere in 200 e l'errore che rende impossibile capire cosa e successo.
      assert.equal(response.status, 429)
      assert.equal(response.ok, false)
    })
  })

  it('risponde al preflight, senza il quale il browser blocca tutto', async () => {
    /*
     * Il bug piu insidioso di questo servizio, e l'unico che non si vede dai test
     * di Node: senza le intestazioni CORS, il `PUT` che registra la chiave viene
     * bloccato dal browser e l'app conclude che il servizio non e in ascolto. Il
     * sintomo e identico a un servizio spento, e Node non applica CORS, quindi
     * tutti gli altri test passavano.
     */
    await withProxy(async ({ base }) => {
      const preflight = await fetch(`${base}/provider/nvidia`, {
        method: 'OPTIONS',
        headers: {
          origin: 'http://127.0.0.1:5173',
          'access-control-request-method': 'PUT',
          'access-control-request-headers': 'content-type',
        },
      })
      assert.equal(preflight.status, 204)
      // L'origine viene riflessa, non fissata a `*`: un `*` darebbe accesso anche
      // da siti terzi, che e esattamente cio che il controllo su Origin impedisce.
      assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173')
      assert.match(preflight.headers.get('access-control-allow-methods') ?? '', /PUT/)
      assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /content-type/)
    })
  })

  it('mette le intestazioni CORS anche sulla risposta della registrazione', async () => {
    await withProxy(
      async ({ base }) => {
        const response = await fetch(`${base}/provider/nvidia`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:5173' },
          body: JSON.stringify({ key: 'sk-x', baseUrl: 'https://integrate.api.nvidia.com/v1' }),
        })
        assert.equal(response.status, 200)
        assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173')
      },
      { register: false },
    )
  })

  it('mette le intestazioni CORS anche sulla risposta del provider', async () => {
    await withProxy(async ({ base }) => {
      const response = await fetch(`${base}/p/nvidia/models`, {
        headers: { origin: 'http://127.0.0.1:5173' },
      })
      // Se mancassero qui, il browser lascerebbe passare la registrazione e
      // bloccherebbe la lista modelli: due metà del percorso che falliscono in
      // modi diversi e apparentemente scollegati.
      assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173')
    })
  })

  it('non riflette un origine esterna, neppure nel preflight', async () => {
    await withProxy(async ({ base }) => {
      const preflight = await fetch(`${base}/status`, {
        method: 'OPTIONS',
        headers: { origin: 'https://pagina-estrana.example' },
      })
      assert.equal(preflight.headers.get('access-control-allow-origin'), null)
    })
  })

  it('rifiuta ancora con 403, e non con 500, un origine esterna', async () => {
    // Le intestazioni si calcolano prima del controllo sull'origine. Dichiarate
    // dopo, finivano nella zona morta temporale e il 403 diventava un 500, che e
    // l'errore peggiore: dice "il servizio e rotto" quando ha fatto esattamente
    // quello che doveva.
    await withProxy(async ({ base }) => {
      const response = await fetch(`${base}/status`, {
        headers: { origin: 'https://pagina-estrana.example' },
      })
      assert.equal(response.status, 403)
    })
  })

  it('dimentica la chiave quando gliela si chiede di dimenticare', async () => {
    await withProxy(async ({ base }) => {
      assert.equal((await fetch(`${base}/p/nvidia/models`)).status, 200)
      assert.equal((await fetch(`${base}/provider/nvidia`, { method: 'DELETE' })).status, 200)
      assert.equal((await fetch(`${base}/p/nvidia/models`)).status, 401)
    })
  })

  it('non accetta una chiave vuota', async () => {
    await withProxy(
      async ({ base }) => {
        const response = await fetch(`${base}/provider/nvidia`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key: '   ' }),
        })
        assert.equal(response.status, 400)
      },
      { register: false },
    )
  })

  it('risponde 413 a un corpo enorme, e non chiude la connessione', async () => {
    await withProxy(
      async ({ base }) => {
        // Una chiave sta in qualche decina di caratteri: 9000 non e una chiave.
        // La risposta deve essere 413 e non una socket chiusa, altrimenti il
        // client non sa se il servizio e caduto o se ha rifiutato.
        const response = await fetch(`${base}/provider/nvidia`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key: 'k'.repeat(9000) }),
        })
        assert.equal(response.status, 413)
        assert.match((await response.json()).error, /too large/)
      },
      { register: false },
    )
  })
})
