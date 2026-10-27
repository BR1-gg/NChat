import { readFileSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { defineConfig, type Plugin } from 'vitest/config'

/**
 * `?raw` sulle regole di stile, perche servono come testo a un test.
 *
 * Vite ha gia un `?raw`, ma sui CSS non arriva: la trasformazione CSS intercetta
 * prima e l'import restituisce una stringa **vuota**. Non e un dettaglio: un test
 * che leggesse cosi un file di stile passerebbe sempre, e un test che passa sempre
 * e peggio di nessun test — sembrerebbe coprire la leggibilita dello zoom lontano
 * mentre non guarda niente.
 *
 * Due trucchi servono, e il secondo e quello che ci si dimentica:
 *
 * 1. Serve un id **virtuale** (`\0` iniziale), perche restituire il testo dal
 *    `load` sul percorso vero non basta: nella fase dopo, la trasformazione CSS
 *    lo rifarebbe diventare un modulo vuoto.
 * 2. L'id virtuale **non puo finire con `.css`**. E il punto in cui si resta
 *    incastrati: il prefetto da solo non serve, perche `vite:css` continua a
 *    riconoscerlo dalla sola estensione e a trasformarlo lo stesso. Per questo c'e
 *    `SUFFISSO`, che e un'estensione neutra e serve solo a non farsi riconoscere.
 *
 * Solo i CSS: ogni altro tipo di file resta con il comportamento di Vite.
 */
const PREFISSO = '\u0000nchat-raw-css:'
const SUFFISSO = '.raw-js'

function rawCss(): Plugin {
  return {
    name: 'nchat-raw-css',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!source.endsWith('.css?raw')) return null
      const percorso = source.slice(0, -'?raw'.length)
      const assoluto = importer ? resolvePath(dirname(importer), percorso) : percorso
      return PREFISSO + assoluto + SUFFISSO
    },
    load(id) {
      if (!id.startsWith(PREFISSO)) return null
      const percorso = id.slice(PREFISSO.length, id.length - SUFFISSO.length)
      return `export default ${JSON.stringify(readFileSync(percorso, 'utf8'))}`
    },
  }
}

export default defineConfig({
  plugins: [rawCss()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    /*
     * I file in `tools/` sono script Node e si testano con `node --test`, non con
     * vitest: aprono porte vere su 127.0.0.1 e usano `node:test`. Senza questo
     * esclude vitest li raccoglierebbe, fallirebbe perche non c'e `describe`, e
     * `npm test` diventerebbe rosso per un file che funziona benissimo con il
     * runner giusto.
     */
    exclude: ['tools/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
})
