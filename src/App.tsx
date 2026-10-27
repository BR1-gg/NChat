import { ReactFlowProvider } from '@xyflow/react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { FlowCanvas } from './components/canvas/FlowCanvas'
import { HomePage } from './components/home/HomePage'
import { Inspector } from './components/inspector/Inspector'
import { RequestPreview } from './components/inspector/RequestPreview'
import { NodePalette } from './components/palette/NodePalette'
import { TabBar } from './components/tabs/TabBar'
import { ConfirmDialog } from './components/shell/ConfirmDialog'
import { QueuePanel } from './components/shell/QueuePanel'
import { ImportDialog } from './components/shell/ImportDialog'
import { SearchBar } from './components/canvas/SearchBar'
import { SearchHighlight } from './components/canvas/SearchHighlight'
import { KnowledgeView } from './components/knowledge/KnowledgeView'
import { SaveKnowledgeDialog } from './components/knowledge/SaveKnowledgeDialog'
import { CompactDialog } from './components/shell/CompactDialog'
import { LogDialog } from './components/shell/LogDialog'
import { SettingsDialog } from './components/shell/SettingsDialog'
import { StatusBar } from './components/shell/StatusBar'
import { Toasts } from './components/shell/Toasts'
import { TopBar } from './components/shell/TopBar'
import { UsageDialog } from './components/shell/UsageDialog'
import { WorkspaceConflictDialog } from './components/shell/WorkspaceConflictDialog'
import { useAppSettingsPersistence } from './hooks/useAppSettingsPersistence'
import { useAutosave } from './hooks/useAutosave'
import { useClipboard } from './hooks/useClipboard'
import { useConnection } from './hooks/useConnection'
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { installGlobalErrorHandlers, log, restoreLog } from './logging/logger'
import { getRepository } from './persistence/bootstrap'
import { sanitizeAppSettings } from './persistence/storage'
import { initInstallPrompt } from './pwa/install'
import { navigate, useHashRoute } from './router'
import { useRunStore } from './store/runStore'
import { useTabsStore } from './store/tabsStore'
import { useUiStore } from './store/uiStore'
import { hydrateUsage } from './store/usageStore'
import { workspaceRegistry } from './store/workspaceRegistry'
import {
  WorkspaceStoreProvider,
  type WorkspaceStoreApi,
} from './store/workspaceStore'
import { DEFAULT_APP_SETTINGS } from './types/settings'

function WorkspaceContent({ testConnection }: { testConnection: () => void }) {
  useAutosave()
  useKeyboardShortcuts()
  useClipboard()
  const dialog = useUiStore((state) => state.dialog)
  const paletteOpen = useUiStore((state) => state.paletteOpen)
  const selectedNodeId = useUiStore((state) => state.selectedNodeId)
  const runningCount = useRunStore((state) => Object.keys(state.runs).length)
  const announcement = useUiStore((state) => state.announcement)

  return (
    <div className="app-shell">
      <TopBar />
      <main className="app-main">
        <FlowCanvas onTestConnection={testConnection} />
        <Inspector />
      </main>
      <StatusBar />
      {paletteOpen ? <NodePalette /> : null}
      {/*
        Sta **dentro** il workspace, e non junto alla finestra di ricerca, perche'
        evidenzia un nodo: i nodi esistono solo qui. Montata fuori, non avrebbe niente
        su cui lavorare — e il difetto sarebbe silenzioso, perche' l'evidenziatura e'
        una cosa che quando manca non si vede, si sente la sua assenza.
      */}
      <SearchHighlight />
      {dialog === 'preview' && selectedNodeId ? (
        <RequestPreview promptId={selectedNodeId} />
      ) : null}
      <ImportDialog />
      <QueuePanel />
      <div className="visually-hidden" aria-live="polite">
        {announcement || (runningCount > 0 ? `${runningCount} generations running` : 'No generations running')}
      </div>
    </div>
  )
}

function WorkspaceRuntime({ store, children }: { store: WorkspaceStoreApi; children: ReactNode }) {
  return (
    <ReactFlowProvider>
      <WorkspaceStoreProvider store={store}>{children}</WorkspaceStoreProvider>
    </ReactFlowProvider>
  )
}

function WorkspaceBoundary({
  workspaceId,
  testConnection,
}: {
  workspaceId: string
  testConnection: () => void
}) {
  const [store, setStore] = useState<WorkspaceStoreApi | null>(
    () => workspaceRegistry.get(workspaceId) ?? null,
  )

  useEffect(() => {
    let cancelled = false
    workspaceRegistry.activate(workspaceId)
    void getRepository().then(async (repository) => {
      const existing = workspaceRegistry.get(workspaceId)
      if (existing && !existing.getState().dirty) {
        if (!cancelled) setStore(existing)
        return
      }
      const loaded = await repository.load(workspaceId)
      if (cancelled) return
      if (!loaded) {
        useUiStore.getState().addToast({
          tone: 'error',
          title: 'Workspace not found',
          message: 'It may have been deleted in another window.',
          sticky: true,
        })
        navigate({ name: 'home' })
        return
      }
      const next = workspaceRegistry.open(
        workspaceId,
        loaded.document,
        loaded.meta.revision,
      )
      next.getState().hydrateAppSettings(useUiStore.getState().appSettings)
      workspaceRegistry.activate(workspaceId)
      setStore(next)
    })
    return () => {
      cancelled = true
      /*
       * Disattiva il workspace uscente.
       *
       * Senza questo `activeWorkspaceId` restava impostato sull'ultimo workspace
       * aperto per sempre, anche una volta tornati alla Home. Non si vedeva in
       * nessun test, perche ogni test parte gia su un workspace o non usa il
       * registry, ma cambiava la risposta a "c'e un workspace aperto": i campi
       * che appartengono al workspace sembravano disponibili dalla Home e
       * scrivevano dove non era nessuno.
       *
       * Il cleanup gira prima dell'effetto della rotta nuova, quindi se si
       * cambia workspace l'ordine è disattiva, poi attiva.
       */
      workspaceRegistry.activate(null)
    }
  }, [workspaceId])

  if (!store) {
    return <div className="app-loading"><span className="spinner" /> Opening workspace…</div>
  }
  return (
    <WorkspaceRuntime store={store} key={workspaceId}>
      <WorkspaceContent testConnection={testConnection} />
    </WorkspaceRuntime>
  )
}

export default function App() {
  useGlobalShortcuts()
  // Sul disco, e su ogni rotta: sta qui perche dentro `useAutosave`, che gira
  // solo con un workspace aperto, una scelta fatta dalla Home non veniva salvata
  // e al riavvio tornava indietro.
  useAppSettingsPersistence()
  /*
   * Il registro. estoreLog **prima** di qualunque altra scrittura: senza, le
   * voci della sessione precedente verrebbero sovrascritte da un primo setItem con
   * l'anello ancora vuoto — il modo piu veloce per perdere esattamente il log che
   * serviva, cioe quello dell'errore che ha fatto cadere la pagina.
   */
  useEffect(() => {
    const restored = restoreLog()
    installGlobalErrorHandlers()
    if (restored > 0) {
      log.info('app', `Ripristinate ${restored} voci dalla sessione precedente.`)
    }
  }, [])
  const route = useHashRoute()
  const [ready, setReady] = useState(false)
  const theme = useUiStore((state) => state.appSettings.theme)
  const appearance = useUiStore((state) => state.appSettings.appearance ?? 'default')
  const uiScale = useUiStore((state) => state.preferences.uiScale)
  /*
   * La connessione a LM Studio e dell'applicazione, non di un workspace: la
   * stessa macchina, lo stesso server, la stessa coda. Sta qui perche i Settings
   * sono disponibili anche dalla Home, e perche `useConnection` avvia un
   * sondaggio: chiamarlo anche dentro il workspace avrebbe duplicato il timer e
   * fatto due richieste al doppio.
   */
  const { checkConnection } = useConnection()
  const testConnection = useCallback((): void => {
    void checkConnection(true)
  }, [checkConnection])

  // Listen once for the browser's install event. The manifest is served in
  // development too, so this works while the dev server is running.
  useEffect(() => initInstallPrompt(), [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    // An attribute, like the theme, so the stylesheets can key off it. Set even
    // when it is the default so `:root[data-appearance='default']` is never a
    // special case that a saved document can fall out of.
    document.documentElement.dataset.appearance = appearance
  }, [appearance])

  useEffect(() => {
    /*
     * La dimensione della UI come una variabile CSS, e non con uno stile in linea.
     *
     * Una variabile lascia il valore nel CSS (`:root { zoom: var(--ui-scale) }`), quindi
     * chi legge i fogli di stile vede **perche'** il testo e' grande e non trova un
     * numero moltiplicato sparso in un effetto. Un attributo `style` in linea
     * verrebbe dopo tutto quello che gia' fa il tema e l'aspetto, e qui non c'e'
     * niente da mettere su un attributo perche' il valore e' un numero, non un nome.
     */
    document.documentElement.style.setProperty('--ui-scale', String(uiScale))
  }, [uiScale])

  useEffect(() => {
    let cancelled = false
    void getRepository().then(async (repository) => {
      const appSettings = sanitizeAppSettings(
        (await repository.getAppState<unknown>('appSettings')) ?? DEFAULT_APP_SETTINGS,
      )
      const openTabs = (await repository.getAppState<string[]>('openTabs')) ?? []
      const activeTab = (await repository.getAppState<string>('activeTabId')) ?? 'home'
      const preferences = await repository.getAppState<{
        reopenTabsOnStartup?: boolean
      }>('uiPreferences')
      if (cancelled) return
      useUiStore.getState().setAppSettings(appSettings)
      if (preferences) useUiStore.getState().setPreferences(preferences)
      // I consumi si leggono qui, insieme al resto: il bottone nella barra mostra la
      // spesa e senza questo mostrerebbe zero per qualche millisecondo a ogni avvio,
      // e un utempo' se ne accorgerebbe come di un conteggio che si azzera.
      hydrateUsage()
      if (preferences?.reopenTabsOnStartup !== false) {
        useTabsStore.getState().hydrate(openTabs, activeTab)
      } else {
        useTabsStore.getState().hydrate([], 'home')
      }
      if (repository.kind === 'memory') {
        useUiStore.getState().addToast({
          tone: 'warning',
          title: 'IndexedDB is unavailable',
          message: 'Changes are kept in memory only and will not survive a reload.',
          sticky: true,
        })
      }
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // A deep link such as #/w/<id> must always own a visible tab.
  useEffect(() => {
    if (!ready) return
    if (route.name === 'workspace' && !useTabsStore.getState().tabs.includes(route.workspaceId)) {
      useTabsStore.getState().openTab(route.workspaceId)
    } else if (route.name === 'home' && useTabsStore.getState().activeId !== 'home') {
      useTabsStore.getState().activate('home')
    }
  }, [ready, route])

  useEffect(() => {
    if (!ready) return
    const persist = (): void => {
      void getRepository().then((repository) =>
        Promise.all([
          repository.setAppState('openTabs', useTabsStore.getState().tabs),
          repository.setAppState('activeTabId', useTabsStore.getState().activeId),
          repository.setAppState('uiPreferences', useUiStore.getState().preferences),
        ]),
      )
    }
    persist()
    const unsubTabs = useTabsStore.subscribe(persist)
    const unsubPrefs = useUiStore.subscribe(persist)
    return () => {
      unsubTabs()
      unsubPrefs()
    }
  }, [ready])

  if (!ready) {
    return <div className="app-loading"><span className="spinner" /> Loading NCHAT…</div>
  }

  return (
    <div className="app-root">
      <TabBar route={route} />
      {route.name === 'workspace' ? (
        <WorkspaceBoundary workspaceId={route.workspaceId} testConnection={testConnection} />
      ) : route.name === 'knowledge' ? (
        /*
          La conoscenza e' una **rotta**, non una finestra, e la differenza non e' di
          comodita' ma diche cosa sia.

          Una finestra coprirebbe il contenuto, e il contenuto da cui si salvano le note e'
          proprio il grafo: aprire l'archivio su una finestra sopra il workspace significerebbe
          non poter selezionare un passaggio e salvarlo senza chiudere e riaprire. E una
          finestra sopra la Home non avrebbe niente da coprire, quindi la stessa cosa
          dovrebbe essere due cose diverse a seconda della pagina.

          Come rotta e' sempre la stessa cosa, e il workspace resta **aperto** dietro: si
          salva una nota, si torna al grafo, e la nota e' gia' li. Il tab del workspace non si
          chiude, e questo e' il motivo per cui non e' una scheda: non si duplica, non si
          rinomina, non si chiude.
        */
        <KnowledgeView />
      ) : (
        <HomePage />
      )}
      <Toasts />
      <WorkspaceConflictDialog />
      {/*
        Settings sta qui e non dentro `WorkspaceContent`.
        Sta qui perche e una finestra **dell'applicazione**, non di un workspace:
        la connessione a LM Studio, l'aspetto e l'installazione sono le stesse
        su ogni pagina. Dentro lo shell del workspace non esisteva affatto quando
        la rotta era Home, che e la pagina in cui si atterra e l'unica che
        esiste quando non c'e ancora un workspace: da li si arrivava ai Settings
        solo con Ctrl+, e il bottone semplicemente non c'era.

        Non perde il workspace aperto: senza il provider il suo store arriva lo
        stesso da `getActiveWorkspaceStore()`, che `workspaceRegistry.activate`
        ha gia impostato sul workspace corrente.
      */}
      <SettingsDialog onTestConnection={testConnection} />
      {/*
        La ricerca e' l'unica cosa che si apre **mentre** si lavora, quindi sta fuori
        dallo shell del workspace come le altre finestre ma senza essere modale: il
        grafo resta vivo dietro, e scegliendo un risultato si torna al nodo con il
        cursore dentro. Una finestra che chiude tutto il resto sarebbe la forma
        sbagliata per una ricerca — e sarebbe anche inutile, perche' i risultati sono
        nodi che stanno li' dietro e li si vuole vedere arrivare.
      */}
      <SearchBar />
      {/*
        «Dove la metto?» sta qui e non dentro il workspace, e non per un ordine di comodo'.
        E' una domanda sull'**archivio**, che e' uno per applicazione e vive fuori da tutti
        i workspace: la si chiede da una risposta, si risponde da qualunque parte, e il
        testo che si salva attraversa i confini che il workspace non attraversa. Dentro lo
        shell del workspace esisterebbe solo li', e la stessa finestra dovrebbe essere due
        cose diverse a seconda della pagina da cui si e' arrivati.
      */}
      <SaveKnowledgeDialog />
      <LogDialog />
      {/*
        I consumi sono una finestra **dell'applicazione**, come i Settings: la spesa
        e della persona, non del grafo, e deve aprirsi anche dalla Home. E per questo
        i record vivono in `appState` e non nel documento.
      */}
      <UsageDialog />
      {/*
        La compattazione e' una finestra **dell'applicazione** e non del workspace,
        per lo stesso motivo dei consumi: mostra un contesto e un riassunto, e
        nessuna delle due cose appartiene a un grafo in particolare. Sta qui e non
        dentro `WorkspaceShell` perche' cosi' si puo' aprire anche dalla Home, dove
        non esiste ancora un nodo su cui premerla ma il collegamento e comunque
        previsto.
      */}
      <CompactDialog />
      {/*
        La conferma sta **qui** e non dentro il workspace, e non per un ordine di comodo'.

        «Chiedere prima di farlo» e' una cosa dell'applicazione, non di un grafo: e' lo
        stesso gesto per tutti — cancellare una nota dell'archivio, chiudere una scheda,
        sostituire un workspace. Montata dentro il workspace esisteva solo li', e la prima
        cosa che e' capitata fuori e' stata proprio la conferma per la cancellazione di una
        nota: il pulsante premuto e nessuna finestra, quindi **niente era successo e non si
        vedeva niente**. Il difetto peggiore di tutti, perche' sembra un pulsante morto.

        Qui sopra funziona da qualunque pagina, che e' l'unica cosa che serve a una conferma.
      */}
      <ConfirmDialog />
    </div>
  )
}
