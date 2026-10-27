import {
  Brain,
  Copy,
  CornerDownRight,
  Library,
  Play,
  RefreshCw,
  Square,
  Trash2,
} from 'lucide-react'
import { memo, useEffect, useRef } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { continueFromResponse } from '../../actions/connectNodes'
// Alias: `savePassageFromSelection` era il nome giusto quando il pulsante poteva solo
// salvare una selezione. Ora puo' anche prendere la risposta intera, e chiamarlo
// «fromSelection» nel punto in cui si usa direbbe una cosa che non e' piu' vera.
import { askWhereToSaveFromNode } from '../../actions/knowledgeActions'
import { retryResponse, runPrompt } from '../../actions/runPrompt'
import { stopRun } from '../../actions/stopRun'
import { estimateTokens } from '../../llm/tokens'
import { zoomSummary, zoomSummaryIsTitle } from '../../logic/zoomSummary'
import { useNodeData, useNodeHasExplicitSize } from '../../hooks/useNodeData'
import { queueCounts, queuePosition } from '../../queue/runQueue'
import { useQueueStore } from '../../queue/queueStore'
import { useModelStore } from '../../store/modelStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import type { ResponseNode as ResponseNodeType, ResponseNodeData } from '../../types/document'
import { copyToClipboard } from '../../utils/clipboard'
import { IconButton } from '../common/Button'
import { ErrorCard } from '../common/ErrorCard'
import { MarkdownView } from '../common/MarkdownView'
import { Spinner } from '../common/Spinner'
import { NodeShell } from './NodeShell'
import { ResponseKnowledge } from './ResponseKnowledge'

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return 'â€”'
  return ms < 1_000 ? `${Math.round(ms)} ms` : `${(ms / 1_000).toFixed(1)} s`
}

export const ResponseNode = memo(function ResponseNode({
  id,
  selected,
}: NodeProps<ResponseNodeType>) {
  const hasExplicitSize = useNodeHasExplicitSize(id)
  const data = useNodeData<ResponseNodeData>(id, 'response')
  const bodyRef = useRef<HTMLDivElement>(null)
  const isRunning = useWorkspaceStore((state) => Boolean(state.nodes.find((node) => node.id === id && node.data.kind === 'response' && (node.data.status === 'streaming' || node.data.status === 'queued'))))
  // Re-render when this node's job changes queue state so the position and the
  // blocked/loading label stay live.
  const queueSignature = useQueueStore((state) => {
    const job = state.jobs.find((candidate) => candidate.targetNodeId === id)
    return job ? `${job.state}:${job.dependsOn.length}:${state.jobs.length}` : 'none'
  })
  void queueSignature
  const modelId = data?.requestSnapshot.model ?? ''
  const modelState = useModelStore((state) => state.runtimes[modelId]?.state ?? 'unloaded')

  useEffect(() => {
    const body = bodyRef.current
    if (!body || data?.status !== 'streaming') return
    const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 80
    if (nearBottom) body.scrollTop = body.scrollHeight
  }, [data?.text, data?.status])

  if (!data) return null
  const status = data.status
  const outputTokens = data.stats.totalTokens ?? estimateTokens(data.text)

  /**
   * Queue feedback: which slot, what it waits for, and whether the delay comes
   * from the model being loaded rather than from another job.
   */
  const queuedLabel = (): string => {
    const job = useQueueStore
      .getState()
      .jobs.find((candidate) => candidate.targetNodeId === id)
    if (!job) return 'Waiting for modelâ€¦'
    if (job.state === 'blocked' && job.dependsOn.length > 0) {
      const count = job.dependsOn.length
      return `Waiting for ${count} connected answer${count === 1 ? '' : 's'}`
    }
    const position = queuePosition(job.id)
    const total = queueCounts().total
    const where = position > 0 && total > 0 ? `Queued Â· #${position} of ${total}` : 'Queued'
    return modelState === 'loading'
      ? `${where} Â· Loading modelâ€¦`
      : `${where} Â· Waiting for modelâ€¦`
  }

  return (
    <NodeShell
      zoomSummary={zoomSummary(data)}
      summaryIsTitle={zoomSummaryIsTitle(data)}
      id={id}
      explicitSize={hasExplicitSize}
      nodeKind="response"
      icon={<CornerDownRight size={12} />}
      title={data.title || 'Response'}
      subtitle={`#${data.runIndex + 1}`}
      status={status}
      selected={selected}
      error={status === 'error'}
      collapsed={data.collapsed === true}
      collapsedPreview={data.text || data.reasoning || data.promptSnapshot}
      actions={
        <>
          <IconButton
            label="Copy response"
            onClick={() => void copyToClipboard(data.text)}
            disabled={!data.text}
          >
            <Copy size={11} />
          </IconButton>
          <IconButton
            label="Delete response"
            danger
            onClick={() => useWorkspaceStore.getState().removeNodes([id])}
          >
            <Trash2 size={11} />
          </IconButton>
        </>
      }
      footer={
        <>
          {/*
            La traccia delle note, prima del conteggio dei token.

            Prima perche' e' la cosa per cui si e' aperta la risposta, e perche' il
            conteggio senza la traccia mente: dice quanto e' costata la richiesta senza
            dire niente di che cosa conteneva, che e' la domanda che porta ad aprire
            questa riga in primo luogo.
          */}
          <ResponseKnowledge promptId={data.parentPromptId} used={data.knowledgeUsed} />
          <div className="response-stats" title="Generation statistics">
            <span>{data.requestSnapshot.model || 'no model'}</span>
            <span>{formatDuration(data.stats.durationMs)}</span>
            <span>
              {data.stats.totalTokens !== undefined
                ? `${data.stats.totalTokens} tok`
                : `~${outputTokens} tok`}
            </span>
            {data.stats.promptTokens !== undefined ? (
              <span>prompt ~{data.stats.promptTokens}</span>
            ) : null}
          </div>
          <div className="node-footer-actions">
            {isRunning ? (
              <IconButton label="Stop generation" danger onClick={() => stopRun(id)}>
                <Square size={10} fill="currentColor" />
              </IconButton>
            ) : null}
            {status === 'done' || status === 'aborted' || status === 'interrupted' || status === 'error' ? (
              <>
                <IconButton
                  label="Retry same request in place"
                  onClick={() => void retryResponse(id)}
                >
                  <RefreshCw size={10} />
                </IconButton>
                <IconButton
                  label="Run prompt again as a new branch"
                  onClick={() => void runPrompt(data.parentPromptId)}
                >
                  <Play size={10} fill="currentColor" />
                </IconButton>
              </>
            ) : null}
            {status === 'done' ? (
              <IconButton
                label="Continue with a connected prompt"
                onClick={() => continueFromResponse(id)}
              >
                <CornerDownRight size={10} />
              </IconButton>
            ) : null}
            {/*
              Salva nell'archivio la conoscenza. Si legge **quello che e' selezionato** nel
              momento del clic, e se non c'e' una selezione prende la risposta intera: il
              pulsante dice in una riga cosa sta per fare, cosi' non succede di salvare
              mezzo ragionamento per caso.

              Il pulsante non salva: **chiede dove mettere la nota**. Il testo e' gia'
              scelto qui e non viene riletto dopo, altrimenti la selezione dentro la
              finestra diventerebbe il testo salvato al prossimo clic. Il posto, invece,
              lo sceglie l'utente — perche' quello che parla dello stesso argomento si
              deduce dalle parole e quello che «sta nello stesso gruppo» no.

              Non e' un'azione che il modello puo' iniziare da solo: non ha strumenti, e
              l'unico codice che arriva a `savePassage` e' la finestra che questo pulsante
              apre. Non parte nessuna richiesta e non cambia la risposta: e' un bottone
              che apre una domanda e, quando l'utente risponde, scrive in un archivio e
              dice cosa ha scritto.
            */}
            {status === 'done' && data.text.trim() ? (
              <IconButton
                label="Save to knowledge — then choose where it goes"
                onClick={() => void askWhereToSaveFromNode(id, data.text)}
              >
                <Library size={10} />
              </IconButton>
            ) : null}
          </div>
        </>
      }
    >
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        className="handle-run"
        aria-label="Prompt owner"
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="context"
        aria-label="Use as context"
      />
      <div
        ref={bodyRef}
        className={`response-body ${status === 'streaming' ? 'is-streaming' : ''}`}
      >
        {status === 'queued' ? (
          <div className="response-placeholder">
            <Spinner label="Waiting for model" />{' '}
            {queuedLabel()}
          </div>
        ) : null}
        {status === 'aborted' ? (
          <div className="response-banner">Stopped â€” partial output kept</div>
        ) : null}
        {status === 'interrupted' ? (
          <div className="response-banner">Interrupted â€” the page closed during generation</div>
        ) : null}
        {data.text ? <MarkdownView text={data.text} /> : null}
        {data.reasoning ? (
          <details className="response-reasoning" open={!data.text}>
            <summary>
              <Brain size={11} /> Thinking Â· ~{estimateTokens(data.reasoning)} tok
            </summary>
            <div className="response-reasoning-body">{data.reasoning}</div>
          </details>
        ) : null}
        {status === 'error' && data.error ? (
          <div style={{ marginTop: data.text ? 9 : 0 }}>
            <ErrorCard error={data.error} />
          </div>
        ) : null}
        {status === 'error' && !data.error ? (
          <p className="empty-usage">The request failed without a readable error.</p>
        ) : null}
      </div>
      <span className="visually-hidden" aria-live="polite">
        Response {data.runIndex + 1} {status}
        {status === 'done' ? ` in ${formatDuration(data.stats.durationMs)}` : ''}
      </span>
    </NodeShell>
  )
})
