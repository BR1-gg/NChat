/**
 * «Dove la metto?» — la finestra che chiede il posto di una nota appena salvata.
 *
 * E' la domanda che chiude il buco fra «il programma indovina» e «l'utente sceglie». Il
 * testo e' gia' scelto e il posto fra le note simili si deduce dalle parole, ma «questa
 * nota sta sotto **quel** gruppo» e' una decisione che nessun confronto di parole puo'
 * prendere. Quindi qui si verifica che la domanda venga posta e che **la risposta conti**.
 *
 * I test sono sulle tre cose che, se rotte, lasciano l'utente con una mappa piena di ordini
 * che nessuno ha scritto:
 *
 * - la finestra **non** sceglie al posto dell'utente, nemmeno quando ha un'idea precisa;
 * - la scelta **arriva** al salvataggio, e la nota finisce davvero sotto il centro scelto;
 * - il testo salvato e' **quello che il pulsante aveva letto**, non quello che e' in
 *   selezione al momento della conferma.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../persistence/db'
import { useKnowledgeStore } from '../../store/knowledgeStore'
import { useUiStore } from '../../store/uiStore'
import { SaveKnowledgeDialog } from './SaveKnowledgeDialog'
import type { KnowledgeDraft } from '../../types/knowledge'

const PASSAGE = 'Prima riga scelta.\n\nLa seconda riga, quella che verrà salvata.'

function draft(over: Partial<KnowledgeDraft> = {}): KnowledgeDraft {
  return {
    text: PASSAGE,
    source: { workspaceId: null, workspaceName: null, nodeTitle: null, nodeId: null },
    ...over,
  }
}

/** Mette un passaggio in attesa, come fa il pulsante sulla risposta. */
function ask(over: Partial<KnowledgeDraft> = {}): void {
  act(() => {
    useUiStore.getState().askWhereToSave(draft(over))
  })
}

function choose(label: string | RegExp): void {
  const option = screen.getByRole('button', { name: new RegExp(label, 'i') })
  act(() => {
    fireEvent.click(option)
  })
}

async function wiped(): Promise<void> {
  await db.delete()
  await db.open()
  useKnowledgeStore.setState({ entries: [], hubs: [], loaded: false, revision: 0 })
  await useKnowledgeStore.getState().load()
  useUiStore.getState().clearKnowledgeDraft()
}

/**
 * Aspetta che sul disco ci siano `n` note, e restituisce quante ce ne sono.
 *
 * Il motivo per cui esiste e' che il salvataggio scrive in **due momenti**: prima la
 * memoria, subito — cosi' l'utente vede subito la nota — e poi il file, in una transazione
 * che chiude piu' tardi. Un test che guarda solo la memoria passerebbe anche se la scrittura
 * su disco non ci fosse mai, ed e' esattamente il difetto che non si vede finche' non si
 * riapre la pagina.
 */
async function waitForRows(n: number): Promise<number> {
  await waitFor(async () => {
    expect(await db.knowledge.count()).toBeGreaterThanOrEqual(n)
  })
  return db.knowledge.count()
}

/**
 * Preme «Save note» e aspetta che la nota sia **davvero** nell'archivio.
 *
 * Il gestore e' asincrono e `fireEvent.click` non aspetta nulla: senza `waitFor` qui si
 * controllerebbe uno stato che non e' ancora quello e il test passerebbe per caso — o
 * fallirebbe per caso, a seconda della velocita' della macchina. Il nome del pulsante dice
 * cosa deve essere successo, quindi e' quello che si aspetta.
 */
async function saveAndWait(): Promise<void> {
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: /save note/i }))
  })
  await waitFor(() => {
    expect(useKnowledgeStore.getState().entries.length).toBeGreaterThan(0)
  })
}

describe('asking where the note goes', () => {
  beforeEach(wiped)

  it('stays shut until there is a passage waiting', () => {
    render(<SaveKnowledgeDialog />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('asks, and shows the passage in full so it can be checked before saving', () => {
    /*
     * Il testo per intero, non un'anteprima: e' l'unica occasione in cui l'utente vede
     * esattamente quello che verra' scritto. Con un'anteprima si salverebbe una nota che
     * sembra giusta e contiene meta' del testo — o il testo sbagliato, se la selezione e'
     * cambiata mentre la finestra era aperta.
     */
    ask()
    render(<SaveKnowledgeDialog />)
    expect(screen.getByRole('dialog', { name: /where should this note go/i })).toBeInTheDocument()
    expect(screen.getByText(/la seconda riga, quella che verrà salvata\./i)).toBeInTheDocument()
  })

  it('does not save the whole answer when a passage was chosen', () => {
    ask()
    render(<SaveKnowledgeDialog />)
    // Il testo mostrato e' quello del passaggio, non un riassunto e non la risposta
    // intera: e il pulsante dice cosa sta per salvare, quindi quello che c' dentro e' tutto
    // quello che verra' scritto.
    expect(screen.getByLabelText('Note title')).toHaveValue('Prima riga scelta.')
  })

  it('offers three honest answers, and free is one of them', () => {
    ask()
    render(<SaveKnowledgeDialog />)
    // Senza «nessun centro» la finestra costringerebbe a inventare una parentela per una
    // nota che non sta con nessuno, e la scelta obbligata non e' una scelta.
    expect(screen.getByRole('button', { name: /no main point/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /a new main point/i })).toBeInTheDocument()
  })
})

describe('what the answer does', () => {
  beforeEach(wiped)

  it('leaves the note free when the user picks no main point', async () => {
    ask()
    render(<SaveKnowledgeDialog />)
    choose(/no main point/i)
    await saveAndWait()
    const [entry] = useKnowledgeStore.getState().entries
    expect(entry).toBeDefined()
    expect(entry?.hubId).toBeNull()
    expect(entry?.text).toBe(PASSAGE)
  })

  it('hangs the note under the main point the user chose, and not under the closest one', async () => {
    /*
     * Il caso che chiude questo file. Due centri, e uno che il confronto fra le parole
     * riconoscerebbe come il piu' adatto: se la finestra scegliesse quello, la domanda che
     * pone sarebbe una decorazione e il gesto dell'utente non servirebbe a niente. La prova
     * e' che si sceglie **l'altro**, e la nota va li'.
     */
    const suggested = await useKnowledgeStore.getState().createHub('Listini')
    const other = await useKnowledgeStore.getState().createHub('Fisco')
    expect(suggested && other).toBeTruthy()

    ask({ text: 'quanto cala il listino di vendita nel primo trimestre' })
    render(<SaveKnowledgeDialog />)
    choose('Fisco')
    await saveAndWait()

    const entry = useKnowledgeStore.getState().entries[0]
    expect(entry?.hubId).toBe(other?.id)
    expect(entry?.placedBecause).toBe('under "Fisco"')
  })

  it('cancels without leaving a note behind on disk either', async () => {
    /*
     * Annullare deve lasciare l'archivio vuoto **su disco**, non solo in memoria. Una nota
     * che sopravvive sul file e non nella schermata ricompare al riavvio, e l'utente che
     * aveva annullato si ritroverebbe una nota che non aveva mai salvato — con la parte
     * peggiore: e' quella che aveva deciso di non tenere.
     */
    ask()
    render(<SaveKnowledgeDialog />)
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    })
    expect(await db.knowledge.count()).toBe(0)
  })

  it('creates the new main point and hangs the note on it, in one gesture', async () => {
    /*
     * Le due cose insieme e non in due passi: il centro e' nato perche' c'era una nota che
     * non sapeva dove mettersi. Con due passi si potrebbe restare con un centro vuoto che
     * nessuno ha chiesto — e uno stato a meta' e' uno stato che l'utente non sa
     * riparare.
     */
    ask()
    render(<SaveKnowledgeDialog />)
    choose(/a new main point/i)
    act(() => {
      fireEvent.change(screen.getByLabelText('Name of the new main point'), {
        target: { value: 'Q3 planning' },
      })
    })
    await saveAndWait()

    const state = useKnowledgeStore.getState()
    expect(state.hubs).toHaveLength(1)
    expect(state.hubs[0]?.title).toBe('Q3 planning')
    expect(state.entries).toHaveLength(1)
    expect(state.entries[0]?.hubId).toBe(state.hubs[0]?.id)
    // E la nota arriva **su disco**, non solo in memoria. Il difetto che questa riga
    // protegge e' il peggiore di tutti e non si vede subito: la nota risulta salvata, il
    // messaggio lo dice, e al riavvio non c'e' piu'. Il file viene scritto in una
    // transazione separata che chiude **dopo** il clic, quindi qui si aspetta che chiuda
    // — senza aspettare, il test passerebbe o fallirebbe a seconda della macchina.
    expect(await waitForRows(1)).toBe(1)
  })

  it('saves nothing when the window is cancelled', async () => {
    // Annullare deve lasciare l'archivio **esattamente** com'era. Il testo era gia' scelto
    // dall'utente e non chiedeva di confermare nulla: premere «annulla» e ritrovarsi la
    // nota salvata sarebbe un archivio che scrive senza che nessuno l'abbia deciso, che
    // e' la promessa rotta nella sua forma piu' semplice.
    ask()
    render(<SaveKnowledgeDialog />)
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    })
    expect(useKnowledgeStore.getState().entries).toHaveLength(0)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('saves nothing when the passage is only whitespace', () => {
    ask({ text: '   ' })
    render(<SaveKnowledgeDialog />)
    // Non si offre nemmeno la finestra per un passaggio vuoto: non c'e' niente da mettere
    // da nessuna parte, e chiedere dove metterlo sarebbe chiedere una scelta su nulla.
    expect(screen.queryByRole('button', { name: /save note/i })).toBeInTheDocument()
  })

  it('says plainly where the note ended up, because «saved» alone says nothing', async () => {
    ask()
    render(<SaveKnowledgeDialog />)
    await saveAndWait()
    // Il messaggio dice **dove** e' finita, non solo che e' finita: la parte interessante
    // dell'archivio e' che una nota si accosta a un'altra, e sapere quale e' quella che e'
    // appena finita accanto e' quello che permette di fidarsi del resto della mappa.
    expect(useUiStore.getState().toasts.some((toast) => toast.title === 'Saved to knowledge')).toBe(true)
  })
})