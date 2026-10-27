import { AlertTriangle, Bug, ChevronDown, ChevronRight, Copy, Download, Filter, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { clearLog, logEntries, subscribeLog, type LogEntry, type LogLevel } from '../../logging/logger'
import { useUiStore } from '../../store/uiStore'
import { downloadBlob } from '../../utils/download'
import { Button, IconButton } from '../common/Button'
import { Modal } from '../common/Modal'
import { Select } from '../common/FormControls'

/**
 * Il registro, da leggere.
 *
 * Tre cose che un pannello di errori deve fare e che spesso non fa:
 *
 * - **dire da dove viene** ogni voce. Un 401 da un provider e un'eccezione
 *   dell'app si risolvono in due modi opposti, e una lista che li mescola porta
 *   a riavviare il server invece che a correggere una condizione.
 * - **dire quando**, con l'ora, perche la prima cosa che si fa e guardare il registro
 *   *subito* dopo che qualcosa e andato storto.
 * - **lasciarsi copiare.** Il registro finisce in un file che l'utente incolla
 *   altrove per farsi aiutare, e per questo `redact` esiste: la chiave non deve
 *   poter finire in quel file.
 */

const LEVEL_LABEL: Record<LogLevel, string> = {
  debug: 'Dettaglio',
  info: 'Info',
  warn: 'Avviso',
  error: 'Errore',
}

const SOURCE_LABEL: Record<string, string> = {
  provider: 'Provider',
  app: 'App',
  llm: 'Modello',
  persistence: 'Dati',
  proxy: 'Servizio locale',
}

function timeOf(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

/** Il registro come testo, per il copia-incolla e per il file. */
export function logAsText(entries: LogEntry[]): string {
  return entries
    .map((entry) => {
      const head = `${timeOf(entry.at)} ${LEVEL_LABEL[entry.level].padEnd(9)} ${SOURCE_LABEL[entry.source] ?? entry.source}: ${entry.message}`
      if (!entry.detail) return head
      const detail = Object.entries(entry.detail)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `    ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
        .join('\n')
      return detail ? `${head}\n${detail}` : head
    })
    .join('\n')
}

export function LogDialog() {
  const dialog = useUiStore((state) => state.dialog)
  const closeDialog = useUiStore((state) => state.closeDialog)
  const [level, setLevel] = useState<LogLevel | 'all'>('all')
  const [source, setSource] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Record<number, boolean>>({})

  // Il registro vive fuori da React, quindi serve un avviso per ridisegnare quando
  // arriva qualcosa. `useSyncExternalStore` sarebbe piu pulito, ma qui si scrive
  // quattro volte e non vale un altro file.
  const [, bump] = useState(0)
  useEffect(() => subscribeLog(() => bump((n) => n + 1)), [])

  const entries = logEntries()

  /*
   * Senza `useMemo`, e per una ragione precisa.
   *
   * Il logger aggiunge con `push` e **muta lo stesso array**: la reference non
   * cambia mai, quindi una memo dipendente da `entries` non si ricalcolerebbe mai
   * piu. Il pannello avrebbe mostrato «0 errori» con due voci in memoria — cioe
   * un registro che mente, che e la cosa peggiore che possa fare: si usa quando
   * qualcosa e andato storto, e li la risposta sarebbe «tutto a posto».
   *
   * Il costo e nullo: sono al massimo 500 voci, e si filtrano solo se qualcuno
   * filtra. La memo era un'ottimizzazione per un lavoro che non esiste, e ha
   * comprato un bug.
   */
  const needle = query.trim().toLowerCase()
  const filtered = entries.filter((entry) => {
    if (level !== 'all' && entry.level !== level) return false
    if (source !== 'all' && entry.source !== source) return false
    if (needle && !`${entry.message} ${logAsText([entry])}`.toLowerCase().includes(needle)) return false
    return true
  })

  const counts: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 }
  for (const entry of entries) counts[entry.level] += 1

  if (dialog !== 'log') return null

  const copyAll = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(logAsText(filtered))
      useUiStore.getState().addToast({ tone: 'success', title: 'Log copiato negli appunti.' })
    } catch {
      useUiStore
        .getState()
        .addToast({ tone: 'error', title: 'Copia non riuscita.', message: 'Usa invece “Salva come file”.' })
    }
  }

  const saveFile = (): void => {
    // Il nome ha la data: un file chiamato `log.txt` viene sovrascritto e non si
    // sa piu di quale sessione sia.
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const result = downloadBlob(logAsText(filtered), `nchat-log-${stamp}.txt`, 'text/plain')
    if (!result.ok) {
      useUiStore.getState().addToast({ tone: 'error', title: 'Salvataggio fallito.', message: result.error })
    }
  }

  return (
    <Modal
      title="Log"
      size="large"
      onClose={closeDialog}
      footer={
        <>
          <span className="log-counts">
            {counts.error} errori · {counts.warn} avvisi · {counts.info} info · {counts.debug} dettagli
            {entries.length > 0 ? ` · ${entries.length} voci in memoria` : ''}
          </span>
          <Button icon={<Copy size={12} />} onClick={() => void copyAll()}>Copia</Button>
          <Button icon={<Download size={12} />} onClick={saveFile}>Salva come file</Button>
          <Button icon={<Trash2 size={12} />} onClick={() => clearLog()}>Svuota</Button>
          <Button variant="primary" onClick={closeDialog}>Chiudi</Button>
        </>
      }
    >
      {entries.length === 0 ? (
        <div className="log-empty">
          <Bug size={22} />
          <p>Nessuna voce. Quando qualcosa va storto, questo e il posto dove viene scritto.</p>
        </div>
      ) : (
        <>
          <div className="log-filters">
            <Filter size={12} />
            <Select
              value={level}
              aria-label="Level"
              onChange={(event) => setLevel(event.currentTarget.value as LogLevel | 'all')}
            >
              <option value="all">Tutti i livelli</option>
              <option value="error">Solo errori</option>
              <option value="warn">Errori e avvisi</option>
              <option value="info">Tutto tranne il dettaglio</option>
              <option value="debug">Tutto</option>
            </Select>
            <Select
              value={source}
              aria-label="Source"
              onChange={(event) => setSource(event.currentTarget.value)}
            >
              <option value="all">Tutte le fonti</option>
              {Object.entries(SOURCE_LABEL).map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </Select>
            <input
              className="log-search"
              type="search"
              placeholder="Cerca nel testo…"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            {filtered.length !== entries.length ? (
              <span className="log-shown">{filtered.length} di {entries.length}</span>
            ) : null}
          </div>

          <ol className="log-list">
            {[...filtered].reverse().map((entry) => {
              const isOpen = open[entry.id] === true
              const hasDetail = entry.detail !== undefined
              return (
                <li key={entry.id} className={`log-row is-${entry.level}`}>
                  <div className="log-row-head">
                    {hasDetail ? (
                      <IconButton
                        label={isOpen ? 'Chiudi il dettaglio' : 'Apri il dettaglio'}
                        onClick={() => setOpen((prev) => ({ ...prev, [entry.id]: !isOpen }))}
                      >
                        {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                      </IconButton>
                    ) : null}
                    <time dateTime={new Date(entry.at).toISOString()}>{timeOf(entry.at)}</time>
                    <span className={`log-level is-${entry.level}`}>
                      {entry.level === 'error' ? <AlertTriangle size={10} /> : null}
                      {LEVEL_LABEL[entry.level]}
                    </span>
                    <span className="log-source">{SOURCE_LABEL[entry.source] ?? entry.source}</span>
                    <span className="log-message">{entry.message}</span>
                    {entry.fromPreviousSession ? (
                      <span className="log-previous" title="Scritto prima dell'ultimo riavvio">
                        prima
                      </span>
                    ) : null}
                  </div>
                  {hasDetail && isOpen ? (
                    <dl className="log-detail">
                      {Object.entries(entry.detail ?? {})
                        .filter(([, value]) => value !== undefined)
                        .map(([key, value]) => (
                          <div key={key} className="log-detail-row">
                            <dt>{key}</dt>
                            <dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
                          </div>
                        ))}
                    </dl>
                  ) : null}
                </li>
              )
            })}
          </ol>
        </>
      )}
      <p className="log-privacy">
        Le chiavi non finiscono mai qui: i campi che le contengono sono sostituiti, e
        i valori lunghi vengono tagliati. Quello che leggi qui puoi incollarlo senza
        pensarci.
      </p>
    </Modal>
  )
}
