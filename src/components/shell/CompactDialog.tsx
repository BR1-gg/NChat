import { ArrowRight, Loader2, Minimize2, Wand2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { compactFromAnyNode } from '../../actions/compactionPreview'
import { renderTranscript } from '../../logic/compact'
import { refusalMessage, resolveCompactionTarget } from '../../logic/compactionTarget'
import { formatTokens } from '../../logic/pricing'
import { estimateMessages } from '../../llm/tokens'
import { useUiStore } from '../../store/uiStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { Button } from '../common/Button'
import { Modal } from '../common/Modal'

/**
 * La finestra della compattazione: **cosa c'e' adesso** e **cosa diventa**.
 *
 * Il difetto che chiude e' che compattare era un atto cieco. Il comando partiva,
 * faceva una chiamata a pagamento, e il risultato compariva su un nodo Summary
 *|altrove nella tela. Se il riassunto era cattivo — e un riassunto lo e' spesso,
 * perche' perde i dettagli — l'unica scelta era annullare tutto e ricominciare,
 * con il costo gia' speso. Qui il contesto iniziale e il risultato sono uno di
 * fianco all'altro, quindi la decisione si prende **prima** di pagare e si
 * corregge subito dopo.
 *
 * E la risposta alla domanda che il menu non poteva fare: premendo «Compact
 * context» su una nota, **cosa** verrebbe compattato? Qui e' scritto, con il testo
 * del prompt. Un'azione che non dice quale grafo tocca non e' un'azione, e' una
 * sorpresa.
 */
export function CompactDialog() {
  const dialog = useUiStore((state) => state.dialog)
  const nodeId = useUiStore((state) => state.compactNodeId)

  /*
   * Il documento si ricostruisce dagli stessi campi che il componente gia' sottoscr
   * ve, e non con `getState()`.
   *
   * Con `getState()` la finestra leggerebbe il grafo una volta sola e non saprebbe
   * che e' cambiato: se l'utente scollega un file mentre la finestra e' aperta, il
   * bottosto direbbe ancora che si puo' compattare e produrrebbe un riassunto di un
   * contesto che non esiste piu'. Usando `nodes`/`edges`/`settings` come dipendenze
   * di `useMemo`, il ricalcolo c'e' quando il grafo cambia — ed e' anche il motivo
   * per cui il bottone puo' disabilitarsi da solo.
   */
  const nodes = useWorkspaceStore((state) => state.nodes)
  const edges = useWorkspaceStore((state) => state.edges)
  const settings = useWorkspaceStore((state) => state.settings)
  const docVersion = useWorkspaceStore((state) => state.docVersion)
  const name = useWorkspaceStore((state) => state.name)
  const viewport = useWorkspaceStore((state) => state.viewport)

  /**
   * Il nodo del riassunto, per mostrarlo mentre arriva.
   *
   * Sta nello store e non qui, e il motivo e' l'azzeramento: deve sparire quando la
   * finestra si **riapre** su un altro nodo, e l'apertura e' un'azione. Con uno stato
   * locale servirebbe un `useEffect` che lo azzera, cioe' un render in piu' e un
   * fotogramma in cui la finestra mostra ancora il riassunto della volta prima.
   */
  const summaryId = useUiStore((state) => state.compactSummaryId)
  const setSummaryId = useUiStore((state) => state.setCompactSummary)

  const [busy, setBusy] = useState(false)

  const summary = useWorkspaceStore((state) =>
    summaryId ? state.nodes.find((node) => node.id === summaryId) : undefined,
  )
  const summaryData = summary?.data.kind === 'summary' ? summary.data : undefined
  const summaryText = summaryData?.text ?? ''
  const summaryStatus = summaryData?.status ?? null

  const resolution = useMemo(() => {
    if (!nodeId) return null
    return resolveCompactionTarget(
      { docVersion, savedAt: 0, name, nodes, edges, settings, viewport },
      nodeId,
    )
  }, [nodeId, docVersion, name, nodes, edges, settings, viewport])

  if (dialog !== 'compact' || !nodeId || !resolution) return null

  if (!resolution.ok) {
    const { title, message } = refusalMessage(resolution.refusal)
    return (
      <Modal title={title} onClose={() => useUiStore.getState().closeDialog()} size="small">
        <p className="compact-refused">{message}</p>
      </Modal>
    )
  }

  const { target } = resolution
  const before = renderTranscript(target.messages)
  const after = summaryText
  const tokensAfter = after ? estimateMessages([{ role: 'assistant', content: after }]) : 0
  const saved = target.tokensBefore - tokensAfter
  const percent = target.tokensBefore > 0 ? Math.round((saved / target.tokensBefore) * 100) : 0
  const running = busy || summaryStatus === 'queued' || summaryStatus === 'streaming'

  const promptNode = nodes.find((node) => node.id === target.promptId)
  const promptText =
    promptNode?.data.kind === 'prompt' ? promptNode.data.text.trim().split('\n')[0] ?? '' : ''
  const promptName = promptText.slice(0, 70) || 'Prompt'

  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      const id = await compactFromAnyNode(nodeId)
      if (id) setSummaryId(id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Compact context"
      size="large"
      onClose={() => useUiStore.getState().closeDialog()}
      footer={
        <>
          <span className="compact-footnote">
            {summaryId
              ? saved > 0
                ? `About ${percent}% smaller: ${formatTokens(target.tokensBefore)} → ${formatTokens(tokensAfter)} tokens.`
                : 'Compacted — but not smaller than the original, which is worth knowing.'
              : 'The original links stay in the graph, so Undo puts everything back.'}
          </span>
          <div className="compact-footer-actions">
            <Button onClick={() => useUiStore.getState().closeDialog()}>
              {summaryId ? 'Close' : 'Cancel'}
            </Button>
            {summaryId ? null : (
              <Button
                variant="primary"
                icon={<Wand2 size={12} />}
                onClick={() => void run()}
                disabled={running}
              >
                Compact
              </Button>
            )}
          </div>
        </>
      }
    >
      <div className="compact-target">
        <span className="compact-target-label">Compacting the context of</span>
        <strong className="compact-target-name" title={promptText}>
          {promptName}
        </strong>
        <span className="compact-target-tokens">
          {formatTokens(target.tokensNow)} tokens in the request as it stands
        </span>
      </div>

      <div className="compact-panes">
        <section className="compact-pane">
          <header className="compact-pane-header">
            <h3>Context now</h3>
            <span className="compact-pane-count">
              {target.messages.length} messages · {formatTokens(target.tokensBefore)} tokens
            </span>
          </header>
          <pre className="compact-text is-before">{before}</pre>
        </section>

        <ArrowRight className="compact-arrow" size={16} aria-hidden />

        <section className="compact-pane">
          <header className="compact-pane-header">
            <h3>Compacted</h3>
            <span className="compact-pane-count">
              {summaryId
                ? after
                  ? `${formatTokens(tokensAfter)} tokens`
                  : 'working…'
                : 'not built yet'}
            </span>
          </header>
          {summaryId ? (
            <pre className="compact-text is-after">
              {running && !after ? (
                <span className="compact-working">
                  <Loader2 size={12} className="compact-spin" /> Summarizing…
                </span>
              ) : after ? (
                after
              ) : (
                <span className="compact-working">Nothing came back.</span>
              )}
            </pre>
          ) : (
            <div className="compact-placeholder">
              <Minimize2 size={14} />
              <p>
                The summary appears here as it is written, next to what it replaces. Nothing is
                spent until you press Compact.
              </p>
            </div>
          )}
        </section>
      </div>
    </Modal>
  )
}
