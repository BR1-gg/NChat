import {
  Braces,
  Copy,
  CornerDownRight,
  Play,
  Settings2,
  X,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { assembleMessages } from '../../logic/assemble'
import { useKnowledgeStore } from '../../store/knowledgeStore'
import { continueFromResponse } from '../../actions/connectNodes'
import { runPrompt } from '../../actions/runPrompt'
import {
  refreshOutputs,
  removeSelectionFromSets,
  synthesizeOutput,
} from '../../actions/setActions'
import { estimateTokens } from '../../llm/tokens'
import { NODE_SIZE_LIMITS } from '../../nodes/specs'
import { useUiStore } from '../../store/uiStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import type { NoteColor } from '../../types/document'
import { copyToClipboard } from '../../utils/clipboard'
import { Button, IconButton } from '../common/Button'
import { Select, SliderField, TextArea, TextInput } from '../common/FormControls'
import { StatusDot } from '../nodes/StatusDot'

export function Inspector() {
  const selectedId = useUiStore((state) => state.selectedNodeId)
  // Developer mode gates the panel. Selecting a node used to make it appear on
  // its own, covering the canvas; now it is a deliberate toggle.
  const developerMode = useUiStore((state) => state.preferences.developerMode)
  const inspectorOpen = useUiStore((state) => state.preferences.inspectorOpen)
  const node = useWorkspaceStore((state) =>
    state.nodes.find((candidate) => candidate.id === selectedId),
  )
  if (!developerMode || !inspectorOpen) return null
  if (!node) return null
  const workspace = useWorkspaceStore.getState()
  const update = (patch: Record<string, unknown>): void =>
    workspace.updateNodeData(node.id, patch)
  const responseParentId =
    node.data.kind === 'response' && typeof node.data.parentPromptId === 'string'
      ? node.data.parentPromptId
      : ''
  // Read outside the JSX: narrowing on `node.data.kind` is dropped inside
  // callbacks, so the handlers below must close over plain values.
  const outputSources: string[] =
    node.data.kind === 'output' ? (node.data.sourceNodeIds ?? []) : []
  const outputText: string = node.data.kind === 'output' ? node.data.text : ''
  const synthesizing: boolean =
    node.data.kind === 'output' && node.data.synthesis?.status === 'streaming'

  return (
    <aside className="inspector" aria-label={`${node.type} node inspector`}>
      <header className="inspector-header">
        <Settings2 size={14} color="var(--accent-strong)" />
        <h2>{node.type[0]?.toUpperCase()}{node.type.slice(1)} inspector</h2>
        <IconButton
          label="Close inspector"
          onClick={() => useUiStore.getState().setSelectedNode(null)}
        >
          <X size={14} />
        </IconButton>
      </header>
      <div className="inspector-scroll">
        {node.data.kind === 'prompt' ? (
          <>
            <section className="inspector-section">
              <h3>Prompt</h3>
              <div className="form-field">
                <label htmlFor="prompt-title">Title</label>
                <TextInput
                  id="prompt-title"
                  value={node.data.title ?? ''}
                  placeholder="Prompt"
                  onChange={(event) => update({ title: event.currentTarget.value })}
                />
              </div>
            </section>
            <section className="inspector-section">
              <h3>Generation parameters</h3>
              <p className="inspector-value">
                Parameters are global: they apply to every prompt in this workspace. Change
                them in Settings &rarr; Generation.
              </p>
              <div className="inspector-grid">
                <div className="inspector-value">
                  Temperature<br /><strong>{workspace.settings.defaults.temperature.toFixed(2)}</strong>
                </div>
                <div className="inspector-value">
                  Top P<br /><strong>{workspace.settings.defaults.topP.toFixed(2)}</strong>
                </div>
                <div className="inspector-value">
                  Max output tokens<br /><strong>{workspace.settings.defaults.maxTokens}</strong>
                </div>
                <div className="inspector-value">
                  Thinking<br /><strong>{node.data.thinking === false ? 'Off' : 'On'}</strong>
                </div>
              </div>
              <div className="inspector-actions" style={{ marginTop: 9 }}>
                <Button
                  size="small"
                  onClick={() => useUiStore.getState().openDialog('settings')}
                >
                  Open global settings
                </Button>
                <Button
                  size="small"
                  onClick={() =>
                    update({ thinking: node.data.thinking === false ? true : false })
                  }
                >
                  {node.data.thinking === false ? 'Enable thinking' : 'Disable thinking'}
                </Button>
              </div>
            </section>
            <section className="inspector-section">
              <h3>Request</h3>
              <RequestSummary promptId={node.id} />
              <div className="inspector-actions" style={{ marginTop: 9 }}>
                <Button
                  size="small"
                  icon={<Braces size={11} />}
                  onClick={() => useUiStore.getState().openDialog('preview')}
                >
                  Preview request
                </Button>
                <Button
                  size="small"
                  variant="primary"
                  icon={<Play size={10} fill="currentColor" />}
                  disabled={!node.data.text.trim()}
                  onClick={() => void runPrompt(node.id)}
                >
                  Run
                </Button>
              </div>
            </section>
          </>
        ) : null}

        {node.data.kind === 'response' ? (
          <>
            <section className="inspector-section">
              <h3>Run record</h3>
              <div className="inspector-grid">
                <div className="inspector-value">
                  Status<br /><strong>{node.data.status}</strong>
                </div>
                <div className="inspector-value">
                  Branch<br /><strong>#{node.data.runIndex + 1}</strong>
                </div>
                <div className="inspector-value">
                  Model<br /><strong>{node.data.requestSnapshot.model || '—'}</strong>
                </div>
                <div className="inspector-value">
                  Tokens<br /><strong>{node.data.stats.totalTokens ?? 'estimated'}</strong>
                </div>
              </div>
            </section>
            <section className="inspector-section">
              <h3>Prompt snapshot</h3>
              <TextArea
                readOnly
                value={node.data.promptSnapshot || '(empty when run)'}
                aria-label="Prompt snapshot"
              />
            </section>
            <section className="inspector-section">
              <h3>Actions</h3>
              <div className="inspector-actions">
                <Button
                  size="small"
                  icon={<Copy size={11} />}
                  onClick={() => void copyToClipboard(typeof node.data.text === 'string' ? node.data.text : '')}
                >
                  Copy
                </Button>
                <Button
                  size="small"
                  icon={<CornerDownRight size={11} />}
                  onClick={() => continueFromResponse(node.id)}
                >
                  Continue
                </Button>
                <Button
                  size="small"
                  icon={<Play size={10} />}
                  onClick={() => void runPrompt(responseParentId)}
                >
                  Run again
                </Button>
              </div>
            </section>
          </>
        ) : null}

        {node.data.kind === 'system' ? (
          <section className="inspector-section">
            <h3>System instructions</h3>
            <TextArea
              value={node.data.text}
              placeholder="Set downstream model behavior…"
              onChange={(event) => update({ text: event.currentTarget.value })}
            />
            <p className="field-help" style={{ marginTop: 8 }}>
              A prompt can have one system edge. Connecting a new system node replaces the previous one.
            </p>
          </section>
        ) : null}

        {node.data.kind === 'note' ? (
          <>
            <section className="inspector-section">
              <h3>Note appearance</h3>
              <div className="form-field">
                <label htmlFor="note-color">Color</label>
                <Select
                  id="note-color"
                  value={node.data.color ?? 'default'}
                  onChange={(event) => update({ color: event.currentTarget.value as NoteColor })}
                >
                  <option value="default">Default</option>
                  <option value="amber">Amber</option>
                  <option value="sky">Sky</option>
                  <option value="rose">Rose</option>
                </Select>
              </div>
            </section>
            <section className="inspector-section">
              <h3>Size</h3>
              <SliderField
                label="Node width"
                value={node.width ?? 320}
                minimum={NODE_SIZE_LIMITS.note.minWidth}
                maximum={NODE_SIZE_LIMITS.note.maxWidth}
                step={10}
                onChange={(width) =>
                  useWorkspaceStore.getState().setNodeSize(node.id, width, undefined)
                }
              />
              <Button size="small" onClick={() => useWorkspaceStore.getState().setNodeSize(node.id, undefined, undefined)}>
                Reset size
              </Button>
            </section>
          </>
        ) : null}

        {node.data.kind === 'output' ? (
          <>
            <section className="inspector-section">
              <h3>Grouped answers</h3>
              <div className="form-field">
                <label htmlFor="output-title">Title</label>
                <TextInput
                  id="output-title"
                  value={node.data.title ?? ''}
                  placeholder="Output"
                  onChange={(event) => update({ title: event.currentTarget.value })}
                />
              </div>
              <div className="inspector-grid">
                <div className="inspector-value">
                  Members<br />
                  <strong>{outputSources.length}</strong>
                </div>
                <div className="inspector-value">
                  Format<br />
                  <strong>{node.data.format ?? 'sections'}</strong>
                </div>
                <div className="inspector-value">
                  Words<br />
                  <strong>{outputText.trim() ? outputText.trim().split(/\s+/).length : 0}</strong>
                </div>
                <div className="inspector-value">
                  Tokens<br />
                  <strong>~{estimateTokens(outputText)}</strong>
                </div>
              </div>
              {outputSources.length ? (
                <ul className="set-member-list">
                  {outputSources.map((id) => {
                    const member = workspace.nodes.find((candidate) => candidate.id === id)
                    return (
                      <li key={id}>
                        <StatusDot
                          status={member?.data.kind === 'response' ? member.data.status : 'idle'}
                        />
                        <span className="set-member-text">
                          {member?.data.kind === 'response'
                            ? member.data.text.trim().split('\n')[0] || '(empty answer)'
                            : 'missing node'}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="field-help" style={{ marginTop: 8 }}>
                  This output owns no answers. Select response nodes on the canvas and choose
                  &ldquo;Group N answers into one output&rdquo;, or connect a response to its input.
                </p>
              )}
            </section>
            <section className="inspector-section">
              <h3>Actions</h3>
              <div className="inspector-actions">
                <Button size="small" onClick={() => refreshOutputs()}>
                  Refresh
                </Button>
                <Button
                  size="small"
                  disabled={synthesizing || !outputText.trim()}
                  onClick={() => void synthesizeOutput(node.id)}
                >
                  {synthesizing ? 'Synthesizing…' : 'Synthesize one answer'}
                </Button>
                <Button
                  size="small"
                  disabled={outputSources.length === 0}
                  onClick={() => removeSelectionFromSets(outputSources)}
                >
                  Clear members
                </Button>
                <Button size="small" icon={<Copy size={11} />} onClick={() => void copyToClipboard(outputText)}>
                  Copy
                </Button>
              </div>
            </section>
          </>
        ) : null}

        <section className="inspector-section">
          <h3>Graph</h3>
          <div className="inspector-value">
            <strong>{workspace.nodes.length}</strong> nodes ·{' '}
            <strong>{workspace.edges.length}</strong> edges
          </div>
        </section>
      </div>
    </aside>
  )
}

function RequestSummary({ promptId }: { promptId: string }) {
  /*
   * L'archivio passa in parte, dal suo stesso store, e questa riga e' la ragione per cui il
   * numero qui non mente.
   *
   * Senza archivio i nodi Knowledge non possono risolvere nulla e ssembleMessages conta una
   * richiesta piu' piccola di quella che partira' davvero — quindi l'Ispettore mostrava un costo
   * che non era quello che l'utente avrebbe pagato. Passarlo e' l'unico modo perche' il numero
   * qui sia lo stesso che esce dalla corsa.
   *
   * I due store si leggono con selettori separati e si combinano dentro ssembleMessages: un
   * selettore che costruisce un oggetto nuovo a ogni chiamata fa girare il ciclo di render
   * all'infinito, ed e' il difetto che ha gia' lasciato una pagina bianca in questa
   * applicazione (vedi selectorStability.test.ts).
   */
  const entries = useKnowledgeStore((state) => state.entries)
  const hubs = useKnowledgeStore((state) => state.hubs)
  const summary = useWorkspaceStore(
    useShallow((state) => {
      try {
        const assembled = assembleMessages(
          {
            docVersion: state.docVersion,
            savedAt: 0,
            name: '',
            nodes: state.nodes,
            edges: state.edges,
            settings: state.settings,
            viewport: state.viewport,
          },
          promptId,
          { knowledgeEntries: entries, knowledgeHubs: hubs },
        )
        return {
          messages: assembled.messages.length,
          tokens: assembled.estTokens,
          warning: assembled.warnings.length > 0,
        }
      } catch {
        return { messages: 0, tokens: 0, warning: true }
      }
    }),
  )
  return (
    <div className="inspector-value">
      <strong>{summary.messages}</strong> messages · approximately{' '}
      <strong>{summary.tokens.toLocaleString()}</strong> tokens
      {summary.warning ? <span style={{ color: 'var(--warn)' }}> · warning</span> : null}
    </div>
  )
}
