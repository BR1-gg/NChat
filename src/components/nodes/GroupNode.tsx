import { Check, X } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { useNodeData, useNodeStoredSize } from '../../hooks/useNodeData'
import { useWorkspaceStore } from '../../store/workspaceStore'
import type { GroupColor, GroupNode as GroupNodeType, GroupNodeData } from '../../types/document'
import { removeGroup, ungroupNodes } from '../../actions/groupActions'
import { IconButton } from '../common/Button'

/**
 * Un gruppo **solo visivo**: una cornice che mette ordine, e non fa nient'altro.
 *
 * **Non c'e' nessuna `Handle` in questo file, e non e' una dimenticanza.**
 *
 * E' il modo che ha di garantire il «solo visivo» senza dover ricordarsene: una linea si
 * puo' tracciare solo partendo da una maniglia, quindi un nodo senza maniglie non puo'
 * entrare in nessuna relazione — non come contesto, non come risposta, non come
 * aggregazione. Non e' che il collegamento venga rifiutato dopo averlo tentato: non
 * esiste il modo di formularlo, dal mouse come dal codice.
 *
 * Il contrario sarebbe una lista di regole sparse — `graph.ts`, `assemble.ts`, la
 * ricerca, i connettori, l'esportazione — e in ognuna un posto in cui dimenticarsi che
 * il gruppo esiste, per accorgersene solo quando il gruppo e' finito dentro una richiesta
 * inviata al modello. Un difetto che arriva al provider non si vede piu'.
 *
 * Il gruppo logico resta un'altra cosa (`output`): quello **e'** una relazione, aggrega
 * risposte e si puo' usare come contesto. Qui non c'e' niente da aggregare, quindi qui
 * non si aggrega.
 *
 * La posizione e la dimensione non sono nostre: le calcola `computeGroupFrame` dai nodi
 * dentro. Per questo l'unica cosa che si puo' fare con i membri e' spostarli, e lo fa
 * `expandGroupMove` muovendo i nodi e lasciando che la cornice li seguia.
 */
export const GroupNode = memo(function GroupNode({ id, selected }: NodeProps<GroupNodeType>) {
  const data = useNodeData<GroupNodeData>(id, 'group')
  /*
   * La misura viene dal documento, non dalle props di React Flow. Per una cornice le
   * due non possono coincidere — vedi `useNodeStoredSize` — e scegliere le props faceva
   * tremare la cornice: React Flow misurava la barra del titolo e noi insistevamo sulla
   * misura calcolata dai nodi dentro.
   */
  const { width, height } = useNodeStoredSize(id)
  const update = useWorkspaceStore((state) => state.updateNodeData)
  const removeNodes = useWorkspaceStore((state) => state.removeNodes)
  // Solo il numero di membri: cosi' una modifica a un nodo dentro non ridisegna la
  // cornice, che non mostra altro che il numero e il nome.
  const memberCount = useWorkspaceStore((state) => {
    const node = state.nodes.find((candidate) => candidate.id === id)
    return node?.data.kind === 'group' ? node.data.members.length : 0
  })

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  if (!data) return null

  const beginEdit = (): void => {
    setDraft(data.title)
    setEditing(true)
  }

  const commitTitle = (): void => {
    setEditing(false)
    // Il nome si ripulisce prima di essere salvato: uno spazio finale non si vede e
    // farebbe sembrare il gruppo vuoto quando non lo e', perche' il nome vuoto e'
    // quello che mostra il conteggio al suo posto.
    const title = draft.replace(/\s+/g, ' ').trim()
    if (title !== data.title) update(id, { title })
  }

  const colour = data.color ?? 'default'
  const title = data.title.trim()

  return (
    <section
      className={`group-frame group-frame-visual group-${colour} ${selected ? 'is-selected' : ''} ${
        memberCount === 0 ? 'is-empty' : ''
      }`}
      style={{ width: width ?? undefined, height: height ?? undefined }}
      aria-label={title || `Group of ${memberCount} nodes`}
    >
      {/*
        La barra e' la maniglia del gruppo: trascinarla sposta tutti i nodi dentro.
        Non e' `nodrag` apposta, altrimenti la cornice si potrebbe afferrare solo dal
        bordo tratteggiato di 1.5px.
      */}
      <div className="group-frame-bar">
        {editing ? (
          <input
            ref={inputRef}
            className="group-title-input nodrag"
            aria-label="Group name"
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitTitle()
                return
              }
              if (event.key === 'Escape') {
                // `Escape` annulla invece di salvare: durante la scrittura non si sa
                // ancora se quella sara' il nome definitivo, e annullare e' il modo che
                // non costa niente se ti sbagli.
                event.preventDefault()
                setEditing(false)
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="group-frame-label"
            onClick={beginEdit}
            title="Rename this group"
            aria-label={`Name this group, currently ${title || 'unnamed'}`}
          >
            {title || `${memberCount} ${memberCount === 1 ? 'node' : 'nodes'}`}
          </button>
        )}

        <span className="group-frame-tokens">
          {title ? `${memberCount} ${memberCount === 1 ? 'node' : 'nodes'}` : ''}
        </span>

        <span className="group-frame-actions nodrag">
          <GroupColours
            colour={colour}
            onPick={(next) => update(id, { color: next })}
            label={`Colour of ${title || 'this group'}`}
          />
          <IconButton
            label="Remove these nodes from the group"
            title="Remove from group"
            disabled={memberCount === 0}
            onClick={() => ungroupNodes(id)}
          >
            <X />
          </IconButton>
          <IconButton
            label="Delete the group, keeping the nodes inside"
            title="Delete group, keep nodes"
            onClick={() => {
              // Il gruppo non contiene i nodi: li **circonda**. Cancellarlo quindi non
              // deve toccarli, e per questo si rimuove solo la cornice. Se cancellasse
              // anche i membri, un gruppo usato per mettere ordine perderebbe il lavoro
              // che era li' per organizzare.
              removeGroup(id, removeNodes)
            }}
          >
            <span aria-hidden="true">×</span>
          </IconButton>
        </span>
      </div>
    </section>
  )
})

const GROUP_COLOURS: GroupColor[] = ['default', 'amber', 'sky', 'rose', 'green', 'violet']

/**
 * The colour swatches.
 *
 * Sono **palline con un nome**, non un campo per scrivere un colore: il colore arriva da
 * un file salvato e si vede contro una cornice, un'etichetta e due temi, quindi va
 * scelto da una lista chiusa e verificata nei test. Un colore libero finirebbe quasi
 * sempre male su uno dei due.
 *
 * Il colore attuale ha il segno di spunta: senza, due palline vicine sono distinguibili
 * solo guardandole con attenzione, e la domanda «qual e' il colore di questo gruppo?»
 * diventerebbe un esame di memoria.
 */
function GroupColours({
  colour,
  onPick,
  label,
}: {
  colour: GroupColor
  onPick: (next: GroupColor) => void
  label: string
}) {
  return (
    <span className="group-colours" role="group" aria-label={label}>
      {GROUP_COLOURS.map((candidate) => {
        const active = candidate === colour
        return (
          <button
            key={candidate}
            type="button"
            className={`group-swatch group-swatch-${candidate} ${active ? 'is-on' : ''}`}
            aria-pressed={active}
            title={SWATCH_NAMES[candidate]}
            aria-label={SWATCH_NAMES[candidate]}
            onClick={() => onPick(candidate)}
          >
            {active ? <Check aria-hidden /> : null}
          </button>
        )
      })}
    </span>
  )
}

/**
 * The names, in the app's language.
 *
 * Vanno dichiarati qui e non presi dal valore interno, perche' `default` non e' un
 * colore: e' «il colore del tema». Un'etichetta che dicesse `default` non direbbe nulla
 * all'utente che sta scegliendo.
 */
const SWATCH_NAMES: Record<GroupColor, string> = {
  default: 'Theme colour',
  amber: 'Amber',
  sky: 'Sky',
  rose: 'Rose',
  green: 'Green',
  violet: 'Violet',
}
