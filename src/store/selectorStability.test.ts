/**
 * I selettori di Zustand devono restituire valori **stabili**.
 *
 * Questo file esiste perche' un selettore che restituisce un array nuovo a ogni
 * lettura **fa morire l'applicazione all'avvio**, e nessun test lo aveva preso.
 *
 * Il meccanismo: Zustand chiama `getSnapshot` a ogni render e confronta il risultato
 * con quello precedente per decidere se ridisegnare. Il confronto e' per identita'. Un
 * selettore come
 *
 *     useWorkspaceStore((state) => state.nodes.filter((n) => n.selected).map((n) => n.id))
 *
 * produce un array **nuovo** a ogni chiamata, quindi lo snapshot e' sempre diverso,
 * quindi il componente si aggiorna, quindi il selettore viene chiamato di nuovo — e il
 * ciclo non finisce. React chiama `getSnapshot` durante il render perche' deve poter
 * controllare se il valore e' cambiato, e un selettore impuro lo costringe a farlo in
 * un punto in cui non puo' restituirne uno calcolato senza effetti.
 *
 * Il risultato in pratica: `Maximum update depth exceeded`, la tela non si monta, e
 * l'utente vede una pagina vuota. Senza un errore di rete, senza un messaggio, senza
 * niente che dica che il programma e partito e si e' rotto. E il peggio e' che
 * funziona in quasi tutti i test, perche' i test non rileggono lo stato dal vivo come
 * fa un browser.
 *
 * La regola e' semplice: **una stringa, un numero, un booleano, o un valore gia'
 * presente nello stato.** Se serve un array o un oggetto, si deriva dopo, con
 * `useMemo` sulla firma.
 */

// @ts-expect-error - Node's types are not in this file's tsconfig, and this test only runs
// under the test runner, which has them.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
import * as fs from 'fs'
// @ts-expect-error - as above
import * as path from 'path'
import { describe, expect, it } from 'vitest'

/** Runs a zustand selector the way the store does, and reports what it gave back. */
function readSelector<T>(
  selector: (state: { nodes: Array<{ id: string; selected: boolean }> }) => T,
  state: { nodes: Array<{ id: string; selected: boolean }> },
): T {
  return selector(state)
}

const state = {
  nodes: [
    { id: 'a', selected: true },
    { id: 'b', selected: false },
    { id: 'c', selected: true },
  ],
}

describe('a selector that does not break the app on load', () => {
  it('gives the same string twice, so the snapshot is stable', () => {
    // Il pattern corretto: si sottoscrive a una **stringa**, che si confronta per
    // valore. Due letture consecutive danno lo stesso identico, quindi Zustand vede
    // che niente e' cambiato e il ciclo si chiude.
    const selector = (s: typeof state): string =>
      s.nodes.filter((node) => node.selected).map((node) => node.id).join(' ')
    const first = readSelector(selector, state)
    const second = readSelector(selector, state)
    expect(second).toBe(first)
    expect(typeof first).toBe('string')
  })

  it('gives a new array every time, which is the bug', () => {
    /*
     * Questo non e' un test che fallisce: e' il difetto **documentato e verificato**.
     * Serve a tenere sotto gli occhi la forma sbagliata, perche' e 自然issima da
     * scrivere e sembra innocua: restituisce esattamente i dati giusti, solo che non
     * smette mai di aggiornare.
     */
    const selector = (s: typeof state): string[] =>
      s.nodes.filter((node) => node.selected).map((node) => node.id)
    const first = readSelector(selector, state)
    const second = readSelector(selector, state)
    // Contenuto identico...
    expect(second).toEqual(first)
    // ...ma due array distinti: e' questo, e non il contenuto, che fa andare in loop
    // il rendering.
    expect(second).not.toBe(first)
  })

  it('round-trips the signature back to the ids it stands for', () => {
    // La stringa non e' un trucco: e' la firma, e da lei si ricostruisce esattamente
    // la lista che serve. Il separatore e uno spazio, che un id generato non contiene.
    const signature = state.nodes.filter((n) => n.selected).map((n) => n.id).join(' ')
    expect(signature.split(' ')).toEqual(['a', 'c'])
  })

  it('gives an empty list for an empty selection, not a string with a stray space', () => {
    const nothing = { nodes: [] as Array<{ id: string; selected: boolean }> }
    const signature = readSelector((s) => s.nodes.filter((n) => n.selected).map((n) => n.id).join(' '), nothing)
    expect(signature).toBe('')
    expect(signature ? signature.split(' ') : []).toEqual([])
  })
})

/**
 * Un selettore che costruisce un oggetto: il difetto che lascia la pagina **bianca**.
 *
 * Il test qui sopra spiega il principio con due selettori fatti a mano. Questo controlla che
 * nessun componente ci cada dentro per sbaglio, e serve perche' e' gia' successo — non in
 * teoria: `ResponseKnowledge` passava `workspaceDocumentFromState` direttamente come
 * selettore, quella funzione costruisce un oggetto nuovo a ogni chiamata, React ha continuato
 * a considerare il componente cambiato per sempre, e il sintomo e' stato uno schermo vuoto con
 * un solo messaggio in console:
 *
 * `Warning: The result of getSnapshot should be cached to avoid an infinite loop`
 *
 * Il tipo del documento restituito e' corretto, il selettore e' una funzione che rispetta la
 * firma di Zustand, e il typecheck passa: nessuno dei tre potrebbe intercettarlo. Solo guardando
 * la forma del codice si vede, e quindi e' una forma che va guardata automaticamente.
 *
 * La regola e' stretta per scelta: si vieta **quel** selettore, non tutti quelli che derivano
 * un valore. Un selettore che calcola `state.nodes.filter(...)` e' instabile come oggetto ma
 * `useShallow` lo rende accettabile, e quel caso giusto gia' esiste nell'applicazione. Vietare
 * la derivazione in generale renderebbe questo test un rumore che si impara a saltare.
 */
describe('the components do not use a selector that builds a new object', () => {
  it('finds nothing that passes a document builder straight to a store hook', () => {
    const dir = new URL('../components/', import.meta.url).pathname.replace(/^\//, '')
    const files: string[] = []
    // Il parametro si chiama `dir` e non `path` perche' `path` e' il modulo: con lo stesso
    // nome, `path.join` diventerebbe `string.join` e il typecheck lo segnalerebbe — ma e'
    // il typecheck che renderebbe inutile il test, quindi il nome giusto lo rende inutile
    // due volte.
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry.name)) files.push(full)
      }
    }
    if (!fs.existsSync(dir)) return
    walk(dir)

    const offenders: string[] = []
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8')
      // `useWorkspaceStore(workspaceDocumentFromState)` e le sue varianti con spazi.
      if (/use\w*Store\(\s*workspaceDocumentFromState\s*[),]/.test(source)) {
        offenders.push(file)
      }
    }
    expect(
      offenders,
      'A component passes a function that builds a new object as a store selector. Zustand ' +
        'sees a different value every render and React never stops re-rendering. Read ' +
        "`state.nodes` and `state.edges` instead — they are the store's own arrays — and do " +
        'the deriving inside a useMemo.',
    ).toEqual([])
  })
})