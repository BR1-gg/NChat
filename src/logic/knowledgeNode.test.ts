/**
 * Il nodo Knowledge: che cosa arriva al prompt, e che cosa no.
 *
 * Il nodo tiene degli **id**, non dei testi, e questa e' la scelta che rende tutto il resto
 * discutibile. Un id continua a valere mentre la nota viene riscritta, spostata in un centro
 * o letta da un file nella cartella; un testo copiato dentro il nodo diventa una seconda
 * copia che invecchia da sola e su cui nessuno avvisa quando non somiglia piu' a quella vera.
 *
 * I test sono quindi sulle cose che **rompono** la promessa dei due lati:
 *
 * - il nodo manda **esattamente** le note del centro che sono state scelte, e non una in
 *   piu' e non una in meno — perche' una nota in piu' e' una risposta costruita su materiale
 *   che l'utente non ha davanti, e una in meno e' una risposta a meta';
 * - una nota **cancellata** non blocca la corsa e non sparisce in silenzio;
 * - il blocco che arriva ha la **stessa forma** di quello che arriva dal recupero automatico,
 *   avviso di sola lettura compreso, perche' e' la promessa che il modello non tocchi
 *   l'archivio e vale per tutto quello che ne esce.
 */

import { describe, expect, it } from 'vitest'
import { notesOfferedBy, resolveKnowledgePick } from './knowledgeNode'
import { assembleMessages } from './assemble'
import { document } from '../test/factories'
import { prompt } from '../test/factories'
import type { KnowledgeEntry, KnowledgeHub, KnowledgeId } from '../types/knowledge'
import type { KnowledgeNodeData } from '../types/document'

function entry(over: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: over.id ?? 'a1',
    title: over.title ?? 'Margine listino',
    text: over.text ?? 'il margine cala sul listino',
    source: { workspaceId: null, workspaceName: null, nodeTitle: null, nodeId: null },
    hubId: over.hubId ?? null,
    links: over.links ?? [],
    color: over.color ?? 'default',
    position: over.position ?? { x: 0, y: 0, z: 0 },
    createdAt: over.createdAt ?? 1,
    updatedAt: over.updatedAt ?? 1,
    placedBecause: over.placedBecause ?? 'test',
  }
}

const priceHub: KnowledgeHub = {
  id: 'prices',
  title: 'Prezzi e listini',
  position: { x: 0, y: 0, z: 0 },
  createdAt: 1,
  updatedAt: 1,
}

const taxHub: KnowledgeHub = {
  id: 'tax',
  title: 'Fisco',
  position: { x: 20, y: 0, z: 0 },
  createdAt: 2,
  updatedAt: 2,
}

const hubs = [priceHub, taxHub]

const notes = [
  entry({ id: 'n1', title: 'Margine', text: 'il margine cala del 12%', hubId: 'prices', createdAt: 1 }),
  entry({ id: 'n2', title: 'Listini 2026', text: 'i listini sono stati ricalcolati', hubId: 'prices', createdAt: 2 }),
  entry({ id: 'n3', title: 'IVA', text: 'l IVA recuperabile', hubId: 'tax', createdAt: 3 }),
  entry({ id: 'n4', title: 'Sciolta', text: 'nota libera', hubId: null, createdAt: 4 }),
]

/**
 * Un nodo come lo lascia l'utente che ha appena acceso «manda le note di questo centro».
 *
 * Il ripiego e' **tutte** le note del centro, e non una lista vuota, perche' e' esattamente
 * cio' che scrive il componente: si accende la spunta e la lista si riempie. Una fabbrica che
 * partisse da `[]` descriverebbe uno stato che l'utente non puo' raggiungere con un click —
 * e i test che lo userebbero passerebbero controllando una configurazione che non esiste.
 */
function node(over: Partial<KnowledgeNodeData> = {}): KnowledgeNodeData {
  const hubId = over.hubId === undefined ? 'prices' : over.hubId
  return {
    kind: 'knowledge',
    auto: over.auto ?? false,
    hubId,
    includeNotes: over.includeNotes ?? true,
    entryIds:
      over.entryIds ??
      (over.includeNotes === false ? [] : notes.filter((n) => n.hubId === hubId).map((n) => n.id)),
    includeLinked: over.includeLinked ?? false,
    title: over.title,
    collapsed: over.collapsed,
  }
}

const ids = (pick: { notes: KnowledgeEntry[] }): KnowledgeId[] => pick.notes.map((entry) => entry.id)

describe('what the node sends', () => {
  it('sends the notes of the main point it points at, and nothing else', () => {
    const pick = resolveKnowledgePick(node(), notes, hubs)
    // Non la nota libera e non quella di un altro centro: e' esattamente quello che e' stato
    // chiesto, e una nota in piu' significa una risposta costruita su materiale che l'utente
    // non aveva davanti.
    expect(ids(pick)).toEqual(['n1', 'n2'])
  })

  it('sends nothing when no main point is chosen', () => {
    const pick = resolveKnowledgePick(node({ hubId: null }), notes, hubs)
    expect(pick.block).toBeNull()
    expect(pick.notes).toEqual([])
  })

  it('sends nothing when the notes are not asked for', () => {
    // Un centro da solo non porta con se' le note: scegliere il gruppo e' dire «da qui», e
    // cosa viene con e' una seconda scelta. Senza questa separazione, scegliere il centro
    // costerebbe token senza che l'utente lo sapesse.
    const pick = resolveKnowledgePick(node({ includeNotes: false }), notes, hubs)
    expect(pick.notes).toEqual([])
  })

  it('sends only the notes that were ticked, when some were', () => {
    const pick = resolveKnowledgePick(node({ entryIds: ['n2'] }), notes, hubs)
    expect(ids(pick)).toEqual(['n2'])
  })

it('sends nothing when the ticked list is empty, because empty means none', () => {
    /*
     * Una volta il vuoto voleva dire «tutte», per non mandare blocchi vuoti appena si
     * sceglieva un centro. Ma allora voleva dire anche «nessuna», e una casella non spuntata
     * accanto a un piede che dice «2 note» era una contraddizione: l'utente leggeva la spunta
     * e credeva di aver tolto due note che venivano mandate lo stesso.
     *
     * Ora il vuoto ha un solo significato e il nodo che si accende **riempie** la lista. Il
     * vantaggio e' che non esiste piu' uno stato che non si vede.
     */
    const pick = resolveKnowledgePick(node({ entryIds: [] }), notes, hubs)
    expect(pick.notes).toEqual([])
    expect(pick.block).toBeNull()
  })

  it('shows every note of the centre, so nothing hides behind being unchosen', () => {
    // L'elenco serve a scegliere: una nota che c'e' nell'archivio, sta sotto il centro e non
    // compare sembrerebbe sparita. Meglio una riga non spuntata che una riga assente — e con
    // la lista che si riempie all'accensione, «non spuntata» vuol dire che e' stata tolta di
    // proposito e non che e' stata dimenticata.
    expect(notesOfferedBy(node({ entryIds: ['n2'] }), notes).map((entry) => entry.id)).toEqual([
      'n1',
      'n2',
    ])
  })

  it('adds the notes tied to the chosen ones, because those are what they are about together', () => {
    const tied = [
      ...notes,
      entry({ id: 'n5', title: 'Margine 2025', text: 'lo stesso argomento', links: ['n1'] }),
    ]
    const pick = resolveKnowledgePick(node({ includeLinked: true }), tied, hubs)
    expect(ids(pick)).toContain('n5')
    // E non due volte: una nota legata a due scelte resta una nota sola, perche' mandarla
    // due volte costa token e non aggiunge niente al contesto.
    expect(ids(pick).filter((id) => id === 'n5')).toHaveLength(1)
  })
})

describe('notes that went away', () => {
  it('says so instead of failing, and still sends what is there', () => {
    // La corsa **non** si ferma. Fermarsi lascerebbe l'utente con un prompt che non parte e
    // nessuna spiegazione; la spiegazione arriva in un avviso che non blocca niente, e il
    // contesto che arriva e' comunque quello giusto.
    const pick = resolveKnowledgePick(node({ entryIds: ['n1', 'sparita'] }), notes, hubs)
    expect(ids(pick)).toEqual(['n1'])
    expect(pick.missing).toContain('sparita')
  })

  it('says so when the whole main point is gone, and sends nothing', () => {
    const pick = resolveKnowledgePick(node({ hubId: 'nonEsiste' }), notes, hubs)
    expect(pick.block).toBeNull()
    expect(pick.missing).toEqual(['nonEsiste'])
    expect(pick.hubTitle).toBeNull()
  })
})

describe('the block that reaches the model', () => {
  it('carries the same read-only promise as the automatically retrieved notes', () => {
    /*
     * E' la riga che tiene insieme tutta questa parte. Se le note scelte a mano arrivassero
     * con un blocco diverso, il modello riceverebbe quel materiale senza l'avviso che non puo'
     * modificarlo — e potrebbe promettere di averlo fatto. Non si vede, e produce risposte
     * sicurissime su cose che l'utente non ha scritto.
     */
    const pick = resolveKnowledgePick(node(), notes, hubs)
    expect(pick.block).toContain('cannot edit or delete')
    expect(pick.block).toContain('[Prezzi e listini]')
    expect(pick.block).toContain('Margine')
  })

  it('lands in the prompt when the node is wired as context', () => {
    const p = prompt('che cosa hai scritto sui listini?')
    const knowledge = {
      id: 'k1',
      type: 'knowledge' as const,
      position: { x: 0, y: 200 },
      data: node(),
    }
    const doc = document([p, knowledge], [
      { id: 'e1', source: 'k1', target: p.id, sourceHandle: 'out', targetHandle: 'context', kind: 'context', createdAt: 1 },
    ])
    const { messages } = assembleMessages(doc, p.id, {
      knowledgeEntries: notes,
      knowledgeHubs: hubs,
    })
    const user = messages.find((message) => message.role === 'user')
    expect(String(user?.content)).toContain('il margine cala del 12%')
  })

  it('costs nothing when the archive is not passed in at all', () => {
    // Il percorso di validazione e la corsa senza archivio devono funzionare come prima, e
    // senza archivio il nodo manda niente invece di far fallire la corsa.
    const p = prompt('domanda')
    const knowledge = { id: 'k1', type: 'knowledge' as const, position: { x: 0, y: 200 }, data: node() }
    const doc = document([p, knowledge], [
      { id: 'e1', source: 'k1', target: p.id, sourceHandle: 'out', targetHandle: 'context', kind: 'context', createdAt: 1 },
    ])
    const { messages } = assembleMessages(doc, p.id)
    expect(String(messages.find((message) => message.role === 'user')?.content)).toContain('domanda')
  })
})

describe('the list the node offers', () => {
  it('lists only the notes of the chosen centre', () => {
    expect(notesOfferedBy(node(), notes).map((entry) => entry.id)).toEqual(['n1', 'n2'])
  })

it('lists the centre notes even when they are not being sent, because that is when the list is needed', () => {
    /*
     * Questa lista **non** guarda la spunta «manda le note di questo centro».
     *
     * Lo guardava, e il difetto non si vedeva nel codice ma nell'uso: il momento in cui si
     * accende la spunta, la lista si riempie con tutte le note del centro — ma la lista
     * veniva calcolata *prima* che la spunta cambiasse, quindi con la lista ancora vuota.
     * Risultato: il nodo si accendeva e non selezionava niente, due note elencate tutte da
     * spuntare a mano, e un piede che diceva «0 notes».
     *
     * Non era un errore di logica ma un ordine sbagliato: la funzione che doveva rispondere
     * «cosa c'e' sotto questo centro» rispondeva «cosa c'e' sotto questo centro **e che sto
     * gia' mandando**», e le due domande non coincidono. La lista risponde alla prima, e
     * decides se mostrarlo e' un'altra domanda — quella del componente.
     */
    expect(notesOfferedBy(node({ includeNotes: false }), notes).map((entry) => entry.id)).toEqual([
      'n1',
      'n2',
    ])
  })

  it('offers nothing without a main point, because there is nothing to be under', () => {
    expect(notesOfferedBy(node({ hubId: null }), notes)).toEqual([])
  })

  it('keeps a note the user unticked visible, so removing one can be seen and undone', () => {
    /*
     * Una volta questo test pretendeva che la lista fosse **uguale** a cio' che viene mandato.
     * Adesso pretende il contrario, e la ragione del cambio e' la parte importante.
     *
     * Se la lista mostrasse solo le note scelte, togliere una spunta la farebbe sparire dalla
     * lista: l'utente non vedrebbe piu' nulla che dica *quale* nota aveva tolto, e per rimetterla
     * dovrebbe ricordarsi il titolo e cercarlo. Peggio, una nota tolta per sbaglio diventerebbe
     * irraggiungibile dalla stessa riga da cui si era tolta — e il modo per recuperarla
     * diventerebbe spegnere e riaccendere la casella, che azzera tutta la lista.
     *
     * Quindi la lista e' un **soprinsieme** di cio' che viene mandato: contiene tutto quello
     * che c'e' sotto il centro, e la spunta dice cosa passa. Il numero nel piede del nodo
     * continua a dire la verta' — quanti ne passano — quindi i due non si contraddicono mai.
     */
    const data = node({ entryIds: ['n2'] })
    const listed = notesOfferedBy(data, notes).map((entry) => entry.id)
    const sent = ids(resolveKnowledgePick(data, notes, hubs))
    expect(listed).toEqual(['n1', 'n2'])
    expect(sent).toEqual(['n2'])
    // La relazione che tiene insieme le due cose: tutto quello che parte e' nell'elenco.
    // E' la' che impedisce al nodo di mandare una nota che l'utente non vede da nessuna parte.
    for (const id of sent) expect(listed).toContain(id)
  })

})