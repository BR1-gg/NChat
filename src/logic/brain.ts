import { outputNameFor, type NameVerdict } from './paths'
import { estimateTokens } from '../llm/tokens'

/**
 * What a Brain run will do, worked out before it touches anything.
 *
 * This is a pure function on purpose. The run writes to the user's disk, and the
 * decisions that shape it — which files, in what order, under which ceilings,
 * what happens on a collision — must be reviewable and testable without a disk, a
 * model or a canvas. Everything the run needs is computed here and then simply
 * executed.
 *
 * The node is not an agent: the model never chooses a tool, never loops, and
 * never sees anything but one file and one instruction. What it does is answer
 * "given this instruction and this file, what should the file say". That is the
 * whole contract, and it is a contract a local model can actually keep.
 */

export type BrainStatus = 'idle' | 'running' | 'done' | 'stopped' | 'failed'

export interface BrainLimits {
  /** Files processed in one run. */
  maxFiles: number
  /** Total bytes read from the input folder. */
  maxTotalBytes: number
  /** Longest single output file, in characters. */
  maxOutputChars: number
  /** Longest input file handed to the model, in characters. */
  maxInputChars: number
  /** Running estimate of the whole run, refused above this. */
  maxTotalTokens: number
}

export const DEFAULT_BRAIN_LIMITS: BrainLimits = {
  maxFiles: 50,
  maxTotalBytes: 4 * 1024 * 1024,
  maxOutputChars: 60_000,
  maxInputChars: 40_000,
  maxTotalTokens: 400_000,
}

export interface PlannedFile {
  index: number
  /** Path relative to the input folder. */
  path: string
  name: string
  kind: string
  text: string
  truncated: boolean
  /** What the run would send, after the input ceiling. */
  promptText: string
  promptTokens: number
}

export interface RefusedFile {
  /** The relative path, which is what identifies a file that was not read. */
  name: string
  reason: string
}

export interface BrainPlan {
  files: PlannedFile[]
  refused: RefusedFile[]
  /** The run stops here for this reason, when set. */
  blocked: string | null
  estimatedTokens: number
  limits: BrainLimits
}

/**
 * Turns a read result into the list of files to process.
 *
 * A refused file is never silently dropped: the run reports it, because a user
 * who dropped a folder of thirty files and got twelve back has to be told which
 * eighteen went missing and why.
 */
export function planBrainRun(
  read: {
    entries: Array<{
      path: string
      name: string
      kind: string
      sizeBytes: number
      text: string
      truncated: boolean
    }>
    refused: Array<{ name: string; reason: string }>
  },
  instruction: string,
  limits: BrainLimits = DEFAULT_BRAIN_LIMITS,
): BrainPlan {
  const refused: RefusedFile[] = [...read.refused]
  if (instruction.trim() === '') {
    return {
      files: [],
      refused,
      blocked: 'The instruction is empty, so there is nothing to do to the files.',
      estimatedTokens: 0,
      limits,
    }
  }
  const files: PlannedFile[] = []
  let estimated = 0
  for (const entry of read.entries) {
    if (files.length >= limits.maxFiles) {
      refused.push({
        name: entry.path,
        reason: `Over the ${limits.maxFiles} files per run limit.`,
      })
      continue
    }
    const promptText =
      entry.text.length > limits.maxInputChars
        ? entry.text.slice(0, limits.maxInputChars)
        : entry.text
    // The instruction counts once per file, which is why a long instruction is
    // paid for on every file and not just once.
    const promptTokens = estimateTokens(instruction) + estimateTokens(promptText)
    estimated += promptTokens
    files.push({
      index: files.length,
      path: entry.path,
      name: entry.name,
      kind: entry.kind,
      text: entry.text,
      truncated: entry.truncated || entry.text.length > limits.maxInputChars,
      promptText,
      promptTokens,
    })
  }
  return {
    files,
    refused,
    blocked: null,
    estimatedTokens: estimated,
    limits,
  }
}

/**
 * The messages sent for one file.
 *
 * Kept next to the plan so the prompt the run will send is reviewable in a test,
 * and so there is exactly one definition of what a Brain instruction means.
 */
export function brainMessages(
  instruction: string,
  file: { path: string; text: string },
): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system' as const,
      content: [
        'You rewrite files. Follow the instruction exactly.',
        'Reply with the new contents of the file and nothing else.',
        'No preamble, no explanation, no code fence around the whole answer.',
        'If the instruction does not apply, reply with the original text unchanged.',
      ].join(' '),
    },
    {
      role: 'user' as const,
      content: [
        `Instruction: ${instruction.trim()}`,
        '',
        `File: ${file.path}`,
        '---',
        file.text,
      ].join('\n'),
    },
  ]
}

/**
 * The name and the text to write for one file's answer.
 *
 * Output is capped, and the cap is **stated inside the text**, so the model is
 * never used to work around it: a file silently cut at 60,000 characters reads
 * as a complete document to whoever opens it next.
 */
export function prepareOutput(
  inputName: string,
  answer: string,
  limits: BrainLimits = DEFAULT_BRAIN_LIMITS,
): { verdict: NameVerdict; text: string; truncated: boolean } {
  const verdict = outputNameFor(inputName, answer)
  const body = answer.trim()
  if (body.length <= limits.maxOutputChars) {
    return { verdict, text: body, truncated: false }
  }
  const kept = body.slice(0, limits.maxOutputChars)
  // The note goes **inside** the file, not only in the log. A file cut at the cap
  // with nothing written in it reads as a finished document to whoever opens it
  // next, and that is exactly the kind of quiet wrongness this app has tried to
  // avoid everywhere else.
  const note = [
    '',
    `[Note: this file was cut at ${limits.maxOutputChars.toLocaleString()} characters by NCHAT.`,
    'The rest of the model answer is not in this file.]',
  ].join('\n')
  return { verdict, text: kept + note, truncated: true }
}

/** A one-line summary of what a run did, for the toast. */
export function summariseRun(
  results: Array<{ status: string }>,
): { written: number; renamed: number; skipped: number; failed: number } {
  return {
    written: results.filter((entry) => entry.status === 'written').length,
    renamed: results.filter((entry) => entry.status === 'renamed').length,
    skipped: results.filter((entry) => entry.status === 'skipped').length,
    failed: results.filter((entry) => entry.status === 'failed').length,
  }
}

export interface FolderRef {
  id: string | null
  name: string | null
}

export interface BrainFolders {
  input: FolderRef
  output: FolderRef
}

const NONE: FolderRef = { id: null, name: null }

/**
 * The two folders a Brain is wired to.
 *
 * One function, used by the node and by the run, on purpose: the two directions
 * are easy to confuse, and getting it wrong in the node leaves the Run button
 * disabled with nothing on screen to explain why, while getting it wrong in the
 * run produces "no folders connected" on a graph that plainly has two.
 *
 * The input arrives on an **incoming** edge and the output leaves on an
 **outgoing** one. They are not symmetric, and that is the whole trap.
 */
export function brainFolders(
  nodes: Array<{ id: string; data: { kind: string; name?: string } }>,
  edges: Array<{ source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>,
  brainId: string,
): BrainFolders {
  let input: FolderRef = NONE
  let output: FolderRef = NONE
  const nameOf = (nodeId: string | undefined | null): FolderRef => {
    if (!nodeId) return NONE
    const node = nodes.find((candidate) => candidate.id === nodeId)
    if (node?.data.kind !== 'folder') return NONE
    return { id: node.id, name: node.data.name || 'cartella senza nome' }
  }
  for (const edge of edges) {
    if (edge.target === brainId && edge.targetHandle === 'in' && input.id === null) {
      input = nameOf(edge.source)
    }
    if (edge.source === brainId && edge.sourceHandle === 'out' && output.id === null) {
      output = nameOf(edge.target)
    }
  }
  return { input, output }
}
