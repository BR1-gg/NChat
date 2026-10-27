/**
 * Chi si tiene la rotella, e quando.
 *
 * Due funzioni sole, senza stato e senza dipendenze, perche la parte difficile di
 * questo problema non e la regola — e decidere **quando non** applicarla.
 *
 * Il caso da non rovinare e l'ultimo: la rotella in fondo a un testo che scorre,
 * o in cima a uno che e gia in cima. Fermare l'evento anche li produce il peggior
 * comportamento possibile — il testo non si muove e non succede nient'altro, senza
 * un segnale che dica dove sia finita la rotella. Meglio che la rotella prosegua e
 * zoomi il quadro, che e almeno un effetto che l'utente riconosce.
 */

/** Sotto questa differenza, in pixel, il confronto non vale niente. */
const SCROLL_EPSILON = 1

/**
 * Il primo antenato che puo scorrere in verticale, senza uscire da `within`.
 *
 * Sale dal puntatore verso l'albero dei padri, e si ferma a `within` perche oltre
 * quello non e piu roba del quadro: un antenato che scorre non deve poter
 * «rubare» la rotella a qualcosa che sta dentro.
 */
export function findScrollableAncestor(target: HTMLElement, within: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = target
  while (current) {
    if (current !== within && canScrollVertically(current)) return current
    if (current === within) return null
    current = current.parentElement
  }
  return null
}

/** Whether this element actually scrolls vertically, rather than merely allowing it. */
export function canScrollVertically(element: HTMLElement): boolean {
  if (element.scrollHeight <= element.clientHeight) return false
  const overflow = globalThis.getComputedStyle(element).overflowY
  return overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay'
}

/**
 * Whether there is still something to read in the direction of the wheel.
 *
 * `delta > 0` e rotella verso il basso, che in un testo e avanti. Il confronto e
 * con `clientHeight` e non con `offsetHeight`: il primo e l'altezza **visibile**,
 * cioe quella che l'utente vede, e sono diversi quando c'e una barra di scorrimento
 * o un bordo.
 */
export function canScrollFurther(element: HTMLElement, deltaY: number): boolean {
  const gap = deltaY > 0
    ? element.scrollHeight - element.scrollTop - element.clientHeight
    : element.scrollTop
  return gap > SCROLL_EPSILON
}
