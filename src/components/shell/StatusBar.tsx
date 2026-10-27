import { Check, Cloud, LoaderCircle, TriangleAlert } from 'lucide-react'
import { requeueInterrupted } from '../../actions/requeueInterrupted'
import { contextWindowFor } from '../../logic/pricing'
import { formatDuration, queueEtaMs } from '../../queue/runQueue'
import { useModelStore } from '../../store/modelStore'
import { useQueueStore } from '../../queue/queueStore'
import { useUiStore } from '../../store/uiStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { Button } from '../common/Button'

export function StatusBar() {
  const nodeCount = useWorkspaceStore((state) => state.nodes.length)
  const edgeCount = useWorkspaceStore((state) => state.edges.length)
  const saveStatus = useUiStore((state) => state.saveStatus)
  const lastTokens = useUiStore((state) => state.lastRequestTokens)
  const provider = useUiStore((state) => state.appSettings.provider)
  const selectedModel = useUiStore((state) => state.appSettings.defaultModel)
  const modelContextLength = useModelStore(
    (state) => state.models.find((model) => model.id === selectedModel)?.contextLength ?? null,
  )
  /*
   * Il tetto viene prima da LM Studio, che lo dichiara per il modello caricato, e
   * dalla tabella dei prezzi altrimenti. I due non sono la stessa cosa: quello del
   * server e' il tetto **assegnato** a questa istanza e puo' essere minore di quello
   * del modello, quindi usare il secondo mostrerebbe uno spazio che qui non esiste.
   */
  const contextLimit = modelContextLength ?? contextWindowFor(provider, selectedModel ?? '')
  const contextPercent =
    contextLimit && contextLimit > 0
      ? Math.min(100, Math.round((lastTokens / contextLimit) * 100))
      : null
  const jobs = useQueueStore((state) => state.jobs)
  const eta = queueEtaMs()
  const waiting = jobs.filter(
    (job) => job.state === 'waiting' || job.state === 'blocked',
  ).length
  const running = jobs.filter((job) => job.state === 'running').length
  const interrupted = useWorkspaceStore(
    (state) => state.nodes.filter((node) => node.data.kind === 'response' && node.data.status === 'interrupted').length,
  )

  return (
    <footer className="statusbar" aria-label="Workspace status">
      <span>{nodeCount} nodes</span>
      <span>{edgeCount} edges</span>
      {/*
        La barra di stato porta **la percentuale di contesto**, non i token grezzi.

        I token da soli non dicono niente senza un tetto: 40.000 token e' il 4% o il
        40% e cambiano cose opposte. Con la percentuale la domanda «posso continuare
        a mandare contesto o devo compattare?» ha una risposta che si vede, e la
        risposta cambia mentre si lavora — quindi non puo' stare in una finestra che
        si apre e si chiude.

        Senza tetto noto non si inventa: si mostra solo il numero di token, perche' un
        limite sbagliato produrrebbe un avviso di "quasi pieno" che non esiste, e un
        avviso falso e' peggio di nessuno.
      */}
      {contextLimit ? (
        <button
          type="button"
          className={`statusbar-context ${contextPercent !== null && contextPercent > 85 ? 'is-high' : ''}`}
          onClick={() => useUiStore.getState().openDialog('usage')}
          title={`Context of the last request: ${lastTokens.toLocaleString()} of ${contextLimit.toLocaleString()} tokens${
            contextPercent !== null ? ` (${contextPercent}%)` : ''
          }. Open usage.`}
        >
          context {lastTokens.toLocaleString()} / {contextLimit.toLocaleString()}
          {contextPercent !== null ? ` · ${contextPercent}%` : ''}
        </button>
      ) : (
        <span className="optional-status">~{lastTokens.toLocaleString()} tok last request</span>
      )}
      {waiting > 0 || running > 0 ? (
        <span>
          Queue: {waiting}
          {running > 0 ? ` · ${running} running` : ''}
          {eta ? ` · ETA ~${formatDuration(eta)}` : ''}
        </span>
      ) : null}
      {interrupted > 0 ? (
        <Button
          size="small"
          variant="ghost"
          onClick={() => void requeueInterrupted()}
          title="Re-queue the generations interrupted by a reload or a closed page"
        >
          Re-queue {interrupted} interrupted
        </Button>
      ) : null}
      <div className="statusbar-spacer" />
      <span className={`save-${saveStatus}`}>
        {saveStatus === 'saving' ? (
          <LoaderCircle size={9} />
        ) : saveStatus === 'saved' ? (
          <Check size={9} />
        ) : saveStatus === 'error' ? (
          <TriangleAlert size={9} />
        ) : (
          <Cloud size={9} />
        )}
        {saveStatus === 'saving'
          ? 'Saving…'
          : saveStatus === 'saved'
            ? 'Saved'
            : saveStatus === 'error'
              ? 'Save failed'
              : 'Local workspace'}
      </span>
      <span className="optional-status">v2.0.0</span>
    </footer>
  )
}
