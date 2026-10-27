/**
 * Un bottone che sembra cliccabile e non lo e' e' il difetto peggiore che un
 * aspetto puo' avere.
 *
 * Non e' un difetto di colore: e' un difetto che l'utente non ha modo di
 * diagnosticare. Un bottone che non risponde e' identico, a occhio, da un'applicazione
 * rotta, e l'unica cosa che vede e' che il colore passa e la freccia si muove. Non
 * c'e' nessun messaggio di errore, nessun log, nessun cosa-che-non-va: solo un
 * pulsante che sembra funzionare.
 *
 * Questo difetto e' gia' successo in questo progetto, e il meccanismo e' noto:
 * `z-index: 120` significa "sono sopra tutto", ma quei 120 valgono **dentro** il
 * contesto di impilamento che contiene l'elemento. Se quel contesto perde, il menu
 * va sotto e i pulsanti diventano trasparenti al puntatore — invariati colore,
 * posizione e aspetto. Il fix e' stato togliere uno `z-index`, non alzare l'altro.
 *
 * Percio' questi test leggono i fogli di stile per veri e impongono la regola che
 * rende il problema **impossibile** invece che improbabile:
 *
 *   un aspetto puo' cambiare colori, bordi, raggi, ombre e font.
 *   un aspetto non puo' dichiarare `z-index` ne' `pointer-events`.
 *
 * Non e' una restrizione stilistica: `z-index` crea contesti di impilamento e
 * `pointer-events` spegne l'input. Sono le due uniche dichiarazioni con cui un foglio
 * di stile puo' rendere un controllo irraggiungibile senza che nulla sembri rotto.
 * Vietarle in tutti e sei gli aspetti e' piu' forte di provarli a uno alla volta, e
 * costa meno.
 */

import { describe, expect, it } from 'vitest'
import { APPEARANCES } from '../types/settings'
import asciiCss from './look-ascii.css?raw'
import claudeCss from './look-claude.css?raw'
import googleCss from './look-google.css?raw'
import minimalCss from './look-minimal.css?raw'
import glassCss from './glass.css?raw'
import themeCss from './theme.css?raw'
import tokensCss from './tokens.css?raw'
import v2Css from './v2.css?raw'

/** Il CSS di ogni aspetto, accanto al suo id. */
const LOOK_SHEETS: Array<[string, string]> = [
  ['glass', glassCss],
  ['google', googleCss],
  ['claude', claudeCss],
  ['ascii', asciiCss],
  ['minimal', minimalCss],
]

/**
 * Every declaration in a sheet, with the selector it belongs to.
 *
 * I fogli di questo progetto sono commentati in italiano e molti commenti contengono
 * `{`, `}` o due punti. Senza toglierli, un commento che scrive `z-index: 1` verrebbe
 * letto come una dichiarazione e il test passerebbe perche' ha trovato una parola in
 * un commento — cioe' passerebbe per il motivo sbagliato, che e' il modo peggiore in
 * cui un test puo' passare. Il difetto che questi test proteggono e' proprio una
 * dichiarazione scritta dove non deve, quindi la lettura deve essere incapace di
 * confondersi con un testo.
 */
function rules(css: string): Array<{ selector: string; body: string }> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: (match[1] ?? '').trim().replace(/\s+/g, ' '),
    body: match[2] ?? '',
  }))
}

/** Whether a selector is a decorative pseudo-element, which holds no controls. */
function isDecoration(selector: string): boolean {
  return /::(before|after)\b/.test(selector)
}

/**
 * Where a look declares a property, on anything that is not decoration.
 *
 * `pointer-events: none` e `z-index` su uno **pseudo-elemento decorativo** sono
 * corretti e necessari: la macchia colorata dietro al vetro non deve poter
 * intercettare un clic, e senza `z-index: 0` finirebbe sopra il contenuto. Vietarli
 * anche li' avrebbe spinto a toglierli da li' — e la macchia avrebbe iniziato a
 * mangiare i clic, che e' esattamente il difetto che questi test vietano.
 *
 * Quindi il divieto e' sui selettori **veri**: un elemento che contiene un controllo
 * non puo' dichiarare nessuna delle due, perche' non ha modo di sapere se lo
 * contiene. Il caso reale — `z-index: 1` su `.app-main`, che contiene il menu dei
 * Settings — e' di quelli, ed e' per questo che viene preso.
 */
function declaredOutsideDecoration(css: string, property: string): string[] {
  return rules(css)
    .filter((rule) => !isDecoration(rule.selector))
    .flatMap((rule) =>
      rule.body
        .split(';')
        .map((declaration) => declaration.trim())
        .filter((declaration) => declaration.toLowerCase().startsWith(`${property}:`))
        .map((declaration) => `${rule.selector} { ${declaration} }`),
    )
}

describe('every look leaves the controls reachable', () => {
  it('declares no z-index on a real element, in any look', () => {
    /*
     * `z-index` non e' proibito per principio: e' uno strumento giusto. E' proibito
     * **in un aspetto**, perche' un aspetto e' una scelta di aspetto e non un layout.
     * Se serve un `z-index` per far funzionare un pannello, il difetto e' nel layout di
     * base, e sistemarlo li' e' l'unica cosa che non lascia un altro aspetto con lo
     * stesso difetto.
     */
    for (const [id, css] of LOOK_SHEETS) {
      expect(
        declaredOutsideDecoration(css, 'z-index'),
        `the ${id} look declares z-index on a real element`,
      ).toEqual([])
    }
  })

  it('declares no pointer-events on a real element, in any look', () => {
    for (const [id, css] of LOOK_SHEETS) {
      expect(
        declaredOutsideDecoration(css, 'pointer-events'),
        `the ${id} look declares pointer-events on a real element`,
      ).toEqual([])
    }
  })

  it('lets the decorative blur layer ignore the pointer, in the glass look', () => {
    /*
     * Il contrario della regola sopra, e va verificato perche' la correzione sbagliata
     * a questa riga e' naturale: togliere `pointer-events: none` dalla macchia per
     * far passare il test precedente. Funzionerebbe, e la macchia inizierebbe a
     * mangiare i clic su tutto quello che c'e' sotto — cioe' il difetto che questi
     * test esistono per impedire, introdotto dal test che li doveva impedire.
     *
     * Il vetro e' l'unico aspetto con una macchia, quindi e' l'unico che ha questa
     * regola, ed e' l'unico che va controllato.
     */
    const blob = rules(glassCss).find((rule) =>
      /app-shell::before/.test(rule.selector),
    )
    expect(blob, 'the glass look should still have its blur layer').toBeDefined()
    expect(blob?.body).toMatch(/pointer-events:\s*none/)
  })

  it('never hides something with visibility or display', () => {
    /*
     * Anche questi due rendono qualcosa irraggiungibile, e con un effetto peggiore di
     * `z-index`: non solo il puntatore, ma la tastiera. Un controllo con
     * `visibility: hidden` sparisce dal flusso di tabulazione, quindi un utente che
     * naviga da tastiera non ci arriva e non sa che esiste.
     *
     * Il caso reale e' gia' successo: `.node-body { display: none }` su un nodo
     * compresso nascondeva le maniglie di connessione, che sono figli del corpo. Il
     * nodo compresso non si poteva ricollagare. La correzione e' stata
     * `visibility: hidden` piu' altezza zero, che lasciano la maniglia fuori.
     *
     * Qui la regola e' che un aspetto non **imposta** queste due proprieta' con un
     * valore che nasconde. Non e' vietato **annullarle`: un aspetto come il terminale
     * potrebbe volerlo, e annullare un valore che nasconde non nasconde niente.
     */
    for (const [id, css] of LOOK_SHEETS) {
      const hiding = rules(css)
        .flatMap((rule) =>
          rule.body
            .split(';')
            .map((declaration) => declaration.trim().toLowerCase())
            .filter(
              (declaration) =>
                /^display:\s*none\s*$/.test(declaration) ||
                /^visibility:\s*hidden\s*$/.test(declaration),
            )
            .map((declaration) => `${rule.selector} { ${declaration} }`),
        )
      expect(hiding, `the ${id} look hides something`).toEqual([])
    }
  })

  it('keeps the handle of a collapsed node visible, in every look', () => {
    /*
     * Il difetto dei nodi compressi, verificato sul CSS di ogni aspetto. Le maniglie
     * sono figli di `.node-body`, e se un aspetto nasconde il corpo le maniglie
     * spariscono: il nodo compresso non si puo' piu' ricollagare, e non si vede perche'
     * — sembra solo che il collegamento non funzioni.
     */
    for (const [id, css] of LOOK_SHEETS) {
      const collapsed = rules(css).filter((rule) =>
        /node-shell\.is-collapsed/.test(rule.selector),
      )
      for (const rule of collapsed) {
        expect(rule.body, `the ${id} look hides a collapsed node body`).not.toMatch(
          /display:\s*none/,
        )
      }
    }
  })
})

describe('the shape is a token, so a look can change all of it at once', () => {
  it('writes no bare pixel radius outside the tokens', () => {
    /*
     * Il difetto che questo chiude: ogni foglio di aspetto elencava i pannelli a cui
     * cambiare il raggio, e l'elenco si era gia' dimenticato `.home-empty`. Il
     * risultato era una pagina iniziale con gli angoli dell'aspetto di default
     * accanto a sette angoli Material — e non un errore, solo una cosa che sembrava
     * caricata a meta'.
     *
     * Adesso ogni raggio e' `var(--r-*, <il suo valore>)`, e un aspetto definisce tre
     * numeri. Un raggio scritto a mano sfugge a questo e torna a essere l'eccezione
     * che non segue l'aspetto, quindi qui si cerca e si segnala.
     *
     * I valori in percentuale sono fuori: sono i manigli rotondi di React Flow, e un
     * aspetto che li volesse quadrati li tratterebbe con una regola propria, che
     * `look-ascii.css` fa gia' esplicitamente.
     */
    for (const [name, css] of [
      ['theme.css', themeCss],
      ['v2.css', v2Css],
    ] as const) {
      const bare = [...rules(css)]
        .flatMap((rule) =>
          rule.body
            .split(';')
            .map((declaration) => declaration.trim())
            .filter(
              (declaration) =>
                /^border-radius:\s*[0-9.]+px\s*$/.test(declaration) &&
                !declaration.includes('var('),
            )
            .map((declaration) => `${rule.selector} { ${declaration} }`),
        )
      expect(bare, `${name} has a hardcoded radius`).toEqual([])
    }
  })

  it('gives every site its old value as the fallback, so the default look is unchanged', () => {
    /*
     * Il punto dei valori di riserva: `var(--r-panel, 14px)` deve dire `14px` li'
     * dove c'era `14px`. Se la riserva sbaglia, l'aspetto di default cambia di una
     * virgola — e nessuno se ne accorge, perche' un raggio di qualche pixel di
     * differenza non e' un difetto che si nota guardando.
     *
     * Il confronto e' con quello scritto qui, e non con una copia di `theme.css`:
     * una copia passerebbe anche se qualcuno avesse cambiato entrambe.
     */
    const expected = new Map<string, number>([
      ['var(--r-pill, 999px)', 999],
      ['var(--r-panel, 16px)', 16],
      ['var(--r-panel, 15px)', 15],
      ['var(--r-panel, 14px)', 14],
      ['var(--r-panel, 13px)', 13],
      ['var(--r-panel, 12px)', 12],
      ['var(--r-panel, 11px)', 11],
      ['var(--r-panel, 10px)', 10],
      ['var(--r-field, 9px)', 9],
      ['var(--r-field, 8px)', 8],
    ])
    const everywhere = [...rules(themeCss), ...rules(v2Css)]
    for (const [declaration, px] of expected) {
      expect(
        everywhere.some((rule) => rule.body.includes(declaration)),
        `no site still uses ${declaration}`,
      ).toBe(true)
      // La riserva contiene il numero che il nome del gruppo non porta con se'.
      expect(declaration).toContain(`${px}px`)
    }
  })

  it('leaves the three names undefined by default, so every fallback applies', () => {
    /*
     * Se `:root` definisse `--r-panel: 14px`, tutte le riserve diventerebbero codice
     * morto e ogni pannello — anche quelli a 16px e 8px — finirebbe a 14px. Il
     * default cambierebbe, in silenzio, e un aspetto che non definisce i nomi
     * sembrerebbe funzionare mentre non sta facendo niente.
     *
     * Quindi i tre nomi si definiscono **solo** dentro un aspetto. Qui non devono
     * esserci — in nessuna regola, non solo in `:root`, perche' basta una regola
     * qualsiasi a riaprire il problema che i token avrebbero dovuto chiudere.
     */
    for (const token of ['--r-panel', '--r-field', '--r-pill']) {
      const declared = [...rules(tokensCss)]
        .flatMap((rule) => [...rule.body.matchAll(new RegExp(`${token}\\s*:`, 'g'))]
          .map((match) => `${rule.selector} { ${match[0]} }`))
      expect(declared, `tokens.css must not set ${token} by default`).toEqual([])
    }
  })

  it('has every look set all three, or none at all', () => {
    /*
     * Un aspetto che ne definisce due lascia il terzo in riserva, e si ritrova con la
     * forma dell'aspetto di default su una parte dell'interfaccia. Peggio: se il terzo
     * e' quello dei pulsanti, i pulsanti non cambiano e sembra che l'aspetto non
     * faccia niente.
     */
    for (const [id, css] of LOOK_SHEETS) {
      const declared = new Set(
        [...rules(css)]
          .flatMap((rule) => [...rule.body.matchAll(/(--r-(?:panel|field|pill))\s*:/g)])
          .map((match) => match[1]),
      )
      // Il vetro non usa i tre token: ha il suo `--glass-radius`, dichiarato li' e
      // applicato ai pannelli che elenca. E' l'unica eccezione, e viene detta.
      if (id === 'glass') {
        expect(css, 'the glass look should use its own radius token').toContain(
          '--glass-radius',
        )
        continue
      }
      expect([...declared].sort(), `the ${id} look sets only some radii`).toEqual([
        '--r-field',
        '--r-panel',
        '--r-pill',
      ])
    }
  })
})

describe('every look has a sheet, and every sheet has a look', () => {
  it('has a stylesheet for each look that the settings offers', () => {
    /*
     * Le due liste possono divergere ed e' gia' successo: il tipo e la tendina
     * conoscevano sei aspetti e il validatore del caricamento ne accettava due,
     * quindi la scelta si perdeva al primo ricaricamento **senza avviso**.
     *
     * Il collegamento si verifica sui nomi, non sui numeri: un foglio chiamato
     * `look-goole.css` non verrebbe notato da un confronto di cardinalita'.
     */
    const sheets = LOOK_SHEETS.map(([id]) => id)
    for (const look of APPEARANCES) {
      /*
       * `default` non ha un foglio suo e non ne ha bisogno: e' l'aspetto di partenza,
       * definito dai fogli base. E' l'unica eccezione, ed e' dichiarata qui per nome,
       * perche' un'eccezione implicita e' un'eccezione che il prossimo non vede.
       */
      if (look.id === 'default') continue
      expect(sheets, `no stylesheet for the ${look.id} look`).toContain(look.id)
    }
  })

  it('keys each sheet on the appearance it draws, so two looks cannot both apply', () => {
    // Ogni foglio vive su `:root[data-appearance='<id>']`. Se uno non lo facesse,
    // le sue regole entrerebbero anche con un altro aspetto attivo, e si vedrebbe un
    // misto di due — peggio di nessuno dei due.
    for (const [id, css] of LOOK_SHEETS) {
      const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
      expect(withoutComments, `the ${id} sheet is not scoped`).toContain(
        `[data-appearance='${id}']`,
      )
    }
  })

  it('draws every look in both themes, or says it does not', () => {
    /*
     * Un aspetto che definisce solo il tema scuro, con `data-theme` non menzionato,
     * si troverebbe senza i suoi colori in chiaro: tokens non ridefiniti, quindi
     * l'aspetto di default sotto un aspetto che sembra scaricato a meta'.
     *
     * L'eccezione e `ascii`, che e' **voluta** e dichiarata: un terminale in tema
     * chiaro non e' un terminale, e li il verde fosforescente su nero e' la scelta
     * giusta. Il test la nomina perche' un'eccezione non dichiarata diventa un
     * difetto che nessuno spiega.
     */
    for (const [id, css] of LOOK_SHEETS) {
      if (id === 'ascii') {
        expect(css, 'the ascii look should be a terminal in both themes').not.toContain(
          'data-theme',
        )
        continue
      }
      for (const theme of ['dark', 'light']) {
        expect(css, `the ${id} look has no ${theme} theme`).toContain(`[data-theme='${theme}']`)
      }
    }
  })
})
