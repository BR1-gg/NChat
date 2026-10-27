/**
 * La traccia: **quali note dell'archivio sono arrivate al modello** in una risposta.
 *
 * Il file esiste per una domanda precisa: «l'AI sta usando i miei appunti?». Prima non c'era
 * nessuna risposta a questa domanda nell'applicazione, e la cosa piu' vicina che c'era — il
 * nodo che dice «2 notes · ~132 tokens» — diceva solo quante note *avrebbe* mandato. Sono due
 * fatti diversi, e sono l'unica cosa che l'utente aveva per capire se il canale fosse aperto.
 *
 * Quindi i test qui sono sulla catena intera, non sulla funzione: dall'id alla traccia alla
 * richiesta assemblata. Una traccia bellissima che nessuno scrive sul nodo non risolve niente,
 * e una traccia scritta su un nodo che non contiene quello che e' stato mandato e' peggio di
 * nessuna — perche' dice una cosa falsa con l'aria di una prova.
 */

import { describe, expect, it } from 'vitest'
import { assembleMessages } from './assemble'
import { knowledgeOfferedToPrompt, resolveKnowledgePick } from './knowledgeNode'
import { knowledgeTrail } from './knowledge'
import { document, edge, prompt, response } from '../test/factories'
import { normalizeDocument, serializeDocument } from '../persistence/storage'
import type { KnowledgeEntry, KnowledgeHub } from '../types/knowledge'

function entry(over: Partial<KnowledgeEntry> & { id: string }): KnowledgeEntry {
  return {
    title: 'Senza titolo',
    text: 'testo',
    source: { workspaceId: null, workspaceName: null, nodeTitle: null, nodeId: null },
    hubId: null,
    links: [],
    color: 'default',
    position: { x: 0, y: 0, z: 0 },
    createdAt: 1,
    updatedAt: 1,
    placedBecause: 'test',
    ...over,
  }
}

const priceHub: KnowledgeHub = {
  id: 'prezzi',
  title: 'Prezzi e listini',
  position: { x: 0, y: 0, z: 0 },
  createdAt: 1,
  updatedAt: 1,
}
const taxHub: KnowledgeHub = {
  id: 'fisco',
  title: 'Fisco',
  position: { x: 10, y: 0, z: 0 },
  createdAt: 2,
  updatedAt: 2,
}
const hubs = [priceHub, taxHub]

const notes = [
  entry({ id: 'n1', title: 'Margine', text: 'il margine cala', hubId: 'prezzi' }),
  entry({ id: 'n2', title: 'IVA', text: 'l IVA recuperabile', hubId: 'fisco' }),
]

describe('the trail it builds', () => {
  it('names the note and the main point it hangs under', () => {
    const trail = knowledgeTrail('node', ['n1', 'n2'], notes, hubs)
    expect(trail).toEqual([
      { id: 'n1', title: 'Margine', hub: 'Prezzi e listini', via: 'node' },
      { id: 'n2', title: 'IVA', hub: 'Fisco', via: 'node' },
    ])
  })

  it('says where each note came from, because "chosen" and "similar" are not the same', () => {
    /*
     * La distinzione che piu' spesso si perde: due note nell'archivio, una scelta dall'utente e
     * una trovata per somiglianza con la domanda. Nell'elenco dei titoli sono identiche, e
     * quindi la risposta «perche' ha citato questa e non quella?» non ha risposta. Sono due
     * comportamenti con conseguenze diverse — e sapere quale dei due e' successo e' metta
     * della conoscenza di quello che si puo' aspettare.
     */
    const chosen = knowledgeTrail('node', ['n1'], notes, hubs)
    const found = knowledgeTrail('retrieved', ['n1'], notes, hubs)
    expect(chosen[0]?.via).toBe('node')
    expect(found[0]?.via).toBe('retrieved')
  })

  it('drops ids that no longer exist, rather than listing a note that was not sent', () => {
    // Una traccia che mostra una nota cancellata e' una traccia che mente: l'utente legge un
    // titolo che nel contesto non c'era, e la confusione che ne nasce e' peggiore di una riga
    // in meno. E' la ragione per cui lo scarto e' silenzioso — la lista risponde «che cosa e'
    // arrivato», e un id sparito non e' arrivato a nessuno.
    const trail = knowledgeTrail('node', ['n1', 'cancellata'], notes, hubs)
    expect(trail.map((item) => item.id)).toEqual(['n1'])
  })

  it('leaves a loose note without a main point, rather than inventing one', () => {
    const loose = entry({ id: 'n3', title: 'Senza gruppo', hubId: null })
    expect(knowledgeTrail('node', ['n3'], [...notes, loose], hubs)[0]?.hub).toBeNull()
  })

  it('is empty, not absent, when there was no knowledge at all', () => {
    // La differenza fra «non c'era niente» e «non lo so» e' tutta qui, ed e' il motivo per cui
    // la traccia sta sul nodo come campo: un'assenza non si distingue da una risposta vecchia.
    expect(knowledgeTrail('retrieved', [], notes, hubs)).toEqual([])
  })
})

describe('what actually reached the model', () => {
  function knowledgeNode(over: Record<string, unknown> = {}) {
    return {
      id: 'k1',
      type: 'knowledge' as const,
      position: { x: 0, y: 0 },
      data: {
        kind: 'knowledge' as const,
        auto: false,
        hubId: 'prezzi',
        includeNotes: true,
        entryIds: ['n1'],
        includeLinked: false,
        ...over,
      },
    }
  }

  it('records the notes a Knowledge node sent, as chosen by the user', () => {
    const p1 = prompt('che cosa hai scritto sui margini?')
    const k = knowledgeNode()
    const doc = document([k, p1], [edge(k, p1, 'context')])
    const { knowledgeUsed } = assembleMessages(doc, p1.id, {
      knowledgeEntries: notes,
      knowledgeHubs: hubs,
    })
    expect(knowledgeUsed.entries).toEqual([
      { id: 'n1', title: 'Margine', hub: 'Prezzi e listini', via: 'node' },
    ])
  })

  it('records the automatic retrieval too, and says it was automatic', () => {
    const p1 = prompt('che cosa hai scritto sui margini?')
    const { knowledgeUsed } = assembleMessages(document([p1], []), p1.id, {
      knowledge: '<saved_knowledge>\nnota\n</saved_knowledge>',
      knowledgeEntryIds: ['n1'],
      knowledgeEntries: notes,
      knowledgeHubs: hubs,
    })
    expect(knowledgeUsed.entries).toEqual([
      { id: 'n1', title: 'Margine', hub: 'Prezzi e listini', via: 'retrieved' },
    ])
  })

  it('shows both when a run has a node and a retrieval at once', () => {
    /*
     * Una richiesta puo' avere le due cose, ed e' il caso normale dopo che un nodo Knowledge
     * e' stato collegato: il recupero trova comunque qualcosa, e il nodo aggiunge quello che
     * la somiglianza non trova. Mostrarne uno solo dei due sarebbe una risposta vera solo per
     * meta' — e la meta' sbagliata e' quella che fa sembrare rotto un nodo che funziona.
     */
    const p1 = prompt('domanda')
    const k = knowledgeNode()
    const doc = document([k, p1], [edge(k, p1, 'context')])
    const { knowledgeUsed } = assembleMessages(doc, p1.id, {
      knowledge: '<saved_knowledge>\nnota\n</saved_knowledge>',
      knowledgeEntryIds: ['n2'],
      knowledgeEntries: notes,
      knowledgeHubs: hubs,
    })
    // Le scelte a mano in cima: sono la scelta esplicita, e la lista e' un elenco di provenienza.
    expect(knowledgeUsed.entries.map((item) => item.via)).toEqual(['node', 'retrieved'])
  })

  it('is empty for a prompt with nothing knowledge-related attached', () => {
    // E' una risposta vera e non un caso mancante: senza note e' cosi', e la riga non deve
    // comparire perche' non c'e' niente da dire.
    const p1 = prompt('domanda qualsiasi')
    const { knowledgeUsed } = assembleMessages(document([p1], []), p1.id)
    expect(knowledgeUsed.entries).toEqual([])
  })

  it('does not claim a note was sent when the node had nothing configured', () => {
    /*
     * Il caso che genera le accuse piu' ingiuste: un nodo Knowledge **collegato** ma senza
     * centro scelto. Se la traccia dicesse qui, l'utente leggerebbe «nessuna nota mandata» e
     * concluderebbe che il canale e' rotto, mentre il canale funziona e il nodo e' vuoto. Per
     * questo la traccia resta vuota — e a informare della differenza c'e' `knowledgeOfferedToPrompt`,
     * che sa dire *che cosa* manca invece di limitarsi a constatare che manca.
     */
    const p1 = prompt('domanda')
    const k = knowledgeNode({ hubId: null })
    const doc = document([k, p1], [edge(k, p1, 'context')])
    const { knowledgeUsed } = assembleMessages(doc, p1.id, {
      knowledgeEntries: notes,
      knowledgeHubs: hubs,
    })
    expect(knowledgeUsed.entries).toEqual([])
    const offered = knowledgeOfferedToPrompt(doc.nodes, doc.edges, p1.id, notes, hubs)
    expect(offered).toEqual({ nodes: 1, notes: 0, unconfigured: 1, nothingTicked: 0 })
  })
})

describe('telling a silent node from a broken one', () => {
  it('counts what a connected node would send, so silence can be explained', () => {
    /*
     * Il buco che questa funzione chiude: senza di essa, «nessuna nota in questa risposta» e'
     * la stessa immagine per tre cause diverse. Con questa, la riga puo' dire «il nodo e'
     * collegato e non aveva niente da mandare», che e' una diagnosi e non un symptom.
     */
    const p1 = prompt('domanda')
    const k = {
      id: 'k1',
      type: 'knowledge' as const,
      position: { x: 0, y: 0 },
      data: {
        kind: 'knowledge' as const,
        auto: false,
        hubId: 'prezzi',
        includeNotes: true,
        entryIds: ['n1'],
        includeLinked: false,
      },
    }
    const doc = document([k, p1], [edge(k, p1, 'context')])
    expect(knowledgeOfferedToPrompt(doc.nodes, doc.edges, p1.id, notes, hubs)).toEqual({
      nodes: 1,
      notes: 1,
      unconfigured: 0,
      nothingTicked: 0,
    })
  })

it('tells the two reasons apart, because they are fixed in opposite ways', () => {
    /*
     * E' la ragione per cui la funzione restituisce due contatori invece di uno.
     *
     * Un nodo senza centro e un nodo con il centro scelto ma tutte le note tolte sono due
     * problemi che si risolvono al contrario: il primo si risolve scegliendo, il secondo
     * spuntando. Un avviso che dicesse «apri il nodo e controlla» costringerebbe a provarle
     * entrambe, e il caso piu' probabile â€” quello in cui le note sono state tolte per sbaglio
     * mentre si sceglieva â€” e' anche quello in cui la persona sta gia' guardando la casella da
     * spuntare. Dirle «scegli un punto di contesto» la manderebbe a cercare un centro che ha
     * gia' scelto, che e' esattamente il momento in cui smette di fidarsi della riga.
     */
    const p1 = prompt('domanda')
    const bare = {
      id: 'k1',
      type: 'knowledge' as const,
      position: { x: 0, y: 0 },
      data: { kind: 'knowledge' as const, auto: false, hubId: null, includeNotes: true, entryIds: [], includeLinked: false },
    }
    const emptied = {
      id: 'k2',
      type: 'knowledge' as const,
      position: { x: 0, y: 0 },
      data: { kind: 'knowledge' as const, auto: false, hubId: 'prezzi', includeNotes: true, entryIds: [], includeLinked: false },
    }
    const doc = document([bare, emptied, p1], [edge(bare, p1, 'context'), edge(emptied, p1, 'context')])
    const offered = knowledgeOfferedToPrompt(doc.nodes, doc.edges, p1.id, notes, hubs)
    expect(offered).toEqual({ nodes: 2, notes: 0, unconfigured: 1, nothingTicked: 1 })
  })

  it('ignores a Knowledge node that is connected to some other prompt', () => {
    const p1 = prompt('domanda')
    const p2 = prompt('altra domanda')
    const k = {
      id: 'k1',
      type: 'knowledge' as const,
      position: { x: 0, y: 0 },
      data: {
        kind: 'knowledge' as const,
        auto: false,
        hubId: 'prezzi',
        includeNotes: true,
        entryIds: ['n1'],
        includeLinked: false,
      },
    }
    const doc = document([k, p1, p2], [edge(k, p2, 'context')])
    // p1 non ha niente, e dire il contrario farebbe comparire un avviso dove non c'e' problema:
    // un avviso che non segnala nulla e' il modo piu' rapido per insegnare a ignorarli.
    expect(knowledgeOfferedToPrompt(doc.nodes, doc.edges, p1.id, notes, hubs)).toEqual({
      nodes: 0,
      notes: 0,
      unconfigured: 0,
      nothingTicked: 0,
    })
  })

  it('agrees with what the node actually sends, because two lists would be worse than none', () => {
    // Il confronto e' il punto: se il numero che «dovrebbe mandare» e il numero che «manda»
    // venissero calcolati in due posti, il giorno in cui divergono la riga direbbe «manca una
    // nota» mentre la nota c'e' — e l'utente andrebbe a cercare un problema che non esiste.
    const data = {
      kind: 'knowledge' as const,
      auto: false,
      hubId: 'prezzi',
      includeNotes: true,
      entryIds: ['n1'],
      includeLinked: false,
    }
    const p1 = prompt('domanda')
    const doc = document([{ id: 'k1', type: 'knowledge', position: { x: 0, y: 0 }, data }, p1], [
      edge({ id: 'k1', type: 'knowledge', position: { x: 0, y: 0 }, data }, p1, 'context'),
    ])
    const pick = resolveKnowledgePick(data, notes, hubs)
    expect(knowledgeOfferedToPrompt(doc.nodes, doc.edges, p1.id, notes, hubs).notes).toBe(pick.notes.length)
  })
})

describe('a response node keeps the trail after a reload', () => {
  it('comes back with the note titles and where they came from', () => {
    /*
     * Il giro completo, perche' una traccia che si perde al ricaricamento e' peggio di
     * nessuna: l'utente la vede sulla risposta appena prodotta, rilancia la pagina per
     *continuare a lavorare, e la prova che aveva davanti non c'e' piu'. Un campo che non
     * sopravvive al salvataggio e' un campo che non si puo' usare per rispondere a una
     * domanda, perche' la domanda arriva quasi sempre il giorno dopo.
     */
    const p1 = prompt('domanda')
    const r1 = response(p1.id, 'risposta', {
      knowledgeUsed: {
        entries: [{ id: 'n1', title: 'Margine', hub: 'Prezzi e listini', via: 'node' }],
      },
    })
    const saved = serializeDocument(document([p1, r1], [edge(p1, r1, 'run')]))
    const reopened = normalizeDocument(JSON.parse(JSON.stringify(saved))).document
    const node = reopened.nodes.find((candidate) => candidate.type === 'response')
    if (node?.data.kind !== 'response') throw new Error('the response did not come back')
    expect(node.data.knowledgeUsed?.entries).toEqual([
      { id: 'n1', title: 'Margine', hub: 'Prezzi e listini', via: 'node' },
    ])
  })

  it('drops a half-written entry rather than showing a line it cannot render', () => {
    /*
     * Una voce senza titolo non si puo' mostrare, e una voce mostrata a meta' e' peggio di
     * una voce assente: il conteggio non torna piu' con quello che si vede, e l'utente non ha
     * piu' modo di fidarsi del numero.
     */
    const raw = {
      docVersion: 1,
      savedAt: 1,
      name: 'prova',
      nodes: [
        {
          id: 'r1',
          type: 'response',
          position: { x: 0, y: 0 },
          data: {
            kind: 'response',
            parentPromptId: 'p1',
            knowledgeUsed: {
              entries: [
                { id: 'n1', title: 'Margine', hub: null, via: 'node' },
                { id: 'n2', via: 'node' },
                { title: 'senza id', via: 'node' },
              ],
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const node = normalizeDocument(raw).document.nodes[0]
    if (node?.data.kind !== 'response') throw new Error('not a response')
    expect(node.data.knowledgeUsed?.entries).toEqual([
      { id: 'n1', title: 'Margine', hub: null, via: 'node' },
    ])
  })

  it('says nothing rather than something false, when the saved file has no trail at all', () => {
    // Una risposta vecchia non ha la traccia, e non si deve inventare. Il campo assente
    // significa «questa risposta e' precedente alla traccia», che e' una cosa diversa da
    // «questa risposta non aveva note» — ed e' la differenza che impedisce a un avviso di
    // comparire addosso a risposse su cui non ha niente da dire.
    const p1 = prompt('domanda')
    const r1 = response(p1.id, 'risposta')
    const saved = serializeDocument(document([p1, r1], [edge(p1, r1, 'run')]))
    const reopened = normalizeDocument(JSON.parse(JSON.stringify(saved))).document
    const node = reopened.nodes.find((candidate) => candidate.type === 'response')
    if (node?.data.kind !== 'response') throw new Error('not a response')
    expect(node.data.knowledgeUsed).toBeUndefined()
  })
})