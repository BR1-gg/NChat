import { beforeEach, describe, expect, it } from 'vitest'
import { canScrollFurther, canScrollVertically, findScrollableAncestor } from './wheelRouting'

/**
 * Chi si tiene la rotella.
 *
 * Il caso che questi test presidiano e l'**ultimo**, non il primo: la rotella su un
 * testo che puo scorrere deve scorrere e basta, ed e facile. Il difficile e non
 * fermare l'evento quando il testo e gia in fondo, o gia in cima.
 *
 * Fermarlo anche li produce il comportamento peggiore che un'interfaccia possa
 * avere: il testo non si muove, e non succede nient'altro. L'utente gira la rotella
 * e non capisce se il mouse sia rotto, se il testo sia finito, o se lui stia
 * sbagliando qualcosa. Meglio che l'evento prosegua e il quadro zooma: almeno e
 * un effetto che si riconosce.
 */

function elementWith(options: {
  scrollHeight: number
  clientHeight: number
  scrollTop?: number
  overflowY?: string
}): HTMLElement {
  const el = document.createElement('div')
  // Stile **vero**, inline: `getComputedStyle` deve poterlo vedere, altrimenti
  // `canScrollVertically` direbbe sempre di no e i test passerebbero senza provare
  // niente. happy-dom non applica i fogli di stile del progetto, quindi qui si
  // scrive la regola a mano.
  el.style.overflowY = options.overflowY ?? 'auto'
  Object.defineProperty(el, 'scrollHeight', { value: options.scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: options.clientHeight, configurable: true })
  Object.defineProperty(el, 'scrollTop', {
    value: options.scrollTop ?? 0,
    configurable: true,
    writable: true,
  })
  // Allegato al documento: `getComputedStyle` su un nodo sciolto restituisce
  // valori di default, e il test passerebbe verificando il nulla.
  document.body.appendChild(el)
  return el
}

describe('canScrollVertically', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('says no when the content already fits, even if it could scroll', () => {
    // Il caso importante: un elemento che *potrebbe* scorrere ma non ha niente da
    // mostrare. Se dicesse di si, la rotella su un nodo piccolo non zoomerebbe
    // piu — e su un grafo pieno di nodi piccoli, non zoomerebbe piu quasi mai.
    expect(
      canScrollVertically(elementWith({ scrollHeight: 200, clientHeight: 200 })),
    ).toBe(false)
  })

  it('says yes when there is more content than height', () => {
    expect(canScrollVertically(elementWith({ scrollHeight: 400, clientHeight: 200 }))).toBe(true)
  })

  it('says no when the overflow is hidden, because nothing would move', () => {
    // `overflow: hidden` con contenuto piu grande: sembra un testo che si puo
    // scorrere e non si puo. Intercettare la rotella li produrrebbe testo fermo.
    expect(
      canScrollVertically(
        elementWith({ scrollHeight: 400, clientHeight: 200, overflowY: 'hidden' }),
      ),
    ).toBe(false)
  })

  it('says no when the overflow is visible, because the content is not clipped', () => {
    // `visible` e l'unico caso in cui lo scorrimento nativo non esiste affatto: il
    // contenuto esce dal riquadro e non c'e niente da scorrere.
    expect(
      canScrollVertically(
        elementWith({ scrollHeight: 400, clientHeight: 200, overflowY: 'visible' }),
      ),
    ).toBe(false)
  })
})

describe('canScrollFurther', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('says yes when there is room below', () => {
    const el = elementWith({ scrollHeight: 1000, clientHeight: 200, scrollTop: 0 })
    expect(canScrollFurther(el, 120)).toBe(true)
  })

  it('says no at the bottom, so the wheel can carry on to the canvas', () => {
    // Il caso limite, e il motivo per cui questa funzione esiste.
    const el = elementWith({ scrollHeight: 1000, clientHeight: 200, scrollTop: 800 })
    expect(canScrollFurther(el, 120)).toBe(false)
  })

  it('says no at the top for an upward wheel', () => {
    const el = elementWith({ scrollHeight: 1000, clientHeight: 200, scrollTop: 0 })
    expect(canScrollFurther(el, -120)).toBe(false)
  })

  it('says yes going up from the middle', () => {
    const el = elementWith({ scrollHeight: 1000, clientHeight: 200, scrollTop: 500 })
    expect(canScrollFurther(el, -120)).toBe(true)
  })

  it('says yes going down from the middle', () => {
    const el = elementWith({ scrollHeight: 1000, clientHeight: 200, scrollTop: 500 })
    expect(canScrollFurther(el, 120)).toBe(true)
  })

  it('tolerates a fraction of a pixel, because rounding is not a position', () => {
    // 799.6 di scroll dentro 800: la posizione e gia in fondo, anche se il confronto
    // con un intero sbaglia di poco. Senza la tolleranza, l'ultimo mezzo pixel fa
    // tremolare fra "scorre" e "non scorre" e la rotella sembra appiccicata.
    const el = elementWith({ scrollHeight: 1000, clientHeight: 200, scrollTop: 799.6 })
    expect(canScrollFurther(el, 120)).toBe(false)
  })
})

describe('findScrollableAncestor', () => {
  let wrap: HTMLElement
  let node: HTMLElement
  let body: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = ''
    wrap = document.createElement('div')
    node = document.createElement('div')
    body = elementWith({ scrollHeight: 1000, clientHeight: 200 })
    node.appendChild(body)
    wrap.appendChild(node)
    document.body.appendChild(wrap)
  })

  it('finds the scrolling text from a point inside it', () => {
    // Il caso normale: il puntatore e dentro un paragrafo, e il paragrafo e
    // dentro il corpo della risposta, che e quello che scorre.
    const dentro = document.createElement('span')
    body.appendChild(dentro)
    expect(findScrollableAncestor(dentro, wrap)).toBe(body)
  })

  it('gives up at the canvas, so a scrolling ancestor outside cannot take the wheel', () => {
    // `document.body` scorre in un browser vero. Se la ricerca non si fermasse al
    // canvas, la rotella su un nodo piccolo scrollerebbe la pagina invece di
    // zoomare — che e il modo piu subdolo di rompere un quadro.
    expect(findScrollableAncestor(node, wrap)).toBeNull()
  })

  it('says null when nothing on the way scrolls', () => {
    expect(findScrollableAncestor(wrap, wrap)).toBeNull()
  })

  it('never returns the canvas itself, which is not what scrolls', () => {
    const risultato = findScrollableAncestor(wrap, wrap)
    expect(risultato).not.toBe(wrap)
  })
})
