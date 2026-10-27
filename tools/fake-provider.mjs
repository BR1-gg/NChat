// Un provider finto che parla l'API OpenAI, in ascolto sulla loopback.
//
// Serve a verificare il percorso completo — app -> proxy locale -> "provider" —
// senza una chiave vera e senza mandare niente fuori da questa macchina. Non e'
// un provider: e uno stub che risponde come uno, e va detto cosi'.
//
// Esegue con:  node tools/fake-provider.mjs [porta]

import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 1236)

/** I modelli che lo stub offre. Uno solo, cosi' e chiaro da dove arriva. */
const MODELS = [
  { id: 'finto-grande', object: 'model', owned_by: 'fake' },
  { id: 'finto-piccolo', object: 'model', owned_by: 'fake' },
]

function chunkFor(model, text) {
  return {
    id: 'chatcmpl-finto',
    object: 'chat.completion.chunk',
    created: 0,
    model,
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  }
}

const server = createServer((request, response) => {
  const chunks = []
  request.on('data', (chunk) => chunks.push(chunk))
  request.on('end', async () => {
    const body = Buffer.concat(chunks).toString('utf8')

    if (request.url?.endsWith('/models')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ object: 'list', data: MODELS }))
      return
    }

    if (request.url?.endsWith('/chat/completions')) {
      let model = 'finto-grande'
      let prompt = ''
      let stream = true
      /*
       * I parametri di generazione **arrivano** al provider, e qui si vede.
       *
       * Era una domanda aperta: se l'app manda `temperature`, `top_p` e
       * `max_tokens` o se se li tiene per conto suo, e la differenza e enorme —
       * nel primo caso sono impostazioni dell'utente che il provider onora, nel
       * secondo sarebbero campi inutili da mostrare. Lo stub li rimette nella
       * risposta, cosi la domanda si risponde guardando una risposta vera e non
       * leggendo il codice.
       */
      let received = {}
      try {
        const parsed = JSON.parse(body)
        model = parsed.model ?? model
        if (parsed.stream === false) stream = false
        for (const key of ['temperature', 'top_p', 'max_tokens', 'stop', 'reasoning_effort']) {
          if (parsed[key] !== undefined) received[key] = parsed[key]
        }
        const last = parsed.messages?.[parsed.messages.length - 1]
        const content = last?.content
        prompt = typeof content === 'string' ? content : (content?.[0]?.text ?? '')
      } catch {
        /* la richiesta non era JSON: rispondo lo stesso, tanto e uno stub */
      }
      const answer =
        `Hai detto: ${prompt.slice(0, 40)}. Risposta dal provider finto, modello ${model}.` +
        ` Parametri ricevuti: ${JSON.stringify(received)}`

      /*
       * `stream: false` viene onorato. Prima rispondeva sempre in streaming, e
       * questo non era onesto: un vero provider rispetta il flag, e il client deve
       * essere provato su quello che riceve davvero, non su uno stub che mente.
       * (Il client e comunque tollerante a un SSE su una richiesta non-streaming:
       * molti servizi lo ignorano, e li' e un test.)
       */
      if (!stream) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            id: 'chatcmpl-finto',
            object: 'chat.completion',
            created: 0,
            model,
            choices: [
              { index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' },
            ],
          }),
        )
        return
      }

      // In due scatti, cosi si vede che lo streaming attraversa il proxy e non
      // arriva tutto in un colpo alla fine.
      const cut = Math.ceil(answer.length / 2)
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
      })
      response.write(`data: ${JSON.stringify(chunkFor(model, answer.slice(0, cut)))}\n\n`)
      await new Promise((resolve) => setTimeout(resolve, 40))
      // Il pezzo mancante, e poi la chiusura. Tre messaggi e non due, perche
      // sovrascrivere `choices` nel secondo scartava il testo: ed e esattamente
      // il tipo di errore che fa sembrare rotto uno stub invece del client.
      response.write(`data: ${JSON.stringify(chunkFor(model, answer.slice(cut)))}\n\n`)
      response.write(
        `data: ${JSON.stringify({ id: 'chatcmpl-finto', object: 'chat.completion.chunk', created: 0, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
      )
      response.write('data: [DONE]\n\n')
      response.end()
      return
    }

    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'no such endpoint' } }))
  })
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`fake provider on http://127.0.0.1:${port}\n`)
})
