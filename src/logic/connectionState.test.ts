import { describe, expect, it } from 'vitest'
import {
  connectionAdvice,
  connectionExplanation,
  connectionLabel,
  type ConnectionState,
} from './connectionState'
import theme from '../styles/theme.css?raw'

/**
 * Cosa dice l'app quando il server dei modelli non risponde.
 *
 * Il difetto che questi test bloccano e di **parola**, non di logica. La pastiglia
 * diceva `Offline` con un punto rosso, e l'utente ha letto «l'app non si e aperta».
 *
 * L'app era aperta. Era fermo il **server dei modelli**, che e un programma separato
 * che l'utente avvia per conto suo. Due processi distinti, due problemi distinti, e
 * una parola che li confondeva: da li in poi l'utente cercava il guasto in NCHAT
 * mentre il guasto era altrove, e il modo piu rapido per non aprire piu l'app.
 *
 * Quindi la regola e stretta e verificabile: in ogni stato la frase nomina NCHAT
 * **come acceso**, e nomina per nome la cosa che manca. Solo allora non c'e modo di
 * leggere il messaggio e sbagliare.
 */

const STATI: ConnectionState[] = [
  'connected',
  'connecting',
  'offline',
  'no-model',
  'loading-model',
]

describe('la pastiglia', () => {
  it('non dice mai "Offline", perche sembra che sia NCHAT a essere fermo', () => {
    // La parola sola e sufficiente a far pensare il contrario di quello che e:
    // `Offline` descrive chi ascolta, e chi ascolta e l'app.
    for (const stato of STATI) {
      expect(connectionLabel(stato), stato).not.toMatch(/offline/i)
    }
  })

  it('nomina il server dei modelli, che e la cosa che e ferma', () => {
    // Non un generico «server»: un nome generico obbliga l'utente a tradurre, e
    // translatinge e dove sbaglia.
    expect(connectionLabel('offline')).toMatch(/model server/i)
  })

  it('non usa la parola errore in nessuno stato', () => {
    for (const stato of STATI) {
      expect(connectionLabel(stato), stato).not.toMatch(/error|fail|broken/i)
    }
  })

  it('resta corta, perche sta in una pastiglia', () => {
    for (const stato of STATI) {
      expect(connectionLabel(stato).length, stato).toBeLessThanOrEqual(24)
    }
  })
})

describe('la spiegazione', () => {
  it('dice sempre che NCHAT e in funzione', () => {
    /*
     * Il punto, e la ragione per cui queste funzioni stanno in un modulo solo: la
     * frase non e un'aggiunta, e la prima cosa che deve dire e **chi sta bene**.
     * Ogni stato, senza eccezioni.
     */
    for (const stato of STATI) {
      for (const provider of ['lmstudio', 'nvidia', 'google'] as const) {
        const frase = connectionExplanation(stato, provider)
        expect(frase, `${stato}/${provider}`).toMatch(/NCHAT is running/)
      }
    }
  })

  it('quando il server non risponde, nomina il provider per nome', () => {
    // «the server» e il caso in cui l'utente deve indovinare quale. Il nome
    // eliminates l'indovinare.
    expect(connectionExplanation('offline', 'lmstudio')).toContain('Local (LM Studio)')
    expect(connectionExplanation('offline', 'nvidia')).toContain('NVIDIA NIM')
    expect(connectionExplanation('offline', 'google')).toContain('Google AI Studio')
  })

  it('distingue i due provider cloud, perche anche loro si fermano', () => {
    expect(connectionExplanation('offline', 'nvidia')).not.toBe(connectionExplanation('offline', 'google'))
  })

  it('non promette modelli che non ci sono', () => {
    // La frase non deve lasciare sperare: quando non c'e piu niente da scegliere,
    // lo dice, altrimenti l'utente aspetta una lista che non arriva.
    expect(connectionExplanation('offline', 'lmstudio')).toMatch(/no models to choose from yet/i)
  })

  it('dice che il quadro funziona anche senza modelli', () => {
    // Perche l'utente pensasse di aver perso tutto. Non ha perso niente.
    expect(connectionExplanation('offline', 'lmstudio')).toMatch(/canvas still works/i)
  })
})

describe('il consiglio', () => {
  it('tace quando non c e niente da fare', () => {
    // Meglio il silenzio di un pulsante che non serve. Un consiglio che si rivela
    // inutile e un consiglio che toglie fiduita a tutti gli altri.
    expect(connectionAdvice('connected', 'lmstudio')).toBeNull()
    expect(connectionAdvice('connecting', 'lmstudio')).toBeNull()
    expect(connectionAdvice('loading-model', 'lmstudio')).toBeNull()
  })

  it('per LM Studio dice di avviare LM Studio, non NCHAT', () => {
    // Il consiglio sbagliato in questo caso e peggio di nessun consiglio: avrebbe
    // fatto riavviare l'app che era gia aperta, e il server dei modelli sarebbe
    // rimasto fermo lo stesso.
    const consiglio = connectionAdvice('offline', 'lmstudio') ?? ''
    expect(consiglio).toMatch(/Start LM Studio/)
    expect(consiglio).not.toMatch(/start NCHAT/i)
  })

  it('per un provider cloud parla del servizio locale e della chiave', () => {
    // In cloud il server dei modelli non c'e: quello che manca e il servizio locale
    // che porta la chiave, e il primo tentativo sbagliato che fa l'utente e mettere
    // la chiave sbagliata invece di avviare il servizio.
    const consiglio = connectionAdvice('offline', 'nvidia') ?? ''
    expect(consiglio).toMatch(/local service/i)
    expect(consiglio).toMatch(/API key/i)
  })

  it('dice di scegliere un modello quando il server risponde ma non ce n e', () => {
    expect(connectionAdvice('no-model', 'lmstudio')).toMatch(/model/i)
  })
})

describe('i colori', () => {
  it('lo stato fermo del server dei modelli non usa il colore dell errore', () => {
    /*
     * Il colore e parte del messaggio, e piu forte del testo: se il bordo e rosso,
     * la frase calmante accanto viene letta come il tentativo di convincere che non
     * sia un problema.
     */
    const blocco = theme.slice(theme.indexOf('.inline-message.is-quiet {'))
    expect(blocco).toMatch(/border-color:\s*var\(--border\)/)
    expect(blocco.slice(0, 200)).not.toMatch(/var\(--err\)|var\(--warn\)/)
  })

  it('il punto della pastiglia quando il server e fermo non e rosso', () => {
    // `idle` e la classe del punto spento. `error` e quella che diceva «rotto».
    const topBar = theme.match(/\.status-dot\.idle \{[^}]*\}/)?.[0] ?? ''
    expect(topBar).toMatch(/--text-faint/)
    expect(topBar).not.toMatch(/--err/)
  })

  it('il punto verde resta solo per la connessione vera', () => {
    // Altrimenti, con `idle` e `done` che condividono una regola, il punto verde
    // finisce anche dove non c'e nessuna connessione, e il colore non distingue piu
    // niente — cioe smette di portare informazione.
    const regole = theme.match(/\.status-dot\.(idle|done) \{[^}]*\}/g) ?? []
    for (const regola of regole) {
      expect(regola, regola).toMatch(/--(ok|text-faint)/)
    }
    expect(regole.join(' ')).not.toMatch(/\.status-dot\.idle,\s*\.status-dot\.done/)
  })
})
