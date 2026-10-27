import {
  CircleHelp,
  Database,
  Download,
  FilePlus2,
  Layers3,
  Palette,
  PlugZap,
  RefreshCw,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Trash2,
  Upload,
} from 'lucide-react'
import { ExternalLink } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  deleteAllData,
  exportWorkspace,
  readImportFile,
  requestNewWorkspace,
  restoreLocalBackup,
  storageUsageKb,
  workspaceBackupExists,
} from '../../actions/workspaceIO'
import { forceSave } from '../../actions/workspaceIO'
import { useUiStore, type SettingsTab } from '../../store/uiStore'
import { useWorkspaceStore, type SettingsPatch } from '../../store/workspaceStore'
import { workspaceRegistry } from '../../store/workspaceRegistry'
import { APPEARANCES, apiKeyFor, mergeSettings, sanitizeUiScale, UI_SCALE_MAX, UI_SCALE_MIN, UI_SCALE_STEP, type Settings } from '../../types/settings'
import { PROVIDER_SPECS, isCloudProvider, providerSpec, type ProviderId } from '../../logic/providers'
import { connectionAdvice, connectionExplanation } from '../../logic/connectionState'
import { ProxyError, proxyHelp, proxyStatus, registerKey } from '../../llm/cloudProxy'
import { Button } from '../common/Button'
import {
  Field,
  Select,
  SliderField,
  TextArea,
  TextInput,
  Toggle,
} from '../common/FormControls'
import { Modal } from '../common/Modal'

const tabs: Array<{ id: SettingsTab; label: string }> = [
  { id: 'connection', label: 'Connection' },
  { id: 'generation', label: 'Generation' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'data', label: 'Data' },
  { id: 'help', label: 'Help' },
]

export function SettingsDialog({ onTestConnection }: { onTestConnection: () => void }) {
  const dialog = useUiStore((state) => state.dialog)
  const activeTab = useUiStore((state) => state.settingsTab)
  const models = useUiStore((state) => state.models)
  const connectionStatus = useUiStore((state) => state.connectionStatus)
  const latency = useUiStore((state) => state.connectionLatencyMs)
  const connectionError = useUiStore((state) => state.connectionError)
  const preferences = useUiStore((state) => state.preferences)
  const apiCapabilityLevel = useUiStore((state) => state.apiCapabilityLevel)
  const appSettings = useUiStore((state) => state.appSettings)
  const workspaceSettings = useWorkspaceStore((state) => state.workspaceSettings)
  const settings: Settings = mergeSettings(appSettings, workspaceSettings)
  /*
   * Se c'e un workspace aperto. I Settings si aprono anche dalla Home, dove non
   * c'e: i campi che appartengono al workspace non hanno dove scrivere e quindi
   * non vengono mostrati, invece di accettare valori che verrebbero persi.
   *
   * Il percorso non puo cambiare con la finestra aperta, perche e modale: qui
   * `activeId()` basta e non serve una subscription.
   */
  const hasWorkspace = workspaceRegistry.activeId() !== null
  const spec = providerSpec(appSettings.provider)
  const [proxyUp, setProxyUp] = useState(false)
  /** Quali provider il servizio ha davvero in memoria, secondo lui. */
  const [proxyRegistered, setProxyRegistered] = useState<ProviderId[]>([])

  /**
   * I provider cloud, e quelli che hanno gia la chiave.
   *
   * Serve al riga sotto il campo: con piu provider in cloud, «ho gia messo la
   * chiave di Google?» diventa una domanda che l'utente si fa ogni volta e che
   * uno schermo con un solo campo non puo rispondere. La risposta e una riga di
   * nomi, senza rivelare niente — solo se c e.
   */
  const cloudProviders = PROVIDER_SPECS.filter((s) => s.needsKey).map((s) => s.id)
  /**
   * Il provider scelto e in cloud?
   *
   * Una variabile sola perche la stessa domanda viene posta in tre punti della scheda
   * — quali controlli mostrare, quale riga scrivere — e ognuno con la sua copia della
   * condizione finisce per divergere al primo ritocco.
   */
  const cloudProvider = isCloudProvider(appSettings.provider)
  const cloudProvidersWithKey = cloudProviders.filter((id) => apiKeyFor(appSettings, id) !== '')
  /**
   * La chiave del provider scelto, come valore.
   *
   * `apiKeyFor(...)` dentro l'array delle dipendenze e' un'espressione, e un
   * lint la segnala perche' non puo' essere verificata staticamente. Il valore e
   * quello che conta, quindi va in una variabile: il controllo automatico torna a
   * poterlo confrontare con quello che l'effetto usa davvero, che e' il punto per cui
   * quell'array esiste.
   */
  const activeKey = apiKeyFor(appSettings, appSettings.provider)
  /** Il servizio ha in memoria la chiave di questo provider? */
  const proxyHasKey =
    isCloudProvider(appSettings.provider) && proxyRegistered.includes(appSettings.provider)
  /** Il campo della chiave di questo provider ha qualcosa? */
  const hasOwnKey = apiKeyFor(appSettings, appSettings.provider) !== ''

  /*
   * Whether the local service is up, and whether it holds this provider's key.
   *
   * Two facts, kept apart on purpose: with one flag the screen had to claim both
   * or neither, and the case that matters is the terzo — il servizio gira, la
   * chiave c'e nel campo, ma non e stata ancora consegnata.dire «il servizio ha la
   * chiave» in quel momento e una bugola piccola e concreta, perche e la riga che
   * dice all'utente che puo chiudere le impostazioni.
   *
   * Checked when the dialog opens and whenever the key changes, and not polled:
   * the user is looking at this screen, and a request that fails because the
   * service is not running says so by itself. Polling here would mean a timer
   * that exists only while a dialog happens to be open.
   */
  useEffect(() => {
    if (!isCloudProvider(appSettings.provider)) {
      setProxyUp(false)
      setProxyRegistered([])
      return
    }
    let cancelled = false
    void proxyStatus().then((status) => {
      if (cancelled) return
      setProxyUp(status.up)
      setProxyRegistered(status.registered)
    })
    return () => {
      cancelled = true
    }
  }, [
    appSettings.provider,
    activeKey,
    appSettings.baseUrlOverrides,
    /*
     * `dialog`, non `open`.
     *
     * Qui `open` non era una variabile: risolveva al `window.open` globale, che esiste
     * su ogni schermata e non cambia mai. Quindi questa dipendenza era costante, e
     * l'effetto — che il commento sopra descrive come «controllato quando si apre la
     * finestra» — non girava affatto aprendo la finestra. Il controllo partiva solo se
     * cambiavano provider, chiave o indirizzo, quindi uno statovecchio di servizio
     * fermo restava a schermo anche dopo che l'utente lo aveva avviato dal tray.
     */
    dialog,
  ])

  /** Hands the key to the local service, and says whether it took it. */
  const handKeyToService = async (): Promise<void> => {
    const ui = useUiStore.getState()
    try {
      const taken = await registerKey({
        ...mergeSettings(useUiStore.getState().appSettings, useWorkspaceStore.getState().workspaceSettings),
      })
      setProxyUp(true)
      ui.addToast({
        tone: taken ? 'success' : 'warning',
        title: taken
          ? 'The local service has the key.'
          : 'There is no key to give yet.',
        ...(taken ? {} : { message: 'Paste the key above first.' }),
      })
    } catch (error: unknown) {
      setProxyUp(false)
      const reason = error instanceof ProxyError ? error.reason : 'network'
      ui.addToast({
        tone: 'error',
        title: 'The local service did not take the key.',
        message: proxyHelp(reason),
        sticky: true,
      })
    }
  }
  const importRef = useRef<HTMLInputElement>(null)
  const [clearText, setClearText] = useState('')
  const [showModels, setShowModels] = useState(false)

  if (dialog !== 'settings') return null
  const set = (patch: SettingsPatch): void => {
    useWorkspaceStore.getState().setSettings(patch)
    const { defaults: _defaults, contextTokenWarning: _warning, ...appPatch } = patch
    if (Object.keys(appPatch).length > 0) {
      useUiStore.getState().setAppSettings(appPatch)
    }
  }
  const close = (): void => useUiStore.getState().closeDialog()

  return (
    <Modal title="Settings" size="large" onClose={close}>
      <div className="settings-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`settings-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => useUiStore.getState().openDialog('settings', tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'connection' ? (
        <div className="settings-panel">
          {/*
            Questa sezione riguarda **solo** il provider locale, quindi in cloud non
            viene mostrata.

            Prima era sempre visibile, e con Google o NVIDIA selezionati metteva in
            cima una schermata intitolata «LM Studio server» con un campo Base URL e
            una porta 1234: era esattamente la confusione che l'utente ha segnalato,
            e l'impressione che il supporto API fosse fittizio nasceva anche da qui.
            Il posto giusto per un campo che non riguarda il provider scelto e'
            nessuno: se proprio serve, si torna a Local.
          */}
          {!cloudProvider ? (
          <section className="settings-section">
            <h3>LM Studio server</h3>
            <p>NCHAT uses only the OpenAI-compatible endpoints exposed by your local server.</p>
            <Field label="Base URL" help="Include /v1. Older LM Studio builds may use port 8080.">
              {(id) => (
                <TextInput
                  id={id}
                  value={settings.baseUrl}
                  spellCheck={false}
                  onChange={(event) => set({ baseUrl: event.currentTarget.value })}
                />
              )}
            </Field>
            <div className="preset-row">
              <Button
                size="small"
                onClick={() => set({ baseUrl: 'http://localhost:1234/v1' })}
              >
                localhost:1234
              </Button>
              <Button
                size="small"
                onClick={() => set({ baseUrl: 'http://localhost:8080/v1' })}
              >
                localhost:8080
              </Button>
            </div>
            <Toggle
              label="Use Vite dev proxy"
              description="Bypasses browser CORS while running the development server."
              checked={settings.useProxy}
              onChange={(useProxy) => set({ useProxy })}
            />
            {!import.meta.env.DEV && settings.useProxy ? (
              <div className="inline-message warning">
                A static production build has no Vite proxy. Turn this off and allow the app origin in LM Studio, or host the build behind a proxy.
              </div>
            ) : null}
          </section>
          ) : null}
          {/*
            Lo stato della connessione e i due pulsanti stanno **fuori** dal
            condizionale: valgono per ogni provider.

            Qui e dove l'utente legge perche non vede modelli, quindi qui la frase
            deve dire **le due cose** in modo che non si confondano: NCHAT e
            acceso, e il server dei modelli no.

            Il messaggio tecnico resta, ma **dopo** la spiegazione e non al posto
            suo: «Cannot reach http://localhost:1234/v1» dice perche il tentativo e
            fallito, ma da solo fa pensare che l'app sia rotta, perche e la prima
            riga che si incontra e non la quinta.

            E non e rosso: il server dei modelli e un programma separato che
            l'utente avvia per conto suo, e che sia fermo non e un errore di
            NCHAT — e su una macchina che lavora in cloud e la normalita.
          */}
          <section className="settings-section">
            <h3>Connection</h3>
            <div className="inspector-actions">
              <Button icon={<PlugZap size={12} />} onClick={onTestConnection}>
                Test connection
              </Button>
              <Button
                icon={<RefreshCw size={12} />}
                onClick={onTestConnection}
                disabled={connectionStatus === 'connecting'}
              >
                Reload model list
              </Button>
            </div>
            <div
              className={`inline-message ${
                connectionStatus === 'connected'
                  ? 'success'
                  : connectionStatus === 'offline'
                    ? 'is-quiet'
                    : ''
              }`}
            >
              <strong>{connectionExplanation(connectionStatus, appSettings.provider)}</strong>
              {connectionStatus === 'connected' ? (
                ` Connected in ${latency ?? '—'} ms · ${models.length} model${models.length === 1 ? '' : 's'} available.`
              ) : null}
              {connectionStatus !== 'connected' && connectionError ? (
                <span className="inline-detail">{connectionError.message}</span>
              ) : null}
              {connectionAdvice(connectionStatus, appSettings.provider) ? (
                <span className="inline-detail">
                  {connectionAdvice(connectionStatus, appSettings.provider)}
                </span>
              ) : null}
            </div>
            {showModels ? (
              <pre className="code-preview">{JSON.stringify(models, null, 2)}</pre>
            ) : null}
            <Button size="small" onClick={() => setShowModels((value) => !value)}>
              {showModels ? 'Hide' : 'Show'} raw model result
            </Button>
          </section>
          <section className="settings-section">
            <h3>Default model</h3>
            <Field label="Model sent with each run" help="The exact id from /models is always used.">
              {(id) => (
                <Select
                  id={id}
                  value={settings.defaultModel ?? ''}
                  onChange={(event) => set({ defaultModel: event.currentTarget.value || null })}
                >
                  <option value="">Select a model…</option>
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>{model.id}</option>
                  ))}
                </Select>
              )}
            </Field>
          </section>
          <section className="settings-section">
            <h3>Where the model runs</h3>
            <Field label="Provider" help="Also on the top bar, because it is a per-run choice.">
              {(id) => (
                <Select
                  id={id}
                  value={settings.provider}
                  onChange={(event) => {
                    const next = event.currentTarget.value as ProviderId
                    if (next !== 'lmstudio') set({ defaultModel: null })
                    set({ provider: next })
                  }}
                >
                  {PROVIDER_SPECS.map((spec) => (
                    <option key={spec.id} value={spec.id}>{spec.label}</option>
                  ))}
                </Select>
              )}
            </Field>
            <p className="settings-hint">{spec.blurb}</p>
            {isCloudProvider(settings.provider) ? (
              <>
                {/*
                  La chiave viene data al servizio locale, che la tiene in memoria e
                  non la scrive da nessuna parte. Qui la si vede perche e utile
                  controllarla, ma non e la copia che il servizio usa: quella non
                  e leggibile da nessuna parte, e questo e il punto.

                  Il campo mostra la chiave **del provider scelto**, e sotto dice
                  quali altri ne hanno una. Senza quella riga, un utente che ha
                  riempito tutto e cambia provider trova il campo vuoto e pensa di
                  aver perso la chiave: uno schermo che sembra aver perso il lavoro
                  e peggio di uno che non lo ha mai chiesto.
                */}
                <Field
                  label={`API key${spec.needsKey ? ` — ${spec.label}` : ''}`}
                  help="Held by the local service in memory only. It is never written to disk and never sent back out, so you enter it again after the service restarts."
                >
                  {(id) => (
                    <TextInput
                      id={id}
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={spec.needsKey ? 'Paste the key' : 'Not needed for this provider'}
                      disabled={!spec.needsKey}
                      value={apiKeyFor(appSettings, settings.provider)}
                      onChange={(event) => {
                        const provider = settings.provider
                        set({ apiKeys: { ...appSettings.apiKeys, [provider]: event.currentTarget.value } })
                      }}
                    />
                  )}
                </Field>
                {/*
                  Quale provider ha gia la sua chiave, in una riga sola e senza
                  rivelare niente: solo se c e. E una risposta a una domanda che
                  l'utente si fa sempre e che non trova altrove — «ho gia messo
                  quella di Google?».
                */}
                {cloudProvidersWithKey.length > 0 || cloudProviders.length > 1 ? (
                  <p className="settings-hint settings-keys-elsewhere">
                    {cloudProvidersWithKey.length > 0
                      ? `Key already saved for: ${cloudProvidersWithKey.map((id) => providerSpec(id).label).join(', ')}.`
                      : 'No key saved for any cloud provider yet.'}
                  </p>
                ) : null}
                {spec.keysUrl ? (
                  <Button
                    size="small"
                    icon={<ExternalLink size={12} />}
                    onClick={() => window.open(spec.keysUrl, '_blank', 'noopener,noreferrer')}
                  >
                    Where do I get the key?
                  </Button>
                ) : null}
                {/*
                  L'indirizzo e scrivibile per **ogni** provider, non solo per
                  `custom`. Gli indirizzi di questo progetto sono conoscenza, non
                  misurazioni: senza questa via, un provider che li cambia
                  lascerebbe l'utente con un menu che non funziona e nessuna
                  uscita. Il pulsante per tornare a quello di default c'e per
                 che il campo non deve diventare un posto dove si perde il filo.
                */}
                <Field
                  label="Service address"
                  help={
                    spec.needsBaseUrl
                      ? 'The OpenAI-compatible address, https. The part before /v1 is usually enough.'
                      : 'Leave this empty to use the built-in address. Change it only if the provider moved it.'
                  }
                >
                  {(id) => (
                    <div className="field-with-button">
                      <TextInput
                        id={id}
                        type="url"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={spec.needsBaseUrl ? 'https://api.example.com/v1' : 'built-in'}
                        value={appSettings.baseUrlOverrides[settings.provider] ?? ''}
                        onChange={(event) => {
                          const next = event.currentTarget.value
                          set({
                            baseUrlOverrides: {
                              ...appSettings.baseUrlOverrides,
                              [settings.provider]: next,
                            },
                          })
                        }}
                      />
                      {appSettings.baseUrlOverrides[settings.provider] ? (
                        <Button
                          size="small"
                          onClick={() => {
                            const next = { ...appSettings.baseUrlOverrides }
                            delete next[settings.provider]
                            set({ baseUrlOverrides: next })
                          }}
                        >
                          Use the built-in address
                        </Button>
                      ) : null}
                    </div>
                  )}
                </Field>
                {/*
                  Tre stati, non due. Il booleano `proxyUp` diceva «il servizio
                  gira» e il messaggio aggiungeva «e ha la chiave di questo
                  provider»: due fatti in uno, e quello sbagliato si vede subito —
                  con il campo vuoto e la chiave consegnata in precedenza, lo
                  schermo annunciava una chiave che l'utente aveva appena
                  cancellato. `registered` dice la verita, quindi si usa.
                */}
                <div
                  className={`inline-message ${proxyUp ? (proxyHasKey ? '' : 'is-warning') : 'is-warning'}`}
                >
                  {!proxyUp
                    ? 'The local service is not running. Start it from the tray icon, or run tools/cloud-proxy.mjs.'
                    : proxyHasKey
                      ? 'The local service is running and holds a key for this provider.'
                      : hasOwnKey
                        ? 'The local service is running, but it has no key for this provider yet. Give it one below.'
                        : 'The local service is running. Paste a key above and give it to the service.'}
                </div>
                <Button
                  size="small"
                  onClick={() => void handKeyToService()}
                >
                  Give the key to the local service
                </Button>
              </>
            ) : null}
          </section>
          <section className="settings-section">
            <h3>Model loading</h3>
            {/*
              I tre controlli qui sotto sono concetti di **LM Studio**: il peso del
              modello sta in memoria della macchina, due modelli si contendono la GPU,
              e un caricamento puo durare minuti. Niente di questo esiste su NVIDIA o
              Google: li il modello e gia in piedi e l'unica cosa che lo rende
              raggiungibile e la chiave.

              Mostrarli in cloud non era solo inutile, era **costoso**: «Load model when
              I start typing» chiamava `ensureLoaded`, che su un livello non nativo
              finisce col mandare una richiesta vera di completamento (`max_tokens: 1`)
              per controllare se il modello e pronto. Cioe una chiamata fatturata per
              ogni prompt e per ogni cambio di modello, piu una latenza che l'utente
              leggeva come un attesa.

              Quindi in cloud spariscono, e al loro posto c'e una riga che dice cosa
              vale la pena sapere. Non si lascia il vuoto: un vuoto sembra una
              impostazione dimenticata.
            */}
            {cloudProvider ? (
              <div className="inline-message is-quiet">
                <strong>Nothing to load.</strong> {providerSpec(appSettings.provider).label} serves the
                model, so there is no download and no wait. The only thing that has to be in place is
                the API key, in Connection.
              </div>
            ) : (
              <>
                <Toggle
                  label="Load model when I start typing"
                  description="Preloads the selected model after 300 ms of typing."
                  checked={settings.preloadOnTyping}
                  onChange={(preloadOnTyping) => set({ preloadOnTyping })}
                />
                <Toggle
                  label="Keep only one model in memory"
                  description="Unloads other loaded chat models when the queue is idle."
                  checked={settings.singleModelInMemory}
                  onChange={(singleModelInMemory) => set({ singleModelInMemory })}
                />
                <Field label="Model load timeout (seconds)">
                  {(id) => (
                    <TextInput
                      id={id}
                      type="number"
                      min={1}
                      value={Math.round(settings.modelLoadTimeoutMs / 1000)}
                      onChange={(event) => set({ modelLoadTimeoutMs: Math.max(1, Number(event.currentTarget.value) || 1) * 1000 })}
                    />
                  )}
                </Field>
              </>
            )}
            <Field
              label="First token timeout (seconds)"
              help="A cold reasoning model can take ~30 s to emit its first token. Raise this if long waits are cut short."
            >
              {(id) => (
                <TextInput
                  id={id}
                  type="number"
                  min={5}
                  value={Math.round(settings.firstByteTimeoutMs / 1000)}
                  onChange={(event) => set({ firstByteTimeoutMs: Math.max(5, Number(event.currentTarget.value) || 5) * 1000 })}
                />
              )}
            </Field>
            {!cloudProvider ? (
              <div className="inline-message">LM Studio API level detected: <strong>{apiCapabilityLevel}</strong></div>
            ) : null}
          </section>
        </div>
      ) : null}

      {activeTab === 'generation' ? (
        <div className="settings-panel">
          {/*
            I default di campionamento sono del **workspace**, non dell'app: senza
            un workspace aperto non c'e nulla a cui appartengano. Scriverebbero
            nello store di bootstrap e sparisirebbero al prossimo riavvio,
            senza alcun avviso: meglio non offrire i controlli e dirlo.

            Il resto della scheda (streaming, coda, compattazione, prompt di
            fallback) e dell'app e resta disponibile ovunque.
          */}
          {hasWorkspace ? (
          <section className="settings-section">
            <h3>Sampling defaults</h3>
            <p>These values are global: every prompt in the workspace uses them. Thinking is the only per-prompt switch, on the prompt node.</p>
            {/*
              Questa riga e qui perche e la cosa che piu spesso si crede sbagliata:
              che in cloud la temperatura, il top-p e il massimo di token li scelga il
              provider. **Non e cosi.** Sono campi standard dell'API OpenAI-compatible,
              viaggiano nel corpo della richiesta, e Google AI Studio e NVIDIA NIM li
              applicano come li ricevono.

              Quindi toglierli non libererebbe da una scelta non propria: toglierebbe il
              controllo su tre cose che cambiano il risultato, e su una in particolare
              che e un tetto di spesa. Se un giorno un provider li ignorerasse, lo
              direbbe — e non accaderebbe in silenzio.
            */}
            {cloudProvider ? (
              <div className="inline-message is-quiet">
                <strong>These are sent to {providerSpec(appSettings.provider).label} as they are.</strong>{' '}
                It applies them, and the maximum output tokens is what caps what one answer can cost.
              </div>
            ) : null}
            {/*
              Il limite del provider, detto dove si sceglie il valore.

              Il caso reale e' Claude, che accetta la temperatura solo fino a 1 e riduce
              il valore senza rifiutarlo: il cursore andrebbe oltre, la richiesta
              partirebbe con 1, e il risultato sarebbe diverso da quello impostato senza
              che nulla lo segnalasse. Il cursore si ferma al limite e la riga sotto
              spiega perche', cosi' il limite si vede prima e non dopo la risposta.
            */}
            {spec.maxTemperature !== undefined && settings.defaults.temperature > spec.maxTemperature ? (
              <div className="inline-message warning">
                {spec.label} accepts a temperature from 0 to {spec.maxTemperature}. The value above
                would be reduced to {spec.maxTemperature} before the request is sent.
              </div>
            ) : null}
            <div className="two-column">
              <SliderField
                label="Temperature"
                value={settings.defaults.temperature}
                minimum={0}
                maximum={2}
                step={0.05}
                onChange={(temperature) => set({ defaults: { temperature } })}
              />
              <SliderField
                label="Top P"
                value={settings.defaults.topP}
                minimum={0}
                maximum={1}
                step={0.01}
                onChange={(topP) => set({ defaults: { topP } })}
              />
            </div>
            <Field label="Maximum output tokens" help="Use a positive value. With a reasoning model, 4000 or more leaves room for the thinking phase.">
              {(id) => (
                <TextInput
                  id={id}
                  type="number"
                  min={1}
                  value={settings.defaults.maxTokens}
                  onChange={(event) =>
                    set({ defaults: { maxTokens: Math.max(1, Number(event.currentTarget.value) || 1) } })
                  }
                />
              )}
            </Field>
            <Field label="Context warning threshold" help="This is a local estimate, not a hard context gate.">
              {(id) => (
                <TextInput
                  id={id}
                  type="number"
                  min={1}
                  value={settings.contextTokenWarning}
                  onChange={(event) =>
                    set({ contextTokenWarning: Math.max(1, Number(event.currentTarget.value) || 1) })
                  }
                />
              )}
            </Field>
          </section>
          ) : (
            <section className="settings-section">
              <h3>Sampling defaults</h3>
              <p>
                These belong to a workspace, not to the app, so they need one open.
                Create or open a workspace and they will be here.
              </p>
            </section>
          )}
          <section className="settings-section">
            <h3>Fallback system prompt</h3>
            <p>Used when a prompt has no connected system node.</p>
            <TextArea
              value={settings.defaults.systemPrompt}
              placeholder="You are a concise, helpful assistant."
              onChange={(event) => set({ defaults: { systemPrompt: event.currentTarget.value } })}
            />
            <Toggle
              label="Stream responses"
              description="Disable to use one non-streaming completion request."
              checked={settings.streaming}
              onChange={(streaming) => set({ streaming })}
            />
          </section>
          <section className="settings-section">
            <h3>Queue and compaction</h3>
            <Field label="Queue concurrency" help="LM Studio normally serializes requests on one model; values above 1 only help with parallel slots.">
              {(id) => (
                <TextInput
                  id={id}
                  type="number"
                  min={1}
                  max={4}
                  value={settings.queueConcurrency}
                  onChange={(event) => set({ queueConcurrency: Math.min(4, Math.max(1, Number(event.currentTarget.value) || 1)) })}
                />
              )}
            </Field>
            <Field label="Automatic compaction">
              {(id) => (
                <Select id={id} value={settings.autoCompact} onChange={(event) => set({ autoCompact: event.currentTarget.value as 'off' | 'ask' | 'auto' })}>
                  <option value="off">Off</option>
                  <option value="ask">Ask before a large run</option>
                  <option value="auto">Compact automatically</option>
                </Select>
              )}
            </Field>
            <Field label="Summary max tokens">
              {(id) => (
                <TextInput
                  id={id}
                  type="number"
                  min={1}
                  value={settings.compactMaxTokens}
                  onChange={(event) =>
                    set({ compactMaxTokens: Math.max(1, Number(event.currentTarget.value) || 1) })
                  }
                />
              )}
            </Field>
          </section>
        </div>
      ) : null}

      {activeTab === 'appearance' ? (
        <div className="settings-panel">
          <section className="settings-section">
            <h3>Theme</h3>
            <Field label="Color theme">
              {(id) => (
                <Select
                  id={id}
                  value={settings.theme}
                  onChange={(event) =>
                    set({ theme: event.currentTarget.value as 'dark' | 'light' })
                  }
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </Select>
              )}
            </Field>
            <Field label="Look">
              {() => (
                <div className="look-grid" role="radiogroup" aria-label="Look">
                  {APPEARANCES.map((look) => (
                    <button
                      key={look.id}
                      type="button"
                      role="radio"
                      aria-checked={settings.appearance === look.id}
                      className={`look-card ${settings.appearance === look.id ? 'is-on' : ''}`}
                      onClick={() => set({ appearance: look.id })}
                      title={look.blurb}
                    >
                      {/*
                        Il campione: quattro rettangoli nella forma e nei colori
                        dell'aspetto, non una sua descrizione. Il nome dice «Google» e
                        non dice niente di come appare; il campione lo dice. Ed e' anche
                        l'unico modo per capire quale dei due accenti si vede meglio
                        sul proprio schermo senza dover provarli uno alla volta.
                      */}
                      <span className={`look-swatch look-swatch-${look.id}`} aria-hidden>
                        <span className="look-swatch-bar" />
                        <span className="look-swatch-card" />
                        <span className="look-swatch-btn" />
                      </span>
                      <span className="look-name">{look.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </Field>
            <p className="settings-hint">
              Independent of dark and light: it chooses the shape and the material, not
              the colours. It applies immediately, so you can compare without saving.
            </p>
          </section>
          {/*
            La dimensione sta nella sezione che riguarda **come si vede**, e non in
            Generazione: non cambia nessun testo che viene mandato a un provider, quindi
            non e' un'impostazione del modello.

            Il cursore e su `preferences` e non su `appSettings` perche' e una cosa della
            macchina: le stesse impostazioni devono restare leggibili su un portatile da
            13 pollici e su un monitor grande, e chi se lo ricorda e' l'utente di quel
            computer, non il documento.
          */}
          <section className="settings-section">
            <h3>Size</h3>
            <SliderField
              label="Interface size"
              value={preferences.uiScale}
              minimum={UI_SCALE_MIN}
              maximum={UI_SCALE_MAX}
              step={UI_SCALE_STEP}
              onChange={(uiScale) =>
                useUiStore.getState().setPreferences({ uiScale: sanitizeUiScale(uiScale) })
              }
              format={(value) => `${Math.round(value * 100)}%`}
            />
            <p className="settings-hint">
              Applies immediately and is remembered on this computer. It scales the whole
              interface, not only the text, so a small laptop fits more of the graph and a
              large monitor makes everything easier to read.
            </p>
            {preferences.uiScale !== 1 ? (
              <Button
                size="small"
                onClick={() => useUiStore.getState().setPreferences({ uiScale: 1 })}
              >
                Back to 100%
              </Button>
            ) : null}
          </section>
          <section className="settings-section">
            <h3>Canvas</h3>
            <Field label="Edge style">
              {(id) => (
                <Select
                  id={id}
                  value={preferences.edgeStyle}
                  onChange={(event) =>
                    useUiStore.getState().setPreferences({
                      edgeStyle: event.currentTarget.value as 'default' | 'smoothstep',
                    })
                  }
                >
                  <option value="default">Bezier</option>
                  <option value="smoothstep">Smooth step</option>
                </Select>
              )}
            </Field>
            <Toggle
              label="Show minimap"
              checked={preferences.minimapOpen}
              onChange={(minimapOpen) => useUiStore.getState().setPreferences({ minimapOpen })}
            />
            <Toggle
              label="Reopen tabs on startup"
              description="Restore the tabs from the previous session. The Home page is always shown first."
              checked={preferences.reopenTabsOnStartup}
              onChange={(reopenTabsOnStartup) =>
                useUiStore.getState().setPreferences({ reopenTabsOnStartup })
              }
            />
          </section>
          <section className="settings-section">
            <h3>Developer</h3>
            <Toggle
              label="Developer mode"
              description="Off by default. When on, the top bar gets a button to open the inspector, which lists every stored field of the selected node. Useful when writing prompts or debugging the graph; it covers part of the canvas, so it stays out of the way otherwise."
              checked={preferences.developerMode}
              onChange={(developerMode) => {
                useUiStore.getState().setPreferences({ developerMode })
                if (!developerMode) {
                  useUiStore.getState().setPreferences({ inspectorOpen: false })
                }
              }}
            />
          </section>
        </div>
      ) : null}

      {activeTab === 'data' ? (
        <div className="settings-panel">
          <section className="settings-section">
            <h3>Workspace file</h3>
            <p>Exports contain nodes, edges, settings, viewport, and document version.</p>
            <div className="inspector-actions">
              <Button icon={<Download size={12} />} onClick={exportWorkspace}>Export JSON</Button>
              <Button icon={<Upload size={12} />} onClick={() => importRef.current?.click()}>Import JSON</Button>
              <Button icon={<FilePlus2 size={12} />} onClick={requestNewWorkspace}>New workspace</Button>
            </div>
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (file) void readImportFile(file)
                event.currentTarget.value = ''
              }}
            />
          </section>
          <section className="settings-section">
            <h3>Local storage</h3>
            <div className="inline-message">
              <Database size={11} style={{ verticalAlign: '-2px', marginRight: 5 }} />
              Current workspace: {storageUsageKb().toFixed(0)} KB · autosave key nchat.workspace.v1
            </div>
            <div className="inspector-actions">
              <Button icon={<Save size={12} />} onClick={() => forceSave(true)}>Save now</Button>
              <Button
                icon={<RotateCcw size={12} />}
                disabled={!workspaceBackupExists()}
                onClick={() => restoreLocalBackup()}
              >
                Restore local backup
              </Button>
            </div>
          </section>
          <section className="settings-section">
            <h3>Danger zone</h3>
            <p>Type DELETE to remove every NCHAT key, including the local backup.</p>
            <TextInput
              value={clearText}
              placeholder="DELETE"
              aria-label="Type DELETE to confirm data removal"
              onChange={(event) => setClearText(event.currentTarget.value)}
            />
            <Button
              variant="danger"
              icon={<Trash2 size={12} />}
              disabled={clearText !== 'DELETE'}
              onClick={deleteAllData}
            >
              Delete all local data
            </Button>
          </section>
        </div>
      ) : null}

      {activeTab === 'help' ? (
        <div className="settings-panel">
          <section className="settings-section">
            <h3>
              <CircleHelp size={13} style={{ verticalAlign: '-2px' }} />{' '}
              {cloudProvider ? `Connect ${spec.label}` : 'Connect LM Studio'}
            </h3>
            {/*
              I passi cambiano con il provider, e i due insiemi non hanno niente in
              comune: in locale si avvia un programma e si sceglie un indirizzo, in
              cloud si mette una chiave e si avvia il servizio locale che la tiene.
              Mostrare i passi di LM Studio a chi ha scelto Google era la stessa
              confusione della scheda Connection, ripetuta qui.
            */}
            <div className="onboarding-steps">
              {cloudProvider ? (
                <>
                  <div className="onboarding-step"><span className="onboarding-step-number">1</span><span>Paste the API key in Connection, above. It is held by the local service in memory only.</span></div>
                  <div className="onboarding-step"><span className="onboarding-step-number">2</span><span>Make sure the local service is running: it starts with NCHAT, from the tray icon.</span></div>
                  <div className="onboarding-step"><span className="onboarding-step-number">3</span><span>Return here and press Test connection.</span></div>
                </>
              ) : (
                <>
                  <div className="onboarding-step"><span className="onboarding-step-number">1</span><span>Open LM Studio and load any chat model.</span></div>
                  <div className="onboarding-step"><span className="onboarding-step-number">2</span><span>Open Developer and start the server. The default URL is http://localhost:1234/v1.</span></div>
                  <div className="onboarding-step"><span className="onboarding-step-number">3</span><span>Return here and press Test connection.</span></div>
                </>
              )}
            </div>
            <div className="inline-message">
              {cloudProvider ? (
                <>
                  The key never leaves this machine: the page does not send it, and the local
                  service keeps it in memory. It is gone when the service stops, so you enter it
                  again after a restart — that is the trade for never writing it to disk.
                </>
              ) : (
                <>
                  Direct mode requires LM Studio → Developer → Allow all origins, or start it with <code>lms server start --yolo</code>. Development mode normally uses the Vite proxy and needs no CORS change.
                </>
              )}
            </div>
            {cloudProvider ? (
              <a className="btn" href={spec.keysUrl ?? 'https://aistudio.google.com/apikey'} target="_blank" rel="noreferrer">
                Where do I get the key?
              </a>
            ) : (
              <a className="btn" href="https://lmstudio.ai/docs" target="_blank" rel="noreferrer">Open LM Studio documentation</a>
            )}
          </section>
          <section className="settings-section">
            <h3><Layers3 size={13} style={{ verticalAlign: '-2px' }} /> Grouping answers</h3>
            <p>
              Select two or more <strong>response</strong> nodes, right-click, and choose
              <strong> Group N answers into one output</strong>. You get a single Output node placed
              next to the selection, with a dashed frame drawn around the answers that produced it.
              That output has one output handle: plug it into the next prompt to use the whole group
              as context. Grouping prompts instead is a separate menu entry and takes the answers
              those prompts produced.
            </p>
            <p>
              Temperature, top-p and max output tokens are global and live here, in Generation.
              The only per-prompt switch is <strong>Thinking</strong>, next to Run on the prompt
              node: switch it off and the run sends <code>reasoning_effort: "none"</code> so a
              reasoning model answers without thinking first.
            </p>
          </section>
          <section className="settings-section">
            <h3><SlidersHorizontal size={13} style={{ verticalAlign: '-2px' }} /> Keyboard shortcuts</h3>
            <div className="inspector-grid">
              <Shortcut keys="Tab" action="Open node palette" />
              {/*
                `Ctrl+K` sta qui e **non** sulla palette. Per un tempo lo stesso tasto
                apriva entrambe, una sopra l'altra, e l'utente non sapeva quale delle
                due stesse guardando — mentre quella sotto rubava i tasti a quella
                sopra. Un tasto, un'azione: `Tab` aggiunge, `Ctrl+K` cerca.
              */}
              <Shortcut keys="Ctrl K" action="Search words in this workspace" />
              <Shortcut keys="Ctrl Enter" action="Run prompt, or N prompts in topological order" />
              <Shortcut keys="Ctrl C / X / V" action="Copy / cut / paste nodes" />
              <Shortcut keys="Ctrl D" action="Duplicate selection" />
              <Shortcut keys="F" action="Fit view" />
              <Shortcut keys="A" action="Auto-layout" />
              <Shortcut keys="1" action="Reset zoom" />
              <Shortcut keys="Ctrl S" action="Save now" />
              <Shortcut keys="Ctrl E" action="Export" />
              <Shortcut keys="Ctrl ," action="Open settings" />
              <Shortcut keys="Arrows" action="Nudge selection" />
              <Shortcut keys="Delete" action="Delete selection" />
              <Shortcut keys="Alt N" action="New workspace (Home)" />
              <Shortcut keys="Alt T" action="New workspace in a new tab" />
              <Shortcut keys="Alt W" action="Close active tab" />
              <Shortcut keys="Alt H" action="Go to Home" />
              <Shortcut keys="Alt PgDn / PgUp" action="Next / previous tab" />
              <Shortcut keys="Alt 1..9" action="Go to tab N" />
            </div>
            <div className="inline-message">
              Browser-reserved shortcuts (Ctrl T, Ctrl W, Ctrl N, Ctrl Tab, Ctrl 1..9) are
              never intercepted: a page cannot receive them reliably.
            </div>
          </section>
          <section className="settings-section">
            <h3><Palette size={13} style={{ verticalAlign: '-2px' }} /> Privacy</h3>
            <p>NCHAT has no account, telemetry, analytics, cookies, or backend. Workspace data stays in this browser profile (IndexedDB database nchat) unless you export it. Only the base URL you configure is contacted.</p>
          </section>
        </div>
      ) : null}
    </Modal>
  )
}

function Shortcut({ keys, action }: { keys: string; action: string }) {
  return (
    <div className="inspector-value">
      <span className="kbd">{keys}</span><br />
      <strong>{action}</strong>
    </div>
  )
}
