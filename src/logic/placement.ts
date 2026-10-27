import type { XYPosition } from '@xyflow/react'

/**
 * Where new nodes should appear.
 *
 * A new node used to land in the middle of the visible canvas, which meant
 * hunting for it after every insert, paste or duplicate. The canvas records the
 * last pointer position here, in flow coordinates, and creators read it.
 *
 * Deliberately a module variable and not a store: the position changes on every
 * mouse move, and a store write per move would re-render every subscriber for a
 * value that only matters at the moment a node is created.
 */
let lastPointer: XYPosition | null = null

export function setLastPointerPosition(position: XYPosition | null): void {
  lastPointer = position
}

export function getLastPointerPosition(): XYPosition | null {
  return lastPointer
}

/**
 * The position a new node should use, in order of preference:
 *
 * 1. `explicit`, when the user pointed at a place on purpose: right-clicking or
 *    double-clicking the canvas sets an insertion point.
 * 2. The last pointer position, so the node appears under the cursor.
 * 3. `fallback`, normally the centre of the current view.
 * 4. The origin, which is only correct when the canvas has never been seen.
 *
 * The fallback matters: without it, a node created before the pointer has ever
 * touched the canvas lands at the world origin, usually far outside the view,
 * and the user has to go looking for it.
 */
export function creationPosition(
  explicit: XYPosition | null | undefined,
  fallback?: XYPosition | null,
): XYPosition {
  if (explicit) return explicit
  if (lastPointer) return lastPointer
  return fallback ?? { x: 0, y: 0 }
}

if (import.meta.env.DEV) {
  // Debug handle, come __nchatGetStore: permette di controllare dalla console
  // quale posizione sta per essere usata, senza dover ricostruire la
  // trasformazione del canvas a mano.
  ;(
    globalThis as unknown as { __nchatPlacement?: typeof creationPosition }
  ).__nchatPlacement = creationPosition
}
