import { describe, expect, it } from 'vitest'
import { NODE_REGISTRY, addableNodeTypes } from '../nodes/registry'
import {
  document,
  nodeOfType,
  prompt,
  response,
  set as setFactory,
  summary,
} from '../test/factories'
import { normalizeDocument, serializeDocument } from './storage'
import { NodeSchema } from './schema'
import { createNode } from '../store/workspaceStore'
import type { AppNode, NodeType } from '../types/document'

/**
 * Ogni tipo di nodo deve **sopravvivere a un salvataggio**.
 *
 * Il difetto che questo file chiude e' comparso piu' volte in questa applicazione, sempre
 * uguale e sempre diverso: un tipo di nodo nuovo viene aggiunto al registro, allo schema e
 * alla palette, funziona benissimo, e poi sparisce — o si trasforma in qualcos'altro — alla
 * riapertura.
 *
 * Perche' succede e' che la validazione di un documento ha **due elenchi di tipi**: quello
 * dello schema e quello scritto a mano nella normalizzazione. Il primo accetta il tipo nuovo
 * e il secondo no, e il secondo vince — in silenzio. Il caso peggiore non e' il nodo
 * scartato, e' il nodo **convertito**: passa il controllo «non e' stato perso» e arriva
 * vuoto di tutto quello che aveva. Non si vede niente, non c'e' errore, e il difetto emerge
 * solo al ricaricamento, cioe' dopo che il lavoro e' stato fatto.
 *
 * Il test quindi non elenca i tipi a mano: legge **il catalogo** e prova ogni voce. Se
 * domani aggiunge un tipo, questo test comincia a chiederne la sopravvivenza; e se qualcuno
 * lo aggiunge a meta' — al registro ma non alla normalizzazione — il test dice esattamente
 * quale dei due elenchi manca, perche' confronta i due sullo stesso tipo.
 */

/**
 * Un nodo di questo tipo, costruito come lo costruirebbe l'applicazione.
 *
 * I tipi che si possono **mettere sulla tela** passano da `createNode`, cioe' dalla stessa
 * funzione della palette: cosi' questo test non puo' passare mentre la creazione di un nodo e'
 * rotta — che e' esattamente il difetto che ha reso inutile una prima versione di questo
 * file, dove un tipo nuovo finiva con l'aspetto di una nota e il test lo dichiarava regolare.
 *
 * Risposta, riassunto e set nascono invece da una corsa o da un raggruppamento, e non hanno
 * un ramo in `createNode`: per quelli si usano le fabbriche che esistono gia'.
 */
function nodeForKind(kind: NodeType): AppNode {
  if (kind === 'response') return response(prompt('domanda').id, 'risposta')
  if (kind === 'summary') return summary('riassunto')
  if (kind === 'set') return setFactory('Set', [])
  if (kind === 'group') return createNode('group', { x: 0, y: 0 }, undefined)
  return nodeOfType(kind as Parameters<typeof nodeOfType>[0])
}

/** The node under test, found by its type, so the document's other nodes cannot confuse it. */
function nodeOfTypeIn(reopened: unknown, kind: NodeType): AppNode | undefined {
  return (reopened as { nodes: AppNode[] }).nodes.find((node) => node.type === kind)
}

const everyType = Object.keys(NODE_REGISTRY) as NodeType[]

/** Il giro completo: costruisci, serializza sul file, riapri. */
function roundTrip(kind: NodeType): unknown {
  const source =
    kind === 'response'
      ? document([prompt('domanda'), nodeForKind(kind)], [
          {
            id: 'e1',
            source: 'p001',
            target: 'r001',
            sourceHandle: 'out',
            targetHandle: 'in',
            kind: 'run',
            createdAt: 1,
          },
        ])
      : document([nodeForKind(kind)], [])
  return normalizeDocument(JSON.parse(JSON.stringify(serializeDocument(source)))).document
}

describe('every type of node survives a save', () => {
  it('has types to check, so the loops below are not vacuous', () => {
    expect(everyType.length).toBeGreaterThan(5)
    expect(addableNodeTypes.length).toBeGreaterThan(3)
  })

  it.each(everyType)('keeps a %s node through the document round trip', (kind) => {
    const reopened = roundTrip(kind)
    // Non basta «non e' stato scartato»: il difetto peggiore e' la **conversione**, che passa
    // quel controllo e perde tutto. Quindi si verifica che torni indietro **lo stesso tipo**,
    // e non solo che ci torni un nodo qualunque.
    const node = nodeOfTypeIn(reopened, kind)
    expect(node, `${kind} did not come back at all`).toBeDefined()
  })

  it.each(everyType)('agrees with the schema about %s, so the two lists cannot drift', (kind) => {
    // I due elenchi di tipi devono dire la stessa cosa sullo stesso tipo. E' la condizione
    // esatta in cui un nodo sparisce: uno dei due accetta, l'altro no, e vince il piu'
    // stretto senza dire niente.
    const parsed = NodeSchema.safeParse(nodeForKind(kind))
    expect(
      parsed.success,
      `schema rejects ${kind}: ${parsed.success ? '' : parsed.error.message}`,
    ).toBe(true)
  })

  it.each(addableNodeTypes)('creates a %s node as the type the catalogue says', (kind) => {
    /*
     * Il controllo che chiude davvero la classe di difetto, ed e' quello che mancava.
     *
     * `createNode` finisce con un ripiego che crea una **nota**, quindi un tipo nuovo
     * registrato e non messo li' non fallisce: crea un nodo, con la stessa aria di prima, e
     * della forma sbagliata. Il sintomo e' che il pulsante della palette funziona e il nodo
     * non e' quello che e' stato premesso — e per un nodo che punta all'archivio significa un
     * nodo che non sceglie niente e non manda niente, con l'aria di un nodo funzionante.
     */
    expect(nodeOfType(kind).type, kind).toBe(kind)
  })
})

describe('a File, a Folder and a Brain keep their content', () => {
  /*
   * Tre rami mancavano nella ricostruzione, e la loro assenza non era un tipo scartato: la
   * lista dei tipi li accettava, quindi passavano il controllo e finivano sulla **nota** di
   * fondo con `text: ''`. Un nodo File diventava una nota vuota, e con lei spariva il testo
   * del file letto dal disco.
   *
   * Qui si verifica il contenuto, non il tipo: il tipo era gia' giusto — quello e' il caso
   * peggiore, perche' un controllo sul tipo solo lo dichiarerebbe a posto mentre la nota e'
   * vuota.
   */
  it('keeps the text a File had read from disk', () => {
    const source = document([nodeOfType('file')], [])
    const saved = serializeDocument(source)
    const node = nodeOfTypeIn(
      normalizeDocument(JSON.parse(JSON.stringify(saved))).document,
      'file',
    )
    expect(node).toBeDefined()
    expect(node?.type).toBe('file')
    const file = node as Extract<AppNode, { type: 'file' }>
    expect(typeof file.data.name).toBe('string')
    expect(typeof file.data.text).toBe('string')
    // Il testo vuoto e' accettato — un file appena creato non e' stato letto — ma il
    // **numero** di caratteri deve tornare, altrimenti il contenuto del file si perde e il
    // grafo mostra una nota vuota con l'aria di un file.
    expect(typeof file.data.sizeBytes).toBe('number')
  })

  it('keeps a Folder the list of files it refused, because that list is why it is smaller', () => {
    const folder = createNode('folder', { x: 0, y: 0 }, {
      name: 'progetto',
      fileCount: 3,
      text: 'un file',
      refused: [{ name: 'grande.pdf', reason: 'too large' }],
    })
    const node = nodeOfTypeIn(
      normalizeDocument(JSON.parse(JSON.stringify(serializeDocument(document([folder], []))))).document,
      'folder',
    )
    // Senza `refused` il contesto sarebbe piu' piccolo senza che nulla lo dicesse:
    // l'utente crederebbe che il modello avesse letto anche i file saltati.
    expect((node as Extract<AppNode, { type: 'folder' }>).data.refused).toEqual([
      { name: 'grande.pdf', reason: 'too large' },
    ])
  })

  it('opens a Brain idle rather than still running', () => {
    // Un Brain salvato mentre stava lavorando, riaprirtelo come «in corso» mostrerebbe un
    // lavoro finito da un pezzo, che nessuno puo' piu' concludere e che l'unica cosa da fare
    // sarebbe ricominciare.
    const brain = createNode('brain', { x: 0, y: 0 }, { instruction: 'traduci' })
    const node = nodeOfTypeIn(
      normalizeDocument(JSON.parse(JSON.stringify(serializeDocument(document([brain], []))))).document,
      'brain',
    )
    const opened = node as Extract<AppNode, { type: 'brain' }>
    expect(opened.data.instruction).toBe('traduci')
    expect(opened.data.run.status).toBe('idle')
  })
})

describe('a Knowledge node keeps what it was given', () => {
  const raw = (data: Record<string, unknown>) => ({
    docVersion: 1,
    savedAt: 1_700_000_000_000,
    name: 'prova',
    nodes: [
      { id: 'k1', type: 'knowledge', position: { x: 0, y: 0 }, data: { kind: 'knowledge', ...data } },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  })

  it('comes back with the main point, the ticked notes and the tied-ones choice', () => {
    const node = normalizeDocument(
      raw({
        hubId: 'prezzi',
        includeNotes: true,
        entryIds: ['n1', 'n3'],
        includeLinked: true,
        title: 'Listini',
      }),
    ).document.nodes[0]
    expect(node?.type).toBe('knowledge')
    if (node?.data.kind !== 'knowledge') throw new Error('not a knowledge node')
    expect(node.data.hubId).toBe('prezzi')
    expect(node.data.includeNotes).toBe(true)
    expect(node.data.entryIds).toEqual(['n1', 'n3'])
    expect(node.data.includeLinked).toBe(true)
  })

  it('opens as unconfigured rather than inventing a main point', () => {
    /*
     * Il caso di un file scritto a mano, o salvato da una versione che non aveva ancora
     * questo tipo. Il nodo deve aprirsi **non configurato**: inventare un centro che l'utente
     * non ha scelto significherebbe mandare note a un gruppo che non esiste, e il modello
     * risponderebbe su materiale che nessuno ha chiesto.
     */
    const node = normalizeDocument(raw({})).document.nodes[0]
    if (node?.data.kind !== 'knowledge') throw new Error('not a knowledge node')
    expect(node.data.hubId).toBeNull()
    expect(node.data.includeNotes).toBe(false)
    expect(node.data.entryIds).toEqual([])
  })

  it('drops ids that are not strings, because they could never match a note', () => {
    const node = normalizeDocument(raw({ entryIds: ['n1', 42, null, { a: 1 }] })).document.nodes[0]
    if (node?.data.kind !== 'knowledge') throw new Error('not a knowledge node')
    expect(node.data.entryIds).toEqual(['n1'])
  })

  it('keeps the automatic choice across a save, and defaults it to off', () => {
    /*
     * Il valore che **non** si puo' perdere, e il valore che non si puo' inventare.
     *
     * Perdere `auto: true` silenziosamente trasformerebbe un nodo che chiede «quello che
     * c'entra» in un nodo che chiede «scegli un centro»: dopo un salvataggio il nodo si
     * aprirebbe in una domanda che l'utente non ha mai fatto, e la prima riga gli direbbe
     * di scegliere qualcosa che aveva gia' scelto.
     *
     * Inventarlo e' il difetto peggiore, e per questo il default e' `false`. Un file senza la
     * chiave viene da una versione in cui la modalita' non esisteva, e in quella versione il
     * nodo mandava solo le note di un centro: aprirlo in automatico comincerebbe a mandare
     * note che nessuno ha autorizzato.
     */
    const on = normalizeDocument(raw({ auto: true, hubId: null })).document.nodes[0]
    if (on?.data.kind !== 'knowledge') throw new Error('not a knowledge node')
    expect(on.data.auto).toBe(true)

    const absent = normalizeDocument(raw({})).document.nodes[0]
    if (absent?.data.kind !== 'knowledge') throw new Error('not a knowledge node')
    expect(absent.data.auto).toBe(false)

    // E una riga non booleana non puo' accendere il ramo automatico per sbaglio.
    const junk = normalizeDocument(raw({ auto: 'si' })).document.nodes[0]
    if (junk?.data.kind !== 'knowledge') throw new Error('not a knowledge node')
    expect(junk.data.auto).toBe(false)
  })
})