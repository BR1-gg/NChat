/**
 * Cercare una parola nel grafo.
 *
 * Il difetto che questo file chiude e' che su un grafo grande **non si poteva cercare
 * niente**. C'era la palette per aggiungere nodi e il menu per le azioni, ma per
 * trovare «quella cosa che avevo scritto tre settimane fa» l'unica opzione era
 * scorrere la tela leggendo ogni nodo — e su un grafo di trecento nodi quello non e'
 * slow scrolling, e' non sapere nemmeno in che direzione guardare.
 *
 * I due comportamenti che contano di piu', e che qui sono bloccati uno per uno:
 *
 * - **`AND`, non `OR`.** Un risultato che contiene una parola su tre e' rumore, e in
 *   una ricerca il rumore e' peggio di non trovare niente: l'utente smette di fidarsi
 *   e non guarda nemmeno quello che c'era davvero.
 * - **l'ordine per intenzione.** Un prompt scritto per essere eseguito viene prima di
 *   una risposta che contiene la parola per caso. L'ordine e' meta' del lavoro, perche'
 *   l'utente Finds giusto quello fra i risultati.
 */

import { describe, expect, it } from 'vitest'
import { queryTerms, searchNodes } from './search'
import { document, file, image, note, prompt, response, summary, system } from '../test/factories'

describe('finding words in the graph', () => {
  it('finds a word in a prompt, a note, an answer and a file', () => {
    /*
     * Ogni tipo di testo che l'utente scrive, e che deve poter ritrovare. Una ricerca
     * che funziona solo sui prompt, su un grafo grande, non serve a niente: la cosa che
     * si ritrova e' quasi sempre in una risposta o in una nota, perche' li' e' finito
     * quello che si e' scritto per davvero.
     */
    const p = prompt('How do I compress an image?')
    const n = note('Remember to compress the image before saving.')
    const r = response(p.id, 'You compress the image by resizing it.')
    const f = file('tips.md', { text: 'Always compress the image you upload.' })
    const doc = document([p, n, r, f], [])
    const hits = searchNodes(doc, 'compress')
    expect(hits).toHaveLength(4)
    expect(hits.map((hit) => hit.nodeId).sort()).toEqual([p.id, n.id, r.id, f.id].sort())
  })

  it('finds a word in a file, a summary and the instructions', () => {
    const p = prompt('Go')
    const f = file('report.md', { text: 'the quarterly numbers are here' })
    const s = summary('The quarterly trend went up.')
    const sys = system('Always answer in the quarterly tone.')
    const doc = document([p, f, s, sys], [])
    const hits = searchNodes(doc, 'quarterly')
    expect(hits.map((hit) => hit.field).sort()).toEqual(['file', 'summary', 'system'].sort())
  })

  it('finds a picture by its name, because that is all a picture has', () => {
    const shot = image('invoice-2026-03.png')
    const p = prompt('What is this?')
    const doc = document([p, shot], [])
    const hits = searchNodes(doc, 'invoice')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.nodeId).toBe(shot.id)
    expect(hits[0]?.field).toBe('name')
  })

  it('is not case sensitive, because nobody remembers the capital letters', () => {
    const p = prompt('Compress THE image')
    const doc = document([p], [])
    expect(searchNodes(doc, 'compress')).toHaveLength(1)
    expect(searchNodes(doc, 'COMPRESS')).toHaveLength(1)
  })

  it('needs every word, not just one of them', () => {
    /*
     * Il punto su cui la ricerca si gioca la fiducia. Con `OR`, «timeout retry»
     * restituirebbe ogni nodo che parla di timeout e ogni nodo che parla di retry: su
     * un grafo grande sono decine, e l'utente passerebbe il resto della giornata a
     * leggerli per scoprire che nessuno contiene entrambe le parole.
     */
    const both = prompt('A timeout means you should retry.')
    const onlyTimeout = prompt('The request timed out.')
    const onlyRetry = prompt('Try again.')
    const doc = document([both, onlyTimeout, onlyRetry], [])
    const hits = searchNodes(doc, 'timeout retry')
    expect(hits.map((hit) => hit.nodeId)).toEqual([both.id])
  })

  it('splits the query on spaces, so two words are two conditions', () => {
    expect(queryTerms('  timeout   retry ')).toEqual(['timeout', 'retry'])
    expect(queryTerms('   ')).toEqual([])
  })

  it('returns nothing for an empty query, rather than everything', () => {
    // Il caso peggiore possibile: una barra appena aperta che mostra tutti i nodi del
    // grafo. Non e' «tutto e basta», e' un elenco di trecento righe che l'utente
    // legge come un errore.
    const doc = document([prompt('a'), note('b'), response(prompt('c').id, 'd')], [])
    expect(searchNodes(doc, '')).toEqual([])
    expect(searchNodes(doc, '   ')).toEqual([])
  })
})

describe('the order of the results', () => {
  it('puts a prompt before an answer that happens to contain the same word', () => {
    /*
     * L'ordine e' meta' del lavoro. Un prompt e' stato **scritto** per essere eseguito;
     * una risposta contiene la parola perche' e' passata li' dentro. Cercando «retry»,
     * quello che si vuole ricordare e' il prompt, e quello che si trova per caso e'
     * l'altro.
     */
    const question = prompt('What should I retry?')
    const answer = response(question.id, 'You can retry the call.')
    const doc = document([answer, question], [])
    const hits = searchNodes(doc, 'retry')
    expect(hits[0]?.nodeId).toBe(question.id)
  })

  it('puts the node with more occurrences first, within the same kind', () => {
    const one = prompt('retry once')
    const many = prompt('retry retry retry')
    const doc = document([one, many], [])
    const hits = searchNodes(doc, 'retry')
    expect(hits[0]?.nodeId).toBe(many.id)
  })

  it('counts how many times the word appears, so a strong hit shows it', () => {
    const p = prompt('retry retry retry')
    const doc = document([p], [])
    expect(searchNodes(doc, 'retry')[0]?.occurrences).toBe(3)
  })

  it('keeps every result for the same node to one line', () => {
    // Un nodo che contiene la parola in tre campi non deve comparire tre volte: due
    // righe con lo stesso titolo sembranno due nodi diversi, e l'utente non sapra'
    // quale aprire.
    const p = prompt('retry')
    const n = note('retry')
    const doc = document([p, n], [])
    const hits = searchNodes(doc, 'retry')
    expect(hits).toHaveLength(2)
    expect(new Set(hits.map((hit) => hit.nodeId)).size).toBe(2)
  })
})

describe('what the result line shows', () => {
  it('shows the text around the word, not the first two thousand characters', () => {
    /*
     * Lo spezzone parte **vicino** alla parola. Uno spezzone dall'inizio del testo
     * sarebbe la cosa peggiore: si vedrebbe un pezzo che non c'entra niente e la
     * parola cercata sarebbe fuori in basso, e l'utente non saprebbe se il risultato
     * parla della cosa giusta.
     */
    const filler = 'padding words that have nothing to do with it. '.repeat(20)
    const p = prompt(`${filler}the needle is here${filler}`)
    const doc = document([p], [])
    const hit = searchNodes(doc, 'needle')[0]
    expect(hit?.snippet).toContain('needle')
    // I puntini di sospensione dicono che il testo continua fuori dalla riga: senza,
    // l'utente prenderebbe lo spezzone per il testo intero del nodo.
    expect(hit?.snippet).toMatch(/^…|…$/)
  })

  it('points at the word inside the snippet, so it can be lit up', () => {
    const p = prompt('first line\nsecond line with the needle inside\nthird line')
    const doc = document([p], [])
    const hit = searchNodes(doc, 'needle')[0]
    // L'indice deve cadere **esattamente** sul termine, altrimenti l'evidenziatore
    // illumina la parola nel posto sbagliato — che e' un difetto che fa dubitare
    // di tutta la ricerca, non di una lettera.
    expect(hit?.snippet.slice(hit!.at, hit!.at + hit!.length)).toBe('needle')
  })

  it('labels the node with the first line of what it says', () => {
    // Il titolo del risultato e' la prima riga, perche' e' quello che l'utente
    // ricorda di aver scritto. «Prompt» non aiuterebbe nessuno.
    const p = prompt('Remember the milk\nand the bread')
    const doc = document([p], [])
    expect(searchNodes(doc, 'milk')[0]?.title).toBe('Remember the milk')
  })
})

describe('a large graph', () => {
  it('stays quick, because it runs on every keystroke', () => {
    /*
     * La ricerca gira a **ogni lettera**, quindi un grafo grande e' il caso normale e
     * non un caso limite. Con trecento nodi grandi, un filtro che li passa in riga per
     * trecento volte — uno per termine, uno per campo — si nota. Non e' una richiesta di
     * ottimizzazione prematura: e' la condizione perche' la barra resti usabile.
     */
    const nodes = []
    for (let index = 0; index < 400; index += 1) {
      if (index % 3 === 0) nodes.push(prompt(`question number ${index} about the needle`))
      else if (index % 3 === 1) nodes.push(note(`note number ${index} mentions the thread`))
      else nodes.push(response(prompt(`q${index}`).id, `answer number ${index} about the needle`))
    }
    const doc = document(nodes, [])
    const started = Date.now()
    // Il limite e' alto apposta: il test e' sul costo della ricerca, non su quanti
    // risultati ne tornano fuori.
    const hits = searchNodes(doc, 'needle', 500)
    const elapsed = Date.now() - started
    expect(hits.length).toBeGreaterThan(100)
    // Un margine largo, perche' il clock di una macchina sotto carico e' rumoroso. Il
    // punto e' che non e' un'operazione che blocca, non che faccia 400 nodi in 1ms.
    expect(elapsed).toBeLessThan(2000)
  })

  it('stops at the limit, so the list stays readable', () => {
    const nodes = Array.from({ length: 100 }, (_, index) => prompt(`needle ${index}`))
    const doc = document(nodes, [])
    expect(searchNodes(doc, 'needle', 10)).toHaveLength(10)
  })
})
