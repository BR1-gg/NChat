/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'
import { FAR_ZOOM } from './zoomSummary'
import v2 from '../styles/v2.css?raw'
import flowCanvas from '../components/canvas/FlowCanvas.tsx?raw'

/**
 * La leggibilita del riepilogo a zoom lontano.
 *
 * Il difetto che questi test bloccano e uno che sembra una scelta di design e non
 * lo e: il riepilogo era scritto in pixel del **nodo**, e il nodo sta dentro
 * `transform: scale(zoom)`. Quindi la sua dimensione sullo schermo era
 * `11px × zoom`, che al minimo consentito — 0.2 — faceva **2.2 pixel**: non un
 * testo piccolo, un testo che non esiste. E la cosa si nascondeva bene, perche a
 * zoom 1 sembrava perfettamente normale e il difetto compariva solo a 0.2, dove
 * nessuno va a guardare due volte.
 *
 * La correzione e dividere per lo zoom, cosi la dimensione e costante sullo
 * schermo. Il rischio, da qui in poi, e che qualcuno lo "semplifichi": un
 * `font-size: 12px` sembra il valore giusto in una regola CSS, e il difetto
 * ritorna identico e di nuovo invisibile. Quindi il `calc` e verificato qui.
 */

/**
 * I numeri che questo file verifica, e perche sono quelli.
 *
 * `minZoom` e 0.2, quindi la grandezza che si vede sullo schermo e
 * `pixels / zoom`. Un valore fisso di 15px arriva a **3px**: non un testo piccolo,
 * un testo che non esiste. Quindi la prova non guarda che «c'e un calc», guarda che
 * il divisore sia lo zoom e che il numeratore sia abbastanza grande da sopravvivere
 * alla divisione.
 */
const SCREEN_PX = 14

/** Il blocco del riepilogo, dai sorgenti. */
function summaryBlock(): string {
  const inizio = v2.indexOf('.node-zoom-summary {')
  const fine = v2.indexOf('.node-zoom-summary p {')
  expect(inizio, 'il blocco .node-zoom-summary non e stato trovato').toBeGreaterThan(-1)
  expect(fine, 'il blocco .node-zoom-summary p non e stato trovato').toBeGreaterThan(-1)
  return v2.slice(inizio, fine)
}

function summaryParagraph(): string {
  const inizio = v2.indexOf('.node-zoom-summary p {')
  const fine = v2.indexOf('.node-zoom-summary.is-title', inizio)
  expect(inizio).toBeGreaterThan(-1)
  return v2.slice(inizio, fine === -1 ? undefined : fine)
}

describe('il riepilogo a zoom lontano', () => {
  it('divide la dimensione per lo zoom, altrimenti al minimo diventa illeggibile', () => {
    const blocco = summaryBlock()
    expect(blocco).toMatch(
      /--summary-px:\s*calc\(\s*\d+px\s*\/\s*var\(--canvas-zoom,\s*1\)\s*\)/,
    )
    // E il numeratore deve reggere: sotto i 10px sullo schermo non e "piccolo",
    // e il difetto tornerebbe identico con un aspetto piu serio di quanto sembri.
    const numeratore = Number(blocco.match(/--summary-px:\s*calc\(\s*(\d+)px/)?.[1])
    expect(numeratore, 'il numeratore non e stato letto').toBeGreaterThanOrEqual(SCREEN_PX)
    // E questo e il punto aritmetico: la divisione annulla lo zoom, quindi il
    // numeratore **e** la grandezza sullo schermo a qualunque distanza. Il
    // numeratore e il numero che conta, e non va moltiplicato per niente.
    expect(numeratore, 'sullo schermo non deve scendere sotto i 12px').toBeGreaterThanOrEqual(12)
  })

  it('usa la grandezza calcolata, non un numero scritto a mano', () => {
    // Il punto dove si perdeva la compensazione: la regola c'era ma la dimensione
    // non la usava, quindi il calcolo non serviva a niente.
    expect(summaryParagraph()).toMatch(/font-size:\s*var\(--summary-px/)
    expect(summaryParagraph()).not.toMatch(/font-size:\s*\d+px/)
  })

  it('ha un ripiego quando la variabile non c e', () => {
    // Il primo render, e qualunque contesto in cui il foglio di stile e applicato
    // fuori dal canvas: meglio il ripiego che `calc` invalido, che azzera la
    // dimensione e la lascia ereditare dal nodo.
    expect(summaryBlock()).toMatch(/var\(--canvas-zoom,\s*1\)/)
    expect(summaryParagraph()).toMatch(/var\(--summary-px,\s*\d+px\)/)
  })

  it('non taglia il testo da entrambi i lati quando non ci sta', () => {
    /*
     * Il secondo difetto, emerso solo guardando lo schermo a 0.2.
     *
     * Con la dimensione compensata il testo e piu alto del nodo, e `align-items:
     * center` su un contenuto che trabocca lo taglia **sopra e sotto**: quello che
     * si leggeva era la seconda riga, spezzata a meta' parola. Con `safe center`
     * l'allineamento ricade su `start` quando il contenuto non entra, quindi la
     * prima riga e sempre quella che si vede — e le prime parole sono quelle che
     * identificano il nodo.
     */
    expect(summaryBlock()).toMatch(/align-items:\s*safe center/)
  })

  it('non spende un quarto del nodo in margini', () => {
    // I margini non sono compensati, e questa e la decisione controintuitiva.
    // Compensarli sembra coerente — e a 0.2 un margine di 10px su un nodo di 190px
    // lascia al testo 90px, cioe una parola per riga dentro un nodo di 38 pixel
    // sullo schermo. La misura nel browser: larghezza del testo 17px su 38px
    // disponibili, cioe metta. Con i margini piccoli e costanti: 34px su 38.
    const padding = summaryBlock().match(/padding:\s*([^;]+);/)
    expect(padding, 'il padding non e stato trovato').not.toBeNull()
    const numeri = [...(padding?.[1] ?? '').matchAll(/(\d+)px/g)].map((m) => Number(m[1]))
    expect(numeri.length, 'il padding dovrebbe essere in pixel semplici').toBeGreaterThan(0)
    for (const n of numeri) expect(n, 'margine troppo grande per un nodo piccolo').toBeLessThanOrEqual(10)
  })
})

describe('il riepilogo di una risposta e un titolo', () => {
  const bloccoTitolo = (): string => {
    const inizio = v2.indexOf('.node-zoom-summary.is-title {')
    expect(inizio, 'il blocco .is-title non e stato trovato').toBeGreaterThan(-1)
    return v2.slice(inizio, inizio + 400)
  }

  it('e piu grande del riepilogo normale, non uguale', () => {
    const normale = Number(summaryBlock().match(/--summary-px:\s*calc\(\s*(\d+)px/)?.[1])
    const titolo = Number(bloccoTitolo().match(/--summary-px:\s*calc\(\s*(\d+)px/)?.[1])
    expect(titolo, 'il titolo non ha una sua grandezza').toBeGreaterThan(normale)
    // E la differenza si vede sullo schermo a qualunque zoom, perche la divisione
    // e la stessa per i due: quindi il confronto e gia quello giusto.
    expect(titolo - normale, 'sullo schermo il titolo deve staccare').toBeGreaterThanOrEqual(1)
  })

  it('e marcato, perche un titolo piu grande ma senza segno sembra solo un testo', () => {
    // Su un grafo con trenta nodi, l'unica differenza che si nota a zoom spinza e
    // il segno: il peso si vede, ma non dice «questa riga e il titolo del nodo».
    expect(bloccoTitolo()).toMatch(/border-left:\s*\d+px solid/)
  })

  it('non scrive un secondo numero per la stessa grandezza', () => {
    // `--summary-px` viene ricalcolata invece di aggiungere un `font-size` nuovo:
    // due numeri per la stessa grandezza sono due numeri che un giorno non
    // coincidono piu, e il secondo sopravvive al primo.
    expect(bloccoTitolo()).not.toMatch(/font-size:\s*\d+px/)
  })
})

describe('lo zoom e esposto alla pagina', () => {
  it('FlowCanvas mette lo zoom come variabile CSS', () => {
    // Senza questo non c'e niente da dividere: la variabile e l'unico canale fra il
    // valore numerico e la regola di stile, e senza di lei il `calc` riporterebbe
    // il ripiego a 12px, cioe il difetto di prima con un aspetto piu serio.
    expect(flowCanvas).toMatch(/--canvas-zoom/)
    expect(flowCanvas).toMatch(/'--canvas-zoom':\s*viewport\.zoom/)
  })

  it('la soglia resta quella del modulo, non un numero nel foglio di stile', () => {
    /*
     * `data-canvas-zoom` e un attributo e non una classe perche e una conseguenza
     * pura dello zoom. Il numero deve stare in un posto solo: se il CSS decidesse
     * con un suo valore, i due potrebbero divergere e il riepilogo apparirebbe con
     * lo sfondo ancora nitido, o sparirebbe con lo sfondo gia' sfocato.
     */
    expect(flowCanvas).toMatch(/data-canvas-zoom=\{viewport\.zoom < FAR_ZOOM \? 'far' : 'near'\}/)
    expect(FAR_ZOOM).toBeGreaterThan(0)
    expect(FAR_ZOOM).toBeLessThan(1)
  })
})
