import { Brain, MessageSquareText, Play, Scissors, Square, Terminal, Wand2 } from 'lucide-react'
import { memo, useEffect, useMemo, useRef } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { runPrompt } from '../../actions/runPrompt'
import { runFromNode, runIntent } from '../../actions/runIntent'
import { preloadOnTyping } from '../../actions/modelManager'
import { stopRun } from '../../actions/stopRun'
import { AUTO_FIT, autoFitHeight } from '../../logic/autoFit'
import { zoomSummary } from '../../logic/zoomSummary'
import { CONCISE_SUMMARY } from '../../logic/concise'
import {
  useFocusOnCreate,
  useNodeData,
  useNodeDraft,
  useNodeHasExplicitSize,
} from '../../hooks/useNodeData'
import { useUiStore } from '../../store/uiStore'
import { getActiveWorkspaceStore, useWorkspaceStore, workspaceDocumentFromState } from '../../store/workspaceStore'
import type { PromptNode as PromptNodeType, PromptNodeData } from '../../types/document'
import { Button } from '../common/Button'
import { NodeShell } from './NodeShell'

export const PromptNode = memo(function PromptNode({
  id,
  selected,
}: NodeProps<PromptNodeType>) {
  const hasExplicitSize = useNodeHasExplicitSize(id)
  const data = useNodeData<PromptNodeData>(id, 'prompt')
  const draft = useNodeDraft(id, data?.text ?? '')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const validationError = useUiStore((state) => state.promptErrors[id])
  const activeResponseId = useWorkspaceStore((state) => {
    const childIds = new Set(
      state.edges
        .filter((edge) => edge.kind === 'run' && edge.source === id)
        .map((edge) => edge.target),
    )
    for (let index = state.nodes.length - 1; index >= 0; index -= 1) {
      const node = state.nodes[index]
      if (
        node &&
        childIds.has(node.id) &&
        node.data.kind === 'response' &&
        (node.data.status === 'streaming' || node.data.status === 'queued')
      ) {
        return node.id
      }
    }
    return null
  })

  useFocusOnCreate(id)

  /*
   * La selezione **di tutti** i nodi, non solo la propria.
   *
   * Il bottone Run dipende dagli altri: con tre prompt selezionati dice «Run 3» su
   * ciascuno. Ma React Flow passa `selected` come prop, quindi questo componente si
   * ridisegna solo quando cambia la **sua** selezione — e senza questa sottoscrizione
   * il nodo che era gia' selezionato quando la selezione e' cresciuta restava con la
   * scritta di prima, dicendo «Run» mentre i suoi due vicini dicevano «Run 3».
   *
   * Non e' un difetto di poco conto: un numero vecchio su un bottone che avvia
   * richieste a pagamento e' peggio di nessun numero, perche' l'utente preme e non sa
   * cosa sta lanciando.
   *
   * **La firma e' una stringa, non un array, e non e' un dettaglio.** Uno stato di
   * zustand viene letto con `getSnapshot` e confrontato per identita': restituirgli un
   * array nuovo a ogni lettura significa che lo snapshot e' sempre diverso, quindi il
   * componente si ridisegna per sempre e l'applicazione muore con «Maximum update depth
   * exceeded» — cioe' non si avvia. Una stringa si confronta per valore, e resta
   * stabile finche' la selezione non cambia davvero. L'array viene ricostruito dopo,
   * con la dipendenza sulla firma, cosi' e' stabile anche lui.
   *
   * Il separatore e' lo spazio, che un id generato non contiene: se contenesse,
   * `split` ricostruirebbe id sbagliati e la selezione andrebbe a pezzi.
   */
  const selectedSignature = useWorkspaceStore((state) =>
    state.nodes
      .filter((node) => node.selected)
      .map((node) => node.id)
      .join(' '),
  )
  const selectedIds = useMemo(
    () => (selectedSignature ? selectedSignature.split(' ') : []),
    [selectedSignature],
  )

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    /*
     * Un nodo che l'utente ha ridimensionato possiede la sua disposizione: la
     * casella riempie quello che c'e e scorre, invece di crescere col testo.
     *
     * La decisione viene da `useNodeHasExplicitSize` e non dal `height` di React
     * Flow, che c'e **sempre** perche e la misura: con quello, questa condizione
     * era vera per ogni nodo e la casella non cresceva mai. Ecco il motivo per cui
     * scrivere un prompt lungo non allargava niente.
     */
    if (hasExplicitSize) {
      textarea.style.height = '100%'
      return
    }
    textarea.style.height = '0px'
    textarea.style.height = `${autoFitHeight(textarea.scrollHeight, {
      min: AUTO_FIT.minHeight,
      max: AUTO_FIT.maxBodyHeight,
    })}px`
  }, [draft.value, hasExplicitSize])

  /*
   * Cosa girerebbe questo bottone, con la selezione di adesso.
   *
   * Sta **prima** di `if (!data) return null`, e non per ordine estetico: un `useMemo`
   * dopo un ritorno anticipato e' una violazione delle regole degli hook. React ne
   * conta le chiamate e, quando un nodo esiste e l'altro no, ne trova meno del
   * previsto: «Rendered fewer hooks than expected», e l'intera tela sparisce. Il
   * difetto e' invisibile finche' non esiste un nodo senza dati — cioe' finche' non
   * si cancella un nodo che un'altra scheda ha gia' rimosso.
   *
   * `blank` da solo non basta: con tre prompt selezionati, uno dei quali e' vuoto, il
   * bottone deve dire «Run 2» e non restare spento perche' **questo** e' vuoto. E se
   * questo nodo non e' fra i selezionati, deve girare solo lui — gli altri non sono
   * stati scelti premendo qui.
   *
   * `ownText` e' una dipendenza **usata**, non una aggiunta per far reagire il memo.
   * `runIntent` legge il testo dal documento e non lo riceve, quindi senza questa
   * guardia un prompt vuoto resterebbe con il bottone spento anche dopo che l'utente ci
   * ha scritto dentro: la selezione non cambia, il memo non si rifarebbe, e il
   * pulsante continuerebbe a dire di non poter partire. Decidere qui, con il testo che
   * l'utente sta guardando, rende la dipendenza esplicita e il risultato identico.
   *
   * La guardia guarda solo il caso «solo questo, e vuoto», che e' l'unico in cui il
   * testo decide da solo. Quando la selezione e' piu' di uno, decide `runIntent`: li'
   * un prompt vuoto non deve spegnere il bottone, perche' gli altri hanno lavoro da fare.
   */
  const ownText = data?.kind === 'prompt' ? data.text : ''
  const intent = useMemo(() => {
    if (!ownText.trim() && selectedIds.length <= 1) {
      return {
        promptIds: [],
        enabled: false,
        label: 'Run',
        title: 'Write something first — an empty prompt has nothing to send.',
        skipped: [],
      }
    }
    return runIntent(id, workspaceDocumentFromState(useWorkspaceStore.getState()), selectedIds)
  }, [id, selectedIds, ownText])

  if (!data) return null
  const status = activeResponseId ? 'streaming' : validationError ? 'error' : 'idle'
  const blank = !draft.value.trim()
  const thinking = data.thinking !== false
  const concise = data.concise === true

  return (
    <NodeShell
      zoomSummary={zoomSummary(data)}
      id={id}
      explicitSize={hasExplicitSize}
      nodeKind="prompt"
      icon={<MessageSquareText size={12} />}
      title={data.title || 'Prompt'}
      subtitle={`${data.runCount} ${data.runCount === 1 ? 'run' : 'runs'}`}
      status={status}
      selected={selected}
      error={Boolean(validationError)}
      collapsed={data.collapsed === true}
      collapsedPreview={draft.value}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="context"
        className="handle-context"
        aria-label="Context input"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="system"
        className="handle-system"
        style={{ top: '68%' }}
        aria-label="System input"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="image"
        className="handle-image"
        style={{ top: '86%' }}
        aria-label="Image input"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        className="handle-run"
        aria-label="Generated responses"
      />
      {draft.value.startsWith('/') ? (
        <p className="command-hint">
          <Wand2 size={10} />
          {draft.value.trimStart().toLowerCase().startsWith('/compact')
            ? 'Ctrl+Enter compacts the context into a Summary instead of running a generation.'
            : 'Unknown command. Try /compact to summarise this context.'}
        </p>
      ) : null}
      <textarea
        ref={textareaRef}
        className="node-textarea"
        value={draft.value}
        placeholder="Ask the model something…"
        aria-label="Prompt text"
        onFocus={() => useUiStore.getState().setSelectedNode(id)}
        onChange={(event) => {
          draft.setValue(event.currentTarget.value)
          preloadOnTyping(event.currentTarget.value)
          if (!event.currentTarget.value.trim()) {
            useUiStore.getState().setPromptError(id, null)
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Tab' && draft.value.startsWith('/')) {
            event.preventDefault()
            const setter = Object.getOwnPropertyDescriptor(
              window.HTMLTextAreaElement.prototype,
              'value',
            )?.set
            setter?.call(event.currentTarget, '/compact ')
            event.currentTarget.dispatchEvent(new Event('input', { bubbles: true }))
          }
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !blank) {
            event.preventDefault()
            void runPrompt(id)
          }
        }}
      />
      <div className="node-actions-row">
        <span className="info-chip">
          <Terminal size={9} /> Ctrl+Enter
        </span>
        <button
          type="button"
          className={`info-chip toggle-chip ${thinking ? 'is-on' : 'is-off'}`}
          onClick={() =>
            getActiveWorkspaceStore()
              .getState()
              .updateNodeData(id, { thinking: !thinking })
          }
          aria-pressed={thinking}
          title={
            thinking
              ? 'Thinking is on. Click to answer without reasoning.'
              : 'Thinking is off. Click to let the model reason first.'
          }
        >
          <Brain size={9} /> {thinking ? 'Thinking' : 'No thinking'}
        </button>
        <button
          type="button"
          className={`info-chip toggle-chip ${concise ? 'is-on' : 'is-off'}`}
          onClick={() =>
            getActiveWorkspaceStore()
              .getState()
              .updateNodeData(id, { concise: !concise })
          }
          aria-pressed={concise}
          title={
            concise
              ? `Short answer is on: ${CONCISE_SUMMARY} Click for the normal length.`
              : 'Short answer is off. Click to ask for a brief reply and spend fewer output tokens.'
          }
        >
          <Scissors size={9} /> Short
        </button>
        {activeResponseId ? (
          <Button
            size="small"
            className="run-button"
            icon={<Square size={10} fill="currentColor" />}
            onClick={() => stopRun(activeResponseId)}
          >
            Stop
          </Button>
        ) : (
          /*
           * Il bottone gira **tutta** la selezione, e lo dice con il numero.
           *
           * Sta qui dentro il nodo e non in una barra sopra la tela per una scelta:
           * un bottone «Run 5» appoggiato sul canvas saprebbe di quanti prompt si
           * parla solo se l'utente lo leggesse, e un grafo grande ha gia' un sacco di
           * numeri. Sul nodo, il numero e' accanto alla domanda a cui si riferisce.
           *
           * La decisione si prende al momento della pressione, non a ogni render: se
           * nel frattempo la selezione e' cambiata, un bottone rimasto con la scritta
           * di prima prometterebbe un numero che non e' quello che girera'.
           */
          <Button
            size="small"
            variant="primary"
            className="run-button"
            disabled={!intent.enabled}
            title={intent.title}
            icon={<Play size={10} fill="currentColor" />}
            onClick={() => void runFromNode(id, useWorkspaceStore)}
          >
            {intent.label}
          </Button>
        )}
      </div>
      {validationError ? (
        <div className="inline-node-error" role="alert">
          {validationError.message}
          {validationError.hint ? ` — ${validationError.hint}` : ''}
        </div>
      ) : null}
    </NodeShell>
  )
})
