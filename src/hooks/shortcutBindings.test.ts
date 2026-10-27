/**
 * Un tasto, una azione.
 *
 * Il difetto che questo file chiude e' che `Ctrl+K` era legato in **due** gestori
 * diversi: quello della tastiera apriva la palette dei nodi, quello globale apriva la
 * ricerca. Una pressione sola, due `keydown` handler, due finestre aperte insieme — la
 * ricerca sopra e la palette sotto.
 *
 * E' il caso peggiore di una scorciatoia duplicata, perche' non sembra un difetto: la
 * ricerca c'e', funziona, e si vede. Ma l'utente non sa quale delle due finestre
 * stia guardando, e **quella sotto ruba i tasti a quella sopra** — quindi la ricerca
 * sembra a tratti non rispondere, senza che nulla dia l'errore.
 *
 * Il controllo e' sui sorgenti, non sul comportamento, perche' il comportamento
 * richiederebbe due finestre aperte contemporaneamente e un simulatore di tastiera che
 * metta in fila due handler. Leggere il codice e' l'unico modo per dire «questa
 * chiave e' legata qui e **non** li'» — che e' esattamente la domanda da porsi.
 */

import { describe, expect, it } from 'vitest'
import globalShortcuts from './useGlobalShortcuts.ts?raw'
import shortcuts from './useKeyboardShortcuts.ts?raw'
import settingsDialog from '../components/shell/SettingsDialog.tsx?raw'
import topBar from '../components/shell/TopBar.tsx?raw'

/**
 * Il sorgente con i commenti tolti.
 *
 * Necessario perche' questi file sono commentati in italiano e i commenti contengono
 * `{`, `}` e parole che somigliano codice. Senza toglierli, un commento che scrive
 * `ui.openPalette()` verrebbe letto come una chiamata e il test passerebbe perche' ha
 * trovato una parola in un commento — cioe' per il motivo sbagliato, che e' il modo
 * peggiore in cui un test puo' passare. Il difetto che questi test proteggono e' una
 * **dichiarazione** nel punto sbagliato, quindi la lettura deve essere incapace di
 * confondersi con un testo.
 */
const code = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '')

/** Il corpo di un ramo `if`, dalla graffa alla sua chiusura, senza i commenti. */
function branch(source: string, condition: string): string {
  const text = code(source)
  const at = text.indexOf(condition)
  if (at < 0) return ''
  const open = text.indexOf('{', at)
  if (open < 0) return ''
  let depth = 0
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1
    else if (text[index] === '}') {
      depth -= 1
      if (depth === 0) return text.slice(open + 1, index)
    }
  }
  return ''
}

describe('Ctrl+K is bound to exactly one thing', () => {
  it('is handled once, in the workspace shortcuts only', () => {
    /*
     * La ricerca sta in `useKeyboardShortcuts`, non in quello globale, e il motivo non
     * e'che sia piu' comodo: e' che la ricerca cerca parole **del grafo**, quindi
     * sulla Home non ha niente da cercare. Gestirla a livello di finestra la
     * aprirebbe anche li', con una lista di risultati vuota che sembrerebbe un errore.
     */
    const workspaceHandler = /mod && event\.key\.toLowerCase\(\) === 'k'/.test(shortcuts)
    expect(workspaceHandler, 'Ctrl+K should be handled in useKeyboardShortcuts').toBe(true)
    // E non anche globalmente: due gestori per la stessa chiave sono il difetto.
    expect(code(globalShortcuts), 'Ctrl+K must not also be handled globally').not.toMatch(
      /toLowerCase\(\) === 'k'/,
    )
  })

  it('opens the search, and closes it when already open', () => {
    // Scritto come `if/else` e non come ternario: la forma non conta, il conteggio
    // delle azioni sì. Chiude quando è già aperta, altrimenti una seconda pressione
    // azzererebbe la casella mentre l'utente sta ancora scrivendo la parola.
    const body = branch(shortcuts, "event.key.toLowerCase() === 'k'")
    expect(body, 'Ctrl+K branch not found').toContain('openSearch()')
    expect(body, 'Ctrl+K must close the search when it is already open').toContain('closeSearch()')
    expect(body).toMatch(/if\s*\(\s*ui\.searchOpen\s*\)/)
  })

  it('does not open the node palette', () => {
    // La palette si apre con Tab, che le resta naturale: Tab aggiunge, Ctrl+K cerca.
    // Sono due azioni diverse e si confondono, quindi due tasti diversi.
    expect(branch(shortcuts, "event.key.toLowerCase() === 'k'")).not.toContain('openPalette')
    // E Tab la apre ancora.
    expect(branch(shortcuts, "event.key === 'Tab'")).toContain('ui.openPalette()')
  })

  it('stops Tab from opening the palette over the search', () => {
    /*
     * Il secondo strato dello stesso difetto, trovato provando nel browser dopo aver
     * sistemato `Ctrl+K`.
     *
     * `Tab` non e' un tasto con modificatore, quindi non c'e' nessun `preventDefault`
     * che lo fermi: arriva e apre la palette **sopra** la ricerca gia' aperta. Due
     * finestre, e quella sotto si mangia i tasti — quindi la ricerca sembra a tratti
     * non rispondere, senza che nulla dia l'errore.
     *
     * Spostare `Ctrl+K` dalla palette aveva spostato il problema invece di risolverlo,
     * e il controllo serve a impedire che torni.
     */
    const body = branch(shortcuts, "event.key === 'Tab'")
    expect(body, 'Tab branch not found').toContain('ui.openPalette()')
    // Il controllo c'e', e viene **prima** di aprire.
    expect(body).toMatch(/if\s*\(\s*ui\.searchOpen[\s\S]*?\)\s*return/)
    expect(body.indexOf('searchOpen')).toBeLessThan(body.indexOf('openPalette'))
  })

  it('is listed in the shortcuts help as the search, not the palette', () => {
    // La lista dei tasti e' l'unico posto dove l'utente scopre cosa esiste. Se dice
    // «Ctrl K apre la palette», gli insegna una cosa falsa e la scorciatoia giusta
    // resta invisibile.
    expect(settingsDialog).toMatch(/keys="Ctrl K" action="Search words in this workspace"/)
    expect(settingsDialog).not.toMatch(/Tab \/ Ctrl K/)
    expect(settingsDialog).toMatch(/keys="Tab" action="Open node palette"/)
  })

  it('is offered in the More menu as the search', () => {
    // Anche nel menu, per chi non preme scorciatoie: una scorciatoia che non si
    // conosce non esiste, e il menu e' il posto dove si scopre cosa c'e'.
    expect(topBar).toMatch(/Search this workspace/)
    expect(topBar).toMatch(/openSearch\(\)/)
  })
})
