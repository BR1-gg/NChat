/**
 * La conoscenza: le due domande a cui si puo' rispondere senza un modello in esecuzione.
 *
 * **«Lo ha messo nel posto giusto?»** e **«al modello gli ha dato queste note e non
 * altre?»**. Entrambe sono decidibili qui, e sono le uniche due cose che quest'archivio
 * deve saper fare. Il resto — disegnarlo in 3D, mostrare i pulsanti — e' roba da provare
 * con gli occhi, e non vale un test.
 *
 * I test sono scritti sulle **promesse che rompono**, non sul caso che funziona: notare
 * senza parentele, due note senza una parola in comune, il modello che non deve poter
 * cancellare. Un test che conferma che il codice fa quello che fa il codice non trova
 * niente, e con il tempo si legge come una garanzia falsa.
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RETRIEVAL,
  PLACEMENT_THRESHOLD,
  RELATED_THRESHOLD,
  estimateTokens,
  hubShellPoint,
  linkPairs,
  neighboursOf,
  pickedInjection,
  placeKnowledge,
  prepareEntry,
  renderKnowledgeBlock,
  retrieveKnowledge,
  searchKnowledge,
  similarity,
  suggestHub,
  termWeights,
  titleFor,
  tokenize,
} from './knowledge'
import { assembleMessages } from './assemble'
import {
  KNOWLEDGE_READ_ONLY_NOTICE,
  type KnowledgeDraft,
  type KnowledgeEntry,
  type KnowledgeHub,
  type Vec3,
} from '../types/knowledge'
import { document, prompt } from '../test/factories'

function entry(over: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: over.id ?? 'e1',
    title: over.title ?? 'Titolo',
    text: over.text ?? 'Testo',
    source: { workspaceId: null, workspaceName: null, nodeTitle: null, nodeId: null },
    /*
     * I due campi nuovi si mettono cosi' che si possano **far mancare**, e non per
     * pigrizia: e' il caso che la lettura dal database deve sopportare. Una riga senza
     * `hubId` e senza `links` e' una riga di un archivio salvato prima che esistessero, e
     * se il costruttore non permette di ometterli nessun test puo' accorgersi che aprire
     * un archivio di tre settimane fa non dia nulla.
     */
    hubId: over.hubId ?? null,
    links: over.links ?? [],
    // Anche il colore si puo' far mancare, per la stessa ragione: una riga senza la colonna
    // e' una riga scritta prima che il colore esistesse, e deve aprire come «il colore del
    // tema» senza che nessuno se ne accorga.
    color: over.color ?? 'default',
    position: over.position ?? { x: 0, y: 0, z: 0 },
    createdAt: over.createdAt ?? 1,
    updatedAt: over.updatedAt ?? 1,
    placedBecause: over.placedBecause ?? 'test',
  }
}

function draft(text: string): KnowledgeDraft {
  return {
    text,
    source: { workspaceId: null, workspaceName: null, nodeTitle: null, nodeId: null },
  }
}

describe('what counts as a word', () => {
  it('drops the words that carry no meaning', () => {
    // Ogni parola viene affiancata dalla sua ipotesi di singolare quando c'e', quindi qui
    // si conta anche «trimestre» due volte: e' il prezzo di far incontrare «trimestri» con
    // «trimestre», che senza diventerebbero due parole diverse.
    const tokens = tokenize('il mercato e la new del trimestre')
    expect(tokens).toEqual(expect.arrayContaining(['mercato', 'new', 'trimestre']))
    // Gli ausiliari e le congiunzioni spariscono: sono loro, non la lunghezza, a decidere.
    for (const stopword of ['il', 'la', 'del']) expect(tokens).not.toContain(stopword)
  })

  it('lets a plural and its singular meet', () => {
    /*
     * Il difetto che questo chiude, e che in italiano capita subito: si cerca «quanto cala
     * il margine dei **listini**», l'archivio ha «sul **listino**», e senza questo la nota
     * che serviva non veniva trovata. Il singolare e' di solito la forma che si scrive,
     * quindi non e' un caso limite — e' il primo caso in cui capita.
     */
    const plural = new Set(tokenize('i listini del trimestre'))
    const singular = new Set(tokenize('sul listino di riferimento'))
    const shared = [...plural].filter((token) => singular.has(token))
    expect(shared).toContain('listino')
  })

  it('leaves a short word alone instead of guessing at it', () => {
    /*
     * Sotto cinque lettere la regola non prova nemmeno: «anni» resta «anni».
     *
     * E va detto il limite vero: la regola sbaglia sui plurali irregolari. «paesi» diventa
     * «paeso», che non e' la parola giusta, e quindi non incontra «paese». Funziona per
     * «listini» e «risposte», che sono la maggior parte dei casi; non funziona per le
     * irregolari, e non c'e' un modo economicale per coprirle senza un dizionario delle
     * radici che funzionerebbe solo per l'italiano e romperebbe ogni altra lingua.
     */
    expect(tokenize('anni')).toEqual(['anni'])
    // E la prova che la regola e' volutamente grossolana: sbaglia, ma sbaglia **sempre
    // uguale** ai due lati, e quindi due parole che erano la stessa restano la stessa.
    expect(tokenize('paesi')).toContain('paesi')
  })

  it('treats an accented word as the same word as its unaccented twin', () => {
    // Senza questo, «perche'» e «perché» sarebbero due parole diverse e la similitudine
    // non le troverebbe mai. E' il caso piu' comune in italiano, quindi il piu' dannoso.
    expect(tokenize('perché no')).toEqual(tokenize('perche no'))
  })

  it('ignores anything too short to be a topic', () => {
    expect(tokenize('a b c listini')).toEqual(['listini', 'listino'])
  })

  it('keeps numbers, because a figure is often the point of a note', () => {
    // «dodici per cento» e il fatto che il numero torni sono spesso il motivo per cui la
    // nota e' stata salvata. Buttare i numeri renderebbe due note sullo stesso margine
    // diverse l'una dall'altra, che e' il contrario di quello che serve.
    expect(tokenize('calato del 12%')).toContain('12')
  })
it('stays inside a token budget, because it is paid on every single request', () => {
    /*
     * Questo e' il test che tiene fermo il numero, e nasce da una domanda vera: «perche' il
     * consumo e' salito?». La risposta era che le **istruzioni** costavano piu' delle note —
     * 212 token a blocco contro circa 100 per nota, che e' troncata a 320 caratteri. Si stava
     * pagando quattro volte il contenuto per dire al modello come comportarsi, e in due blocchi
     * erano otto volte.
     *
     * Il tetto qui e' deliberatamente stretto, e non e' un numero magico: e' il punto in cui
     * l'istruzione comincia a costare piu' di quello che serve. Oggi sta a 87 token con quattro
     * richieste dentro, quindi il margine non e' tanto da sembrare che il tetto sia stato messo
     * largo apposta per farlo passare — e se un domani si aggiunge una frase, il test chiede
     * prima di misurare quanto costa.
     *
     * Nota sul perche' della soglia e non di un confronto con un valore esatto: una frase
     * aggiunta non deve far fallire il test perche' il testo e' diverso, ma perche' il costo e'
     * diverso. Il testo si verifica nei test qui sopra, parola per parola; qui si verifica il
     * conto, che e' la cosa che non si vede.
     */
    const tokens = estimateTokens(KNOWLEDGE_READ_ONLY_NOTICE)
    expect(
      tokens,
      `The instruction is ${tokens} tokens and is sent with every knowledge block. ` +
        'Keep it under the budget, and put anything that explains *why* in the comment above ' +
        'instead — a comment is free.',
    ).toBeLessThanOrEqual(120)
  })

  it('costs less than a single note, so the overhead is not the point', () => {
    /*
     * Il confronto che rende leggibile il tetto. Una nota costa circa 100 token (320 caratteri
     * troncati piu' il titolo), quindi un'istruzione da 87 sta sotto; una da 212 stava sopra,
     * ed era quella la cosa da correggere.
     *
     * Il punto non e' un numero preciso — e' la direzione. Se un domani l'istruzione supera
     * una nota, vuol dire che si sta pagando piu' per spiegare che per dire, che e' il difetto
     * in forma diversa da quello che questo file corregge.
     */
    const instruction = estimateTokens(KNOWLEDGE_READ_ONLY_NOTICE)
    const oneNote = estimateTokens(`Titolo\n${'x'.repeat(320)}`)
    expect(instruction, `instruction ${instruction} vs one note ${oneNote}`).toBeLessThan(oneNote)
  })
})

describe('what makes a word worth matching', () => {
  const corpus = [
    'il margine sui listini e calato del dodici per cento',
    'il margine e previsto in crescita nel prossimo trimestre',
    'il margine operativo resta stabile sul terzo trimestre',
    'la ricetta del risotto con le zucchine arrosto',
  ]

  it('counts a rare word higher than a common one', () => {
    /*
     * E' il motivo per cui il recupero usa il peso di rarita' invece del solo coseno.
     *
     * Senza, una nota che condivide «trimestre» vale quanto una che condivide «dodici» — e
     * non sono la stessa cosa: in un archivio di riassunti trimestrali «trimestre» e' in
     * tutte le note e non distingue niente, mentre «dodici» compare in una sola e dice
     * esattamente quale. Con la rarita', la domanda sul margine trova la nota sul dodici per
     * centro molto prima delle altre tre che parlano solo di trimestri.
     */
    const shared = 'i listini'
    const rare = 'dodici per cento'
    const sharedHits = retrieveKnowledge(shared, corpus.map((text, index) => entry({ id: `s${index}`, text })))
    const rareHits = retrieveKnowledge(rare, corpus.map((text, index) => entry({ id: `s${index}`, text })))
    expect(rareHits.hits[0]?.entry.text).toContain('dodici')
    expect(rareHits.hits[0]?.score ?? 0).toBeGreaterThan(sharedHits.hits[0]?.score ?? 0)
  })
})

describe('comparing two texts', () => {
  it('gives nothing to two texts with no word in common', () => {
    // Il caso che tiene in piedi il recupero. Se due note non hanno niente in comune non
    // si devono accostare ne' citare insieme, e il resto del meccanismo dipende da questo
    // numero che vale esattamente zero.
    expect(similarity('margine sui listini', 'ricette della cucina')).toBe(0)
  })

  it('weighs a word by how much it describes the text, not by how often it repeats', () => {
    /*
     * Una nota lunga che ripete una parola non deve battere una nota breve in cui quella
     * parola e' tutto. Con i conteggi grezzi il risultato e' l'opposto di quello che
     * significa «questa nota parla di questo»: si vince la piu' lunga.
     */
    const short = termWeights('listini')
    const long = termWeights(`listini ${'parola '.repeat(40)}`)
    expect(short[0]?.term).toBe('listini')
    expect(long.find((w) => w.term === 'listini')?.weight).toBeLessThan(short[0]?.weight ?? 1)
  })

  it('counts a shared title only through the text, never twice', () => {
    /*
     * Qui stava un difetto vero, e la ragione per cui esiste questo test e non una funzione
     * `entrySimilarity`.
     *
     * Il titolo veniva pesato **in piu'** rispetto al testo, e cosi' due note che avevano
     * solo lo stesso titolo generico — «Risposta», che e' un titolo che esce spesso perche'
     * deriva dalla prima riga — si trovavano una somiglianza di 0.5, cinque volte la soglia.
     * Il risultato era che due note senza una parola in comune finivano accostate e citate
     * insieme, perche' avevano il titolo uguale. E il titolo, essendo di solito la prima
     * riga del testo, e' gia' dentro il confronto: pesarlo di nuovo lo contava due volte.
     *
     * Quindi qui il titolo non ha un peso proprio: e' parte del testo che si confronta, e
     * nient'altro. Il titolo serve a dare un nome alla nota, non a fare somiglianza.
     */
    const a = entry({ title: 'Risposta', text: 'il margine sui listini e calato' })
    const b = entry({ title: 'Risposta', text: 'la ricetta del risotto con le zucchine' })
    /*
     * Resta una parola in comune — il titolo — e quindi un punteggio piccolo ma non zero.
     * Non si pretende lo zero: se il titolo dice «Risposta» su entrambe, dire che non hanno
     * niente in comune sarebbe falso.
     *
     * Quello che conta e' che quel punteggio **non li faccia parentela**. Il difetto era
     * esattamente questo: due note senza una parola in comune finivano accostate e citate
     * insieme perche' avevano il titolo uguale. La soglia sotto la quale devono restare e'
     * la vera difesa, ed e' anche la prima che si rompe se qualcuno alza la soglia o cambia
     * il peso delle parole.
     */
    const score = similarity(`${a.title} ${a.text}`, `${b.title} ${b.text}`)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(RELATED_THRESHOLD)
    // E il posto in cui il titolo veniva contato due volte: 0.5, cinque volte la soglia.
    expect(score).toBeLessThan(0.1)
  })
})

describe('where a note is put', () => {
  it('puts it next to the note it most resembles', () => {
    const existing = [entry({ id: 'a', title: 'Listini', text: 'il margine sui listini e calato' })]
    const placement = placeKnowledge(draft('il margine sui listini cala ancora'), existing, 'new')
    expect(placement.neighbourId).toBe('a')
    expect(placement.similarity).toBeGreaterThanOrEqual(PLACEMENT_THRESHOLD)
    expect(placement.because).toContain('Listini')
  })

  it('puts a note next to one that shares a single distinctive word', () => {
    /*
     * Il caso che ha reso necessaria una soglia tutta sua. Due note brevi che hanno in
     * comune una parola sola — «listino» — hanno un coseno bassissimo, perche' le altre
     * parole sono diverse. Con la soglia del recupero finivano su due orbite lontane, e la
     * mappa non mostrava la parentela che c'era: il difetto per cui questo archivio esiste.
     *
     * Su test brevi il numero assoluto non dice niente, quindi qui non si guarda il
     * coseno: si guarda il posto, che e' la cosa che l'utente vede.
     */
    const existing = [
      entry({ id: 'a', title: 'Margine', text: "Il margine e' calato del dodici per cento sul listino." }),
    ]
    const placement = placeKnowledge(
      draft('Il listino di riferimento del trimestre e stato aggiornato due volte.'),
      existing,
      'new',
    )
    expect(placement.neighbourId).toBe('a')
  })

  it('still refuses a note with nothing in common, even at the lower placement bar', () => {
    // La soglia bassa non deve aprire il porta a note che non hanno niente da dirsi: e'
    // l'unico caso in cui il materiale sarebbe davvero fuori tema, e quindi l'unico che il
    // recupero non deve mai lasciar passare.
    const existing = [entry({ id: 'a', title: 'Cucina', text: 'la ricetta del risotto con le zucchine' })]
    const placement = placeKnowledge(draft('il margine sui listini cala'), existing, 'new')
    expect(placement.neighbourId).toBeNull()
    expect(retrieveKnowledge('il margine sui listini cala', existing).entryIds).toEqual([])
  })

  it('does not pretend there is a right place when nothing is related', () => {
    // Il caso senza parentele e' normale, non un errore. Una nota che si dichiara vicina a
    // qualcosa di non correlato e' peggio di una che ammette di stare da sola: l'utente
    // si fida della mappa e la guarda sbagliata.
    const existing = [entry({ id: 'a', title: 'Cucina', text: 'la ricetta del risotto' })]
    const placement = placeKnowledge(draft('il margine sui listini cala'), existing, 'new')
    expect(placement.neighbourId).toBeNull()
    expect(placement.because).toBe('no related note yet')
  })

  it('lands on the same spot every time, for the same note', () => {
    /*
     * La posizione viene salvata, quindi un caso diverso a ogni esecuzione sposterebbe
     * note senza che nessuno le abbia toccate. Una mappa che si muove da sola non e'
     * navigabile, ed e' il difetto che fa smettere di fidarsi.
     */
    const existing = [entry({ id: 'a', text: 'il margine sui listini' })]
    const once = placeKnowledge(draft('i listini'), existing, 'stable-id')
    const twice = placeKnowledge(draft('i listini'), existing, 'stable-id')
    expect(once.position).toEqual(twice.position)
  })

  it('keeps unrelated notes apart instead of stacking them on the origin', () => {
    const a = placeKnowledge(draft('primo argomento'), [], 'a')
    const b = placeKnowledge(draft('secondo argomento'), [{ ...entry({ id: 'a' }), placedBecause: 'no related note yet' }], 'b')
    const distance = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y, a.position.z - b.position.z)
    expect(distance).toBeGreaterThan(1)
  })

  it('gives a title from the first line, and shortens a one-line passage', () => {
    // Il titolo non puo' essere inventato: se mente sul contenuto, peggio che niente. La
    // prima riga e' testo che c'era davvero.
    expect(titleFor('prima riga\nseconda riga')).toBe('prima riga')
    expect(titleFor('  uno due tre  ')).toBe('uno due tre')
    expect(titleFor('x'.repeat(200)).length).toBeLessThanOrEqual(60)
  })
})

describe('what the model is given', () => {
  const library: KnowledgeEntry[] = [
    entry({ id: 'a', title: 'Listini', text: 'il margine sui listini e calato del dodici per cento' }),
    entry({ id: 'b', title: 'Cucina', text: 'la ricetta del risotto con le zucchine' }),
    entry({ id: 'c', title: 'Listini 2026', text: 'le previsioni sui listini del prossimo anno' }),
  ]

  it('gives nothing at all rather than something irrelevant', () => {
    /*
     * Una domanda che non ha **nessuna** parola in comune con l'archivio.
     *
     * La prima versione di questo test chiedeva come si prepara il risotto e si aspettava
     * nessuna nota — ma l'archivio aveva una nota sul risotto, quindi la risposta giusta
     * era quella nota. Il test era sbagliato, non il codice, ed e' un buon esempio del
     * pericolo di scrivere un caso negativo con una query che qualcosa contiene davvero:
     * il test che si rompe da solo viene letto come «il codice e' rotto» invece che come
     * «il test era sbagliato», e si butta via la protezione insieme.
     */
    const result = retrieveKnowledge('pressione barometrica a Praga', library)
    expect(result.entryIds).toEqual([])
    expect(result.body).toBe('')
  })

  it('finds a note even when the query is about a word deep inside it', () => {
    // Il caso che distingue «non ho niente» da «non ho cercato bene»: una nota che parla
    // di zucchine deve venire fuori quando si chiede del risotto, perche' e` la stessa
    // ricetta. Un archivio che non trova questo e' inutile.
    const result = retrieveKnowledge('come si prepara il risotto', library)
    expect(result.entryIds).toContain('b')
  })

  it('quotes only what matches, best first', () => {
    const result = retrieveKnowledge('quanto e calato il margine listini', library)
    expect(result.entryIds).toContain('a')
    expect(result.entryIds).not.toContain('b')
    // Il piu' simile in cima, perche' e' il primo che il modello legge.
    expect(result.entryIds[0]).toBe('a')
  })

  it('finds a note even when the query plural differs from the note', () => {
    // Il caso vero, non uno inventato per il test: si scrive «listini» e la nota dice
    // «listino». Senza l'accoppiamento fra plurale e singolare la ricerca tornava vuota
    // mentre la nota giusta era li', e il sintomo e' impossibile da distinguere da
    // «non ho niente salvato su questo argomento».
    const pluralQuery = retrieveKnowledge('quanto cala il margine dei listini', library)
    expect(pluralQuery.entryIds).toContain('a')
  })

  it('stays inside the token budget', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      entry({ id: `x${i}`, title: 'Listini', text: `margine listini nota numero ${i} con un po' di testo` }),
    )
    const result = retrieveKnowledge('margine listini', many, { budgetTokens: 120, limit: 10 })
    expect(result.estimatedTokens).toBeLessThanOrEqual(120)
    expect(result.entryIds.length).toBeGreaterThan(0)
  })

  it('never exceeds the limit even with a large archive', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      entry({ id: `y${i}`, title: 'Listini', text: `margine listini nota ${i}` }),
    )
    expect(retrieveKnowledge('margine listini', many, { limit: 3 }).entryIds).toHaveLength(3)
  })

  it('reports honestly when nothing was relevant', () => {
    const result = retrieveKnowledge("tutto da un'altra parte", library)
    expect(result.nothingRelevant).toBe(true)
    expect(result.entryIds).toEqual([])
  })

  it('quotes a passage on one line, so the block is an index rather than the archive', () => {
    const multiline = [entry({ id: 'm', title: 'T', text: 'riga uno\nriga due\nriga tre' })]
    const result = retrieveKnowledge('riga due', multiline, { threshold: 0 })
    expect(result.body).not.toContain('\nriga')
    expect(result.body.split('\n').length).toBeLessThanOrEqual(2)
  })
})

describe('what the model actually receives', () => {
  const library = [
    entry({ id: 'a', title: 'Listini', text: 'il margine sui listini e calato del dodici per cento' }),
    entry({ id: 'b', title: 'Cucina', text: 'la ricetta del risotto con le zucchine' }),
  ]

  it('goes in as a system message, and the request counts it', () => {
    /*
     * Il posto e' un messaggio **system** perche' e' l'unico che funziona con ogni
     * provider, e il conteggio dei token deve includerlo: `estTokens` e' la cifra che fa
     * scattare l'avviso di contesto troppo grande e che finisce scritta sulla risposta. Se
     * l'archivio aggiungesse mille token invisibili al conto, il numero che serve per capire
     * quando il contesto e' troppo grande direbbe il contrario di quello che e'.
     */
    const question = prompt('quanto cala il margine dei listini?', 'p1')
    const doc = document([question], [])
    const injection = retrieveKnowledge('quanto cala il margine dei listini', library)
    const text = renderKnowledgeBlock(injection)
    expect(text).not.toBe('')

    const withKnowledge = assembleMessages(doc, 'p1', { knowledge: text })
    const system = withKnowledge.messages.find((message) => message.role === 'system')
    // Il segno di riconoscimento e' il **tag**, non il titolo: e' quello che delimita il
    // materiale, e quindi quello su cui il modello fa affidamento per capire dove finisce.
    expect(system?.content).toContain('<saved_knowledge>')
    expect(system?.content).toContain('dodici')
    // La ricetta non c'entra e non deve arrivare: materiale sbagliato in una risposta e'
    // peggio che nessun materiale.
    expect(system?.content).not.toContain('zucchine')

    const without = assembleMessages(doc, 'p1')
    expect(withKnowledge.estTokens).toBeGreaterThan(without.estTokens)
  })

  it('adds nothing at all when nothing matches', () => {
    // Il silenzio e' il comportamento normale, non un caso limite. Un blocco che dice sempre
    // qualcosa smette di essere informativo, e qui si tratta di token che si pagano a ogni
    // richiesta.
    const question = prompt('domanda qualsiasi', 'p1')
    const doc = document([question], [])
    const injection = retrieveKnowledge('pressione a Praga', library)
    expect(renderKnowledgeBlock(injection)).toBe('')
    const result = assembleMessages(doc, 'p1', { knowledge: renderKnowledgeBlock(injection) })
    expect(result.messages.some((message) => String(message.content).includes('<saved_knowledge>'))).toBe(false)
  })

  it('closes the block, so the model can tell where its own words start again', () => {
    // Un blocco che arriva a meta' del contesto e' indistinguibile dal testo dell'utente se
    // non ha un confine, e il difetto e' invisibile: produce risposte sicurissime su cose
    // che l'utente non ha detto.
    const injection = retrieveKnowledge('quanto cala il margine dei listini', library)
    const text = renderKnowledgeBlock(injection)
    expect(text).toContain('<saved_knowledge>')
    expect(text).toContain('</saved_knowledge>')
    expect(text.indexOf('<saved_knowledge>')).toBeLessThan(text.lastIndexOf('</saved_knowledge>'))
  })
})

describe('what the model may not do', () => {
  it('is told, in the text it is given, that it cannot change anything', () => {
    /*
     * La regola che vale davvero e' che **non esiste un canale**: nessun modo di formulare
     * una richiesta di cancellazione che arrivi ai dati. Questa frase e' la seconda
     * linea di difesa, non la prima, e serve ache il modello non perda tempo a
     * promettere che l'ha fatto — perche' un modello che dice «l'ho rimosso» e non
     * puo' averlo fatto e' peggio di un modello che non lo dice.
     */
    expect(KNOWLEDGE_READ_ONLY_NOTICE).toMatch(/cannot edit or delete/)
    expect(KNOWLEDGE_READ_ONLY_NOTICE).toMatch(/say so and the person\s+decides/)
    // "Do not claim to have changed anything" e' esplicito perche' e' la frase che
    // salva l'utente dal dover verificare se il modello ha fatto qualcosa.
    expect(KNOWLEDGE_READ_ONLY_NOTICE).toMatch(/Never claim to have changed anything/)
  })
})

describe('what the model is told to do with them', () => {
  /*
   * Questo blocco e' nato da una domanda vera: «non riesco a capire se l'AI sta usando i
   * dati». La risposta era che le note arrivavano ma il modello non aveva nessun motivo di
   * darci peso — l'avviso diceva solo che poteva citarle, e un permesso non e' un ordine.
   *
   * Quindi qui non si controlla che il testo sia bello, ma che ci siano **le tre richieste**
   * senza delle quali la risposta del modello e' indistinguibile da una senza note.
   */
  it('is told to answer from the notes, not merely allowed to', () => {
    // La differenza fra le due parole e' tutta la questione: "may quote" e' un permesso,
    // "Answer from them" e' un'istruzione.
    expect(KNOWLEDGE_READ_ONLY_NOTICE).toMatch(/Answer from these notes/)
    expect(KNOWLEDGE_READ_ONLY_NOTICE).toMatch(/Prefer them over what you remember/)
  })

  it('is told to name the note it used, which is how the user can tell it did', () => {
    // E' la riga che rende l'uso **leggibile**. Senza, l'unica prova che le note siano state
    // usate resta il fatto che il blocco era pronto, e il blocco era pronto anche quando il
    // modello lo ignorava del tutto.
    expect(KNOWLEDGE_READ_ONLY_NOTICE).toMatch(/name the one you use/)
  })

  it('is told to admit when the notes do not cover the question', () => {
    /*
     * Il caso peggiore non e' il modello che non usa le note: e' il modello che le usa in
     * parte e dà l'impressione di aver risposto con quello. Senza questa frase il silenzio
     * e' indistinguibile dall'ignoranza, e la risposta sembra autorevole mentre poggia su
     * niente.
     */
    expect(KNOWLEDGE_READ_ONLY_NOTICE).toMatch(/say so if they do not cover\s+the question/)
  })

  it('still refuses to write, so making the model use them did not unlock editing', () => {
    // Le due frasi non si contraddicono: gli si chiede di fidarsi del contenuto, non di
    // poterlo cambiare. Se questa riga saltasse, l'archivio diventerebbe scrivibile dal
    // modello — che e' la cosa che nessun prompt dovrebbe poter fare.
    expect(KNOWLEDGE_READ_ONLY_NOTICE).toMatch(/You cannot edit or delete them/)
  })

  it('travels with the notes chosen by hand, not only with automatic retrieval', () => {
    /*
     * Il nodo Knowledge costruisce il suo blocco riutilizzando `renderKnowledgeBlock`, e
     * quindi riceve lo stesso avviso. Se un giorno i due percorsi prendessero strade diverse,
     * le note scelte a mano sarebbero le uniche a non essere spronate — cioe' esattamente
     * quelle che l'utente ha scelto lui.
     */
    const entries = [
      {
        id: 'n1',
        title: 'Margine',
        text: 'il margine cala del 12%',
        source: { workspaceId: null, workspaceName: null, nodeTitle: null, nodeId: null },
        hubId: 'prezzi',
        links: [],
        color: 'default' as const,
        position: { x: 0, y: 0, z: 0 },
        createdAt: 1,
        updatedAt: 1,
        placedBecause: 'test',
      },
    ]
    const picked = pickedInjection(entries, 'Prezzi e listini')
    expect(picked).not.toBeNull()
    expect(picked).toContain('Answer from these notes')
    expect(picked).toContain('name the one you use')
  })
})

describe('saving a passage', () => {
  it('keeps the title the user wrote', () => {
    const prepared = prepareEntry({ ...draft('il testo'), title: 'Il mio titolo' }, [], 'id1')
    expect(prepared.title).toBe('Il mio titolo')
  })

  it('falls back to the text when there is no title', () => {
    const prepared = prepareEntry(draft('prima riga\nseconda'), [], 'id1')
    expect(prepared.title).toBe('prima riga')
  })

  it('trims the text and reports where it put it', () => {
    const long = 'parola '.repeat(2000)
    const prepared = prepareEntry(draft(long), [], 'id1')
    expect(prepared.text.length).toBeLessThanOrEqual(4000)
    expect(prepared.placement.position).toBeDefined()
  })
})

describe('the numbers the defaults rest on', () => {
  it('has a budget that fits comfortably inside a normal context', () => {
    // Il punto di questo numero e' che sia **piccolo abbastanza**. Un archivio che costa
    // piu' di qualche centinaia di token per richiesta finisce per costare piu' del
    // lavoro che fa, e su ogni richiesta — anche su quella a cui non serve niente.
    expect(DEFAULT_RETRIEVAL.budgetTokens).toBeLessThanOrEqual(1500)
    expect(DEFAULT_RETRIEVAL.limit).toBeLessThanOrEqual(8)
  })

  it('estimates tokens generously rather than hopefully', () => {
    // Una stima che sottovaluta fa sfondare il contesto. Meglio stimare alto.
    expect(estimateTokens('a'.repeat(100))).toBeGreaterThan(20)
  })
})

/*
 * I **punti di contesto**: i centri che l'utente crea e a cui appende le note.
 *
 * La promessa che conta e' una sola, ed e' l'unica che un algoritmo non puo' rispettare da
 * solo: **la scelta dell'utente vince**. Tutto il resto — dove cade una nota che non ha un
 * centro, se due note si somigliano, se un centro e' vuoto — e' contorno.
 *
 * I test qui sotto sono scritti sulle cose che **rompono** quella promessa, non sul caso in
 * cui funziona: un centro che viene ignorato, un centro che sparisce ma lascia il filo, un
 * collegamento che sopravvive alla nota dall'altra parte.
 */

function hub(over: Partial<KnowledgeHub> = {}): KnowledgeHub {
  return {
    id: over.id ?? 'h1',
    title: over.title ?? 'Pricing',
    position: over.position ?? { x: 0, y: 0, z: 0 },
    createdAt: over.createdAt ?? 1,
    updatedAt: over.updatedAt ?? 1,
  }
}

describe('a main point beats every guess', () => {
  const existing = [entry({ id: 'near', title: 'Listini', text: 'quanto cala il margine dei listini' })]
  const centre = hub()

  it('puts the note under the chosen main point even when a note is much closer', () => {
    /*
     * Il caso che chiude questo blocco. Una nota che parla esattamente come una nota gia'
     * presente verrebbe accostata a quella dal confronto fra le parole — ed e' il
     * comportamento giusto **quando l'utente non ha indicato un centro**. Indicandone uno,
     * la nota va li': se la finestra chiede «dove la metto?» e poi la risposta non conta,
     * la domanda e' una decorazione e il gesto di scegliere non serve a niente.
     */
    const placement = placeKnowledge(
      { ...draft('quanto cala il margine dei listini'), hubId: 'h1' },
      existing,
      'new1',
      [centre],
    )
    expect(placement.because).toBe('under "Pricing"')
    expect(distance(placement.position, centre.position)).toBeGreaterThan(2.5)
  })

  it('lands on the main point, not on the note it resembles', () => {
    const placement = placeKnowledge(
      { ...draft('quanto cala il margine dei listini'), hubId: 'h1' },
      existing,
      'new1',
      [centre],
    )
    // Il confronto fra le parole avrebbe messo la nota a due passi da `near`, che e' a
    // tre passi dal centro: il filo che legge l'utente sarebbe stato quello sbagliato.
    expect(distance(placement.position, existing[0]!.position)).toBeGreaterThan(
      distance(existing[0]!.position, centre.position),
    )
  })

  it('spreads the notes of one main point outward instead of stacking them', () => {
    const first = hubShellPoint(centre, 0, 'a')
    const second = hubShellPoint(centre, 1, 'b')
    // Se il raggio fosse lo stesso, due note sullo stesso centro finirebbero addossate e
    // la repulsione della mappa le separerebbe a forza, spostandole da dove sono state
    // appese. Il gradino e' quello che rende il gruppo **leggibile**.
    expect(distance(first, second)).toBeGreaterThanOrEqual(2.4)
  })

  it('treats a main point that no longer exists as no main point at all', () => {
    /*
     * Il centro scelto e' sparito fra la scelta e il salvataggio. Non e' un errore da
     * fermare: la nota viene trattata come libera, e non appesa a un id che non porta da
     * nessuna parte — che e' la stessa regola dei collegamenti verso note cancellate.
     */
    const placement = placeKnowledge({ ...draft('parola'), hubId: 'gone' }, existing, 'new1', [])
    expect(placement.because).not.toContain('under')
  })

  it('falls back to the words when the user chose no main point', () => {
    const placement = placeKnowledge(
      { ...draft('quanto cala il margine dei listini'), hubId: null },
      existing,
      'new1',
      [centre],
    )
    expect(placement.because).toBe('next to "Listini"')
  })

  it('puts the main point name in the text given to the model, and only there', () => {
    /*
     * Il nome del centro e' l'unico modo in cui la scelta dell'utente arriva al modello:
     * distanze, colori e linee sono roba da guardare, e al modello non ne arriva niente.
     * E deve arrivare come **richiamo**, non come titolo: sostituirlo al titolo
     * nasconderebbe il testo della nota, che e' la cosa che il modello deve leggere.
     */
    const hung = [entry({ id: 'a', title: 'Margine', text: 'il margine cala sul listino', hubId: 'h1' })]
    const block = renderKnowledgeBlock(retrieveKnowledge('margine listino', hung, { hubs: [centre] }))
    expect(block).toContain('[Pricing] Margine')
    // E il centro non entra fra le note citate: `entryIds` elenca i passaggi che il modello
    // puo' citare, e un nome di comodo non e' un passaggio.
    expect(retrieveKnowledge('margine listino', hung, { hubs: [centre] }).entryIds).toEqual(['a'])
  })

  it('leaves the block exactly as it was when no main point is given', () => {
    const plain = [entry({ id: 'a', title: 'Margine', text: 'il margine cala sul listino' })]
    const result = retrieveKnowledge('margine listino', plain)
    expect(result.body.startsWith('- Margine')).toBe(true)
  })
})

describe('ties between notes, read from one side', () => {
  it('sees a tie written from either end', () => {
    const list = [entry({ id: 'a', links: ['b'] }), entry({ id: 'b', links: [] })]
    expect(neighboursOf(list, 'a')).toContain('b')
    expect(neighboursOf(list, 'b')).toContain('a')
  })

  it('drops a tie to a note that is gone, so no thread hangs in the air', () => {
    /*
     * Una nota cancellata che non si porta via i suoi legami lascia un filo che finisce
     * nel vuoto. E' il caso peggiore: si vede che un rapporto c'e' e non c'e' piu' nessuno
     * dall'altra parte, e la mappa sembra ricordare qualcosa che e' sparito.
     */
    expect(neighboursOf([entry({ id: 'a', links: ['ghost'] })], 'a')).toEqual([])
  })

  it('never lists a note as tied to itself', () => {
    expect(neighboursOf([entry({ id: 'a', links: ['a'] })], 'a')).toEqual([])
  })

  it('draws a tie written from both sides exactly once', () => {
    /*
     * Due note che si puntano a vicenda hanno un rapporto solo. Disegnarlo due volte fa
     * vedere il doppio di un legame, e l'utente conta i fili per capire com'e' fatto
     * l'archivio: conta due e sbaglia.
     */
    const list = [entry({ id: 'a', links: ['b'] }), entry({ id: 'b', links: ['a'] })]
    expect(linkPairs(list)).toHaveLength(1)
  })
})

describe('searching the archive', () => {
  const list = [
    entry({ id: 'a', title: 'Margine', text: 'il margine cala sul listino, listino annesso' }),
    entry({ id: 'b', title: 'Budget', text: 'budget annuale da rivedere' }),
  ]

  it('asks for every word, like the workspace search does', () => {
    /*
     * La stessa regola dei due posti, e per la stessa ragione: un risultato che contiene
     * una parola su tre e' rumore, e in una ricerca il rumore e' peggio di non trovare
     * niente. Due finestre con regole diverse insegnerebbero all'utente che una delle
     * due e' rotta.
     */
    expect(searchKnowledge(list, [], 'margine listino').map((hit) => hit.entryId)).toEqual(['a'])
    expect(searchKnowledge(list, [], 'margine budget')).toEqual([])
  })

  it('says which main point a note hangs from, so the result says what group it is in', () => {
    const hung = [entry({ id: 'a', title: 'Margine', text: 'margine e listino', hubId: 'h1' })]
    expect(searchKnowledge(hung, [hub()], 'margine')[0]?.hubTitle).toBe('Pricing')
  })

  it('brings the notes tied to a match along, so it answers «what is this about together?»', () => {
    // Una nota che non contiene la parola ma e' legata a una che la contiene e' comunque
    // la risposta a «di cosa parla questo insieme?» — ed e' la domanda che un archivio con
    // collegamenti sa rispondere e uno senza no.
    const tied = [
      entry({ id: 'a', text: 'parola cercata' }),
      entry({ id: 'b', text: 'niente qui', links: ['a'] }),
    ]
    expect(searchKnowledge(tied, [], 'cercata').map((hit) => hit.entryId)).toEqual(['a', 'b'])
  })

  it('puts the note that contains the word most often first', () => {
    const many = [
      entry({ id: 'a', text: 'listino una volta' }),
      entry({ id: 'b', text: 'listino listino listino' }),
    ]
    expect(searchKnowledge(many, [], 'listino')[0]?.entryId).toBe('b')
  })

  it('says nothing for an empty query, rather than listing everything', () => {
    expect(searchKnowledge(list, [], '   ')).toEqual([])
  })
})

describe('proposing a main point', () => {
  it('proposes the one whose name the passage is closest to', () => {
    const hubs = [hub({ id: 'f', title: 'Fisco' }), hub({ id: 'l', title: 'Listini' })]
    expect(suggestHub(draft('quanto cala il listino di vendita'), hubs)?.id).toBe('l')
  })

  it('proposes nothing when the names share no words with the passage', () => {
    /*
     * Il caso che vale la pena proteggere. Il confronto e' sulle **parole**, quindi un
     * centro scritto in un'altra lingua — o con parole che nel passaggio non compaiono —
     * non viene mai proposto. Proporre il meno peggio fra nomi che non c'entrano niente
     * e' il comportamento peggiore: l'utente preme per andarsene e si trova la nota nel
     * gruppo sbagliato, e la correzione costa piu' del salvataggio. Meglio nessuna
     * proposta che una proposta falsa.
     */
    expect(suggestHub(draft('quanto cala il listino'), [hub({ id: 'p', title: 'Pricing' })])).toBeNull()
  })

  it('proposes nothing when there are no main points at all', () => {
    expect(suggestHub(draft('parola qualsiasi'), [])).toBeNull()
  })
})

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}
