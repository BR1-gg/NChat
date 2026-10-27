/**
 * Una domanda che non chiede l'archivio non paga l'archivio.
 *
 * Il difetto che questo file chiude e' nato da una domanda: «perche' il consumo e' salito?».
 * La risposta non era «perche' hai collegato il nodo Knowledge», ma **perche' non avevi
 * collegato niente**. Il recupero automatico girava su ogni prompt — anche su una domanda che
 * dell'archivio non sapeva niente — e mandava un blocco con le istruzioni al modello. Le
 * istruzioni costavano piu' delle note, quindi una domanda che non aveva chiesto niente
 * pagava il canale intero, e non c'era niente nella schermata che lo dicesse.
 *
 * Quindi qui non si controlla che il recupero funzioni. Si controlla che **non** succeda quando
 * nessuno l'ha chiesto, che e' il difetto. Il caso positivo e' una riga sola e sta in fondo.
 */

import { describe, expect, it } from 'vitest'
import { assembleMessages } from './assemble'
import { document, edge, prompt } from '../test/factories'
import type { KnowledgeEntry, KnowledgeHub } from '../types/knowledge'
import type { KnowledgeNodeData } from '../types/document'

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

const hub: KnowledgeHub = {
  id: 'prezzi',
  title: 'Prezzi e listini',
  position: { x: 0, y: 0, z: 0 },
  createdAt: 1,
  updatedAt: 1,
}

/* Una nota che assomiglia **tavolo** alla domanda, cosi' il recupero la troverebbe. */
const notes = [
  entry({ id: 'n1', title: 'Margine', text: 'il margine cala del 12%', hubId: 'prezzi' }),
  entry({ id: 'n2', title: 'Listini', text: 'i listini sono stati ricalcolati', hubId: 'prezzi' }),
]

function knowledgeNode(over: Partial<KnowledgeNodeData> = {}) {
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

const assembledText = (doc: ReturnType<typeof document>, promptId: string): string =>
  assembleMessages(doc, promptId, { knowledgeEntries: notes, knowledgeHubs: [hub] }).messages
    .map((message) => String(message.content))
    .join('\n')

describe('a question that did not ask for the archive', () => {
  it('sends nothing at all, even with notes sitting in the archive that match it', () => {
    /*
     * Il caso che costava di piu'. La domanda nomina «margine» e «listini», quindi un recupero
     * li trova: senza il nodo, prima dell cambiamento, la risposta portava con se' un blocco
     * di conoscenza e le sue istruzioni — a una domanda che non aveva chiesto niente.
     */
    const p1 = prompt('che cosa hai scritto sui margini e i listini?')
    const text = assembledText(document([p1], []), p1.id)
    expect(text).not.toContain('saved_knowledge')
    expect(text).not.toContain('Answer from these notes')
    expect(text).not.toContain('il margine cala')
  })

  it('costs the same as it would with an empty archive, which is the whole point', () => {
    /*
     * Il confronto che chiude il ragionamento. Non «quante note ha mandato» — zero e' gia' il
     * minimo possibile — ma **quanti token**: due richieste identiche, una con un archivio
     * pieno e somigliante e una senza archivio, devono costare uguale. E' la formulazione
     * che regge, perche' regge anche se domani il formato del blocco cambia.
     */
    const p1 = prompt('che cosa hai scritto sui margini e i listini?')
    const withArchive = assembleMessages(document([p1], []), p1.id, {
      knowledgeEntries: notes,
      knowledgeHubs: [hub],
    })
    const withoutArchive = assembleMessages(document([p1], []), p1.id, {})
    expect(withArchive.estTokens).toBe(withoutArchive.estTokens)
    expect(withArchive.knowledgeUsed.entries).toEqual([])
  })

  it('still sends notes that were connected by hand, because those were asked for', () => {
    /*
     * Il caso positivo, che e' una riga sola ma senza la quale il cambiamento sembrerebbe
     * aver spento la funzione invece di averla resa esplicita. Un nodo collegato a mano e' una
     * richiesta esplicita, e costa quello che e' costato.
     */
    const p1 = prompt('che cosa hai scritto sui margini e i listini?')
    const k = knowledgeNode()
    const text = assembledText(document([k, p1], [edge(k, p1, 'context')]), p1.id)
    expect(text).toContain('il margine cala')
    expect(text).toContain('Answer from these notes')
  })
})

describe('the automatic mode, which is now a choice', () => {
  it('finds the notes that match the question, when the node asks for it', () => {
    const p1 = prompt('che cosa hai scritto sui margini e i listini?')
    const k = knowledgeNode({ auto: true, hubId: null, includeNotes: false, entryIds: [] })
    const doc = document([k, p1], [edge(k, p1, 'context')])
    const { knowledgeUsed } = assembleMessages(doc, p1.id, {
      knowledgeEntries: notes,
      knowledgeHubs: [hub],
    })
    // E' la modalita' che salva il recupero automatico, non lo toglie: e' esattamente il
    // comportamento di prima, ma solo dove e' stato chiesto.
    expect(knowledgeUsed.entries.length).toBeGreaterThan(0)
    expect(knowledgeUsed.entries.map((item) => item.via)).toContain('node')
  })

  it('says so when nothing matches, instead of sending an empty block or staying silent', () => {
    /*
     * «Nessuna nota somiglia a questa domanda» e' un fatto. Senza dirlo, un nodo in questa
     * modalita' e' indistinguibile da uno spento, che e' la cosa che faceva sembrare rotto un
     * canale che funzionava.
     */
    const p1 = prompt('raccontami la meteorologia di Lisbona nel 1890')
    const k = knowledgeNode({ auto: true, hubId: null, includeNotes: false, entryIds: [] })
    const doc = document([k, p1], [edge(k, p1, 'context')])
    const { warnings, knowledgeUsed } = assembleMessages(doc, p1.id, {
      knowledgeEntries: notes,
      knowledgeHubs: [hub],
    })
    expect(knowledgeUsed.entries).toEqual([])
    expect(warnings.map((warning) => warning.message).join(' ')).toMatch(/No saved note matches/i)
  })

  it('sends nothing when the question itself is empty, rather than matching everything', () => {
    // Una domanda vuota non somiglia a niente in modo utile: senza questa verifica il
    // recupero su un prompt non scritto restituirebbe note a caso, e il modello le prenderebbe
    // per pertinenti solo perche' gliele hanno date.
    const p1 = prompt('   ')
    const k = knowledgeNode({ auto: true, hubId: null, includeNotes: false, entryIds: [] })
    const doc = document([k, p1], [edge(k, p1, 'context')])
    const { knowledgeUsed, warnings } = assembleMessages(doc, p1.id, {
      knowledgeEntries: notes,
      knowledgeHubs: [hub],
    })
    expect(knowledgeUsed.entries).toEqual([])
    expect(warnings).toEqual([])
  })

  it('does not also send the chosen notes, because the two modes do not stack', () => {
    /*
     * E' il risparmio che l'utente ha chiesto, scritto come test.
     *
     * Un nodo in modalita' automatica e uno su un centro non possono sommarsi, e il motivo non
     * e' solo che sarebbe illogico: due blocchi significano **due istruzioni**, cioe' il costo
     * fisso raddoppiato. La combinazione si puo' fare con due nodi, se la si vuole davvero —
     * e allora si paga per due blocchi, come si deve.
     */
    const p1 = prompt('che cosa hai scritto sui margini e i listini?')
    const auto = knowledgeNode({ id: 'k1', auto: true, hubId: null, includeNotes: false, entryIds: [] })
    const doc = document([auto, p1], [edge(auto, p1, 'context')])
    const text = assembledText(doc, p1.id)
    // Un solo blocco, quindi una sola occorrenza dell'istruzione.
    const occurrences = text.split('Answer from these notes').length - 1
    expect(occurrences).toBe(1)
  })
})

describe('a node saved before the automatic mode existed', () => {
  it('opens as a chosen main point, never as automatic', () => {
    /*
     * Un file salvato quando l'unica modalita' era «scegli un centro» non deve aprire come
     * «quello che c'entra». La ragione e' la stessa per cui non si inventa mai un default
     * costoso: aprire un nodo del passato in automatico significherebbe cominciare a mandare
     * note a richieste che l'utente non aveva ancora autorizzato — e lui non avrebbe mai
     * premuto niente per ottenerlo.
     */
    const p1 = prompt('domanda')
    /*
     * Il cast qui e' **il punto del test**, non una scorciatoia.
     *
     * `auto` e' obbligatorio nel tipo, quindi un nodo senza la chiave non si puo' scrivere
     * senza `as never` — e questo e' esattamente cio' che arriva da un file salvato prima che
     * la chiave esistesse. Il tipo descrive cio' che l'applicazione costruisce, non cio' che
     * puo' arrivare da un file: per quello c'e` `normalizeDocument`, che riempie il default.
     */
    const k = {
      id: 'k1',
      type: 'knowledge' as const,
      position: { x: 0, y: 0 },
      data: {
        kind: 'knowledge' as const,
        hubId: 'prezzi',
        includeNotes: true,
        entryIds: ['n1'],
        includeLinked: false,
      } as never,
    } as never
    const doc = document([k, p1], [edge(k, p1, 'context')])
    const { knowledgeUsed } = assembleMessages(doc, p1.id, {
      knowledgeEntries: notes,
      knowledgeHubs: [hub],
    })
    // Nessuna della chiave `auto`: il ramo automatico non parte, e la scelta esplicita vale.
    expect(knowledgeUsed.entries.map((item) => item.id)).toEqual(['n1'])
  })
})