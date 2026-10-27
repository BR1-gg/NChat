import {
  Boxes,
  ClipboardPaste,
  Copy,
  History,
  LayoutDashboard,
  Layers3 as LayersIcon,
  Maximize,
  Minimize2,
  Play,
  Plus,
  RefreshCw,
  Scissors,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react'
import { useReactFlow } from '@xyflow/react'
import { continueFromResponse } from '../../actions/connectNodes'
import { openCompactionDialog, previewCompaction } from '../../actions/compactionPreview'
import { copySelection, cutSelection, pasteAt } from '../../actions/clipboardActions'
import {
  addSelectionToSet,
  classifySelection,
  createSetFromPromptAnswers,
  createSetFromSelection,
  refreshOutputs,
  removeSelectionFromSets,
  synthesizeOutput,
} from '../../actions/setActions'
import { createGroupFromSelection, planGroup } from '../../actions/groupActions'
import { retryResponse, runPrompt } from '../../actions/runPrompt'
import { runSelectionTopologically } from '../../actions/runSelection'
import { useUiStore } from '../../store/uiStore'
import { useWorkspaceStore, workspaceDocumentFromState } from '../../store/workspaceStore'
import { copyToClipboard } from '../../utils/clipboard'
import { Button } from '../common/Button'

export function ContextMenu() {
  const menu = useUiStore((state) => state.contextMenu)
  const { screenToFlowPosition } = useReactFlow()
  if (!menu) return null
  const workspace = useWorkspaceStore.getState()
  const node = menu.nodeId
    ? workspace.nodes.find((candidate) => candidate.id === menu.nodeId)
    : undefined
  const close = (): void => useUiStore.getState().setContextMenu(null)

  /*
   * Se la compattazione si puo' fare da questo nodo.
   *
   * Il bottone compare solo quando c'e' qualcosa da compattare. Un bottone sempre
   * presente che poi dice «niente da fare» e' peggio di un bottone assente:
   * costringe a premere per scoprire che non era il caso, e con la stessa azione
   * ogni volta. La regola e' in `logic/compactionTarget.ts`; qui si chiede solo se
   * regge, e il perche' e' lo stesso.
   */
  const compactable = node ? previewCompaction(node.id).ok : false

  const duplicate = (): void => {
    if (!node) return
    const id = workspace.duplicateNode(node.id)
    if (id) useUiStore.getState().setSelectedNode(id)
    close()
  }
  const remove = (): void => {
    if (!node) return
    const hasChildren =
      node.data.kind === 'prompt' &&
      workspace.edges.some((edge) => edge.kind === 'run' && edge.source === node.id)
    if (hasChildren) {
      useUiStore.getState().requestConfirm({
        title: 'Delete this prompt branch?',
        message: 'All generated response nodes will be deleted with this prompt.',
        confirmLabel: 'Delete branch',
        destructive: true,
        onConfirm: () => workspace.removeNodes([node.id]),
      })
    } else workspace.removeNodes([node.id])
    close()
  }
  const copy = (): void => {
    if (!node) return
    const text = typeof node.data.text === 'string' ? node.data.text : ''
    void copyToClipboard(text).then((success) => {
      if (success) {
        useUiStore.getState().addToast({ tone: 'success', title: 'Text copied.' })
      }
    })
    close()
  }

  return (
    <div
      className="context-menu"
      role="menu"
      style={{ left: Math.min(menu.x, window.innerWidth - 205), top: Math.min(menu.y, window.innerHeight - 300) }}
      onMouseLeave={close}
    >
      {menu.selectedIds && menu.selectedIds.length > 1 ? (
        <>
          <button type="button" role="menuitem" onClick={() => { void copySelection(); close() }}>
            <Copy size={12} /> Copy {menu.selectedIds.length} nodes
          </button>
          <button type="button" role="menuitem" onClick={() => { cutSelection(); close() }}>
            <Scissors size={12} /> Cut nodes
          </button>
          <div className="context-separator" />
          {(() => {
            /*
             * Il gruppo **solo visivo**: mette ordine e non tocca nient'altro.
             *
             * Sta **prima** delle voci che aggregano, perche' e' il caso normale e non
             * uno tra i due: si vuole disporre di questi nodi, non metterli insieme per
             * somma. Le due voici sotto rispondono a una domanda diversa — «cosa dicono
             * questi nodi messi insieme» — e non accettano gli stessi nodi.
             *
             * La voce sparisce se la selezione contiene solo cornici: un nodo non puo'
             * stare dentro due gruppi, e offrire un'azione che poi rifiuta non aiuta
             * nessuno. `planGroup` dice proprio cosa ci finirebbe, quindi la stessa
             * funzione risponde alla domanda «la devo mostrare?» e a «cosa ci metto?» —
             * senza che una delle due abbia una regola sua.
             */
            const plan = planGroup(workspace.nodes, menu.selectedIds!)
            return plan.members.length === 0 ? null : (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  createGroupFromSelection(menu.selectedIds!)
                  close()
                }}
              >
                <Boxes size={12} /> Group {plan.members.length} node
                {plan.members.length === 1 ? '' : 's'} to arrange them
              </button>
            )
          })()}
          {(() => {
            const picked = classifySelection(workspaceDocumentFromState(workspace), menu.selectedIds!)
            return (
              <>
                {picked.members.length > 0 ? (
                  <button type="button" role="menuitem" onClick={() => { createSetFromSelection(menu.selectedIds!); close() }}>
                    <LayersIcon /> Group {picked.members.length} answer{picked.members.length === 1 ? '' : 's'} into one output
                  </button>
                ) : null}
                {picked.prompts.length > 0 ? (
                  <button type="button" role="menuitem" onClick={() => { createSetFromPromptAnswers(picked.prompts); close() }}>
                    <LayersIcon /> Group the answers of {picked.prompts.length} prompt{picked.prompts.length === 1 ? '' : 's'}
                  </button>
                ) : null}
              </>
            )
          })()}
          {(() => {
            const firstGroup = workspace.nodes.find(
              (item) => item.data.kind === 'output' && (item.data.sourceNodeIds?.length ?? 0) > 0,
            )
            return firstGroup ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  addSelectionToSet(firstGroup.id, menu.selectedIds!)
                  close()
                }}
              >
                <LayersIcon /> Add to the group
              </button>
            ) : null
          })()}
          <button type="button" role="menuitem" onClick={() => { removeSelectionFromSets(menu.selectedIds!); close() }}>
            <LayersIcon /> Remove from the group
          </button>
          <div className="context-separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const prompts = menu.selectedIds!.filter(
                (id) => workspace.nodes.find((item) => item.id === id)?.data.kind === 'prompt',
              )
              void runSelectionTopologically(prompts)
              close()
            }}
          >
            <Play size={12} /> Run {menu.selectedIds.filter((id) => workspace.nodes.find((item) => item.id === id)?.data.kind === 'prompt').length} prompts
          </button>
          <div className="context-separator" />
        </>
      ) : null}
      {node?.data.kind === 'prompt' ? (
        <>
          <button type="button" role="menuitem" onClick={() => { void runPrompt(node.id); close() }}>
            <Play size={12} /> Run prompt
          </button>
          <button type="button" role="menuitem" onClick={duplicate}>
            <Copy size={12} /> Duplicate
          </button>
          <button type="button" role="menuitem" onClick={copy}>
            <Copy size={12} /> Copy text
          </button>
          <button type="button" role="menuitem" onClick={() => { void pasteAt({ x: menu.x, y: menu.y }, undefined, screenToFlowPosition({ x: menu.x, y: menu.y })); close() }}>
            <ClipboardPaste size={12} /> Paste here
          </button>
          <button type="button" role="menuitem" onClick={() => { workspace.setNodeSize(node.id, undefined, undefined); close() }}>
            <Minimize2 size={12} /> Reset size
          </button>
          <div className="context-separator" />
          <button type="button" role="menuitem" className="danger" onClick={remove}>
            <Trash2 size={12} /> Delete
          </button>
        </>
      ) : null}
      {node?.data.kind === 'response' ? (
        <>
          <button type="button" role="menuitem" onClick={copy} disabled={!node.data.text}>
            <Copy size={12} /> Copy response
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { continueFromResponse(node.id); close() }}
          >
            <Plus size={12} /> Add prompt from here
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              if (node.data.kind === 'response') void runPrompt(node.data.parentPromptId)
              close()
            }}
          >
            <Play size={12} /> Run again as new branch
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { void retryResponse(node.id); close() }}
          >
            <RefreshCw size={12} /> Retry same request
          </button>
          <button type="button" role="menuitem" onClick={() => { workspace.setNodeSize(node.id, undefined, undefined); close() }}>
            <Minimize2 size={12} /> Reset size
          </button>
          <div className="context-separator" />
          <button type="button" role="menuitem" className="danger" onClick={remove}>
            <Trash2 size={12} /> Delete response
          </button>
        </>
      ) : null}
      {node?.data.kind === 'set' ? (
        <>
          <button type="button" role="menuitem" onClick={() => { void synthesizeOutput(node.id); close() }}><Sparkles size={12} /> Synthesize results</button>
          <button type="button" role="menuitem" onClick={() => { refreshOutputs(); close() }}><RefreshCw size={12} /> Refresh connected outputs</button>
          <div className="context-separator" />
          <button type="button" role="menuitem" className="danger" onClick={remove}><Trash2 size={12} /> Delete Set</button>
        </>
      ) : null}
      {node?.data.kind === 'output' ? (
        <>
          <button type="button" role="menuitem" onClick={() => { refreshOutputs(); close() }}><RefreshCw size={12} /> Refresh</button>
          <button type="button" role="menuitem" className="danger" onClick={remove}><Trash2 size={12} /> Delete output</button>
        </>
      ) : null}
      {node?.data.kind === 'summary' ? (
        <>
          <button type="button" role="menuitem" onClick={() => { useUiStore.getState().setSelectedNode((Array.isArray(node.data.coveredNodeIds) ? node.data.coveredNodeIds[0] : undefined) ?? null); close() }}><History size={12} /> Show original history</button>
          <button type="button" role="menuitem" className="danger" onClick={remove}><Trash2 size={12} /> Delete summary</button>
        </>
      ) : null}
      {node?.data.kind === 'system' || node?.data.kind === 'note' ? (
        <>
          <button type="button" role="menuitem" onClick={duplicate}>
            <Copy size={12} /> Duplicate
          </button>
          <button type="button" role="menuitem" onClick={copy}>
            <Copy size={12} /> Copy text
          </button>
          <button type="button" role="menuitem" className="danger" onClick={remove}>
            <Trash2 size={12} /> Delete
          </button>
        </>
      ) : null}
      {node && compactable ? <CompactEntry nodeId={node.id} onClose={close} /> : null}
      {!node ? (
        <>
          <Button
            variant="ghost"
            icon={<Plus size={12} />}
            onClick={() => {
              useUiStore.getState().setInsertionPosition({ x: (menu.x / window.innerWidth) * 2000 - 700, y: (menu.y / window.innerHeight) * 1200 - 400 })
              useUiStore.getState().openPalette({ x: menu.x, y: menu.y })
              close()
            }}
          >
            Add node here
          </Button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void pasteAt({ x: menu.x, y: menu.y }, undefined, screenToFlowPosition({ x: menu.x, y: menu.y }))
              close()
            }}
          >
            <ClipboardPaste size={12} /> Paste here
          </button>
          <button type="button" role="menuitem" onClick={() => { window.dispatchEvent(new CustomEvent('nchat:fit-view')); close() }}>
            <Maximize size={12} /> Fit view
          </button>
          <button type="button" role="menuitem" onClick={() => { window.dispatchEvent(new CustomEvent('nchat:layout')); close() }}>
            <LayoutDashboard size={12} /> Auto-layout
          </button>
        </>
      ) : null}
    </div>
  )
}

/**
 * La voce di compattazione, unica per **tutti** i tipi di nodo.
 *
 * Un componente e non un `<button>` inline perche' serve a dire *cosa* sta per
 * compattare: su una nota o su un file la domanda «compatta cosa?» non ha una
 * risposta ovvia, e senza risposta l'utente preme per vedere. Il testo del prompt
 * di destinazione sta nel `title`, quindi passa sopra la voce e la spiega senza
 * rubarle una riga.
 */
function CompactEntry({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const resolution = previewCompaction(nodeId)
  if (!resolution.ok) return null
  const document = workspaceDocumentFromState(useWorkspaceStore.getState())
  const prompt = document.nodes.find((node) => node.id === resolution.target.promptId)
  const text = prompt?.data.kind === 'prompt' ? prompt.data.text.trim().split('\n')[0] ?? '' : ''
  const label = text.slice(0, 48) || 'this prompt'
  return (
    <button
      type="button"
      role="menuitem"
      title={`Shorten what this prompt sends, down to one summary. Target: ${label}`}
      onClick={() => {
        openCompactionDialog(nodeId)
        onClose()
      }}
    >
      <Wand2 size={12} /> Compact context…
    </button>
  )
}
