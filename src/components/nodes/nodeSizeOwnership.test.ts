/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'
import theme from '../../styles/theme.css?raw'
import promptNode from './PromptNode.tsx?raw'
import responseNode from './ResponseNode.tsx?raw'
import nodeShell from './NodeShell.tsx?raw'
import useNodeData from '../../hooks/useNodeData.ts?raw'

/**
 * `has-explicit-size`, e il difetto che quella classe nascondeva.
 *
 * La classe doveva dire «l'utente ha ridimensionato questo nodo a mano», e cosi
 * faceva: se il nodo aveva una dimensione salvata, il corpo della risposta
 * smetteva di scorrere e la casella di scrittura smetteva di crescere col testo.
 *
 * Ma dieci componenti calcolavano la cosa da `Boolean(width ?? height)` prese dalle
 * **props di React Flow**, che sono le misure del nodo e ci sono **sempre**. Quindi
 * la classe era su tutti i nodi, in ogni momento, e di conseguenza:
 *
 * - la casella del prompt non cresceva piu con il testo: restava alta quanto il
 *   nodo e scorreva. «Quando scrivo, voglio che il nodo si allarghi» — e non lo faceva;
 * - il corpo della risposta perdeva il suo tetto di altezza.
 *
 * La prova che blocca il ritorno e sul **luogo** del calcolo, non sul risultato: un
 * test che guardasse solo «il nodo non ha la classe» passerebbe anche scrivendo
 * `Boolean(width ?? height)` e rimanendo al contrario, perche in un test non ci sono
 * nodi React Flow da misurare.
 */

/** `node.width` / `node.height` esistono solo se l'utente ha ridimensionato. */
const ESPLICITO_DAL_DOCUMENTO = 'node?.width !== undefined || node?.height !== undefined'

describe('la dimensione esplicita di un nodo', () => {
  it('si legge dal documento, non dalle misure di React Flow', () => {
    // Il punto. Le misure di React Flow ci sono sempre, quindi usarle rende la
    // classe sempre vera e le due regole che dipendono da lei sempre attive.
    expect(useNodeData).toContain(ESPLICITO_DAL_DOCUMENTO)
  })

  it('nessun nodo lo ricalcola per conto suo', () => {
    // Dieci componenti che calcolano la stessa cosa sono dieci occasioni di
    // sbagliare di nuovo, e una di loro ha gia sbagliato.
    for (const [nome, sorgente] of [
      ['PromptNode', promptNode],
      ['ResponseNode', responseNode],
    ] as const) {
      expect(sorgente, nome).not.toMatch(/Boolean\(width \?\? height\)/)
      expect(sorgente, nome).toContain('useNodeHasExplicitSize')
    }
  })

  it('la casella del prompt decide con quella, e non con una altezza', () => {
    // Il difetto era anche qui: `Boolean(height)` sulla props di React Flow era
    // sempre vero, e il ramo «allunga col testo» non veniva mai preso.
    expect(promptNode).toContain('if (hasExplicitSize) {')
    expect(promptNode).not.toMatch(/Boolean\(height\)/)
  })

  it('NodeShell mette la classe del tipo, cosi il CSS può puntare a un tipo', () => {
    // Senza questo, una regola che vuole dire «solo i nodi risposta» non puo
    // scriversi: la classe non esisteva per nove tipi su undici.
    expect(nodeShell).toMatch(/\$\{nodeKind\}-node/)
  })
})

describe('come crescono i corpi', () => {
  it('la risposta cresce in verticale, e la larghezza e solo un tetto di leggibilita', () => {
    /*
     * «Non voglio vederlo troppo lungo in una direzione, preferisco che sia piu
     * lungo in verticale.»
     *
     * Quindi i due numeri hanno due ruoli diversi, e la prova li distingue per
     * ruolo invece di confrontarli fra loro: l'altezza e un tetto di **crescita** —
     * quanto in alto il nodo puo arrivare, e deve essere generoso, perche e la
     * direzione che l'utente ha chiesto. La larghezza e un tetto di **leggibilita**
     * — oltre quella, una riga e troppo lunga e l'occhio perde il ritorno a inizio
     * riga — e non dice nulla su quanto il nodo diventa grande.
     *
     * Non si pretende che l'altezza sia maggiore della larghezza: non e un requisito,
     * e scriverlo sarebbe un numero inventato a dare un'obiezione finta.
     */
    const altezza = Number(theme.match(/\.response-body \{[\s\S]*?max-height:\s*(\d+)px/)?.[1])
    const larghezza = Number(
      theme.match(/\.response-node:not\(\.has-explicit-size\) \.response-body \{[\s\S]*?max-width:\s*(\d+)px/)?.[1],
    )
    // Tetto di crescita generoso: almeno venti righe di risposta.
    expect(altezza, 'il tetto di altezza non e stato letto').toBeGreaterThanOrEqual(500)
    // Tetto di leggibilita: una riga che si puo seguire, non un foglio.
    expect(larghezza, 'il tetto di larghezza non e stato letto').toBeGreaterThanOrEqual(400)
    expect(larghezza, 'una riga oltre questo non e piu leggibile').toBeLessThanOrEqual(700)
  })

  it('il tetto di larghezza vale solo per chi non ha ridimensionato il nodo', () => {
    // Chi allarga un nodo a mano ha gia deciso quanto lo vuole largo. Limitare
    // anche quello nasconderebbe il testo che ha chiesto di vedere, e romperebbe
    // il ridimensionamento, che e una funzionalita e non una preferenza.
    expect(theme).toMatch(/\.response-node:not\(\.has-explicit-size\)/)
    // E il nodo ridimensionato a mano torna libero su entrambi gli assi.
    expect(theme).toMatch(/\.has-explicit-size \.response-body \{[\s\S]*?max-height: none;[\s\S]*?max-width: none;/)
  })

  it('il corpo della risposta scorre, e non trascina il quadro con se', () => {
    // `overscroll-behavior: contain` serve per questo: senza, arrivare in fondo al
    // testo fa scorrere anche la pagina sotto, che in un quadro a schermo pieno
    // sposta tutto quello che c'e intorno.
    expect(theme).toMatch(/\.response-body \{[\s\S]*?overflow-y: auto;[\s\S]*?overscroll-behavior: contain;/)
  })
})
