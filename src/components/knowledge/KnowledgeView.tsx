import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Check,
  Database,
  HardDrive,
  Link2,
  List,
  Orbit,
  Plus,
  Search,
  Trash2,
  Unlink,
  X,
} from 'lucide-react'
import { useKnowledgeStore } from '../../store/knowledgeStore'
import { useUiStore } from '../../store/uiStore'
import { neighboursOf, titleFor } from '../../logic/knowledge'
import { KNOWLEDGE_COLOUR_NAMES, KNOWLEDGE_COLOURS } from '../../logic/knowledgeColour'
import { createKnowledgeScene, type SceneSelection } from './knowledgeScene'
import { KnowledgeSearchBar } from './KnowledgeSearchBar'
import { VaultDialog } from './VaultDialog'
import { Button, IconButton } from '../common/Button'
import { TextInput } from '../common/FormControls'
import type { KnowledgeEntry, KnowledgeId } from '../../types/knowledge'

/**
 * L'archivio: una pagina a se stante, con la mappa in 3D e, **chiuso**, l'elenco.
 *
 * La mappa e' il posto dove si guarda, e l'elenco e' il posto dove si legge. Sono due modi
 * di guardare la stessa cosa e nessuno dei due si puo' togliere: una pallina non si puo'
 * leggere e un elenco non dice dove si trova niente. Ma **non devono stare insieme** nella
 * schermata.
 *
 * La ragione e' che l'elenco aperto toglieva metà della mappa. E la mappa e' l'unica cosa
 * che dice «di cosa parla questo insieme»: con una colonna di testo che guarda sempre
 * dalla parte destra, l'occhio non ha piu' niente da guardare al centro, e l'archivio che
 * e' nato per orientare si trasforma in un registro da sfogliare. Percio' l'elenco sta
 * chiuso e si apre quando serve — come una sidebar che l'utente accende, non come un
 * pezzo che si sta sempre subendo.
 *
 * Lo stesso vale per la ricerca, e per lo stesso motivo: e' gia' esistita la barra del
 * workspace, ed e' la forma giusta per una ricerca — si apre sopra quello che si sta
 * guardando e si chiude con `Esc`. Una seconda casella fissa in questa pagina sarebbe la
 * stessa funzione due volte, in due posti, con due scorciatoie che l'utente deve ricordare.
 */
export function KnowledgeView() {
  const entries = useKnowledgeStore((state) => state.entries)
  const hubs = useKnowledgeStore((state) => state.hubs)
  const load = useKnowledgeStore((state) => state.load)
  const removeEntry = useKnowledgeStore((state) => state.removeEntry)
  const rename = useKnowledgeStore((state) => state.rename)
  const setColour = useKnowledgeStore((state) => state.setColour)
  const createHub = useKnowledgeStore((state) => state.createHub)
  const renameHub = useKnowledgeStore((state) => state.renameHub)
  const removeHub = useKnowledgeStore((state) => state.removeHub)
  const attachToHub = useKnowledgeStore((state) => state.attachToHub)
  const linkEntries = useKnowledgeStore((state) => state.linkEntries)
  const unlinkEntries = useKnowledgeStore((state) => state.unlinkEntries)
  const moveEntries = useKnowledgeStore((state) => state.moveEntries)
  const moveHub = useKnowledgeStore((state) => state.moveHub)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<ReturnType<typeof createKnowledgeScene> | null>(null)
  const [selection, setSelection] = useState<SceneSelection | null>(null)
  const [ready, setReady] = useState(false)
  /** Whether the notes list is open. Closed is the normal state of the page. */
  const [panelOpen, setPanelOpen] = useState(false)
  /** Whether the link tool is on. Two clicks tie two things together while it is. */
  const [linking, setLinking] = useState(false)
  /** The first half of a tie made from the panel, waiting for the second. */
  /*
   * La prima meta' di un legame aperto dal pannello, e serve sapere **se** c'e' perche'
   * il pannello offre «Link to…» solo quando c'e' un punto di partenza. Senza questo
   * controllo il pulsante ricomparirebbe anche con la prima meta' gia' scelta, e premendolo
   * si ripartirebbe da capo: l'utente che lo preme due volte per sicurezza si troverebbe
   * con due legami invece di uno, e non avrebbe modo di sapere quale dei due sia voluto.
   */
  const [armedLink, setArmedLink] = useState<KnowledgeId | null>(null)
  /** Whether the window that chooses the folder on disk is open. */
  const [vaultOpen, setVaultOpen] = useState(false)

  const selectedNote = useMemo(
    () => (selection?.kind === 'note' ? entries.find((entry) => entry.id === selection.id) ?? null : null),
    [entries, selection],
  )
  const selectedHub = useMemo(
    () => (selection?.kind === 'hub' ? hubs.find((hub) => hub.id === selection.id) ?? null : null),
    [hubs, selection],
  )

  useEffect(() => {
    void load().then(() => setReady(true))
  }, [load])

  /*
   * I tasti: quelli della camera, quelli del pannello, e la ricerca.
   *
   * `Ctrl+K` aprisse la ricerca **del workspace** anche qui, e su questa pagina il workspace
   * non c'e'. Non e' un dettaglio della scorciatoia: e' la differenza fra una ricerca che
   * cerca dove si sta guardando e una che risponde con pezzi di un'altra pagina. La finestra
   * e' la stessa, l'archivio e' questo.
   *
   * I tasti della camera passano alla scena, che e' la che possiede la camera, e tornano
   * `true` quando li ha usati. Quelli che non sono della camera restano a chi se ne occupa,
   * e nessuno deve sapere l'elenco: se sta qui un elenco e domani va avanti, i due posti
   * divergono al primo tasto nuovo, e i tasti smettono di funzionare senza che nulla dica
   * perche'.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        // `Esc` chiude il pannello prima di ogni altra cosa. E' l'ordine giusto perche' il
        // pannello e' l'ultimo aperto: una `Esc` che chiudesse la finestra di ricerca mentre
        // il pannello e' ancora aperto sembrerebbe che la scorciatoia non funzioni.
        if (panelOpen) {
          setPanelOpen(false)
          return
        }
        if (linking) {
          setLinking(false)
          return
        }
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        useUiStore.getState().openSearch('knowledge')
        return
      }
      /*
       * I tasti della camera **non** agiscono mentre si sta scrivendo. Una freccia dentro una
       * casella muove il cursore, e senza questo controllo muoverebbe anche la vista: si
       * scorrerebbe il titolo di una nota e la mappa scivolerebbe via, che e' il modo piu'
       * subdolo di rompere una formazione, perche' i due effetti sono su schermi diversi e
       * nessuno dei due segnala che c'entra l'altro.
       */
      const typing = isTypingTarget(event.target)
      if (typing) return
      if (sceneRef.current?.handleKey(event)) event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [panelOpen, linking])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    /*
     * Se il browser non concede un contesto WebGL non si parte e non si lascia un riquadro
     * nero: la pagina resta comunque utilizzabile, con l'elenco. Un'archivio irraggiungibile
     * perche' manca la grafica e' un archivio perso, e la parte che conta — il testo — e'
     * quella che non ha bisogno di 3D.
     */
    let scene: ReturnType<typeof createKnowledgeScene> | null = null
    try {
      scene = createKnowledgeScene(canvas, {
        onPick: (picked) => setSelection(picked),
        onClear: () => setSelection(null),
        onLink: (from, to) => void tieFromScene(from, to),
        onSettle: ({ notes, hubs: moved }) => {
          /*
             * I due insiemi vanno ai loro due posti e non insieme in una mappa sola. Note e
             * centri stanno in due tabelle diverse: una posizione mandata a quella sbagliata
             * non produce un errore, produce un archivio in cui la mappa alla riapertura
             * mostra i centri dove non ci sono — e il difetto si vede solo al riavvio, che
             * e' il posto peggiore in cui scoprire che la disposizione si e' persa.
             */
          if (notes.size > 0) void moveEntries(notes)
          for (const [id, position] of moved) void moveHub(id, position)
        },
      })
      sceneRef.current = scene
    } catch {
      sceneRef.current = null
      return
    }
    return () => {
      scene?.dispose()
      sceneRef.current = null
    }
    // `tieFromScene` e' definita sotto e usa solo lo store, quindi non entra fra le
    // dipendenze: aggiungerla farebbe ricreare l'intera scena — e con essa perderebbe il
    // contesto WebGL — a ogni cambio di stato.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    sceneRef.current?.setEntries(entries, hubs)
  }, [entries, hubs])

  useEffect(() => {
    sceneRef.current?.setSelected(selection)
  }, [selection])

  useEffect(() => {
    sceneRef.current?.setLinking(linking)
  }, [linking])

  /**
   * Ties two things the user pointed at in the map.
   *
   * Un centro e una nota si appendono; due note si collegano. La distinzione non e' una
   * comodita' di codice: sono due gesti diversi e l'utente li fa in momenti diversi. Il
   * primo dice «questa nota e' di quel gruppo», il secondo dice «queste due note si
   * parlano». Mescolarli metterebbe nel grafo fili che non vogliono significare nulla, e
   * una mappa con fili che non significano niente non ha piu' nessuna informazione.
   */
  function tieFromScene(from: SceneSelection, to: SceneSelection): void {
    // Il collegamento e' finito: la prima meta' non e' piu' in attesa, e lo strumento si
    // spegne da solo. Tenerlo acceso lascerebbe il prossimo clic su una nota collegato a
    // qualcosa che l'utente non stava guardando — che e' il modo piu' rapido per
    // riempire una mappa di fili che nessuno ha chiesto.
    setArmedLink(null)
    setLinking(false)
    if (from.kind === 'hub' && to.kind === 'note') {
      void attachToHub(to.id, from.id)
      setSelection(to)
      return
    }
    if (from.kind === 'note' && to.kind === 'hub') {
      void attachToHub(from.id, to.id)
      setSelection(from)
      return
    }
    if (from.kind === 'note' && to.kind === 'note') {
      void linkEntries(from.id, to.id)
      setSelection(to)
    }
  }

  const focusSelected = useCallback(() => {
    if (selection) sceneRef.current?.focus(selection.id)
  }, [selection])

  const askBeforeDeleting = useCallback(
    (entry: KnowledgeEntry) => {
      /*
       * La conferma non e' una cortesia: e' il posto in cui la promessa «il modello non
       * cancella niente» diventa verificabile dall'altra parte. Una nota cancellata senza
       * domandare non si distingue da una cancellata per errore, e con la parola non si
       * recupera niente.
       *
       * Il testo del pulsante dice **cosa** viene cancellato, non solo «Cancella»: un
       * pulsante generico su una lista lunga e' quello che si preme senza guardare.
       *
       * E il messaggio dice anche cosa **non** cambia: i collegamenti che puntavano a
       * questa nota spariscono con lei. Dirlielo evita la domanda che verrebbe dopo —
       * «perche' quel filo e' sparito?» — e quella domanda, senza risposta, si traduce in
       * un altro archivio che non si tocca per paura.
       */
      useUiStore.getState().requestConfirm({
        title: 'Delete this note?',
        message: `"${titleFor(entry.text).slice(0, 90)}" will be removed from your knowledge. Anything tied to it stays, and just loses the tie. It cannot be undone.`,
        confirmLabel: 'Delete note',
        destructive: true,
        onConfirm: () => {
          void removeEntry(entry.id)
          setSelection((current) => (current?.kind === 'note' && current.id === entry.id ? null : current))
        },
      })
    },
    [removeEntry],
  )

  const askBeforeDeletingHub = useCallback(
    (id: KnowledgeId, name: string, under: number) => {
      /*
       * Cancellare un centro **non cancella le note**, e la differenza va detta prima.
       *
       * Il pulsante genera paura e la paura fa evitare il gesto giusto: «cancella tutto
       * quello che c' dentro» senza spiegare che dentro non c'e' niente che sparisca
       * insieme al centro. Il testo dice una riga sola — le note restano — e la domanda
       * resta una domanda semplice, con una risposta che si puo' dare senza paura.
       */
      useUiStore.getState().requestConfirm({
        title: 'Remove this main point?',
        message: `"${name}" disappears and ${under} ${under === 1 ? 'note stays' : 'notes stay'} in your knowledge. No note is deleted, and you can make the main point again whenever you want.`,
        confirmLabel: 'Remove main point',
        destructive: true,
        onConfirm: () => {
          void removeHub(id)
          setSelection((current) => (current?.kind === 'hub' && current.id === id ? null : current))
        },
      })
    },
    [removeHub],
  )

  const countUnder = useCallback(
    (hubId: KnowledgeId): number => {
      let count = 0
      for (const entry of entries) if (entry.hubId === hubId) count += 1
      return count
    },
    [entries],
  )

  const hubName = useCallback(
    (hubId: KnowledgeId | null): string | null => hubs.find((hub) => hub.id === hubId)?.title ?? null,
    [hubs],
  )

  return (
    <main className="knowledge-page">
      <header className="knowledge-header">
        <div className="knowledge-brand">
          <IconButton label="Back to the last view" title="Back" onClick={() => window.history.back()}>
            <ArrowLeft size={13} />
          </IconButton>
          <Database size={18} />
          <span>Knowledge</span>
          <span className="knowledge-count">
            {entries.length} {entries.length === 1 ? 'note' : 'notes'}
            {hubs.length > 0 ? ` · ${hubs.length} ${hubs.length === 1 ? 'main point' : 'main points'}` : ''}
          </span>
        </div>
        <div className="knowledge-actions">
          {/*
            La ricerca e' **quella del workspace**, non una casella nuova. Si apre sopra la
            mappa e si chiude con `Esc`: mentre si cerca si continua a vedere l'archivio,
            e scegliendo un risultato la nota viene centrata e non persa.
          */}
          <Button
            size="small"
            icon={<Search size={12} />}
            onClick={() => useUiStore.getState().openSearch('knowledge')}
          >
            Search
          </Button>
          {/*
            Il collegamento e' uno **strumento**, quindi si accende e si spegne e resta
            acceso finche' non lo si spegne. Senza lo stato si accesa, ogni clic su una
            nota collegherebbe qualcosa a qualcos'altro e non ci sarebbe modo di tornare
            indietro senza annullare ogni collegamento uno per uno.
          */}
          <Button
            size="small"
            icon={<Link2 size={12} />}
            variant={linking ? 'primary' : 'default'}
            onClick={() => {
              setArmedLink(null)
              setLinking((on) => !on)
            }}
            title={linking ? 'Linking is on — click two notes' : 'Tie one note to another'}
          >
            {linking ? 'Linking…' : 'Link'}
          </Button>
          <Button
            size="small"
            icon={<Plus size={12} />}
            onClick={() => void createHub('New main point')}
            title="Make a main point of context and hang notes on it"
          >
            Main point
          </Button>
          <Button
            size="small"
            icon={<Orbit size={12} />}
            onClick={() => sceneRef.current?.resetView()}
          >
            Reset view
          </Button>
          <Button
            size="small"
            icon={<HardDrive size={12} />}
            onClick={() => setVaultOpen(true)}
            title="Choose a folder on your computer to keep your notes as files"
          >
            Folder
          </Button>
          <Button
            size="small"
            icon={<List size={12} />}
            variant={panelOpen ? 'primary' : 'default'}
            onClick={() => setPanelOpen((open) => !open)}
          >
            Notes
          </Button>
        </div>
      </header>

      <div className="knowledge-body">
        <section className="knowledge-map" aria-label="Saved notes in space">
          <canvas ref={canvasRef} className="knowledge-canvas" />
          {entries.length === 0 && ready ? (
            <p className="knowledge-empty">
              Nothing saved yet. Select a passage in an answer and press
              <strong> Save to knowledge</strong>.
            </p>
          ) : null}
          {linking ? (
            <p className="knowledge-linking">Click a note, then click the one it should be tied to</p>
          ) : null}
          <p className="knowledge-hint">
            Drag a note to move it · drag the background to turn · scroll to zoom
          </p>
        </section>

        {/*
          L'elenco sta **fuori dal flusso** e si mette sopra la mappa quando si apre. Il
          motivo e' il primo di questo file: la mappa deve restare la cosa grande, e un
          pannello che si apre spostando tutto quello che c'e' intorno mostrerebbe che il
          posto dell'archivio e' metà mappa e metà elenco.
        */}
        {panelOpen ? (
          <aside className="knowledge-panel" aria-label="Saved notes">
            <header className="knowledge-panel-head">
              <strong>Notes</strong>
              <IconButton label="Close the notes list" onClick={() => setPanelOpen(false)}>
                <X size={13} />
              </IconButton>
            </header>
            <div className="knowledge-panel-body">
              {selectedNote ? (
                <div className="knowledge-detail">
                  <IconButton
                    label="Back to all notes"
                    onClick={() => setSelection(null)}
                    title="Back to all notes"
                  >
                    <ArrowLeft size={12} />
                  </IconButton>
                  <TextInput
                    value={selectedNote.title}
                    aria-label="Note title"
                    onChange={(event) => void rename(selectedNote.id, event.currentTarget.value)}
                  />
                  <p className="knowledge-detail-why">Placed {selectedNote.placedBecause}</p>
                  <p className="knowledge-detail-text">{selectedNote.text}</p>
                  {selectedNote.source.nodeTitle || selectedNote.source.workspaceName ? (
                    <p className="knowledge-detail-source">
                      From {selectedNote.source.nodeTitle ?? 'a note'}
                      {selectedNote.source.workspaceName ? ` — ${selectedNote.source.workspaceName}` : ''}
                    </p>
                  ) : null}

                  {/*
                    Il centro di contesto si cambia **qui** e non solo quando si salva. E' il
                    motivo per cui la scelta fatta nella finestra non e' irreversibile: una
                    nota appesa al centro sbagliato si sposta con un clic, e senza questo
                    l'unico modo di correggerla sarebbe rifare il salvataggio.
                  */}
                  <label className="form-field">
                    <span>Main point of context</span>
                    <select
                      className="select"
                      value={selectedNote.hubId ?? ''}
                      aria-label="Main point of context for this note"
                      onChange={(event) =>
                        void attachToHub(selectedNote.id, event.currentTarget.value || null)
                      }
                    >
                      <option value="">No main point</option>
                      {hubs.map((hub) => (
                        <option key={hub.id} value={hub.id}>
                          {hub.title}
                        </option>
                      ))}
                    </select>
                  </label>

                  {/*
                    Il colore, scelto **qui** e non al salvataggio.

                    La stessa ragione del centro di contesto sopra, e con la stessa
                    conseguenza: una nota colorata male si ricolora con un clic invece di
                    doverla risalvare. E ogni pastiglia ha un nome, perche' a colpo d'occhio
                    due tinte vicine non si distinguono — e una scelta che non si vede non e'
                    una scelta.

                    Il segno di spunta e' sul bordo e non dentro: il riempimento e' gia' il
                    colore, quindi un segno dentro coprirebbe proprio la cosa che si sta
                    scegliendo.
                  */}
                  <div className="knowledge-colours" role="group" aria-label="Colour for this note">
                    {KNOWLEDGE_COLOURS.map((colour) => {
                      const on = colour === (selectedNote.color ?? 'default')
                      return (
                        <button
                          key={colour}
                          type="button"
                          className={`knowledge-swatch knowledge-swatch-${colour} ${on ? 'is-on' : ''}`}
                          aria-pressed={on}
                          aria-label={KNOWLEDGE_COLOUR_NAMES[colour]}
                          title={KNOWLEDGE_COLOUR_NAMES[colour]}
                          onClick={() => void setColour(selectedNote.id, colour)}
                        >
                          {on ? <Check aria-hidden /> : null}
                        </button>
                      )
                    })}
                  </div>

                  {armedLink === selectedNote.id ? (
                    <p className="save-note-where-suggest">
                      Pick the other end in the map — the note this one ties to, or the
                      main point it belongs to.
                    </p>
                  ) : null}

                  {/*
                    I collegamenti si sciolgono da qui uno per uno, con il nome della nota
                    dall'altra parte. Il pulsante dice **quale** legame tocca e non «rimuovi»:
                    su una lista di collegamenti la parola generica non dice niente, e
                    l'utente preme perche' non sa quale sta togliendo.
                  */}
                  <div className="knowledge-detail-links">
                    <span className="knowledge-detail-links-label">Tied to</span>
                    {tiedNotes(selectedNote.id, entries).map((tied) => (
                      <div key={tied.id} className="knowledge-detail-link">
                        <button
                          type="button"
                          className="knowledge-detail-link-name"
                          onClick={() => setSelection({ kind: 'note', id: tied.id })}
                        >
                          {tied.title}
                        </button>
                        <IconButton
                          label={`Untie ${tied.title}`}
                          onClick={() => void unlinkEntries(selectedNote.id, tied.id)}
                        >
                          <Unlink size={11} />
                        </IconButton>
                      </div>
                    ))}
                    {tiedNotes(selectedNote.id, entries).length === 0 ? (
                      <p className="knowledge-detail-links-empty">
                        Nothing yet. Use <strong>Link</strong> above the map, or press{' '}
                        <strong>Link to…</strong> to pick one by hand.
                      </p>
                    ) : null}
                    <Button
                      size="small"
                      icon={<Link2 size={11} />}
                      onClick={() => {
                        /*
                         * Il primo tocco e' **gia' fatto**: la nota aperta nel pannello e'
                         * la prima meta' del legame. Senza questo, accendere lo strumento
                         * costringerebbe a riclickare la nota che l'utente sta guardando, e
                         * il primo dei due clic si consumerebbe come se fosse il primo: il
                         * legame non partirebbe e il pulsante sembrerebbe rotto.
                         */
                        setArmedLink(selectedNote.id)
                        sceneRef.current?.beginLink({ kind: 'note', id: selectedNote.id })
                        setLinking(true)
                      }}
                    >
                      Link to…
                    </Button>
                  </div>

                  <div className="knowledge-detail-actions">
                    <Button size="small" onClick={focusSelected}>Find it</Button>
                    <Button
                      size="small"
                      variant="danger"
                      icon={<Trash2 size={12} />}
                      onClick={() => askBeforeDeleting(selectedNote)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ) : selectedHub ? (
                <div className="knowledge-detail">
                  <IconButton
                    label="Back to the map"
                    onClick={() => setSelection(null)}
                    title="Back to the map"
                  >
                    <ArrowLeft size={12} />
                  </IconButton>
                  <TextInput
                    value={selectedHub.title}
                    aria-label="Main point title"
                    onChange={(event) => void renameHub(selectedHub.id, event.currentTarget.value)}
                  />
                  <p className="knowledge-detail-why">
                    {countUnder(selectedHub.id)} {countUnder(selectedHub.id) === 1 ? 'note hangs' : 'notes hang'} here
                  </p>
                  <ul className="knowledge-hub-notes">
                    {entries
                      .filter((entry) => entry.hubId === selectedHub.id)
                      .map((entry) => (
                        <li key={entry.id}>
                          <button
                            type="button"
                            className="knowledge-entry"
                            onClick={() => setSelection({ kind: 'note', id: entry.id })}
                          >
                            <span className="knowledge-entry-title">{entry.title}</span>
                          </button>
                        </li>
                      ))}
                  </ul>
                  <div className="knowledge-detail-actions">
                    <Button size="small" onClick={focusSelected}>Find it</Button>
                    <Button
                      size="small"
                      variant="danger"
                      icon={<Trash2 size={12} />}
                      onClick={() =>
                        askBeforeDeletingHub(selectedHub.id, selectedHub.title, countUnder(selectedHub.id))
                      }
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  {/*
                    I punti di contesto vengono **prima** delle note, e non mescolati.
                    Sono le uniche voci che dicono come e' organizzato l'archivio, quindi
                    devono stare dove le si cerca senza leggerne centinaia: sotto un'etichetta
                    che le nomina per quello che sono.
                  */}
                  {hubs.length > 0 ? (
                    <section className="knowledge-hubs">
                      <h3 className="knowledge-panel-section">Main points</h3>
                      <ul className="knowledge-entries">
                        {hubs.map((hub) => (
                          <li key={hub.id}>
                            <button
                              type="button"
                              className="knowledge-entry knowledge-entry-hub"
                              onClick={() => setSelection({ kind: 'hub', id: hub.id })}
                            >
                              <span className="knowledge-entry-title">{hub.title}</span>
                              <span className="knowledge-entry-why">
                                {countUnder(hub.id)} {countUnder(hub.id) === 1 ? 'note' : 'notes'}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                  <ul className="knowledge-entries">
                    {entries.map((entry) => (
                      <li key={entry.id}>
                        <button
                          type="button"
                          className="knowledge-entry"
                          onClick={() => setSelection({ kind: 'note', id: entry.id })}
                        >
                          <span className="knowledge-entry-title">{entry.title}</span>
                          <span className="knowledge-entry-why">
                            {hubName(entry.hubId)
                              ? `under ${hubName(entry.hubId)}`
                              : entry.placedBecause}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {ready && entries.length === 0 ? (
                    <p className="knowledge-none">
                      Nothing saved yet. Select a passage in an answer and press
                      <strong> Save to knowledge</strong>.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </aside>
        ) : null}
      </div>

      {/*
        La ricerca e' la **stessa** finestra del workspace, montata qui con l'archivio
        come ambito. Scegliendo un risultato la nota viene scelta e il pannello aperto:
        la si vuole accanto alla mappa, perche' il testo da solo non dice dove si trova e
        in un archivio il posto e' meta' dell'informazione.
      */}
      <KnowledgeSearchBar
        onOpen={(id) => {
          setSelection({ kind: 'note', id })
          setPanelOpen(true)
          sceneRef.current?.focus(id)
        }}
      />
      {/*
        Il deposito sta **dentro** la pagina dell'archivio e non nelle impostazioni generali.
        E' una scelta di dove mettere una cosa perche' l'archivio e' uno per applicazione e le
        impostazioni sono per cosa si fa con i workspace: una finestra che riguarda l'archivio
        starebbe li' dove non si capisce che cosa riguarda, e si aprirebbe dal posto sbagliato.
        Qui si arriva dal bottone che dice «cartella», accanto alle note che sono quelle che
        finiscono dentro.
      */}
      {vaultOpen ? <VaultDialog onClose={() => setVaultOpen(false)} /> : null}
    </main>
  )
}

/**
 * True when the key is going into a field, so the camera keys stay out of the way.
 *
 * Il controllo e' sul **taglio del campo**, non sul fatto che sia selezionato: un tasto va
 * in un campo anche quando il campo non ha il fuoco ma e' l'elemento attivo, e i due casi
 * non si distinguono guardando `document.activeElement` da soli. Usando il taglio si coprono
 * entrambi senza dover tenere conto di `contentEditable`, che e' un attributo e non un tag.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/** The notes tied to one, from either side of the tie. */
function tiedNotes(
  id: KnowledgeId,
  entries: readonly KnowledgeEntry[],
): KnowledgeEntry[] {
  const ids = neighboursOf(entries, id)
  const out: KnowledgeEntry[] = []
  for (const candidate of entries) {
    if (ids.includes(candidate.id)) out.push(candidate)
  }
  return out
}