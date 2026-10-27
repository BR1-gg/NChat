import { Gauge, Trash2, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  contextWindowFor,
  formatCost,
  formatCostCell,
  formatTokens,
  PRICING_AS_OF,
  PRICING_STALE_DAYS,
} from '../../logic/pricing'
import { isCloudProvider, providerSpec } from '../../logic/providers'
import { useModelStore } from '../../store/modelStore'
import { useUiStore } from '../../store/uiStore'
import { byModel, currentTotals, useUsageStore, MAX_RECORDS } from '../../store/usageStore'
import { Button } from '../common/Button'
import { Modal } from '../common/Modal'
import { Toggle } from '../common/FormControls'

type Range = 'today' | '7d' | '30d' | 'all'

const RANGES: Array<{ id: Range; label: string; days: number }> = [
  { id: 'today', label: 'Today', days: 1 },
  { id: '7d', label: '7 days', days: 7 },
  { id: '30d', label: '30 days', days: 30 },
  { id: 'all', label: 'All', days: Number.POSITIVE_INFINITY },
]

/** Quanti giorni ha la tabella dei prezzi, rispetto a oggi. */
function pricingAgeDays(now: number): number {
  const written = Date.parse(PRICING_AS_OF)
  if (Number.isNaN(written)) return 0
  return Math.max(0, Math.floor((now - written) / 86_400_000))
}

/**
 * I consumi per le API: token, dollari, e quanto riempie il contesto.
 *
 * Tre numeri che rispondono a tre domande diverse, e che per questo stanno in tre
 * righe e non in una tabella sola: **quanto ho speso**, **quanto ho usato**, e
 * **quanto ho ancora**. Il terzo e' quello che arriva sempre per primo («posso
 * continuare a lavorarci?»), ed e' l'unico che cambia durante una singola risposta.
 *
 * Sul costo c'e' una scelta deliberata: quando il prezzo non e' noto la cella dice
 * «price not published» e il totale diventa «almeno», invece di mostrare zero. Un
 * `$0.00` qui verrebbe letto come «gratis», e su un provider a pagamento significa
 * che l'utente ha smesso di badare a quanto spende.
 */
export function UsageDialog() {
  const dialog = useUiStore((state) => state.dialog)
  const addToast = useUiStore((state) => state.addToast)
  const provider = useUiStore((state) => state.appSettings.provider)
  const selectedModel = useUiStore((state) => state.appSettings.defaultModel)
  const lastRequestTokens = useUiStore((state) => state.lastRequestTokens)
  const models = useModelStore((state) => state.models)
  const records = useUsageStore((state) => state.records)
  const clear = useUsageStore((state) => state.clear)

  const [range, setRange] = useState<Range>('all')
  /*
   * Il piano gratuito e' una scelta dell'utente, non una cosa che l'app puo' sapere:
   * una chiava puo' essere di un account gratuito o a pagamento e per l'app sono
   * identiche. Senza questa opzione, un utente del piano gratuito vedrebbe un totale
   * calcolato sul listino a pagamento e penserebbe di dover spendere quei soldi.
   */
  const [freeTier, setFreeTier] = useState(false)

  /*
   * L'istant della finestra, preso **una volta** all'apertura e non a ogni render.
   *
   * `Date.now()` dentro il corpo del componente cambierebbe a ogni ridisegno, e con
   * lei il filtro «ultimi 7 giorni»: una corsa registrata mentre la finestra e aperta
   * entrerebbe e uscirebbe dal range a ogni render, e la tabella tremolerebbe. Qui il
   * valore e fissato all'apertura, che e' quello che l'utente vuole: «quanto ho speso
   * fino a un momento fa».
   */
  const [now] = useState(() => Date.now())
  const ageDays = pricingAgeDays(now)

  const filtered = useMemo(() => {
    const window = RANGES.find((entry) => entry.id === range)
    const days = window?.days ?? Number.POSITIVE_INFINITY
    if (days === Number.POSITIVE_INFINITY) return records
    const cutoff = now - days * 86_400_000
    return records.filter((record) => record.at >= cutoff)
  }, [records, range, now])

  const totals = useMemo(
    () => currentTotals(filtered, freeTier),
    [filtered, freeTier],
  )

  const groups = useMemo(() => byModel(filtered), [filtered])

  /*
   * Il tetto di contesto viene prima da LM Studio, che lo dichiara per ogni modello
   * caricato, e dalla tabella dei prezzi altrimenti. I due dicono cose diverse: il
   * primo e' il tetto **assegnato** a questa istanza, che puo essere minore di
   * quello del modello, e usare quello del listino mostrerebbe uno spazio che questa
   * macchina non ha.
   */
  const contextInfo = useMemo(() => {
    const model = selectedModel ?? ''
    const localLimit = models.find((candidate) => candidate.id === model)?.contextLength ?? null
    const tableLimit = contextWindowFor(provider, model)
    const limit = localLimit ?? tableLimit
    const used = lastRequestTokens
    const percent = limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : null
    return { model, limit, used, percent, source: localLimit ? 'server' : tableLimit ? 'published' : null }
  }, [selectedModel, provider, models, lastRequestTokens])

  if (dialog !== 'usage') return null

  const cloud = isCloudProvider(provider)
  const spec = providerSpec(provider)

  return (
    <Modal
      title="Usage"
      size="large"
      onClose={() => useUiStore.getState().closeDialog()}
      footer={
        <>
          <span className="usage-footnote">
            {records.length >= MAX_RECORDS
              ? `Keeping the ${MAX_RECORDS.toLocaleString()} most recent runs.`
              : `${records.length.toLocaleString()} runs recorded on this machine.`}
          </span>
          <Button
            variant="danger"
            icon={<Trash2 size={12} />}
            onClick={() => {
              clear()
              addToast({ tone: 'info', title: 'Usage history cleared.' })
            }}
          >
            Clear history
          </Button>
        </>
      }
    >
      <div className="usage-ranges" role="group" aria-label="Time range">
        {RANGES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`usage-range ${range === entry.id ? 'is-on' : ''}`}
            aria-pressed={range === entry.id}
            onClick={() => setRange(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="usage-totals">
        <div className="usage-total">
          <span className="usage-total-label">Cost</span>
          <strong className="usage-total-value">
            {totals.costUsd === null ? '—' : formatCost(totals.costUsd)}
          </strong>
          <span className="usage-total-note">
            {totals.costUsd === null
              ? `${totals.unpricedRuns} run${totals.unpricedRuns === 1 ? '' : 's'} with no published price`
              : freeTier
                ? 'Free tier — nothing is billed'
                : 'Estimated at today’s prices'}
          </span>
        </div>
        <div className="usage-total">
          <span className="usage-total-label">Tokens</span>
          <strong className="usage-total-value">{formatTokens(totals.totalTokens)}</strong>
          <span className="usage-total-note">
            {formatTokens(totals.promptTokens)} in · {formatTokens(totals.completionTokens)} out
          </span>
        </div>
        <div className="usage-total">
          <span className="usage-total-label">Runs</span>
          <strong className="usage-total-value">{formatTokens(totals.runs)}</strong>
          <span className="usage-total-note">
            {totals.runs === 1 ? 'generation' : 'generations'} counted
          </span>
        </div>
      </div>

      {/*
        Il contesto occupato e' la risposta alla domanda che l'utente si fa mentre
        guarda: «quanto mi resta». Quindi sta vicino ai totali, e non in fondo: la
        percentuale e' il numero che decide se si puo continuare a mandare contesto o
        se e ora di compattare.

        Senza un tetto noto si dice che non lo si conosce, invece di indovinare un
        limite: un tetto sbagliato fa partire un avviso di contesto pieno che non
        esiste, e un avviso falso e' peggio di nessun avviso.
      */}
      <div className="usage-context">
        <div className="usage-context-head">
          <Gauge size={13} />
          <strong>Context of the last request</strong>
          <span className="usage-context-model" title={contextInfo.model}>
            {contextInfo.model || 'no model selected'}
          </span>
        </div>
        {contextInfo.limit ? (
          <>
            <div className="usage-context-bar" role="img" aria-label={`${contextInfo.percent}% of the context window`}>
              <div
                className={`usage-context-fill ${
                  (contextInfo.percent ?? 0) > 85 ? 'is-high' : ''
                }`}
                style={{ width: `${contextInfo.percent ?? 0}%` }}
              />
            </div>
            <span className="usage-context-numbers">
              {formatTokens(contextInfo.used)} of {formatTokens(contextInfo.limit)} tokens
              {contextInfo.percent !== null ? ` · ${contextInfo.percent}%` : ''}
              <em>
                {contextInfo.source === 'server'
                  ? 'limit reported by the local server'
                  : 'published limit for this model'}
              </em>
            </span>
          </>
        ) : (
          <span className="usage-context-numbers">
            {cloud
              ? 'No published context limit for this model.'
              : 'The local server has not reported a context length for this model yet.'}
          </span>
        )}
      </div>

      {cloud && spec.id !== 'lmstudio' ? (
        <Toggle
          label="I am on a free tier"
          description="Nothing is billed on a free tier, so the estimated cost drops to zero while the token counts stay real."
          checked={freeTier}
          onChange={setFreeTier}
        />
      ) : null}

      {/*
        L'avviso sui prezzi e' piccolo ma non opzionale: la tabella e' conoscenza
        copiata, non una misura, e un totale presentato come attuale su una tabella
        vecchia e' un numero che non regge al confronto con la fattura.
      */}
      {ageDays > PRICING_STALE_DAYS ? (
        <div className="inline-message warning">
          <TriangleAlert size={12} style={{ verticalAlign: '-2px' }} /> These prices were written on{' '}
          {PRICING_AS_OF}, {ageDays} days ago. Providers change their prices without notice, so
          check the provider’s own page before treating the total as a bill.
        </div>
      ) : null}
      {spec.id === 'nvidia' ? (
        <div className="inline-message is-quiet">
          NVIDIA NIM does not publish a per-token price for the hosted catalogue, so its cost is
          shown as “price not published” rather than as zero. Token counts are still exact.
        </div>
      ) : null}

      {groups.length > 0 ? (
        <table className="usage-table">
          <thead>
            <tr>
              <th>Model</th>
              <th className="usage-num">Runs</th>
              <th className="usage-num">In</th>
              <th className="usage-num">Out</th>
              <th className="usage-num">Cost</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const first = group[0]
              if (!first) return null
              /*
               * Il costo viene da `currentTotals`, che somma **per corsa**.
               *
               * Sommare prima i token e poi applicare la tariffa sembra uguale e non
               * lo e': i modelli con soglia di contesto lunga cambiano tariffa a meta'
               * richiesta, quindi la cifra aggregata non e' la somma delle cifre reali.
               * Qui si fa la somma per record, che e' il numero che si vuole mostrare.
               */
              const groupTotal = currentTotals(group, freeTier)
              return (
                <tr key={`${first.provider}:${first.model}`}>
                  <td>
                    <span className="usage-model-name" title={first.model}>
                      {first.model || 'no model'}
                    </span>
                    <span className="usage-model-provider">
                      {providerSpec(first.provider).label}
                    </span>
                  </td>
                  <td className="usage-num">{formatTokens(groupTotal.runs)}</td>
                  <td className="usage-num">{formatTokens(groupTotal.promptTokens)}</td>
                  <td className="usage-num">{formatTokens(groupTotal.completionTokens)}</td>
                  <td className="usage-num">{formatCostCell(groupTotal.costUsd)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : (
        <p className="settings-hint">
          Nothing recorded for this range yet. A run appears here as soon as a provider reports
          its token usage.
        </p>
      )}
    </Modal>
  )
}
