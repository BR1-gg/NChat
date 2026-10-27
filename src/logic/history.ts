/**
 * Undo for the document, not for a text field.
 *
 * Inside a textarea Ctrl+Z is the browser's own text undo, which is why it felt
 * like the only thing undo could do. This is the other half: moving a node,
 * creating one, deleting one, connecting, resizing, grouping.
 *
 * ## Why snapshots and not patches
 *
 * A patch-based history has to know the inverse of every operation, and every new
 * feature adds a new operation that can be forgotten. Snapshots of the node and
 * edge arrays are boring and always correct.
 *
 * They are also cheap, which is the part that looked expensive: the store is
 * written with Immer, so after a mutation the new array reuses the *same object
 * references* for every node that did not change. Pushing the previous array into
 * the stack therefore costs only the nodes that are about to change, and an image
 * node holding a data URL is copied only when that node itself is edited.
 *
 * ## Why drags are one step and not two hundred
 *
 * React Flow reports a position change on every mousemove. Recording each one
 * would make undo useless. A change carries `dragging`, and it is only recorded
 * when the flag says the drag is over, so a drag is a single step. The keyboard
 * nudge has no such flag, so it falls back to a short time window.
 */

export interface HistoryEntry<TNodes, TEdges> {
  nodes: TNodes
  edges: TEdges
  /** Shown in the toast, so an undo is never a mystery. */
  label: string
  at: number
  /** Groups the steps of one continuous gesture. */
  key: string
}

export interface HistoryOptions {
  /** How many steps to keep. Deep enough for a real mistake, shallow enough to stay cheap. */
  limit?: number
  /** Two steps with the same key closer than this are one gesture. */
  coalesceMs?: number
  now?: () => number
}

export const HISTORY_LIMIT = 60
export const COALESCE_MS = 600

export class History<TNodes, TEdges> {
  private past: Array<HistoryEntry<TNodes, TEdges>> = []
  private future: Array<HistoryEntry<TNodes, TEdges>> = []
  private readonly limit: number
  private readonly coalesceMs: number
  private readonly now: () => number

  constructor(options: HistoryOptions = {}) {
    this.limit = options.limit ?? HISTORY_LIMIT
    this.coalesceMs = options.coalesceMs ?? COALESCE_MS
    this.now = options.now ?? (() => Date.now())
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  /** The label of the step an undo would reverse, for the toast. */
  get nextUndoLabel(): string | null {
    return this.past.at(-1)?.label ?? null
  }

  get nextRedoLabel(): string | null {
    return this.future.at(-1)?.label ?? null
  }

  /**
   * Records the state from *before* a mutation.
   *
   * `changed` is the identity check on the post-mutation arrays: Immer returns
   * the very same array when a producer changed nothing, so a false positive here
   * would fill the history with no-op steps that undo appears to ignore.
   */
  record(
    before: { nodes: TNodes; edges: TEdges },
    after: { nodes: TNodes; edges: TEdges },
    label: string,
    key: string,
  ): void {
    if (before.nodes === after.nodes && before.edges === after.edges) return
    const at = this.now()
    const last = this.past.at(-1)
    // Same gesture, still in progress: keep the older snapshot, because that is
    // the state before the gesture started, and just move the clock forward.
    if (last && last.key === key && at - last.at < this.coalesceMs) {
      last.at = at
    } else {
      this.past.push({ nodes: before.nodes, edges: before.edges, label, at, key })
      if (this.past.length > this.limit) this.past.shift()
    }
    // A new action invalidates the redo branch, as everywhere else.
    this.future = []
  }

  undo(current: { nodes: TNodes; edges: TEdges }): HistoryEntry<TNodes, TEdges> | null {
    const entry = this.past.pop()
    if (!entry) return null
    this.future.push({ ...entry, nodes: current.nodes, edges: current.edges })
    return entry
  }

  redo(current: { nodes: TNodes; edges: TEdges }): HistoryEntry<TNodes, TEdges> | null {
    const entry = this.future.pop()
    if (!entry) return null
    this.past.push({ ...entry, nodes: current.nodes, edges: current.edges })
    return entry
  }

  clear(): void {
    this.past = []
    this.future = []
  }
}
