import type { NodeType } from '../types/document'

export const NODE_SIZE_LIMITS: Record<NodeType, { minWidth: number; minHeight: number; maxWidth: number; maxHeight: number }> = {
  prompt: { minWidth: 260, minHeight: 160, maxWidth: 1400, maxHeight: 1800 },
  response: { minWidth: 280, minHeight: 120, maxWidth: 1400, maxHeight: 1800 },
  system: { minWidth: 240, minHeight: 120, maxWidth: 1400, maxHeight: 1800 },
  note: { minWidth: 200, minHeight: 100, maxWidth: 1400, maxHeight: 1800 },
  set: { minWidth: 300, minHeight: 180, maxWidth: 1400, maxHeight: 1800 },
  output: { minWidth: 280, minHeight: 160, maxWidth: 1400, maxHeight: 1800 },
  // Una cornice segue i nodi che contiene, quindi i limiti sono gli stessi dell'output:
  // non serve che l'utente possa ridurla sotto i suoi membri, perche' la sua dimensione
  // la calcola il telaio e non l'utente.
  group: { minWidth: 280, minHeight: 160, maxWidth: 1400, maxHeight: 1800 },
  summary: { minWidth: 280, minHeight: 140, maxWidth: 1400, maxHeight: 1800 },
  // A picture wants to be wider than a text node, and shorter than one: the
  // preview is the content, so there is nothing to type into.
  image: { minWidth: 220, minHeight: 160, maxWidth: 1400, maxHeight: 1800 },
  // A file or a folder holds a text preview, so it wants a little more room
  // than a prompt, which the user types into.
  file: { minWidth: 240, minHeight: 160, maxWidth: 1400, maxHeight: 1800 },
  folder: { minWidth: 260, minHeight: 180, maxWidth: 1400, maxHeight: 1800 },
  // A Brain holds an instruction, two folder names and a run log, so it wants
  // more room than anything else except a folder full of text.
  brain: { minWidth: 300, minHeight: 260, maxWidth: 1400, maxHeight: 1800 },
  // Un nodo Knowledge non si scrive dentro: si sceglie da un elenco. Quindi non ha una
  // casella che cresce col testo e non ha bisogno della larghezza di un prompt — ma ha un
  // elenco di note da spuntare, che ha bisogno di altezza per scorrere senza schiacciare
  // tutto dentro un rettangolo minuscolo.
  knowledge: { minWidth: 280, minHeight: 220, maxWidth: 1400, maxHeight: 1800 },
}
