import type { NodeId } from '../types/document'

/**
 * The frame of a group, in flow coordinates.
 *
 * A group is not a card sitting next to its answers: it *is* the dashed rectangle
 * drawn around them. That rectangle is what you connect to a prompt, so it has to
 * follow the answers when they are dragged, and it has to be a real node for
 * React Flow to give it a connection handle.
 */
export interface GroupFrame {
  id: NodeId
  x: number
  y: number
  width: number
  height: number
}

/** What the frame needs to know about a node it has to enclose. */
export interface FrameMember {
  id: NodeId
  position: { x: number; y: number }
  width?: number
  height?: number
  measured?: { width?: number; height?: number }
}

/** Breathing room between the answers and the dashed border. */
export const FRAME_PADDING = 26

/**
 * The size a node actually occupies. An explicit `width`/`height` wins over the
 * measured one: a node the user resized stays that size even if the measurement
 * is stale.
 */
function sizeOf(node: FrameMember): { width: number; height: number } {
  return {
    width: node.width ?? node.measured?.width ?? 0,
    height: node.height ?? node.measured?.height ?? 0,
  }
}

/**
 * The frame that encloses every member, or `null` when there is nothing to
 * enclose. A member with no known size is measured as zero, which is why the
 * caller only calls this once React Flow has measured the nodes.
 */
export function computeGroupFrame(
  id: NodeId,
  memberIds: readonly NodeId[],
  members: readonly FrameMember[],
  padding: number = FRAME_PADDING,
): GroupFrame | null {
  if (memberIds.length === 0) return null
  const byId = new Map(members.map((node) => [node.id, node]))
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let found = 0

  for (const memberId of memberIds) {
    const member = byId.get(memberId)
    if (!member) continue
    found += 1
    const { width, height } = sizeOf(member)
    minX = Math.min(minX, member.position.x)
    minY = Math.min(minY, member.position.y)
    maxX = Math.max(maxX, member.position.x + width)
    maxY = Math.max(maxY, member.position.y + height)
  }
  if (found === 0) return null

  return {
    id,
    x: minX - padding,
    y: minY - padding,
    // A floor so a group of collapsed nodes still has a grabbable border.
    width: Math.max(80, maxX - minX + padding * 2),
    height: Math.max(48, maxY - minY + padding * 2),
  }
}

/** True when the stored frame already matches, so nothing has to be written. */
export function frameMatches(
  current: { position: { x: number; y: number }; width?: number; height?: number },
  frame: Omit<GroupFrame, 'id'>,
): boolean {
  return (
    current.position.x === frame.x &&
    current.position.y === frame.y &&
    current.width === frame.width &&
    current.height === frame.height
  )
}

/**
 * The nodes inside a frame, or `null` when this node is not a frame.
 *
 * Due tipi di cornice conviveno, e tenere il conto di **quale campo** tiene i membri in
 * un posto solo evita di corregli in due punti e dimenticarsene in uno:
 *
 * - `output` — il gruppo **logico**: raccoglie risposte e le aggrega in un risultato.
 * - `group` — il gruppo **solo visivo**: contiene nodi di qualsiasi tipo e non partecipa
 *   a nessuna relazione.
 *
 * Entrambe sono cornici, quindi condividono il resto del comportamento: la posizione e'
 * derivata dai membri e spostare la cornice sposta i membri. Se un terzo tipo di
 * cornice comparisse, si aggiunge una riga qui e il resto continua a funzionare.
 */
export function groupMemberIds(node: {
  type: string
  data: { kind: string; sourceNodeIds?: NodeId[]; members?: NodeId[] }
}): NodeId[] | null {
  if (node.type === 'output' && node.data.kind === 'output') return node.data.sourceNodeIds ?? null
  if (node.type === 'group' && node.data.kind === 'group') return node.data.members ?? null
  return null
}

/**
 * Whether this node already **draws a frame** around something else.
 *
 * Non e' la stessa domanda di `groupMemberIds`, e tenerle separate e' il punto.
 *
 * - `groupMemberIds` chiede «la tua posizione e' derivata dai tuoi membri?» — di questa
 *   risponde `set` con **no**, perche' `set` e' una card con la sua posizione e il suo
 *   riquadro lo disegna un overlay attorno ai membri, non il nodo stesso.
 * - `ownsFrame` chiede «disegni un riquadro intorno a qualcosa?» — di questa `set`
 *   risponde **si**.
 *
 * Il risultato e' che il vecchio `set` non si puo' mettere dentro un gruppo visivo, ma
 * non perche' sia una cornice posizionata: perche' ha gia' un riquadro suo. Se fosse
 * dentro un gruppo, i due riquadri si sovrapporrebbero — e spostare il gruppo lo
 * trascinerebbe via dal suo riquadro, che resterebbe fermo dove sono i membri.
 *
 * Tenerli separati evita anche il rovescio dell'errore: se `groupMemberIds` includesse
 * `set`, trascinare un vecchio `set` inizierebbe a spostare i suoi membri invece della
 * card, e cambierebbe un comportamento che gia' funziona.
 */
export function ownsFrame(node: { type: string; data: { kind: string } }): boolean {
  return node.type === 'output' || node.type === 'group' || node.type === 'set'
}

/** The little bit of a node this function needs. */
export interface GroupMoveNode {
  id: NodeId
  type: string
  position: { x: number; y: number }
  data: { kind: string; sourceNodeIds?: NodeId[]; members?: NodeId[] }
}

/**
 * Turns a drag of a group's frame into a drag of the answers inside it.
 *
 * The frame cannot be moved on its own: its position is recomputed from the
 * answers on every render, so writing a new position for it would be undone a
 * moment later. Dragging the frame therefore moves **the answers**, by the same
 * delta, and the frame follows them where it belongs.
 *
 * A group inside a group is expanded too, for the same reason: its own frame is
 * derived from its members, so it must not be moved directly. Returns `null`
 * when the node is not a group, which tells the caller to move it as usual.
 */
export function expandGroupMove(
  nodes: readonly GroupMoveNode[],
  id: NodeId,
  next: { x: number; y: number },
): Map<NodeId, { x: number; y: number }> | null {
  const moves = new Map<NodeId, { x: number; y: number }>()
  const seen = new Set<NodeId>()

  const walk = (groupId: NodeId, dx: number, dy: number): boolean => {
    if (seen.has(groupId)) return false
    const group = nodes.find((candidate) => candidate.id === groupId)
    if (!group) return false
    const members = groupMemberIds(group)
    if (!members || members.length === 0) return false
    seen.add(groupId)
    let moved = false
    for (const memberId of members) {
      const member = nodes.find((candidate) => candidate.id === memberId)
      if (!member) continue
      // Un gruppo dentro un gruppo e' una cornice anch'esso: si sposta cio' che contiene,
      // non la sua cornice — per il motivo scritto sopra. `groupMemberIds` restituisce
      // una lista vuota per una cornice senza membri, e quella non va trattata come
      // gruppo annidato: altrimenti ci si fermerebbe li' e non si muoverebbe nulla.
      const nested = groupMemberIds(member)
      if (nested && nested.length > 0) {
        moved = walk(memberId, dx, dy) || moved
        continue
      }
      moves.set(memberId, { x: member.position.x + dx, y: member.position.y + dy })
      moved = true
    }
    return moved
  }

  const frame = nodes.find((candidate) => candidate.id === id)
  if (!frame) return null
  const dx = next.x - frame.position.x
  const dy = next.y - frame.position.y
  if (dx === 0 && dy === 0) return null
  return walk(id, dx, dy) ? moves : null
}
