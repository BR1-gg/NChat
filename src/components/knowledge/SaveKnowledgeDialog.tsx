import { useMemo, useState } from 'react'
import { Circle, FolderPlus, Link2 } from 'lucide-react'
import { savePendingPassage } from '../../actions/knowledgeActions'
import { suggestHub, titleFor } from '../../logic/knowledge'
import { DEFAULT_HUB_TITLE, useKnowledgeStore } from '../../store/knowledgeStore'
import { useUiStore } from '../../store/uiStore'
import { Button } from '../common/Button'
import { Modal } from '../common/Modal'
import { TextInput } from '../common/FormControls'
import type { KnowledgeHub, KnowledgeId } from '../../types/knowledge'

/**
 * «Dove la metto?» — la finestra che si apre quando si salva una risposta.
 *
 * Esiste perche' l'archivio ha una cosa che nessun algoritmo puo' decidere. Il testo
 * l'ha scelto l'utente, e il posto fra le note che parlano lo stesso argomento si deduce
 * dal confronto fra le parole; ma «questa nota appartiene a **quel** gruppo» non e' una
 * somiglianza, e' una decisione su come si vuole organizzare. Senza questa domanda il
 * programma risponderebbe al posto dell'utente con una mappa piena di ordini che nessuno
 * ha scritto — e un archivio che si riordina da solo non e' navigabile, perche' non ci si
 * puo' fidare del suo ordine.
 *
 * Percio' qui non si sceglie **un posto** ma si risponde a una domanda con tre uscite
 * oneste: sotto un centro che gia' esiste, sotto un centro nuovo, o da nessuna parte. La
 * terza non e' una via di fuga: e' la risposta giusta per una nota che non sta con nessuno,
 * e senza di essa la finestra costringerebbe a inventare una parentela.
 *
 * Il centro **proposto** e' solo una proposta, e lo dice. E' il centro il cui nome piu'
 * somiglia al passaggio, calcolato con lo stesso confronto del recupero; nessuno lo sceglie
 * al posto dell'utente, e la scelta resta quella premuta. Proporre serve a non far
 * scegliere a caso, non a scegliere.
 */
export function SaveKnowledgeDialog() {
  const draft = useUiStore((state) => state.knowledgeDraft)
  const hubs = useKnowledgeStore((state) => state.hubs)
  const entries = useKnowledgeStore((state) => state.entries)
  const createHub = useKnowledgeStore((state) => state.createHub)
  const load = useKnowledgeStore((state) => state.load)

  /*
   * Il testo che si vede e' **quello che il pulsante aveva gia' letto**, mai quello che
   * c'era nella selezione al momento di confermare. Il pulsante ha sottolineato una frase
   * e poi si e' aperta una finestra: rileggerla ora darebbe il testo che l'utente sta
   * toccando in quel momento — che e' spesso niente — e salverebbe una risposta intera al
   * posto della frase che aveva scelto. Il difetto e' invisibile: la nota risulta salvata
   * e ha un titolo che ha senso, e dentro ha parole che nessuno ha mai scelto.
   *
   * Per questo la finestra mostra il passaggio **per intero**: e' l'unica occasione in cui
   * si controlla che sia quello giusto prima di confermare.
   */
  const [title, setTitle] = useState(() => (draft ? titleFor(draft.text) : ''))
  /** `null` = nessun centro, `'new'` = crearne uno, altrimenti l'id di quello scelto. */
  const [hubChoice, setHubChoice] = useState<KnowledgeId | null | 'new'>(null)
  const [newHubTitle, setNewHubTitle] = useState('')
  const [saving, setSaving] = useState(false)

  const suggested = useMemo(
    () => (draft ? suggestHub(draft, hubs) : null),
    [draft, hubs],
  )

  if (!draft) return null

  /*
   * Il passaggio viene ripreso in una costante **dopo** il controllo, e serve perche' i
   * gestori qui sotto sono dichiarazioni di funzione: queste vengono sollevate prima del
   * `if`, quindi dentro di loro il tipo di `draft` resta quello col `null` dentro e
   * TypeScript non accetterebbe di mandarlo a `savePassage` — che vuole un testo, non un
   * testo che potrebbe non esserci.
   */
  const passage = draft

  function countUnder(hubId: KnowledgeId): number {
    let count = 0
    for (const entry of entries) if (entry.hubId === hubId) count += 1
    return count
  }

  function close(): void {
    setTitle('')
    setHubChoice(null)
    setNewHubTitle('')
    useUiStore.getState().clearKnowledgeDraft()
  }

  async function confirm(): Promise<void> {
    if (saving) return
    setSaving(true)
    /*
     * Il centro nuovo si crea **solo** se il pulsante e' stato premuto con un nome, e con
     * un nome perche' e' l'unico modo di distinguerlo da un centro vuoto: un centro appena
     * nato senza nome non si sa piu' ritrovare, e un archivio con pezzi senza nome e' un
     * archivio che si puo' solo scorrere.
     */
    if (hubChoice === 'new' && newHubTitle.trim().length === 0) return
    try {
      await load()
      let hubId: KnowledgeId | null = null
      if (hubChoice === 'new') {
        const hub: KnowledgeHub | null = await createHub(newHubTitle.trim() || DEFAULT_HUB_TITLE)
        hubId = hub?.id ?? null
      } else if (typeof hubChoice === 'string') {
        hubId = hubChoice
      }
      /*
       * Il centro scelto viaggia **dentro** il passaggio e non in una variabile separata.
       * Se la finestra scrivesse il centro da una parte e il testo dall'altra, un
       * salvataggio riuscito con il centro sbagliato lascerebbe la nota nel gruppo vecchio
       * senza che nulla lo dica — e la mappa e la finestra direbbero due cose diverse, e
       * l'utente si fiderebbe di quella che vede per prima, cioe' di quella sbagliata.
       */
      const saved = await savePendingPassage({ ...passage, title: title.trim(), hubId })
      if (saved) {
        useUiStore.getState().addToast({
          tone: 'success',
          title: 'Saved to knowledge',
          message: `"${saved.title}" placed ${saved.placedBecause}.`,
        })
      }
      close()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Where should this note go?"
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={saving} onClick={() => void confirm()}>
            {saving ? 'Saving…' : 'Save note'}
          </Button>
        </>
      }
    >
      <p className="save-note-where">
        This passage is saved either way. Choosing where it lands is what keeps the map
        meaning something later — and you can move it afterwards, so nothing here is final.
      </p>

      <label className="form-field">
        <span>Title</span>
        <TextInput
          value={title}
          aria-label="Note title"
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
      </label>

      <fieldset className="save-note-where-fieldset">
        <legend>Main point of context</legend>

        {/*
          I centri sono **tutti elencati**, non i tre migliori. Una lista parziale sembra
          piu' pulita e pero' nasconde l'esistenza degli altri: l'utente che cerca «il
          gruppo delle liste» non lo trova nella lista dei tre piu' simili e conclude che
          il gruppo non esista. Meglio una lista lunga e scrollabile che una lista breve e
          incompleta — e qui sotto c'e' anche «A new main point» per il caso in cui
          nessuno vada bene.
        */}
        <ul className="save-note-where-list">
          <li>
            <button
              type="button"
              className={`save-note-where-option ${hubChoice === null ? 'is-chosen' : ''}`}
              onClick={() => setHubChoice(null)}
            >
              <Circle size={11} aria-hidden />
              <span>
                <strong>No main point</strong>
                <small>It stays free, and finds its place by what it talks about.</small>
              </span>
            </button>
          </li>
          {hubs.map((hub) => {
            const under = countUnder(hub.id)
            return (
              <li key={hub.id}>
                <button
                  type="button"
                  className={`save-note-where-option ${hubChoice === hub.id ? 'is-chosen' : ''}`}
                  onClick={() => setHubChoice(hub.id)}
                >
                  <Circle size={11} aria-hidden />
                  <span>
                    <strong>{hub.title}</strong>
                    <small>
                      {under} {under === 1 ? 'note' : 'notes'}
                      {suggested?.id === hub.id ? ' · looks closest to this' : ''}
                    </small>
                  </span>
                </button>
              </li>
            )
          })}
          <li>
            <button
              type="button"
              className={`save-note-where-option ${hubChoice === 'new' ? 'is-chosen' : ''}`}
              onClick={() => setHubChoice('new')}
            >
              <FolderPlus size={11} aria-hidden />
              <span>
                <strong>A new main point</strong>
                <small>Name it after what these notes will have in common.</small>
              </span>
            </button>
          </li>
        </ul>

        {hubChoice === 'new' ? (
          <TextInput
            value={newHubTitle}
            aria-label="Name of the new main point"
            placeholder="Pricing, Q3 planning, …"
            onChange={(event) => setNewHubTitle(event.currentTarget.value)}
            /*
              Il fuoco va qui appena si sceglie «nuovo»: il nome e' l'unica cosa che questa
              scelta chiede, e lasciare il campo vuoto senza che nessuno ci arrivi da solo
              significherebbe far premere un tasto a chi ha appena chiesto di poter scrivere.
            */
            autoFocus
          />
        ) : null}
      </fieldset>

      {suggested && hubChoice === null ? (
        <p className="save-note-where-suggest">
          <Link2 size={11} aria-hidden />
          «{suggested.title}» is the main point this passage looks closest to. Click it to
          hang the note there — or leave it free and let it sit near what it resembles.
        </p>
      ) : null}

      {/*
        Il passaggio per intero, non un'anteprima, e in sola lettura. La selezione qui non
        deve diventare la selezione che verra' salvata al prossimo clic sul nodo: e' il
        difetto che produce note che sembrano giuste e contengono il testo sbagliato, e
        l'unico modo di evitarlo e' mostrare qui il testo vero e renderlo non selezionabile
        come fonte.
      */}
      <div className="save-note-where-preview">
        <p className="save-note-where-preview-label">What gets saved</p>
        <div className="save-note-where-preview-body">{draft.text}</div>
      </div>
    </Modal>
  )
}