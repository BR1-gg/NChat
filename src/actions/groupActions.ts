import { nanoid } from 'nanoid'
import type { AppNode, NodeId } from '../types/document'
import { ownsFrame } from '../logic/groups'
import { useWorkspaceStore } from '../store/workspaceStore'

/**
 * Il gruppo **solo visivo**: mette ordine e non partecipa a nessuna relazione.
 *
 * E' distinto dal gruppo logico (`output`), che invece raccoglie risposte e le aggrega
 * in un risultato usabile come contesto. Qui il contenuto e' indifferente: dentro un
 * gruppo ci puo' stare **qualsiasi** nodo, perche' non c'e' niente da calcolare e quindi
 * niente per cui un tipo di nodo sia sbagliato. E' esattamente il motivo per cui il gruppo
 * non ha maniglie: senza maniglie non puo' entrare in nessuna relazione, quindi «solo
 * visivo» non dipende da un accordo da mantenere.
 */

/** What this module needs from the store, so a test can pass a stand-in. */
interface GroupStore {
  nodes: AppNode[]
  addNode: (type: 'group', position: { x: number; y: number }, seed?: Record<string, unknown>) => NodeId
  updateNodeData: (id: NodeId, patch: Record<string, unknown>) => void
  removeNodes: (ids: NodeId[]) => void
  getState: () => GroupStore
}

/**
 * Why a node was left out of the group.
 *
 * Non e' un dettaglio: **`set`, `output` e `group` sono loro stessi cornici** — disegnano
 * un riquadro attorno a qualcosa — quindi metterli dentro un'altra cornice produrrebbe due
 * riquadri sovrapposti, e un nodo che si trova dentro due gruppi che si contraddicono.
 *
 * Un gruppo dentro un gruppo e' per se' accettabile, e `expandGroupMove` lo risolve
 * scendendo di livello. Ma qui si tratta di due cornici **diverse** che vogliono lo
 * stesso nodo, e li' non c'e' nessuna regola sensata per decidere quale vince: la
 * posizione dipenderebbe dall'ordine in cui sono state costruite.
 *
 * Per questo si rifiuta e lo si dice, invece di aggiungerlo e fingere che sia andata bene:
 * un rifiuto che spiega il perche' e' un aiuto, mentre un nodo dentro due gruppi e' un bug
 * che si vede solo quando si trascina.
 */
export type GroupSkipReason = 'frame' | 'gone'

export interface GroupPlan {
  /** The nodes that will go in, in the order they will be listed. */
  members: NodeId[]
  /** The nodes that will not, and why. */
  skipped: { id: NodeId; reason: GroupSkipReason }[]
}

/**
 * Works out what a selection would put in a group, before anything is changed.
 *
 * E' una funzione **pura** e sta separata dal gesto perche' la stessa domanda serve in
 * due posti: il menu contestuale, che vuole sapere se mostrare la voce, e la creazione,
 * che vuole sapere cosa metterci dentro. Se fosse una sola funzione che crea, il menu
 * dovrebbe chiamarla per capire se puo' offrire l'azione — e non puo' farlo, perche'
 * creerebbe il gruppo mentre l'utente sta solo passando il mouse sul menu.
 */
export function planGroup(nodes: readonly AppNode[], selectedIds: readonly NodeId[]): GroupPlan {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const members: NodeId[] = []
  const skipped: { id: NodeId; reason: GroupSkipReason }[] = []
  const seen = new Set<NodeId>()

  for (const id of selectedIds) {
    /*
     * Lo stesso nodo due volte non puo' accadere con una selezione vera, ma con un
     * import o con un `addNodes` pastato sì. E il caso non innocuo: metterlo due volte
     * farebbe contare un nodo solo come due, e la cornice mostrerebbe un numero che non
     * corrisponde a quanti ce ne sono.
     */
    if (seen.has(id)) continue
    const node = byId.get(id)
    if (!node) {
      skipped.push({ id, reason: 'gone' })
      continue
    }
    if (ownsFrame(node)) {
      skipped.push({ id, reason: 'frame' })
      continue
    }
    seen.add(id)
    members.push(id)
  }
  return { members, skipped }
}

/** How many nodes a frame wraps, for the label. */
function groupTitle(count: number): string {
  return count === 1 ? '1 node' : `${count} nodes`
}

/**
 * Wraps a selection in a new visual group.
 *
 * La cornice nasce gia' **attorno** ai nodi scelti: non viene posizionata a caso e poi
 * sistemata, ma `computeGroupFrame` la mette dove dev'essere al primo render. Senza, si
 * vedrebbe una cornice nell'angolo per qualche fotogramma e poi un salto — che su un
 * gesto che serve a mettere ordine e' il momento in cui l'utente pensa di aver sbagliato.
 *
 * Restituisce l'id del gruppo, o `null` se non c'era niente da metterci dentro. Non viene
 * creato un gruppo vuoto: senza membri non ha cornice (il telaio non ha nulla da
 * circondare) e non si saprebbe se esiste, quindi sarebbe una scelta che si perde e che
 * l'utente crede di aver fatto.
 */
export function createGroupFromSelection(selectedIds: readonly NodeId[], store?: GroupStore): NodeId | null {
  const state = (store ?? useWorkspaceStore.getState()) as unknown as GroupStore
  const { members } = planGroup(state.nodes, selectedIds)
  if (members.length === 0) return null

  // La posizione iniziale e' provvisoria: il primo `computeGroupFrame` la ricalcola
  // dai membri. Si mette un punto qualsiasi perche' `addNode` ne chiede uno.
  const id = state.addNode('group', { x: 0, y: 0 }, {
    title: groupTitle(members.length),
    members,
  })
  return id
}

/**
 * Takes every node out of a group, and leaves the group in place.
 *
 * Il gruppo resta e resta vuoto: una cornice vuota **non e' un errore**, e' lo stato in
 * cui si trova un gruppo dopo averne spostato via i nodi. Sparirebbe al primo render
 * (il telaio senza membri non ha niente da disegnare) e l'utente che sta svuotandolo
 * vedrebbe il gruppo cancellarsi da solo a metà.
 */
export function ungroupNodes(groupId: NodeId, store?: GroupStore): void {
  const state = (store ?? useWorkspaceStore.getState()) as unknown as GroupStore
  state.updateNodeData(groupId, { members: [] })
}

/**
 * Removes some nodes from one group.
 *
 * Esiste perche' il modo naturale di togliere un nodo da un gruppo e' accorgersi che non
 * ci sta piu' e chiedersi come si fa. La risposta e' un comando, e si trova anche nel
 * menu del nodo, perche' il nodo e' il posto in cui l'utente sta guardando.
 */
export function removeNodesFromGroup(groupId: NodeId, nodeIds: readonly NodeId[], store?: GroupStore): void {
  const state = (store ?? useWorkspaceStore.getState()) as unknown as GroupStore
  const node = state.nodes.find((candidate) => candidate.id === groupId)
  if (node?.data.kind !== 'group') return
  const drop = new Set(nodeIds)
  const members = node.data.members.filter((id) => !drop.has(id))
  if (members.length === node.data.members.length) return
  state.updateNodeData(groupId, { members })
}

/** The group a node is in, if any. */
export function groupOf(nodes: readonly AppNode[], nodeId: NodeId): NodeId | null {
  for (const node of nodes) {
    const members = node.data.kind === 'group' ? node.data.members : null
    if (members?.includes(nodeId)) return node.id
  }
  return null
}

/**
 * Deletes a group and keeps the nodes inside.
 *
 * E' una scelta, non una semplificazione: il gruppo **non contiene** i nodi, li
 * circonda. Se cancellarlo portasse via anche quelli, un gruppo usato per mettere ordine
 * perderebbe proprio il lavoro che era stato creato per organizzare — e il gesto piu'
 * vicino a «non mi serve piu' questa cornice» diventerebbe il modo per perdere dieci
 * nodi. Per questo si chiama `removeNodes([groupId])` e non si tocca nessun membro:
 * `removeNodes` stacca la cornice e basta, e i suoi membri restano dove sono.
 */
export function removeGroup(groupId: NodeId, removeNodes: (ids: NodeId[]) => void): void {
  removeNodes([groupId])
}

/** A fresh id for a group, for callers that build the node themselves. */
export const newGroupId = (): NodeId => nanoid(12)
