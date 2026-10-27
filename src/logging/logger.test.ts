import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearLog,
  installGlobalErrorHandlers,
  log,
  logEntries,
  redact,
  restoreLog,
  subscribeLog,
} from './logger'

/**
 * Il registro, e la cosa che non deve mai succedere.
 *
 * Il registro serve per essere **incollato** — a un forum, a una chat, a qualcuno
 * che ti aiuta. Se contiene una chiave, il file che incolli è un danno che nessuno
 * puo piu annullare: la chiave va ruotata per forza, e l'utente non lo sapra mai.
 *
 * Percio questi test non verificano che il log funzioni. Verificano che non faccia
 * del danno, che e l'unica proprieta che conta.
 */

const CHIAVE = 'nvapi-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghij'

describe('redact', () => {
  it('toglie una chiave NVIDIA', () => {
    expect(redact(`La chiave e ${CHIAVE}`)).not.toContain('ABCDEFGH')
  })

  it('toglie una chiave OpenAI', () => {
    expect(redact('sk-abcdefghijklmnopqrstuvwxyz1234')).not.toContain('abcdefghijklmno')
  })

  it('toglie un token GitHub', () => {
    expect(redact('ghp_abcdefghijklmnopqrstuvwxyz0123')).not.toContain('abcdefghij')
  })

  it('toglie una chiave dopo Bearer, anche se non sembra nessuna di quelle', () => {
    // Il proxy mette `Authorization: Bearer`, e quel valore non ha un nome noto.
    expect(redact('Bearer xyzQWERTY123456789')).not.toContain('xyzQWERTY')
  })

  it('toglie una stringa lunga che non ha un nome noto', () => {
    // Il caso piu importante: non sappiamo come si chiama la chiave di un
    // provider che non abbiamo scritto noi.
    const mysteriouso = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0'
    expect(redact(`valore: ${mysteriouso}`)).not.toContain(mysteriouso)
  })

  it('lascia stare un testo normale', () => {
    const frase = 'NVIDIA ha risposto 404: il modello non esiste piu'
    expect(redact(frase)).toBe(frase)
  })
})

describe('il registro non registra la chiave', () => {
  beforeEach(() => {
    clearLog()
    localStorage.clear()
  })

  it('non registra un campo che si chiama come una chiave', () => {
    // Il pericolo non e la regex: e passare un campo `apiKey` nelle impostazioni.
    // Nessuna regex sulla chiave lo fermerebbe, perche il nome del campo e
    // quello che dice.
    log.error('provider', 'Chiave rifiutata', { apiKey: CHIAVE, nvidiaApiKey: CHIAVE })
    const testo = JSON.stringify(logEntries())
    expect(testo).not.toContain('ABCDEFGH')
    expect(testo).toContain('[non registrato]')
  })

  it('copre i nomi che sembrano credenziali', () => {
    for (const nome of ['token', 'secret', 'password', 'authorization', 'cookie', 'TOKEN']) {
      log.error('app', 'prova', { [nome]: CHIAVE })
      expect(JSON.stringify(logEntries()), nome).not.toContain('ABCDEFGH')
    }
  })

  it('toglie la chiave anche se e dentro un messaggio', () => {
    log.error('app', `Ho usato ${CHIAVE} e non funziona`)
    expect(JSON.stringify(logEntries())).not.toContain('ABCDEFGH')
  })

  it('toglie la chiave anche se e dentro un dettaglio annidato', () => {
    // I body dei provider sono JSON annidati, e dentro c'e di tutto. Vengono
    // serializzati in testo e poi passano da `redact`, per non dover sperare che
    // la forma sia quella che il programmatore si aspetta.
    log.error('provider', 'Errore', { corpo: { auth: { bearer: CHIAVE } } })
    expect(JSON.stringify(logEntries())).not.toContain('ABCDEFGH')
  })

  it('taglia un valore enorme invece di riempire il registro', () => {
    log.error('provider', 'Risposta', { corpo: 'x'.repeat(50_000) })
    const entry = logEntries()[0]
    expect(JSON.stringify(entry).length).toBeLessThan(2000)
    // E dice che era piu lungo, perche un troncamento silenzioso sembla un dato
    // piccolo invece di un troncamento.
    expect(JSON.stringify(entry)).toContain('caratteri')
  })
})

describe('il registro come contenitore', () => {
  beforeEach(() => {
    clearLog()
    localStorage.clear()
  })

  it('non cresce oltre il limite', () => {
    // Un ciclo che sbaglia mille volte al secondo deve riempire la memoria una
    // volta sola, non far cadere la scheda che sta scrivendo.
    for (let i = 0; i < 900; i += 1) log.error('app', `errore ${i}`)
    const entries = logEntries()
    expect(entries.length).toBeLessThanOrEqual(500)
    // E tiene gli ultimi, non i primi: gli ultimi sono quelli che servono.
    expect(entries[entries.length - 1]?.message).toContain('errore 899')
  })

  it('avvisa chi ascolta', () => {
    const seen: number[] = []
    const off = subscribeLog(() => seen.push(logEntries().length))
    log.info('app', 'uno')
    log.info('app', 'due')
    off()
    log.info('app', 'tre')
    expect(seen).toEqual([1, 2])
  })
})

describe('il registro sopravvive al riavvio', () => {
  beforeEach(() => {
    clearLog()
    localStorage.clear()
  })

  /**
   * Il riavvio, come lo vede il logger: `localStorage` ha ancora dentro quello
   * che la sessione precedente aveva scritto, e la memoria e vuota.
   *
   * Non si simula con `clearLog`, perche quello cancella anche il `localStorage` e
   * quindi ripulirebbe proprio la cosa che si vuole provare a recuperare.
   */
  const lasciaComeDopoUnRiavvio = (...messages: string[]): void => {
    localStorage.setItem(
      'nchat.log.v1',
      JSON.stringify(
        messages.map((message, index) => ({
          id: index + 1,
          at: 1_700_000_000_000 + index,
          level: 'error',
          source: 'provider',
          message,
        })),
      ),
    )
  }

  it('riporta dentro quello che era rimasto', () => {
    // L'errore che ti interessa e spesso quello che ha fatto cadere la pagina, e un
    // registro in memoria muore con la pagina.
    lasciaComeDopoUnRiavvio('NVIDIA ha risposto 401')
    expect(restoreLog()).toBe(1)
    expect(logEntries()[0]?.message).toBe('NVIDIA ha risposto 401')
  })

  it('marca come provenienti dalla sessione precedente', () => {
    // Senza il marchio, un errore di due giorni fa sembrerebbe appena successo, e
    // l'utente cercherebbe la causa dove non e.
    lasciaComeDopoUnRiavvio('Errore vecchio')
    restoreLog()
    expect(logEntries()[0]?.fromPreviousSession).toBe(true)
  })

  it('non si rompe davanti a un localStorage corrotto', () => {
    localStorage.setItem('nchat.log.v1', 'non e json')
    expect(() => restoreLog()).not.toThrow()
    expect(logEntries()).toEqual([])
  })

  it('scrive davvero, dopo che il tempo di attesa e passato', () => {
    // La scrittura e rimandata, e senza aspettare il rimando si guarderebbe un
    // registro mai salvato e si concluderebbe che non funziona.
    vi.useFakeTimers()
    log.error('provider', 'NVIDIA ha risposto 404')
    expect(localStorage.getItem('nchat.log.v1')).toBeNull()
    vi.advanceTimersByTime(1000)
    vi.useRealTimers()
    expect(localStorage.getItem('nchat.log.v1')).toContain('404')
  })

  it('non butta via il log di prima se si scrive subito dopo il ripristino', () => {
    // Il caso che ha motivato `restoreLog`: se il ripristino avvenisse dopo una
    // prima scrittura, quella scrittura salverebbe un anello vuoto e le voci
    // precedenti sparirebbero dal file. E il modo piu veloce per perdere esattamente
    // il log che serviva.
    vi.useFakeTimers()
    lasciaComeDopoUnRiavvio('prima del riavvio')
    restoreLog()
    log.error('app', 'dopo il riavvio')
    vi.advanceTimersByTime(1000)
    vi.useRealTimers()
    const salvato = localStorage.getItem('nchat.log.v1') ?? ''
    expect(salvato).toContain('prima del riavvio')
    expect(salvato).toContain('dopo il riavvio')
  })

  it('non registra la chiave nemmeno nel file salvato', () => {
    // Il file e quello che l'utente incolla. Se la chiave ci finisce, il danno e
    // fatto e nessuno lo sapra.
    vi.useFakeTimers()
    log.error('provider', 'Chiave rifiutata', { apiKey: CHIAVE, stato: 401 })
    vi.advanceTimersByTime(1000)
    vi.useRealTimers()
    expect(localStorage.getItem('nchat.log.v1')).not.toContain('ABCDEFGH')
  })
})

describe('gli errori che nessuno ha scritto', () => {
  beforeEach(() => {
    clearLog()
    localStorage.clear()
  })

  it('raccoglie un errore non gestito', () => {
    // Non finisce da nessuna parte: non c'e toast, non c'e nodo, e l'unica traccia
    // e una riga in console che hai gia chiuso.
    const off = installGlobalErrorHandlers()
    const event = new ErrorEvent('error', { message: 'esploso', filename: 'app.js', lineno: 12 })
    globalThis.dispatchEvent(event)
    const entries = logEntries()
    expect(entries[0]?.message).toContain('esploso')
    expect(entries[0]?.level).toBe('error')
    expect(entries[0]?.source).toBe('app')
    off()
  })

  it('raccoglie una promessa rifiutata senza gestione', () => {
    const off = installGlobalErrorHandlers()
    // `PromiseRejectionEvent` non esiste in happy-dom, quindi si costruisce un
    // evento generico con lo stesso `reason`: e cio che l'ascoltatore legge, ed e
    // l'unica cosa che questa prova deve verificare.
    const event = new Event('unhandledrejection') as Event & { reason?: unknown }
    event.reason = new Error('promessa persa')
    globalThis.dispatchEvent(event)
    expect(logEntries()[0]?.message).toMatch(/Promessa rifiutata/)
    expect(JSON.stringify(logEntries())).toContain('promessa persa')
    off()
  })
})
