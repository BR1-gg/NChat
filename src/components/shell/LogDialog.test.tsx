import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { clearLog, log, logEntries } from '../../logging/logger'
import { useUiStore } from '../../store/uiStore'
import { LogDialog, logAsText } from './LogDialog'

/**
 * Il pannello del registro.
 *
 * Il difetto che questi test bloccano e il piu insidioso possibile in un
 * registro: **mostrare zero quando le voci ci sono**. Il logger aggiunge con `push`
 * e muta lo stesso array, quindi una `useMemo` dipendente da quella reference non si
 * ricalcola mai, e il pannello resta convinto di non avere nulla. E la cosa peggiore
 * che possa succedere a un registro: si apre quando qualcosa e andato storto, e
 * risponde «tutto a posto».
 */
describe('il pannello del registro', () => {
  beforeEach(() => {
    clearLog()
    localStorage.clear()
    useUiStore.getState().closeDialog()
  })

  const openWith = (): void => {
    useUiStore.getState().openDialog('log')
    render(<LogDialog />)
  }

  it('non e aperto se il dialogo non e quello', () => {
    render(<LogDialog />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('mostra quello che e stato scritto, anche se e gia successo prima di aprirlo', () => {
    // Il caso che il `useMemo` rotto nascondeva: le voci esistono gia quando il
    // pannello si monta, e senza ricalcolo restano fuori.
    log.error('provider', 'NVIDIA ha risposto 401', { stato: 401 })
    useUiStore.getState().openDialog('log')
    render(<LogDialog />)
    expect(screen.getByText(/NVIDIA ha risposto 401/)).toBeInTheDocument()
  })

  it('mostra quello che arriva mentre e aperto', () => {
    openWith()
    expect(screen.queryByText(/NVIDIA ha risposto 404/)).not.toBeInTheDocument()
    act(() => {
      log.error('provider', 'NVIDIA ha risposto 404', { stato: 404 })
    })
    expect(screen.getByText(/NVIDIA ha risposto 404/)).toBeInTheDocument()
  })

  it('conta per livello, e il totale corrisponde a quello che c e', () => {
    log.error('provider', 'uno')
    log.warn('app', 'due')
    log.info('app', 'tre')
    useUiStore.getState().openDialog('log')
    render(<LogDialog />)
    // Il contatore sbagliato e la stessa menzogna della lista sbagliata.
    expect(screen.getByText(/1 errori · 1 avvisi · 1 info/)).toBeInTheDocument()
  })

  it('filtra per livello', () => {
    openWith()
    act(() => {
      log.error('provider', 'errore serio')
      log.warn('app', 'un avviso')
    })
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: 'error' } })
    expect(screen.getByText(/errore serio/)).toBeInTheDocument()
    expect(screen.queryByText(/un avviso/)).not.toBeInTheDocument()
  })

  it('filtra per fonte, perche provider e app si risolvono in modi opposti', () => {
    openWith()
    act(() => {
      log.error('app', 'dall app')
    })
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'app' } })
    expect(screen.getByText(/dall app/)).toBeInTheDocument()
    expect(screen.queryByText(/dal provider/)).not.toBeInTheDocument()
  })

  it('cerca nel testo del dettaglio, non solo nel messaggio', () => {
    // Il caso vero: un errore si riconosce dal corpo della risposta del provider,
    // che sta nel dettaglio, non dalla sua descrizione in una riga.
    openWith()
    act(() => {
      log.error('provider', 'NVIDIA ha risposto 404', { risposta: 'model_not_found: qwen-42' })
    })
    fireEvent.change(screen.getByPlaceholderText(/Cerca nel testo/), { target: { value: 'qwen-42' } })
    expect(screen.getByText(/NVIDIA ha risposto 404/)).toBeInTheDocument()
  })

  it('apre e chiude il dettaglio', () => {
    openWith()
    act(() => {
      log.error('provider', 'NVIDIA ha risposto 401', { stato: 401, risposta: 'unauthorized' })
    })
    expect(screen.queryByText('stato')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Apri il dettaglio'))
    expect(screen.getByText('stato')).toBeInTheDocument()
    expect(screen.getByText('401')).toBeInTheDocument()
  })

  it('dice che e vuoto, e non lascia uno spazio vuoto senza spiegazione', () => {
    useUiStore.getState().openDialog('log')
    render(<LogDialog />)
    expect(screen.getByText(/Nessuna voce/)).toBeInTheDocument()
  })

  it('la riga del tempo ha il formato leggibile', () => {
    // L'ora e la prima cosa che si guarda: il registro serve subito dopo che
    // qualcosa e andato storto.
    openWith()
    act(() => {
      log.error('provider', 'NVIDIA ha risposto 401')
    })
    const time = screen.getByText(/^\d{2}:\d{2}:\d{2}$/)
    expect(time).toBeInTheDocument()
  })
})

describe('il registro come testo', () => {
  beforeEach(() => {
    clearLog()
    localStorage.clear()
  })

  it('mette il dettaglio sotto la riga, con il nome del campo', () => {
    // E il formato che l'utente incolla: senza il nome del campo, un valore
    // numerico non dice niente.
    log.error('provider', 'NVIDIA ha risposto 429', { stato: 429 })
    const testo = logAsText(logEntries())
    expect(testo).toMatch(/stato: 429/)
    expect(testo).toMatch(/NVIDIA ha risposto 429/)
  })

  it('non ci mette la chiave, perche questo e il testo che viene incollato', () => {
    log.error('provider', 'Chiave rifiutata', { apiKey: 'nvapi-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' })
    expect(logAsText(logEntries())).not.toContain('ABCDEFGH')
  })
})
