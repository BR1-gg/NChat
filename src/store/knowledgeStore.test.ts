/**
 * L'archivio su disco: i punti di contesto, i collegamenti e le posizioni.
 *
 * Qui non si testa il disegno — quello si guarda con gli occhi — ma le tre cose che
 * **scompaiono in silenzio** quando vanno storte:
 *
 * - **una riga vecchia senza i campi nuovi.** Un archivio salvato prima che esistessero i
 *   centri non ha `hubId` ne `links`. Se la lettume non sopporta la loro assenza, si rompe
 *   al riavvio, su un archivio che sembrava pieno, e il difetto non si vede finche' non si
 *   riapre la pagina — che e' il posto peggiore in cui accorgersi di aver perso tutto.
 * - **un centro che sparisce e lascia il filo.** Cancellare un centro non cancella note,
 *   ma non deve nemmeno lasciare una nota appesa a un id che non porta piu' da nessuna
 *   parte.
 * - **una nota cancellata che lascia legami appesi.** Il filo verso il nulla e' il difetto
 *   peggiore: si vede che un rapporto c'e' e dall'altra parte non c'e' piu' nessuno.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { db, type KnowledgeRow } from '../persistence/db'
import { useKnowledgeStore } from './knowledgeStore'
import type { KnowledgeDraft } from '../types/knowledge'

function draft(text: string, hubId?: string | null): KnowledgeDraft {
  return {
    text,
    hubId: hubId ?? null,
    source: { workspaceId: null, workspaceName: null, nodeTitle: null, nodeId: null },
  }
}

/**
 * Un database vuoto, **riaperto**.
 *
 * `db.delete()` chiude la connessione, non la cancella soltanto: dopo, ogni accesso a una
 * tabella finisce in `DatabaseClosedError`. Il `open()` non e' una formalita' — e' la
 * differenza fra un archivio che si apre vuoto e uno su cui non si puo' scrivere niente,
 * che e' lo stesso difetto che il test sta provando a trovare.
 */
async function wiped(): Promise<void> {
  await db.delete()
  await db.open()
}

async function archive(): Promise<void> {
  await wiped()
  useKnowledgeStore.setState({ entries: [], hubs: [], loaded: false, revision: 0 })
  await useKnowledgeStore.getState().load()
}

/** Una riga come quella che c'era prima che esistessero i centri. */
function legacyRow(over: Partial<KnowledgeRow> = {}): KnowledgeRow {
  return {
    id: over.id ?? 'old1',
    title: 'Nota vecchia',
    text: 'una nota di prima dei punti di contesto',
    workspaceId: null,
    workspaceName: null,
    nodeTitle: null,
    nodeId: null,
    positionX: 1,
    positionY: 2,
    positionZ: 3,
    createdAt: 1,
    updatedAt: 1,
    placedBecause: 'no related note yet',
    ...over,
  }
}

describe('an archive written before main points existed', () => {
  beforeEach(async () => {
    await wiped()
    // La riga viene messa **a mano**, senza `hubId` e senza `links`: e' esattamente quello
    // che c'era nel database di chi non ha ancora aperto questa versione.
    await db.knowledge.put(legacyRow())
    useKnowledgeStore.setState({ entries: [], hubs: [], loaded: false, revision: 0 })
  })

  it('opens as one free note with no ties, instead of failing to open at all', async () => {
    await useKnowledgeStore.getState().load()
    const [entry] = useKnowledgeStore.getState().entries
    expect(entry?.title).toBe('Nota vecchia')
    expect(entry?.hubId).toBeNull()
    expect(entry?.links).toEqual([])
  })

  it('reads the same when the fields are there but empty', async () => {
    await db.knowledge.put(legacyRow({ id: 'old2', hubId: null, links: [] }))
    await useKnowledgeStore.getState().load()
    expect(useKnowledgeStore.getState().entries).toHaveLength(2)
  })

  it('ignores a tie written as something that is not a list of ids', async () => {
    await db.knowledge.put(legacyRow({ id: 'old3', links: 'non una lista' as unknown as string[] }))
    await useKnowledgeStore.getState().load()
    const third = useKnowledgeStore.getState().entries.find((entry) => entry.id === 'old3')
    expect(third?.links).toEqual([])
  })
})

describe('main points', () => {
  beforeEach(archive)

  it('hangs the note that asked for it, instead of leaving a centre with nothing on it', async () => {
    // Il centro e' nato **perche'** c'era una nota che non sapeva dove mettersi. Se la
    // nota non venisse appesa, la mappa mostrerebbe un involucro vuoto accanto a una
    // pallina lontana con un filo che attraversa mezzo spazio: direbbe che la nota e' sua
    // mentre la posizione direbbe il contrario, e dei due segni si vede di piu' quello falso.
    const entry = await useKnowledgeStore.getState().save(draft('una nota qualsiasi'))
    const hub = await useKnowledgeStore.getState().createHub('Listini', entry?.id)
    const state = useKnowledgeStore.getState()
    expect(state.hubs).toHaveLength(1)
    expect(state.entries[0]?.hubId).toBe(hub?.id)
    expect(state.entries[0]?.placedBecause).toBe('under "Listini"')
  })

  it('spreads two notes on the same main point instead of stacking them', async () => {
    const hub = await useKnowledgeStore.getState().createHub('Listini')
    const first = await useKnowledgeStore.getState().save(draft('prima nota', hub?.id))
    const second = await useKnowledgeStore.getState().save(draft('seconda nota', hub?.id))
    const distance = Math.hypot(
      first!.position.x - second!.position.x,
      first!.position.y - second!.position.y,
      first!.position.z - second!.position.z,
    )
    expect(distance).toBeGreaterThanOrEqual(2.4)
  })

  it('treats a note saved under a main point that no longer exists as free', async () => {
    const saved = await useKnowledgeStore.getState().save(draft('nota', 'sparito'))
    expect(saved?.hubId).toBeNull()
    expect(saved?.placedBecause).not.toContain('under')
  })

  it('leaves the notes alone when a main point is removed', async () => {
    // Il centro e' stato un modo per ordinarle, non un contenitore. Cancellare con il
    // contenitore significa che il gesto di riordinare costa il lavoro.
    const hub = await useKnowledgeStore.getState().createHub('Listini')
    await useKnowledgeStore.getState().save(draft('nota sotto il centro', hub?.id))
    await useKnowledgeStore.getState().removeHub(hub!.id)
    const state = useKnowledgeStore.getState()
    expect(state.hubs).toHaveLength(0)
    expect(state.entries).toHaveLength(1)
    expect(state.entries[0]?.hubId).toBeNull()
    expect((await db.knowledge.toArray())[0]?.hubId).toBeNull()
  })

  it('renames the reason too, so the map and the note never disagree', async () => {
    const hub = await useKnowledgeStore.getState().createHub('Vecchio nome')
    await useKnowledgeStore.getState().save(draft('nota', hub?.id))
    await useKnowledgeStore.getState().renameHub(hub!.id, 'Nuovo nome')
    // L'antefatto cita il nome del centro: senza questo, la mappa direbbe una cosa e la
    // nota un'altra, e non si saprebbe quale delle due sia quella giusta.
    expect(useKnowledgeStore.getState().entries[0]?.placedBecause).toBe('under "Nuovo nome"')
  })

  it('moves a note to another main point only when it actually changes main point', async () => {
    const one = await useKnowledgeStore.getState().createHub('Uno')
    const two = await useKnowledgeStore.getState().createHub('Due')
    const saved = await useKnowledgeStore.getState().save(draft('nota', one?.id))
    const moved = { ...saved!.position }
    await useKnowledgeStore.getState().attachToHub(saved!.id, one?.id ?? null)
    expect(useKnowledgeStore.getState().entries[0]?.position).toEqual(moved)
    await useKnowledgeStore.getState().attachToHub(saved!.id, two?.id ?? null)
    expect(useKnowledgeStore.getState().entries[0]?.hubId).toBe(two?.id)
    expect(useKnowledgeStore.getState().entries[0]?.position).not.toEqual(moved)
  })
})

describe('ties between notes', () => {
  beforeEach(archive)

  it('writes the tie once, from one side, however it is asked', async () => {
    const a = await useKnowledgeStore.getState().save(draft('prima'))
    const b = await useKnowledgeStore.getState().save(draft('seconda'))
    await useKnowledgeStore.getState().linkEntries(a!.id, b!.id)
    await useKnowledgeStore.getState().linkEntries(a!.id, b!.id)
    // La chiave e' salvata una volta sola: due copie produrrebbero due fili per lo stesso
    // rapporto, e l'utente che conta i fili per capire com'e' fatto l'archivio sbaglia.
    expect((await db.knowledge.toArray()).filter((row) => row.links?.includes(b!.id))).toHaveLength(1)
  })

  it('does not tie a note to itself, because that would show as a dot', async () => {
    const a = await useKnowledgeStore.getState().save(draft('una'))
    await useKnowledgeStore.getState().linkEntries(a!.id, a!.id)
    expect((await db.knowledge.toArray())[0]?.links).toEqual([])
  })

  it('unties from whichever side was holding the tie', async () => {
    const a = await useKnowledgeStore.getState().save(draft('prima'))
    const b = await useKnowledgeStore.getState().save(draft('seconda'))
    await useKnowledgeStore.getState().linkEntries(a!.id, b!.id)
    await useKnowledgeStore.getState().unlinkEntries(a!.id, b!.id)
    expect((await db.knowledge.toArray()).flatMap((row) => row.links ?? [])).toEqual([])
  })

  it('takes the ties with it, so no thread is left pointing at nothing', async () => {
    const a = await useKnowledgeStore.getState().save(draft('prima'))
    const b = await useKnowledgeStore.getState().save(draft('seconda'))
    await useKnowledgeStore.getState().linkEntries(a!.id, b!.id)
    await useKnowledgeStore.getState().removeEntry(a!.id)
    const rows = await db.knowledge.toArray()
    expect(rows.flatMap((row) => row.links ?? [])).toEqual([])
  })
})

describe('where the map left the notes', () => {
  beforeEach(archive)

  it('writes a position that actually moved', async () => {
    await useKnowledgeStore.getState().save(draft('nota'))
    await useKnowledgeStore.getState().moveEntries(new Map([[useKnowledgeStore.getState().entries[0]!.id, { x: 5, y: 0, z: 0 }]]))
    expect((await db.knowledge.toArray())[0]?.positionX).toBe(5)
  })

  it('leaves the file alone when nothing moved enough to see', async () => {
    const saved = await useKnowledgeStore.getState().save(draft('nota'))
    const before = (await db.knowledge.toArray())[0]
    // Sotto la soglia la mappa chiama comunque `moveEntries` a ogni fotogramma: scrivere
    // produrrebbe una scrittura identica a quella di un istante prima, per sempre.
    await useKnowledgeStore.getState().moveEntries(
      new Map([[saved!.id, { x: saved!.position.x + 0.01, y: saved!.position.y, z: saved!.position.z }]]),
    )
    expect((await db.knowledge.toArray())[0]?.updatedAt).toBe(before?.updatedAt)
  })

  it('does nothing at all when handed no positions', async () => {
    await useKnowledgeStore.getState().save(draft('nota'))
    const before = useKnowledgeStore.getState().revision
    await useKnowledgeStore.getState().moveEntries(new Map())
    expect(useKnowledgeStore.getState().revision).toBe(before)
  })

  it('writes back a main point that was dragged, which is a different table', async () => {
    const hub = await useKnowledgeStore.getState().createHub('Listini')
    await useKnowledgeStore.getState().moveHub(hub!.id, { x: -4, y: 0, z: 0 })
    expect((await db.knowledgeHubs.toArray())[0]?.positionX).toBe(-4)
  })
})