import { Brain, Copy, History, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react'
import { memo, useEffect, useRef } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { regenerateSummary, showOriginalHistory, summaryIsOutdated } from '../../actions/summaryActions'
import { zoomSummary } from '../../logic/zoomSummary'
import { useNodeData, useNodeHasExplicitSize } from '../../hooks/useNodeData'
import type { SummaryNode as SummaryNodeType, SummaryNodeData } from '../../types/document'
import { copyToClipboard } from '../../utils/clipboard'
import { Button, IconButton } from '../common/Button'
import { MarkdownView } from '../common/MarkdownView'
import { NodeShell } from './NodeShell'

export const SummaryNode = memo(function SummaryNode({
  id,
  selected,
}: NodeProps<SummaryNodeType>) {
  const hasExplicitSize = useNodeHasExplicitSize(id)
  const data = useNodeData<SummaryNodeData>(id, 'summary')
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = bodyRef.current
    if (element) element.scrollTop = 0
  }, [data?.text])

  if (!data) return null

  const reduction =
    data.tokensBefore > 0
      ? Math.max(0, Math.round((1 - data.tokensAfter / data.tokensBefore) * 100))
      : 0
  const outdated = summaryIsOutdated(id)

  return (
    <NodeShell
      zoomSummary={zoomSummary(data)}
      id={id}
      explicitSize={hasExplicitSize}
      nodeKind="summary"
      icon={<Sparkles size={12} />}
      title={data.title || 'Summary'}
      subtitle={`covers ${data.coveredMessageCount} messages`}
      status={data.status}
      selected={selected}
      error={data.status === 'error'}
      collapsed={data.collapsed === true}
      collapsedPreview={data.text}
      className="summary-node"
      actions={
        <IconButton label="Copy summary" onClick={() => void copyToClipboard(data.text)}>
          <Copy size={11} />
        </IconButton>
      }
      footer={
        <>
          <span className="token-chip">
            ~{data.tokensBefore.toLocaleString()} → {data.tokensAfter.toLocaleString()} tok (−
            {reduction}%)
          </span>
          <div className="node-footer-actions">
            {outdated ? (
              <span className="outdated-badge" title="The summarised history has changed">
                <TriangleAlert size={9} /> May be outdated
              </span>
            ) : null}
            <Button
              size="small"
              icon={<History size={9} />}
              onClick={() => showOriginalHistory(id)}
            >
              Show history
            </Button>
            <Button
              size="small"
              icon={<RefreshCw size={9} />}
              onClick={() => void regenerateSummary(id)}
            >
              Regenerate
            </Button>
          </div>
        </>
      }
    >
      <Handle type="source" position={Position.Right} id="context" aria-label="Summary context" />
      <div ref={bodyRef} className="response-body">
        {data.instructions ? (
          <p className="summary-instructions">
            <Brain size={10} /> {data.instructions}
          </p>
        ) : null}
        {data.status === 'queued' ? <p className="empty-usage">Waiting in queue…</p> : null}
        {data.text ? <MarkdownView text={data.text} /> : null}
        {data.status === 'error' && data.error ? (
          <p className="empty-usage">{data.error.message}</p>
        ) : null}
        {!data.text && data.status !== 'queued' && data.status !== 'error' ? (
          <p className="empty-usage">Double-click the node to edit the summary text.</p>
        ) : null}
      </div>
      <span className="visually-hidden" aria-live="polite">
        Summary {data.status}
      </span>
    </NodeShell>
  )
})
