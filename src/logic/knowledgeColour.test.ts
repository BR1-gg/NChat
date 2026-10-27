/**
 * La palette dei colori delle note, e il patto con i fogli di stile.
 *
 * Il perche' di questo file e' tutto nella prima riga: la palette e' dichiarata in
 * `knowledgeColour.ts` perche' la mappa la passa a `three`, che accetta un numero. La
 * **stessa** palette e' scritta nei fogli di stile, perche' il CSS non puo' importare il
 * TypeScript. Quindi sono due elenchi che devono restare uguali, e senza qualcosa che lo
 * controlli restano uguali **finche' non li qualcuno**.
 *
 * Il difetto, quando arriva, e' invisibile per la definizione stessa del difetto: una
 * pastiglia colorata di rosa e una pallina colorata di viola si presentano entrambe
 * correttamente, hanno entrambe un nome, e l'utente sceglie un colore che poi non e' quello
 * che vede. Non c'e' nessun errore, nessun avviso, e il colore non viene mai applicato.
 *
 * Per questo il controllo e' sui **valori**, non sui nomi: un nome puo' restare identico
 * mentre la tinta cambia sotto, e quello si vedrebbe solo mettendo le due cose vicine.
 */

import { describe, expect, it } from 'vitest'
import {
  KNOWLEDGE_CSS_HEX,
  KNOWLEDGE_COLOUR_NAMES,
  KNOWLEDGE_COLOURS,
  KNOWLEDGE_HEX,
  isKnowledgeColor,
  shadeFor,
} from './knowledgeColour'
import themeCss from '../styles/theme.css?raw'

describe('the colours a note may carry', () => {
  it('offers a neutral plus five shades', () => {
    // Il neutro non e' decorativo: e' quello che ha una nota di cui l'utente non ha
    // scelto il colore, ed e' lo stato in cui stanno **tutte** le note gia' salvate, perche'
    // la colonna e' stata aggiunta a un archivio che ne aveva gia' dentro. Se il neutro non
    // ci fosse, si aprirebbero tutte senza colore e sembrerebbe un difetto.
    expect(KNOWLEDGE_COLOURS[0]).toBe('default')
    expect(KNOWLEDGE_COLOURS).toHaveLength(6)
  })

  it('gives every shade a name, because a colour you cannot name is not a choice', () => {
    // Due tinte vicine non si distinguono a colpo d'occhio, e una scelta che non si vede
    // non e' una scelta: il nome e' quello che rende la pastiglia leggibile.
    for (const colour of KNOWLEDGE_COLOURS) {
      expect(KNOWLEDGE_COLOUR_NAMES[colour]).toBeTruthy()
    }
  })

  it('falls back to the neutral when nothing was chosen', () => {
    // `shadeFor` prende il neutro come parametro e non come costante perche' la mappa ha un
    // proprio neutro, caldo, che sta bene su fondo scuro e non e' nessuna delle tinte.
    expect(shadeFor('default', 0xf3ede0)).toBe(0xf3ede0)
    expect(shadeFor('rose', 0xf3ede0)).toBe(KNOWLEDGE_HEX.rose)
  })

  it('refuses a colour that is not ours, so nothing from a file reaches a sphere', () => {
    // La guardia c'e' perche' il valore puo' arrivare da un archivio importato. Una stringa
    // qualsiasi finirebbe dentro il colore di un oggetto di `three`, e nessuno se ne
    // accorgerebbe: si vedrebbe una pallina di un colore strano, senza spiegazione.
    expect(isKnowledgeColor('rose')).toBe(true)
    expect(isKnowledgeColor('default')).toBe(true)
    expect(isKnowledgeColor('chucknorris')).toBe(false)
    expect(isKnowledgeColor(undefined)).toBe(false)
    expect(isKnowledgeColor(42)).toBe(false)
  })
})

/**
 * The value of `--group-color` inside **one named rule**, and nothing else.
 *
 * Questo helper e' il punto in cui il test era debole, ed e' stato scritto dopo averlo
 * verificato: la prima versione cercava il colore in tutto il foglio e passava anche
 * quando una sola regola era stata cambiata, perche' le altre due riportavano lo stesso
 * numero. E cioe' passava **proprio** sul difetto che diceva di prevenire — cambiare una
 * pastiglia e lasciare indietro la cornice, che e' la divergenza piu' economica da fare e
 * l'unica che non si vede.
 *
 * Quindi qui si estrae il blocco di un selettore e si legge il valore **dentro** quel
 * blocco. Se il selettore non c'e' si fallisce esplicitamente, perche' una regola sparita
 * e' il caso peggiore: una pastiglia che esiste e non ha tinta sembra voluta.
 */
function colourIn(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rule = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(themeCss)
  if (!rule) return null
  const value = /--group-color:\s*([^;]+);/.exec(rule[1] ?? '')
  return value?.[1]?.trim() ?? null
}

describe('the palette and the stylesheets agree', () => {
  const shades = KNOWLEDGE_COLOURS.filter((c) => c !== 'default')

  for (const shade of shades) {
    it(`keeps "${shade}" the same shade in every rule that uses it`, () => {
      const hex = KNOWLEDGE_CSS_HEX[shade]
      // Ogni regola che dichiara questa tinta, una per una. Non «da qualche parte nel
      // foglio»: **in ciascuna**, che e' l'unico modo che distingue un archivio allineato da
      // uno allineato per tre quarti.
      expect(colourIn(`.knowledge-swatch-${shade}`)).toBe(hex)
      expect(colourIn(`.group-swatch-${shade}`)).toBe(hex)
      expect(colourIn(`.group-frame.group-${shade}`)).toBe(hex)
    })
  }

  it('keeps the light-theme overrides in step too', () => {
    /*
     * Il tema chiaro ha i suoi numeri — gli stessi sono troppo tenui su fondo chiaro — e
     * sono una **copia** di quelli scuri. Quindi sono il posto dove la divergenza si
     * nasconde piu' facilmente, perche' sono gia' diversi e non si nota che lo siano due
     * volte.
     */
    expect(colourIn(`:root[data-theme='light'] .knowledge-swatch-amber`)).toBe('#c98a08')
    expect(colourIn(`:root[data-theme='light'] .group-swatch-amber`)).toBe('#c98a08')
  })
})
