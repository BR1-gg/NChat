import { useCallback, useEffect, useRef } from 'react'
import { getLLMClient } from '../llm/client'
import { prepareProvider } from '../llm/cloudProxy'
import { mapLlmError } from '../llm/openai'
import { isCloudProvider, providerSpec } from '../logic/providers'
import { log } from '../logging/logger'
import { useModelStore } from '../store/modelStore'
import { useUiStore } from '../store/uiStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { apiKeyFor, type Settings } from '../types/settings'
import { appError, isAppError } from '../types/errors'

export interface ConnectionControls {
  checkConnection: (manual?: boolean) => Promise<void>
}

export function useConnection(): ConnectionControls {
  const appSettings = useUiStore((state) => state.appSettings)
  const baseUrl = appSettings.baseUrl
  const useProxy = appSettings.useProxy
  const provider = appSettings.provider
  /*
   * Solo la chiave **del provider scelto**, e non l'intero oggetto delle chiavi.
   *
   * E una distinzione che sembra pignola e non lo e: con tutte le chiavi nelle
   * dipendenze, salvare la chiave di Google ricontrollerebbe la connessione anche
   * mentre si guarda NVIDIA. Con una sola sola, inserire la chiave del provider
   * successivo non fa partire nessun controllo, e il primo sintomo e una lista di
   * modelli vuota senza nessuna spiegazione.
   */
  const apiKey = apiKeyFor(appSettings, provider)
  // L'indirizzo come stringa, perche un oggetto nuovo a ogni render farebbe
  // girare il controllo senza fine. Il valore e quello che conta.
  const address = JSON.stringify(appSettings.baseUrlOverrides)
  const checking = useRef<AbortController | null>(null)
  /**
   * L'ultimo provider e numero di modelli che hanno risposto.
   *
   * Serve per non scrivere "Connesso" a ogni sondaggio: e un `useRef` e non uno
   * stato, perche non deve far ridisegnare niente — qui si decide solo cosa mettere
   * nel registro.
   */
  const lastConnectionSignature = useRef<string | null>(null)

  const checkConnection = useCallback(
    async (manual = false): Promise<void> => {
      checking.current?.abort()
      const controller = new AbortController()
      checking.current = controller
      const ui = useUiStore.getState()
      ui.setConnection('connecting')
      const workspaceDefaults = useWorkspaceStore.getState().workspaceSettings
      const settings: Settings = {
        ...useUiStore.getState().appSettings,
        defaults: { ...workspaceDefaults.defaults },
        contextTokenWarning: workspaceDefaults.contextTokenWarning,
      }
      const started = performance.now()
      /*
       * Per un provider in cloud, la chiave va data al servizio locale **prima** di
       * chiedere qualcosa al provider. Senza questo passaggio la lista modelli torna
       * vuota, ogni corsa si rifiuta, e il messaggio parla di LM Studio: esattamente
       * cio che e successo la prima volta che si e scelto un provider cloud.
       */
      if (isCloudProvider(settings.provider)) {
        const readiness = await prepareProvider(settings)
        if (controller.signal.aborted) return
        if (!readiness.ready) {
          useModelStore.getState().setModels([])
          useUiStore.getState().setProviderBlock(readiness)
          log.warn('app', readiness.message, {
            provider: settings.provider,
            motivo: readiness.reason,
          })
          const hint =
            readiness.action === 'start-service'
              ? 'Start it from the tray icon, or run: node tools\\cloud-proxy.mjs'
              : 'Add the key in Settings → Connection.'
          useUiStore
            .getState()
            .setConnection('offline', [], null, appError('OFFLINE', readiness.message, { hint }))
          if (manual) {
            useUiStore
              .getState()
              .addToast({ tone: 'error', title: readiness.message, message: hint, sticky: true })
          }
          return
        }
        useUiStore.getState().setProviderBlock(null)
      }
      try {
        const client = getLLMClient(settings)
        const capabilities = await client.capabilities()
        const models = await client.listAvailableModels(controller.signal)
        if (controller.signal.aborted) return
        const latency = Math.round(performance.now() - started)
        const status = models.length > 0 ? 'connected' : 'no-model'
        useModelStore.getState().setModels(models)
        useUiStore.getState().setConnection(status, models, latency, null, capabilities.level)
        /*
         * "Connesso" ogni due minuti non e un'informazione, e un battito. In un
         * registro che l'utente apre per trovare un errore, una riga ogni due
         * minuti vale come non scriverla: non c'e niente da notare e, peggio,
         * spinge in fondo le righe che servono.
         *
         * Quindi `info` solo quando qualcosa e **cambiato** — provider diverso, o
         * numero di modelli diverso — e `debug` il resto, che si vede solo chiedendo
         * tutto.
         */
        const signature = `${settings.provider}:${models.length}`
        const changed = lastConnectionSignature.current !== signature
        lastConnectionSignature.current = signature
        const entry = {
          provider: settings.provider,
          modelli: models.length,
          latenzaMs: latency,
        }
        if (changed) {
          log.info('app', `Connesso a ${providerSpec(settings.provider).label}`, entry)
        } else {
          log.debug('app', `Ancora su ${providerSpec(settings.provider).label}`, entry)
        }
        const selected = useUiStore.getState().appSettings.defaultModel
        const selectedStillAvailable = models.some((model) => model.id === selected)
        if (models.length > 0 && !selectedStillAvailable) {
          useUiStore.getState().setAppSettings({ defaultModel: models[0]?.id ?? null })
        } else if (models.length === 0) {
          useUiStore.getState().setAppSettings({ defaultModel: null })
        }
        if (manual) {
          // Il motivo per cui la lista e vuota cambia con il provider: in locale
          // significa che nessun modello e caricato, in cloud che il provider non ne
          // espone. Dirlo sempre come "apri LM Studio" e l'errore piu fuorviante che
          // c'e in questa schermata, perche rimanda a un programma che non c'e.
          useUiStore.getState().addToast({
            tone: models.length > 0 ? 'success' : 'warning',
            title:
              models.length > 0
                ? `Connected in ${latency} ms.`
                : `Connected, but ${providerSpec(settings.provider).label} offered no models.`,
            ...(models.length === 0
              ? {
                  message: isCloudProvider(settings.provider)
                    ? 'Check the key, and that the model exists for this provider.'
                    : 'Open LM Studio → Developer → Load a model.',
                }
              : {}),
          })
        }
      } catch (error: unknown) {
        if (controller.signal.aborted) return
        const mapped = mapLlmError(error, settings)
        /*
         * La lista modelli si svuota anche qui, e questa riga e la piu importante
         * del controllo.
         *
         * Il menu modelli legge da `modelStore`, mentre `setConnection` scrive la
         * sua lista in `uiStore`: due copie, e il fallimento svuotava solo quella
         * che nessuno guarda. Cosi, cambiando provider, restavano in menu i
         * modelli del provider precedente — e scegliendone uno la richiesta
         * partiva verso un servizio che quel modello non ce l'ha.
         *
         * E il sintomo esatto che e stato segnalato: dopo lo switch a LM Studio il
         * menu mostrava ancora i modelli di NVIDIA.
         */
        useModelStore.getState().setModels([])
        useUiStore.getState().setAppSettings({ defaultModel: null })
        useUiStore.getState().setConnection('offline', [], null, mapped)
        log.error('app', `Connessione fallita con ${providerSpec(settings.provider).label}`, {
          provider: settings.provider,
          errore: mapped.message,
          suggerimento: mapped.hint,
        })
        if (manual) {
          useUiStore
            .getState()
            .addToast({
              tone: 'error',
              title: isAppError(mapped)
                ? mapped.message
                : `Cannot reach ${providerSpec(settings.provider).label}.`,
              ...(isAppError(mapped) && mapped.hint ? { message: mapped.hint } : {}),
              sticky: true,
            })
        }
      }
    },
    [],
  )

  useEffect(() => {
    void checkConnection(false)
    let timer: number | undefined
    let cancelled = false
    /*
     * Il primo giro e il timer. Il ricontrollo su cambio di provider sta in un
     * effetto a parte, perche e un'altra ragione: qui siIntervala, e un provider
     * nuovo merita una risposta subito, non fra due minuti.
     */

    const schedule = (): void => {
      if (cancelled) return
      const status = useUiStore.getState().connectionStatus
      const delay = status === 'offline' ? 30_000 : 120_000
      timer = globalThis.setTimeout(async () => {
        await checkConnection(false)
        schedule()
      }, delay)
    }
    schedule()

    return () => {
      cancelled = true
      if (timer !== undefined) globalThis.clearTimeout(timer)
      checking.current?.abort()
    }
  }, [baseUrl, useProxy, checkConnection])

  /*
   * Cambiare provider, chiave o indirizzo ricontrolla subito.
   *
   * Senza questo il controllo girava solo all'avvio e poi ogni due minuti, e la
   * pillola continuava a dire "Offline" perche LM Studio e la sua idea di backend,
   * anche con un provider cloud selezionato: e il sintomo che faceva sembrare il
   * supporto API fittizio.
   *
   * Sta qui e non nel selettore perche qui c'e un solo posto che decide
   * "funziona", e cosi non si puo dimenticare un modo di cambiare il provider —
   * dal selettore, dai Settings, o da un import.
   */
  useEffect(() => {
    /*
     * Prima del controllo, la lista del provider precedente sparisce.
     *
     * Non e cosmetico: per un secondo o due il menu mostrerebbe modelli che il
     * provider nuovo non ha, e sceglierne uno produrrebbe una richiesta destinata
     * a un servizio che non lo conosce. Meglio un menu vuoto che un menu bugiardo,
     * e il vuoto ha gia un motivo scritto accanto.
     */
    useModelStore.getState().setModels([])
    void checkConnection(false)
  }, [checkConnection, provider, apiKey, address])

  return { checkConnection }
}
