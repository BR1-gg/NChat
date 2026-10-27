import { LibraryBig, Link2 } from 'lucide-react'
import { memo, useEffect, useMemo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { notesOfferedBy, resolveKnowledgePick } from '../../logic/knowledgeNode'
import { zoomSummary } from '../../logic/zoomSummary'
import { useFocusOnCreate, useNodeData } from '../../hooks/useNodeData'
import { ensureKnowledgeLoaded, useKnowledgeStore } from '../../store/knowledgeStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import type { KnowledgeNode as KnowledgeNodeType, KnowledgeNodeData } from '../../types/document'
import { NodeShell } from './NodeShell'
import { AUTO_HUB } from './autoHub'

/**
 * Il nodo che manda all'archivio le note di un punto di contesto a un prompt.
 *
 * E' l'altro modo di usare la conoscenza, accanto al recupero automatico. Il recupero
 * sceglie per somiglianza con la domanda e funziona bene finche' la domanda nomina le cose
 * di cui si parla; questo nodo serve quando la domanda **non** le nomina — «quello che ho
 * scritto su questo trimestre» — e in quel caso la somiglianza non trova niente, perche' non
 * c'e' una parola in comune fra la domanda e le note.
 *
 * Percio' il nodo non ha una casella di testo. Ha una **scelta**, e la scelta e' un punto di
 * contesto piu' un sottoinsieme delle note che ci pendono. Una casella qui sarebbe una terza
 * copia dell'archivio dentro il grafo: si potrebbe scrivere li' qualcosa che nell'archivio
 * non c'e', e alla prima esecuzione non si saprebbe quale delle due risposte sia quella
 * giusta.
 *
 * Il numero di note e di token sta nel piede del nodo perche' e' la domanda che viene prima
 * di ogni altra quando si collega un nodo del genere a un prompt: «quanto mi costa?». E un
 * nodo che mostra solo «3 note» non risponde, perche' tre note lunghe e tre note brevi hanno
 * un costo che differisce di dieci volte.
 */
export const KnowledgeNode = memo(function KnowledgeNode({ id, selected }: NodeProps<KnowledgeNodeType>) {
  const data = useNodeData<KnowledgeNodeData>(id, 'knowledge')
  const entries = useKnowledgeStore((state) => state.entries)
  const hubs = useKnowledgeStore((state) => state.hubs)
  const usedBy = useWorkspaceStore(
    (state) => state.edges.filter((edge) => edge.kind === 'context' && edge.source === id).length,
  )
  useFocusOnCreate(id)

  /*
   * L'archivio viene caricato **una volta**, e solo se manca.
   *
   * Il nodo vive in un workspace e l'archivio no: sono due cose diverse che possono non
   * essere mai state aperte insieme. Senza questa riga, un nodo Knowledge in un grafo in cui
   * l'archivio non e' mai stato visitato mostrerebbe «nessun punto di contesto» — che e'
   * anche la risposta giusta, ma per il motivo sbagliato, e l'utente che ha venti note non
   * le vedrebbe da nessuna parte.
   */
  useEffect(() => {
    void ensureKnowledgeLoaded()
  }, [])

  /*
   * L'elenco delle note viene derivato con `useMemo` su **array stabili**.
   *
   * `entries` e `hubs` sono gli array stessi dello store — vedi `selectorStability.test.ts` —
   * e questo e' il motivo per cui qui si puo' derivare: un selettore che filtrasse
   * produrrebbe un array nuovo a ogni lettura, React chiamerebbe il selettore di nuovo, e il
   * ciclo non finirebbe. Non e' una questione teorica: e' gia' successo in questa
   * applicazione e ha fatto fallire l'avvio con «Maximum update depth exceeded».
   */
  const offered = useMemo(() => notesOfferedBy(data, entries), [data, entries])
  const pick = useMemo(() => resolveKnowledgePick(data, entries, hubs), [data, entries, hubs])

  if (!data) return null

  const update = (patch: Partial<KnowledgeNodeData>): void => {
    useWorkspaceStore.getState().updateNodeData(id, patch)
  }

  const chosen = new Set(data.entryIds)
  const allChosen = offered.length > 0 && offered.every((entry) => chosen.has(entry.id))

  return (
    <NodeShell
      zoomSummary={zoomSummary(data)}
      id={id}
      nodeKind="knowledge"
      icon={<LibraryBig size={12} />}
      title={data.title || 'Knowledge'}
      subtitle={usedBy === 0 ? 'unused' : undefined}
      selected={selected}
      collapsed={data.collapsed === true}
      className={usedBy === 0 ? 'is-unused' : ''}
collapsedPreview={
        data.auto
          ? 'Anything relevant'
          : pick.hubTitle
            ? `${pick.hubTitle} · ${pick.notes.length} notes`
            : 'No main point'
      }
      footer={
        <span>
          {/* In modalita' `auto` il numero non si puo' mostrare, e mostrarne uno sarebbe una bugia.

              `resolveKnowledgePick` risponde zero perche' non puo' fare il recupero — non ha la
              domanda — e la tendina mostrerebbe «0 notes» su un nodo che al prossimo giro puo'
              benissimo mandarne cinque. Un numero che non si sa e' peggio di nessun numero:
              l'utente o lo crede e sbaglia a prevedere le spese, o non lo crede e smette di
              leggere il piede di tutti i nodi. Qui si dice che la scelta avviene al momento della
              corsa, e il numero vero si vede sotto la risposta, dove c'e' la traccia. */}
          {data.auto
            ? 'notes chosen when you run'
            : `${pick.notes.length} ${pick.notes.length === 1 ? 'note' : 'notes'}${
                pick.estimatedTokens > 0 ? ` · ~${pick.estimatedTokens} tokens` : ''
              }`}
          {` · used by ${usedBy} ${usedBy === 1 ? 'prompt' : 'prompts'}`}
        </span>
      }
    >
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        className="handle-context"
        aria-label="Send these notes to a prompt"
      />

      <div className="knowledge-node-body">
<label className="form-field">
          <span>Main point of context</span>
          <select
            className="select"
            value={data.auto ? AUTO_HUB : (data.hubId ?? '')}
            aria-label="Main point of context"
            onFocus={() => useWorkspaceStore.getState().selectOnlyNode(id)}
            onChange={(event) => {
              /*
               * Cambiare centro **azzera** la lista delle note.
               *
               * Senza, gli id della lista resterebbero quelli del centro precedente: il nodo
               * manderebbe note che appartengono a un altro gruppo, e la riga sotto
               * continuerebbe a dire «3 note» mentre quelle tre sarebbero di un posto che
               * l'utente ha appena abbandonato. E' il caso peggiore di una lista che
               * sopravvive al contesto, perche' i numeri restano giusti e il contenuto no.
               *
               * E «quello che c'entra» azzera la lista perche' in quella modalita' la lista
               * non c'e': le note le cerca il programma, e quelle che trova cambiano a ogni
               * domanda. Una lista rimasta would dire all'utente che verranno mandate note
               * precise, che e' esattamente cio' che non e' vero.
               */
              const value = event.currentTarget.value
              update(
                value === AUTO_HUB
                  ? { auto: true, hubId: null, entryIds: [], includeNotes: false }
                  : { auto: false, hubId: value || null, entryIds: [] },
              )
            }}
          >
            <option value="">No main point</option>
            <option value={AUTO_HUB}>Anything relevant to the question</option>
            {hubs.map((hub) => (
              <option key={hub.id} value={hub.id}>
                {hub.title}
              </option>
            ))}
          </select>
        </label>

        {data.auto ? (
          <p className="knowledge-node-hint">
            Whatever looks relevant to what you ask. The notes are chosen at the moment you
            run, so the count below is from the last run.
          </p>
        ) : null}

        {!data.auto && !data.hubId ? (
          <p className="knowledge-node-hint">
            Nothing is sent until you pick a main point. Use <strong>Link</strong> on a
            response to save a passage, then group it under a main point on the Knowledge
            page.
          </p>
        ) : null}

        {data.hubId && !data.auto ? (
          <>
            <label className="knowledge-node-option">
              <input
                type="checkbox"
                checked={data.includeNotes}
                aria-label="Send the notes under this main point"
                onChange={(event) => {
                  /*
                   * Accendere **riempie** la lista con tutte le note del centro.
                   *
                   * E' la meta' del significato unico: la lista e' esattamente cio' che viene
                   * mandato, quindi una lista vuota deve voler dire «nessuna» e non «tutte».
                   * Senza questo riempimento, accendere la spunta manderebbe blocchi vuoti
                   * finche' l'utente non spuntasse ogni riga a mano — e delle spunte non
                   * spuntate accanto a un piede che dice «2 note» sarebbero una contraddizione
                   * fra quello che si vede e quello che succede.
                   */
                  const on = event.currentTarget.checked
                  update({ includeNotes: on, entryIds: on ? offered.map((entry) => entry.id) : [] })
                }}
              />
              <span>Send the notes under it</span>
            </label>

            {data.includeNotes ? (
              offered.length === 0 ? (
                <p className="knowledge-node-hint">
                  No notes hang on this main point yet, so it sends nothing.
                </p>
              ) : (
                <div className="knowledge-node-list">
                  <div className="knowledge-node-list-head">
                    <button
                      type="button"
                      className="knowledge-node-all"
                      onClick={() =>
                        // Qui i due lati sono davvero opposti: svuotare la lista vuol dire
                        // «nessuna», e riempirla vuol dire «tutte». Con il vecchio significato
                        // di lista vuota — «tutte» — questo pulsante avrebbe fatto il contrario
                        // di quello che diceva.
                        update({ entryIds: allChosen ? [] : offered.map((entry) => entry.id) })
                      }
                    >
                      {allChosen ? 'Clear all' : `All ${offered.length}`}
                    </button>
                  </div>
                  {offered.map((entry) => (
                    <label key={entry.id} className="knowledge-node-option">
                      <input
                        type="checkbox"
                        checked={chosen.has(entry.id)}
                        onChange={(event) => {
                          /*
                           * Spuntare e togliere scrivono la lista per intero, e non un flag
                           * dentro una lista che puo' anche voler dire un'altra cosa. Il
                           * risultato e' che la lista non ha stati nascosti: quello che si vede
                           * e' quello che viene mandato.
                           */
                          const next = event.currentTarget.checked
                            ? [...chosen, entry.id]
                            : offered
                                .filter((candidate) =>
                                  candidate.id === entry.id ? false : chosen.has(candidate.id),
                                )
                                .map((candidate) => candidate.id)
                          update({ entryIds: next })
                        }}
                      />
                      <span title={entry.text}>{entry.title}</span>
                    </label>
                  ))}
                </div>
              )
            ) : null}

            <label className="knowledge-node-option">
              <input
                type="checkbox"
                checked={data.includeLinked}
                aria-label="Send the notes tied to these as well"
                onChange={(event) => update({ includeLinked: event.currentTarget.checked })}
              />
              <span>
                <Link2 size={10} aria-hidden /> And anything tied to them
              </span>
            </label>
          </>
        ) : null}

        {pick.missing.length > 0 ? (
          <p className="knowledge-node-warn">
            {pick.missing.length}{' '}
            {pick.missing.length === 1 ? 'note is' : 'notes are'} no longer in your
            knowledge. The rest still goes.
          </p>
        ) : null}
      </div>
    </NodeShell>
  )
})