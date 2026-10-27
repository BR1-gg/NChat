import { Check, Copy } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toWireRequest } from '../../llm/types'
import { buildChatRequest, resolveModel, resolveParams } from '../../logic/params'
import { validateRunDetailed } from '../../logic/validate'
import { useUiStore } from '../../store/uiStore'
import { useWorkspaceStore, workspaceDocumentFromState } from '../../store/workspaceStore'
import { copyToClipboard } from '../../utils/clipboard'
import { Button } from '../common/Button'
import { ErrorCard } from '../common/ErrorCard'
import { Modal } from '../common/Modal'

export function RequestPreview({ promptId }: { promptId: string }) {
  const [tab, setTab] = useState<'messages' | 'raw' | 'tokens'>('messages')
  const [copied, setCopied] = useState(false)
  const result = useMemo(() => {
    const document = workspaceDocumentFromState(useWorkspaceStore.getState())
    const prompt = document.nodes.find(
      (node) => node.id === promptId && node.data.kind === 'prompt',
    )
    if (!prompt || prompt.data.kind !== 'prompt') return null
    const validation = validateRunDetailed(document, promptId)
    if (!validation.assembled) return { validation, prompt: null, request: null, raw: null }
    const params = resolveParams(prompt.data.params, document.settings)
    const model = resolveModel(document.settings) ?? ''
    const request = buildChatRequest(
      model,
      validation.assembled.messages,
      params,
      document.settings.streaming,
      true,
      // Il provider, non il suo valore di default: l'anteprima deve mostrare la
      // richiesta che partirebbe davvero, quindi con gli stessi limiti del provider
      // scelto. Senza questo parametro un'anteprima su Claude mostrerebbe 1.4 per una
      // richiesta che partirebbe con 1, e chi la legge si fiderebbe di un numero che
      // non verra' inviato.
      document.settings.provider,
    )
    return {
      validation,
      prompt,
      request,
      raw: toWireRequest(request, true),
    }
  }, [promptId])

  if (!result) return null
  const json =
    tab === 'raw'
      ? JSON.stringify(result.raw, null, 2)
      : JSON.stringify(result.validation.assembled?.messages ?? [], null, 2)
  const tokens = result.validation.assembled?.estTokens ?? 0
  const threshold = useWorkspaceStore.getState().settings.contextTokenWarning
  const over = tokens > threshold

  return (
    <Modal
      title="Request preview"
      size="large"
      onClose={() => useUiStore.getState().closeDialog()}
      footer={
        <Button
          icon={copied ? <Check size={12} /> : <Copy size={12} />}
          onClick={() => {
            void copyToClipboard(json).then((success) => {
              if (!success) return
              setCopied(true)
              globalThis.setTimeout(() => setCopied(false), 1_200)
            })
          }}
        >
          {copied ? 'Copied' : 'Copy JSON'}
        </Button>
      }
    >
      {result.validation.error ? <ErrorCard error={result.validation.error} /> : null}
      <div className="preview-tabs" style={{ marginTop: result.validation.error ? 12 : 0 }}>
        <button
          type="button"
          className={`preview-tab ${tab === 'messages' ? 'active' : ''}`}
          onClick={() => setTab('messages')}
        >
          Messages
        </button>
        <button
          type="button"
          className={`preview-tab ${tab === 'raw' ? 'active' : ''}`}
          onClick={() => setTab('raw')}
        >
          Raw JSON
        </button>
        <button
          type="button"
          className={`preview-tab ${tab === 'tokens' ? 'active' : ''}`}
          onClick={() => setTab('tokens')}
        >
          Estimated tokens
        </button>
      </div>
      {tab === 'tokens' ? (
        <div className="token-meter">
          <div>
            <div className="token-meter-value">~{tokens.toLocaleString()}</div>
            <div className="inspector-value">estimated input tokens · chars ÷ 4 + message overhead</div>
          </div>
          <div className="meter-track">
            <div
              className={`meter-fill ${over ? 'warning' : ''}`}
              style={{ width: `${Math.min(100, (tokens / Math.max(threshold, 1)) * 100)}%` }}
            />
          </div>
          <div className="inspector-value">
            Warning threshold: {threshold.toLocaleString()} tokens {over ? '— exceeded' : ''}
          </div>
          <pre className="code-preview">{json}</pre>
        </div>
      ) : (
        <pre className="code-preview">{json}</pre>
      )}
    </Modal>
  )
}
