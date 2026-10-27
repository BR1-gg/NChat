/**
 * I menu che aprono una finestra devono restare cliccabili.
 *
 * Il difetto che questo file chiude e' invisibile nel CSS e invisibile nei test di
 * logica: `z-index: 120` dice "sono sopra tutto", ma quei 120 valgono **dentro** il
 * contesto di impilamento che contiene l'elemento. Se quel contesto perde contro un
 * altro, il menu va sotto e i pulsanti diventano trasparenti al puntatore — senza
 * cambiare colore, senza spostarsi, senza errori. Si vede solo passando il mouse e
 * cliccando.
 *
 * E' successo solo in modalita' vetro, perche' e l'unica che aggiungeva
 * `z-index: 1` a `.app-main`. Il menu "Altro" della barra in alto ha `z-index: 120` e,
 * intrappolato in un contesto a 1, finiva sotto `.react-flow__pane`: le voci erano
 * visibili ma non ricevevano il clic. Sollevare il menu a 200 non avrebbe servito,
 * perche' il confronto che conta e' fra i due contesti, non fra i due elementi.
 *
 * Il test legge i fogli di stile per veri. Una versione precedente confrontava una
 * costante con se stessa e non poteva fallire mai: un test che passa comunque non
 * protegge niente, e sembra proteggere.
 */

import { describe, expect, it } from 'vitest'
import glassCss from './glass.css?raw'
import themeCss from './theme.css?raw'

/**
 * Il valore di una proprieta' dentro un blocco di regole, o `undefined` se assente.
 *
 * I commenti sono tolti per prima cosa perche' i fogli di stile di questo progetto sono
 * commentati in italiano e metà di essi contiene `{`, `}` o due punti: senza questo, un
 * commento che scrive `z-index: 1` verrebbe letto come una dichiarazione, e il test
 * passerebbe perche' ha trovato una parola in un Commento. Il difetto che questo test
 * protegge e' proprio di una dichiarazione scritta in un posto sbagliato, quindi la
 * lettura deve essere incapace di confondersi con un testo.
 */
function declaredValue(css: string, selector: string, property: string): string | undefined {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  // Raggruppa piu' selettori su piu' righe finche' non si trova una graffa.
  const blocks = [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  for (const match of blocks) {
    const selectorText = match[1] ?? ''
    const body = match[2] ?? ''
    const selectors = selectorText
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
    if (!selectors.includes(selector)) continue
    const declaration = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(body)
    if (declaration?.[1]) return declaration[1].trim()
  }
  return undefined
}

describe('glass appearance does not trap menus in a lower stacking context', () => {
  it('gives .app-main no z-index, so a menu inside it can win on its own', () => {
    const value = declaredValue(glassCss, ":root[data-appearance='glass'] .app-main", 'z-index')

    /*
     * Questa e' l'asserzione che chiude il difetto. Con `z-index: 1` qui, il menu
     * "Altro" della barra in alto — che sta dentro `.app-main` e chiede `z-index: 120`
     * — resta comunque sotto `.react-flow__pane`, e le sue voci non ricevono il clic.
     *
     * `undefined` (nessuna dichiarazione) e `auto` sono entrambi corretti: l'importante
     * e' che non sia un numero che crei un contesto.
     */
    expect(value, '.app-main must not create a stacking context in glass mode').toBeUndefined()
  })

  it('keeps position: relative on .app-main so it sits above the blurred backdrop', () => {
    // Senza il posizionamento il contenuto finisce sotto le macchie di colore e il
    // vetro si applica a un vuoto: grigio piatto invece di un materiale.
    expect(declaredValue(glassCss, ":root[data-appearance='glass'] .app-main", 'position')).toBe(
      'relative',
    )
  })

  it('leaves the canvas pane without a z-index of its own', () => {
    // Difesa dalla stessa parte: se la tela creasse un contesto proprio, ci sarebbe
    // un secondo candidato a coprire i menu anche senza `.app-main`.
    expect(declaredValue(themeCss, '.react-flow__pane', 'z-index')).toBeUndefined()
  })

  it('still gives the top-bar menu a z-index that only works from the root', () => {
    // Il valore c'e' ed e' alto: quello che e' cambiato e' il contesto in cui vale,
    // non il numero. Questo test fissa entrambe le mette, cosi' la correzione non
    // viene "annullata" alzando il menu o togliendolo.
    expect(declaredValue(themeCss, '.context-menu', 'z-index')).toBe('120')
  })
})
