import { getLLMClient } from '../llm/client'
import {
  DEFAULT_BRAIN_LIMITS,
  brainMessages,
  planBrainRun,
  prepareOutput,
  brainFolders,
  summariseRun,
  type BrainFolders,
  type BrainLimits,
  type BrainStatus,
} from '../logic/brain'
import { useUiStore } from '../store/uiStore'
import { isCloudProvider, providerSpec } from '../logic/providers'
import { useWorkspaceStore, workspaceDocumentFromState } from '../store/workspaceStore'
import {
  directoryOf,
  ensureReadable,
  ensureWritable,
  listNames,
  readDirectory,
  revertWrite,
  writeTextFile,
  type UndoEntry,
  type WritePolicy,
} from './folderActions'

/**
 * Running a Brain node: read a folder, ask the model once per file, write the
 * answers into another folder.
 *
 * The shape of the run is deliberately not an agent. The model is called once per
 * file with the instruction and that file, and it answers with the new contents.
 * It never chooses a tool, never sees the folder, and never decides what happens
 * next. That is a contract a local model can keep, and it means the blast radius
 * of a bad answer is exactly one file.
 *
 * What the run will do is decided by `planBrainRun` before anything is read, and
 * the permission for the output folder is confirmed before the first call, so a
 * run never stops halfway with files written and no permission for the rest.
 */

export interface BrainFileLog {
  path: string
  status: 'pending' | 'written' | 'renamed' | 'skipped' | 'failed' | 'refused'
  /** The name on disk, which differs from `path` when a collision was renamed. */
  writtenAs?: string
  bytes?: number
  tokens?: number
  reason?: string
  /** How long the model took for this file, in milliseconds. */
  durationMs?: number
}

export interface BrainRunState {
  status: BrainStatus
  total: number
  done: number
  log: BrainFileLog[]
  startedAt?: number
  finishedAt?: number
  /** Files this run touched, with what was there before, for the revert. */
  undo: UndoEntry[]
  message?: string
}

export const IDLE_RUN: BrainRunState = { status: 'idle', total: 0, done: 0, log: [], undo: [] }

/** Which folders a Brain node is connected to. Shared with the node itself. */
export function foldersOf(
  document: ReturnType<typeof workspaceDocumentFromState>,
  brainId: string,
): BrainFolders {
  return brainFolders(document.nodes, document.edges, brainId)
}

/** Calls the model once for one file and returns the whole answer. */
async function askModel(
  settings: Parameters<typeof getLLMClient>[0],
  model: string,
  instruction: string,
  file: { path: string; text: string },
  signal: AbortSignal,
): Promise<{ text: string; tokens: number }> {
  let answer = ''
  let tokens = 0
  const result = await getLLMClient(settings).chatCompletionStream(
    {
      model,
      messages: brainMessages(instruction, file),
      // Low on purpose: a Brain rewrites a file, it does not explore options, and
      // a higher temperature is only a way to get a different file each run.
      temperature: 0.2,
      topP: 1,
      maxTokens: 4096,
      stream: true,
    },
    {
      onChunk: (delta: string) => {
        answer += delta
      },
      onUsage: (usage) => {
        tokens = usage.completionTokens ?? 0
      },
    },
    signal,
  )
  if (result.finishReason === 'length') {
    // A file cut by the output ceiling is a real thing and the writer says so, but
    // the run is told here too, so the log is not the only place that knows.
    return { text: answer, tokens }
  }
  return { text: answer, tokens }
}

export interface RunOptions {
  limits?: BrainLimits
  onState?: (state: BrainRunState) => void
}

/**
 * Runs a Brain node to the end, or until it is stopped.
 *
 * The state is pushed after every file rather than at the end, because a run over
 * a folder of thirty files takes long enough that a progress bar which only
 * appears at the finish is a progress bar that tells you nothing.
 */
export async function runBrain(
  brainId: string,
  options: RunOptions = {},
): Promise<BrainRunState> {
  const limits = options.limits ?? DEFAULT_BRAIN_LIMITS
  const store = useWorkspaceStore.getState()
  const document = workspaceDocumentFromState(store)
  const node = document.nodes.find((candidate) => candidate.id === brainId)
  if (node?.data.kind !== 'brain') {
    return { ...IDLE_RUN, status: 'failed', message: 'This node is not a Brain.' }
  }
  const data = node.data
  const publish = (state: BrainRunState): void => {
    useWorkspaceStore.getState().patchBrain(brainId, { run: state })
    options.onState?.(state)
  }

  const folders = foldersOf(document, brainId)
  /**
   * Every way a run can refuse, published onto the node.
   *
   * A refusal that only reaches a toast is a refusal the user has already
   * forgotten by the time they wonder why nothing happened, so each of these
   * leaves the reason on the node itself, where the Run button is.
   */
  const refuse = (message: string): BrainRunState => {
    const state: BrainRunState = {
      ...IDLE_RUN,
      status: 'failed',
      total: 0,
      done: 0,
      log: [],
      undo: [],
      finishedAt: Date.now(),
      message,
    }
    publish(state)
    return state
  }

  /*
   * Il Brain resta locale, e lo dice prima di fare qualcosa.
   *
   * Un Brain manda a un modello il contenuto di ogni file delle cartelle
   * collegate. Se il modello e in cloud, quello che esce dalla macchina e il testo
   * dell'utente, e lo avrebbe deciso scegliendo un provider per una chat. Non e
   * una cosa che si lascia accadere in silenzio: si rifiuta, e si dice perche.
   *
   * Va prima del controllo sulle cartelle perche e l'unico rifiuto che non dipende
   * dalla forma del grafo: se il provider e in cloud, la risposta e la stessa
   * qualunque sia la cartella, e dirlo per primo evita di far scegliere due
   * cartelle per una corsa che non parte.
   */
  const provider = useUiStore.getState().appSettings.provider
  if (isCloudProvider(provider)) {
    return refuse(
      `The Brain needs a model on this machine. ${providerSpec(provider).label} runs in the cloud, and this run would send the contents of your folders to it. Switch the provider to LM Studio to run it.`,
    )
  }

  if (!folders.input.id || !folders.output.id) {
    return refuse('The Brain needs one folder to read from and one folder to write into.')
  }

  const inputHandle = await directoryOf(folders.input.id)
  const outputHandle = await directoryOf(folders.output.id)
  if (!inputHandle) {
    return refuse('The input folder needs to be chosen again: the browser no longer grants access to it.')
  }
  if (!outputHandle) {
    return refuse('The output folder needs to be chosen: a Brain cannot write anywhere it was not given a folder.')
  }

  // Both permissions are settled before the first model call, so a run never
  // discovers halfway through that it may not write.
  const readable = await ensureReadable(inputHandle)
  if (!readable.ok) return refuse(readable.reason)
  const writable = await ensureWritable(outputHandle)
  if (!writable.ok) return refuse(writable.reason)

  if (folders.input.id === folders.output.id && data.onExisting !== 'overwrite') {
    return refuse(
      'The input and the output folder are the same one, and the node is set not to overwrite. Give the output its own folder, or allow overwriting.',
    )
  }

  const read = await readDirectory(inputHandle, { maxFiles: limits.maxFiles, maxTotalBytes: limits.maxTotalBytes })
  const plan = planBrainRun(read, data.instruction, limits)
  const policy: WritePolicy = { onExisting: data.onExisting }
  const taken = await listNames(outputHandle)
  // An empty model on the node means "the one chosen in the top bar", which is
  // the same default every other run uses.
  const model = data.model || useUiStore.getState().appSettings.defaultModel
  if (!model) {
    return refuse('No model is selected. Pick one in the top bar.')
  }

  const log: BrainFileLog[] = [
    ...plan.files.map((file) => ({ path: file.path, status: 'pending' as const, tokens: file.promptTokens })),
    ...plan.refused.map((entry) => ({ path: entry.name, status: 'refused' as const, reason: entry.reason })),
  ]
  const controller = new AbortController()
  brainControllers.set(brainId, controller)
  const state: BrainRunState = {
    status: 'running',
    total: plan.files.length,
    done: 0,
    log,
    startedAt: Date.now(),
    undo: [],
  }
  publish(state)

  if (plan.blocked) {
    const failed: BrainRunState = { ...state, status: 'failed', finishedAt: Date.now(), message: plan.blocked }
    publish(failed)
    return failed
  }
  if (plan.files.length === 0) {
    const failed: BrainRunState = {
      ...state,
      status: 'failed',
      finishedAt: Date.now(),
      message: 'No readable text file was found in the input folder.',
    }
    publish(failed)
    return failed
  }

  const undo: UndoEntry[] = []
  let stopped = false
  for (const file of plan.files) {
    if (controller.signal.aborted) {
      stopped = true
      break
    }
    const began = performance.now()
    const entry = log.find((candidate) => candidate.path === file.path)
    try {
      const answer = await askModel(
        document.settings,
        model,
        data.instruction,
        { path: file.path, text: file.promptText },
        controller.signal,
      )
      if (answer.text.trim() === '') {
        if (entry) {
          entry.status = 'skipped'
          entry.reason = 'The model returned nothing.'
          entry.durationMs = Math.round(performance.now() - began)
        }
      } else {
        const output = prepareOutput(file.name, answer.text, limits)
        if (!output.verdict.ok) {
          if (entry) {
            entry.status = 'failed'
            entry.reason = output.verdict.reason
            entry.durationMs = Math.round(performance.now() - began)
          }
        } else {
          const written = await writeTextFile(
            outputHandle,
            output.verdict.name,
            output.text,
            policy,
            taken,
          )
          if (written.status !== 'failed') {
            taken.add(written.name)
            undo.push(written.undo)
          }
          if (entry) {
            entry.status = written.status
            entry.writtenAs = written.name
            entry.bytes = written.bytes
            entry.reason = written.reason
            entry.durationMs = Math.round(performance.now() - began)
          }
        }
      }
    } catch (error: unknown) {
      if (entry) {
        entry.status = 'failed'
        entry.reason = error instanceof Error ? error.message : 'The run failed.'
        entry.durationMs = Math.round(performance.now() - began)
      }
      if (controller.signal.aborted) {
        stopped = true
        break
      }
    }
    state.done += 1
    publish({ ...state, log: [...log], done: state.done })
  }

  brainControllers.delete(brainId)
  const counts = summariseRun(log.map((entry) => ({ status: entry.status })))
  const finished: BrainRunState = {
    ...state,
    status: stopped ? 'stopped' : 'done',
    done: state.done,
    log: [...log],
    undo,
    finishedAt: Date.now(),
    message: stopped
      ? `Stopped after ${state.done} of ${state.total} files. The ${undo.length} already written can be put back.`
      : `${counts.written + counts.renamed} written, ${counts.skipped} skipped, ${counts.failed} failed.`,
  }
  publish(finished)
  return finished
}

const brainControllers = new Map<string, AbortController>()

/** Asks a running Brain to stop after the file it is on. */
export function stopBrain(brainId: string): void {
  brainControllers.get(brainId)?.abort()
}

/**
 * Puts back the files a run wrote.
 *
 * This exists because the document's undo cannot: it restores nodes, and nothing
 * in a browser can un-overwrite a file on disk without a copy kept first. The copy
 * is the run's `undo` list, and this is where it is spent.
 */
export async function revertBrainRun(brainId: string): Promise<{ ok: boolean; message: string }> {
  const store = useWorkspaceStore.getState()
  const node = store.nodes.find((candidate) => candidate.id === brainId)
  if (node?.data.kind !== 'brain') return { ok: false, message: 'This node is not a Brain.' }
  const run = node.data.run
  if (!run || run.undo.length === 0) return { ok: false, message: 'There is nothing to put back.' }
  const document = workspaceDocumentFromState(store)
  const folders = foldersOf(document, brainId)
  if (!folders.output.id) return { ok: false, message: 'The output folder is no longer connected.' }
  const handle = await directoryOf(folders.output.id)
  if (!handle) return { ok: false, message: 'The output folder needs to be chosen again.' }
  let restored = 0
  const failures: string[] = []
  // Newest first, so two writes to the same name unwind in the right order.
  for (const entry of [...run.undo].reverse()) {
    const result = await revertWrite(handle, entry)
    if (result.ok) restored += 1
    else failures.push(`${entry.path}: ${result.reason}`)
  }
  useWorkspaceStore.getState().patchBrain(brainId, {
    run: { ...run, undo: [], status: 'idle', message: `Put back ${restored} files.` },
  })
  return failures.length === 0
    ? { ok: true, message: `Put back ${restored} files.` }
    : { ok: false, message: `Put back ${restored}, failed on ${failures.length}: ${failures[0]}` }
}

/** Clears a finished run's log without touching the files it wrote. */
export function clearBrainLog(brainId: string): void {
  useWorkspaceStore.getState().patchBrain(brainId, { run: IDLE_RUN })
}

export function brainToast(tone: 'success' | 'warning' | 'error', title: string, message?: string): void {
  useUiStore.getState().addToast({ tone, title, ...(message ? { message } : {}) })
}
