import { BrainCircuit, FolderInput, FolderOutput, Play, RotateCcw, Square, X } from 'lucide-react'
import { memo, useEffect, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  brainToast,
  clearBrainLog,
  revertBrainRun,
  runBrain,
  stopBrain,
} from '../../actions/brainActions'
import { directoryOf } from '../../actions/folderActions'
import { brainFolders } from '../../logic/brain'
import { isCloudProvider, providerSpec } from '../../logic/providers'
import { supportsDirectories } from '../../persistence/handles'
import { zoomSummary } from '../../logic/zoomSummary'
import { useNodeData, useNodeHasExplicitSize } from '../../hooks/useNodeData'
import { useUiStore } from '../../store/uiStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import type { BrainNode as BrainNodeType, BrainNodeData, BrainOverwrite } from '../../types/document'
import { Button, IconButton } from '../common/Button'
import { NodeShell } from './NodeShell'

/**
 * The Brain: an instruction, two folders, and a run.
 *
 * The node is explicit about the three things that matter and that a person would
 * otherwise have to guess:
 *
 * - **which two folders**, by name, with the one it writes into marked as such;
 * - **what happens to a file that already exists**, as a control on the node,
 *   because that is the user's decision and not a sensible default;
 * - **what the last run did**, per file, with a button to put the written files
 *   back. The document's undo cannot do that: it restores nodes, not files.
 */
export const BrainNode = memo(function BrainNode({
  id,
  selected,
}: NodeProps<BrainNodeType>) {
  const hasExplicitSize = useNodeHasExplicitSize(id)
  const data = useNodeData<BrainNodeData>(id, 'brain')
  const store = useWorkspaceStore.getState()
  const edges = useWorkspaceStore((state) => state.edges)
  const nodes = useWorkspaceStore((state) => state.nodes)
  const uiProvider = useUiStore((state) => state.appSettings.provider)

  const folders = brainFolders(nodes, edges, id)
  const input = folders.input.name
  const outputName = folders.output.name

  /**
   * Which of the two folders the browser has actually granted.
   *
   * Without this the node could only say "a folder is missing", and the person
   * looking at it has two folder nodes and no way to tell which one wants the
   * button. The two lookups are small and happen once per wiring, not per file.
   */
  const [grants, setGrants] = useState<{ input: string | null; output: string | null }>({
    input: null,
    output: null,
  })
  useEffect(() => {
    let live = true
    const read = async (nodeId: string | null): Promise<string | null> => {
      if (!nodeId) return null
      const handle = await directoryOf(nodeId)
      return handle ? handle.name : null
    }
    void Promise.all([read(folders.input.id), read(folders.output.id)]).then(([inPath, outPath]) => {
      if (!live) return
      setGrants({ input: inPath, output: outPath })
      // The document keeps the paths as text; the handles live in their own table
      // because they cannot be serialised.
      store.updateNodeData(id, { inputPath: inPath ?? undefined, outputPath: outPath ?? undefined })
    })
    return () => {
      live = false
    }
  }, [id, folders.input.id, folders.output.id, store])

  const missing: string[] = []
  if (folders.input.id && !grants.input) missing.push(folders.input.name ?? 'the folder to read')
  if (folders.output.id && !grants.output) missing.push(folders.output.name ?? 'the folder to write into')
  /*
   * Why the Run button is off, in the order the user would hit the problems.
   *
   * The provider comes first on purpose. It is the one blocker that no amount of
   * wiring fixes, and if it were last the user would grant access to two folders,
   * write the instruction, and only then be told it will not run. The refusal in
   * `runBrain` is still there and still the one that actually stops it; this is
   * the one that saves the work.
   */
  const cloudProvider = isCloudProvider(uiProvider) ? providerSpec(uiProvider) : null
  const blocked = cloudProvider
    ? `The Brain needs a model on this machine. ${cloudProvider.label} runs in the cloud, and this would send the contents of your folders to it. Switch the provider to LM Studio.`
    : missing.length > 0
      ? `Grant access to ${missing.join(' and ')} from the folder node.`
      : null

  // Every hook is above this line. Returning before them would change the order
  // of the hooks between renders, which React does not allow and which shows up
  // as a crash the first time the node's data is briefly absent.
  if (!data) return null

  const run = data.run
  const running = run.status === 'running'
  const supported = supportsDirectories()
  const writable = run.undo.length > 0
  const finished = run.status === 'done' || run.status === 'stopped' || run.status === 'failed'

  const start = (): void => {
    if (!supported) {
      useUiStore.getState().addToast({
        tone: 'warning',
        title: 'This browser cannot be given a folder.',
        message: 'A Brain needs the File System Access API, which Edge, Chrome and other Chromium browsers have.',
      })
      return
    }
    void runBrain(id)
      .then((state) => {
        if (state.status === 'done') {
          brainToast('success', 'Brain finished.', state.message)
        } else if (state.status === 'stopped') {
          brainToast('warning', 'Brain stopped.', state.message)
        } else {
          brainToast('error', 'Brain did not finish.', state.message)
        }
      })
      .catch((error: unknown) => {
        brainToast('error', 'The run failed.', error instanceof Error ? error.message : undefined)
      })
  }

  const setPolicy = (onExisting: BrainOverwrite): void => {
    store.updateNodeData(id, { onExisting })
  }

  return (
    <NodeShell
      zoomSummary={zoomSummary(data)}
      id={id}
      explicitSize={hasExplicitSize}
      nodeKind="brain"
      icon={<BrainCircuit size={12} />}
      title={data.title || 'Brain'}
      subtitle={
        running
          ? `file ${run.done + 1} di ${run.total}`
          : data.instruction.trim()
            ? data.instruction.trim().split('\n')[0]?.slice(0, 40) ?? ''
            : 'Nessuna istruzione'
      }
      selected={selected}
      collapsed={data.collapsed === true}
      collapsedPreview={data.instruction.slice(0, 30)}
      className="brain-node"
      actions={
        <>
          {writable ? (
            <IconButton
              label="Put the written files back"
              onClick={() => {
                void revertBrainRun(id).then((result) => {
                  if (result.ok) brainToast('success', 'Files put back.', result.message)
                  else brainToast('warning', 'Some files could not be put back.', result.message)
                })
              }}
            >
              <RotateCcw size={11} />
            </IconButton>
          ) : null}
          {finished ? (
            <IconButton label="Clear the run log" onClick={() => clearBrainLog(id)}>
              <X size={11} />
            </IconButton>
          ) : null}
          <IconButton
            label="Remove the Brain"
            danger
            onClick={() => store.removeNodes([id])}
          >
            <X size={11} />
          </IconButton>
        </>
      }
      footer={
        <>
          <span>
            {run.status === 'running'
              ? `Working, ${run.done} of ${run.total}`
              : blocked
                ? blocked
                : run.status === 'idle'
                  ? 'Ready. Only these two folders can be touched.'
                  : (run.message ?? run.status)}
          </span>
          <div className="node-footer-actions">
            {running ? (
              <Button size="small" icon={<Square size={10} fill="currentColor" />} onClick={() => stopBrain(id)}>
                Stop
              </Button>
            ) : (
              <Button
                size="small"
                variant="primary"
                icon={<Play size={10} />}
                onClick={start}
                title={blocked ?? 'Work through the files and write the results'}
                disabled={!data.instruction.trim() || !input || !outputName}
              >
                Run
              </Button>
            )}
          </div>
        </>
      }
    >
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        className="handle-flow"
        aria-label="Read the files of this folder"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        className="handle-flow"
        aria-label="Write the results into this folder"
      />
      <div className="brain-body">
        <label className="brain-field">
          <span>Istruzione: cosa fare a ogni file</span>
          <textarea
            className="brain-instruction"
            value={data.instruction}
            rows={3}
            placeholder="Traduci in inglese. Riscrivi in terze persone. Correggi la grammatica. Riassumi in tre frasi."
            onChange={(event) =>
              store.updateNodeData(id, { instruction: event.currentTarget.value })
            }
          />
        </label>

        <div className="brain-folders">
          <div className="brain-folder">
            <FolderInput size={11} />
            <span className="brain-folder-label">legge</span>
            <strong>{input ?? 'nessuna cartella collegata'}</strong>
            {folders.input.id ? (
              <em className={grants.input ? 'brain-grant is-ok' : 'brain-grant is-missing'}>
                {grants.input ? 'accesso concesso' : 'serve concedere accesso'}
              </em>
            ) : null}
          </div>
          <div className="brain-folder">
            <FolderOutput size={11} />
            <span className="brain-folder-label">scrive</span>
            <strong>{outputName ?? 'nessuna cartella collegata'}</strong>
            {folders.output.id ? (
              <em className={grants.output ? 'brain-grant is-ok' : 'brain-grant is-missing'}>
                {grants.output ? 'accesso concesso' : 'serve concedere accesso'}
              </em>
            ) : null}
          </div>
        </div>
        <p className="brain-note">
          Solo queste due cartelle sono toccabili. Il browser non lascia che un nodo
          raggiunga nient&rsquo;altro, e ogni nome di file viene controllato prima di scrivere.
        </p>

        <fieldset className="brain-policy">
          <legend>Se il file esiste gia</legend>
          {(
            [
              ['rename', ' Rinomina', 'Non sovrascrive mai. Scrive relazione (1).txt.'],
              ['overwrite', 'Sovrascrivi', 'Riscrive il file. Rischia il lavoro precedente.'],
              ['skip', 'Salta', 'Non scrive e lo dice nel log.'],
            ] as Array<[BrainOverwrite, string, string]>
          ).map(([value, label, hint]) => (
            <label key={value} className={`brain-policy-option ${data.onExisting === value ? 'is-on' : ''}`}>
              <input
                type="radio"
                name={`overwrite-${id}`}
                checked={data.onExisting === value}
                onChange={() => setPolicy(value)}
              />
              <span>
                <strong>{label}</strong>
                <em>{hint}</em>
              </span>
            </label>
          ))}
        </fieldset>

        {run.log.length > 0 ? (
          <div className="brain-log">
            <div className="brain-log-head">
              <span>
                {run.done} di {run.total}
              </span>
              {run.undo.length > 0 ? (
                <span>{run.undo.length} file scritti, ripristinabili</span>
              ) : null}
            </div>
            <ul>
              {run.log.slice(0, 40).map((entry) => (
                <li key={`${entry.path}-${entry.status}`} className={`brain-log-item is-${entry.status}`}>
                  <span className="brain-log-status" aria-hidden="true" />
                  <span className="brain-log-path" title={entry.path}>
                    {entry.writtenAs && entry.writtenAs !== entry.path
                      ? `${entry.path} → ${entry.writtenAs}`
                      : entry.path}
                  </span>
                  {entry.reason ? <em className="brain-log-reason">{entry.reason}</em> : null}
                </li>
              ))}
            </ul>
            {run.log.length > 40 ? <p className="brain-note">+{run.log.length - 40} altre righe</p> : null}
          </div>
        ) : null}
      </div>
    </NodeShell>
  )
})
