import { create } from 'zustand'
import type { ProviderId } from '../logic/providers'
import type { AddableNodeType, NodeId, WorkspaceDocument } from '../types/document'
import type { AppError } from '../types/errors'
import type { ModelInfo } from '../llm/types'
import {
  cloneAppSettings,
  DEFAULT_APP_SETTINGS,
  DEFAULT_UI_PREFERENCES,
  sanitizeUiScale,
  type AppSettings,
  type UiPreferences,
} from '../types/settings'
import { loadUiPreferences, saveUiPreferences } from '../persistence/storage'
import type { KnowledgeDraft } from '../types/knowledge'
import type { XYPosition } from '@xyflow/react'

export type DialogName =
  | 'settings'
  | 'preview'
  | 'help'
  | 'log'
  | 'usage'
  | 'compact'
  | 'save-knowledge'
  | null
export type SettingsTab = 'connection' | 'generation' | 'appearance' | 'data' | 'help'

/**
 * The archive the shared search window is looking into.
 *
 * Due valori e non uno perche' il pannello e' uno solo e i due archivi sono due mondi
 * diversi: il grafo sta nel workspace, la conoscenza sta fuori da tutti i workspace e ha
 * i suoi centri di contesto. Fonderli in un unico elenco sarebbe una terza cosa che non e'
 * nessuno dei due, e una ricerca che cerca in un posto dove non c'e' niente e' peggio di
 * una ricerca che non c'e'.
 */
export type SearchScope = 'workspace' | 'knowledge'

/**
 * Why the selected provider cannot answer.
 *
 * Carries the reason and what to do about it, not just a sentence, because the top
 * bar has to offer the action itself: "no key" and "the local service is not
 * running" look the same from the model dropdown and need different things done
 * about them.
 */
export interface ProviderBlock {
  provider: ProviderId
  reason: 'no-key' | 'no-address' | 'service-down' | 'refused'
  message: string
  action: 'open-settings' | 'start-service' | 'none'
}
export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'loading-model'
  | 'no-model'
  | 'offline'
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
export type ToastTone = 'info' | 'success' | 'warning' | 'error'

export interface Toast {
  id: string
  tone: ToastTone
  title: string
  message?: string
  sticky?: boolean
  actionLabel?: string
  onAction?: () => void
}

export interface ContextMenuState {
  x: number
  y: number
  nodeId: NodeId | null
  selectedIds?: NodeId[]
}

export interface ConfirmState {
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  /** When present, cancelling performs an action instead of just dismissing. */
  onCancel?: () => void
}

interface UiState {
  paletteOpen: boolean
  palettePosition: { x: number; y: number } | null
  paletteFilter: AddableNodeType | null
  /**
   * Set when the palette was opened by releasing a dragged handle on empty
   * canvas. The palette then offers only the node types that would connect, and
   * picking one creates it **and** wires it, which is the whole point: the
   * alternative was offering the full list and refusing afterwards, with a node
   * already created that the user has to delete.
   */
  paletteConnect: { sourceId: NodeId; sourceHandle: string | null } | null
  pendingResponseId: NodeId | null
  dialog: DialogName
  settingsTab: SettingsTab
  /**
   * The node the compaction window was opened from.
   *
   * Non il prompt: la finestra si apre da **qualsiasi** nodo, e deve sapere quale,
   * perche' il prompt e' quello che si risolve a partire. Tenere il nodo premuto e
   * non il prompt gia' risolto permette di ricalcolarlo quando la tela cambia
   * mentre la finestra e' aperta.
   */
  compactNodeId: NodeId | null
  /**
   * The Summary node the current compaction is writing into.
   *
   * Vive nello store e non in uno stato locale della finestra perche' debba
   * azzerarsi **quando la finestra si apre**, e l'apertura e' un'azione, non un
   * effetto. Azzerarlo in un `useEffect` al cambio di nodo funzionerebbe, ma
   * costerebbe un render in piu' a ogni apertura e mostrierebbe per un fotogramma
   * il riassunto della compattazione precedente.
   */
  compactSummaryId: NodeId | null
  selectedNodeId: NodeId | null
  focusNodeId: NodeId | null
  insertionPosition: XYPosition
  topMenuOpen: boolean
  contextMenu: ContextMenuState | null
  /**
   * Why the selected provider cannot answer, or `null` when it can.
   *
   * Lives here and not in a throw because the top bar is where the user has to be
   * told: a provider with no key does not throw, it simply has no models, and an
   * empty dropdown with no explanation is indistinguishable from a bug.
   */
  providerBlock: ProviderBlock | null
  queuePanelOpen: boolean
  confirm: ConfirmState | null
  toasts: Toast[]
  /** Latest message for the polite aria-live region (queue, model loading). */
  announcement: string
  addAnnouncement: (message: string) => void
  saveStatus: SaveStatus
  lastRequestTokens: number
  connectionStatus: ConnectionStatus
  models: ModelInfo[]
  connectionLatencyMs: number | null
  connectionError: AppError | null
  apiCapabilityLevel: 'native-v1' | 'beta-v0' | 'openai-compatible' | 'unknown'
  lastConnectionCheck: number | null
  importCandidate: WorkspaceDocument | null
  workspaceConflict: { workspaceId: string; currentRevision: number } | null
  promptErrors: Record<NodeId, AppError>
  preferences: UiPreferences
  appSettings: AppSettings

  openPalette: (
    position?: { x: number; y: number } | null,
    filter?: AddableNodeType | null,
    connect?: { sourceId: NodeId; sourceHandle: string | null } | null,
  ) => void
  closePalette: () => void
  setPendingResponse: (id: NodeId | null) => void
  openDialog: (dialog: DialogName, tab?: SettingsTab, nodeId?: NodeId) => void
  closeDialog: () => void
  setSelectedNode: (id: NodeId | null) => void
  /**
   * Whether the search bar is on screen.
   *
   * A flag e non un dialogo come gli altri, perche' la ricerca e' l'unica finestra
   * che si apre **mentre** si lavora: il grafo resta vivo dietro, e il risultato va
   * scelto e poi si torna al nodo con il fuoco gia' dentro. Un dialogo che chiude
   * tutto il resto — come i Settings — sarebbe la forma sbagliata per questa cosa.
   */
  searchOpen: boolean
  /** What is typed in the search bar. Lives here so the bar and the results agree. */
  searchQuery: string
  /**
   * Which archive the same search window is looking into.
   *
   * La finestra e' **una sola** e si presenta uguale in entrambi i posti — stessa casella,
   * stessa lista, stesse frecce — e cambia solo cio' che cerca. Senza questo campo le due
   * copie della finestra sarebbero due finestre, e su una schermata che le mostra insieme
   * sarebbero due finestre aperte, con due campi che si rubano i tasti: esattamente il
   * difetto che `shortcutBindings.test.ts` racconta per `Ctrl+K`, ma per la ricerca.
   *
   * Sta nello store e non come prop perche' a decidere quale archivio guardare e' una
   * scelta di **dove si e'**, e quello e' gia' nello store: la pagina dell'archivio non
   * deve poter chiedere una ricerca sul grafo mentre si guarda la mappa.
   */
  searchScope: SearchScope
  openSearch: (scope?: SearchScope) => void
  closeSearch: () => void
  setSearchQuery: (query: string) => void
  /**
   * The node a search result pointed at, and the words to light up inside it.
   *
   * Vive **dopo** che la finestra si e' chiusa, perche' e' il momento in cui serve:
   * la ricerca fa trovare il nodo, e il nodo lo si guarda. Senza questo, scegliere un
   * risultatocentering il nodo lascerebbe l'utente davanti a un testo lungo senza
   * sapere **dove** e' la parola cercata — cioe' gli avrebbe rifatto il lavoro che la
   * ricerca aveva appena finito.
   *
   * `terms` e' la lista, non una stringa sola: con due parole cercate sono due cose da
   * mostrare, e segnalarne una lascerebbe il dubbio che l'altra non ci sia.
   */
  searchTarget: { nodeId: NodeId; terms: string[] } | null
  setSearchTarget: (target: { nodeId: NodeId; terms: string[] } | null) => void
  /**
   * Il passaggio scelto dall'utente, in attesa che dica **dove** metterlo.
   *
   * Vive qui e non dentro la finestra perche' il testo non deve cambiare fra il momento
   * in cui l'utente lo ha sottolineato e il momento in cui conferma: il pulsante ha gia'
   * letto la selezione, e rileggerla dopo che la finestra si e' aperta rischierebbe di
   * salvare un testo diverso da quello che l'utente credeva di aver salvato. E' un
   * difetto invisibile: la nota risulta salvata, con un titolo che ha senso, e con dentro
   * parole che non sono mai state scelte.
   */
  knowledgeDraft: KnowledgeDraft | null
  askWhereToSave: (draft: KnowledgeDraft) => void
  clearKnowledgeDraft: () => void
  /** Records the Summary node a compaction is writing into, for the dialog to follow. */
  setCompactSummary: (id: NodeId | null) => void
  setFocusNode: (id: NodeId | null) => void
  setInsertionPosition: (position: XYPosition) => void
  setTopMenuOpen: (open: boolean) => void
  setContextMenu: (menu: ContextMenuState | null) => void
  setProviderBlock: (block: ProviderBlock | null) => void
  setQueuePanelOpen: (open: boolean) => void
  requestConfirm: (confirm: ConfirmState) => void
  closeConfirm: () => void
  addToast: (toast: Omit<Toast, 'id'>) => string
  dismissToast: (id: string) => void
  setSaveStatus: (status: SaveStatus) => void
  setLastRequestTokens: (tokens: number) => void
  setConnection: (
    status: ConnectionStatus,
    models?: ModelInfo[],
    latencyMs?: number | null,
    error?: AppError | null,
    capabilityLevel?: 'native-v1' | 'beta-v0' | 'openai-compatible' | 'unknown',
  ) => void
  setImportCandidate: (document: WorkspaceDocument | null) => void
  setWorkspaceConflict: (conflict: { workspaceId: string; currentRevision: number } | null) => void
  setPromptError: (id: NodeId, error: AppError | null) => void
  setPreferences: (patch: Partial<UiPreferences>) => void
  setAppSettings: (patch: Partial<AppSettings>) => void
}

let toastSequence = 0

export const useUiStore = create<UiState>((set, get) => ({
  paletteOpen: false,
  palettePosition: null,
  paletteFilter: null,
  paletteConnect: null,
  pendingResponseId: null,
  dialog: null,
  settingsTab: 'connection',
  compactNodeId: null,
  compactSummaryId: null,
  selectedNodeId: null,
  searchOpen: false,
  searchQuery: '',
  searchScope: 'workspace',
  knowledgeDraft: null,
  searchTarget: null,
  focusNodeId: null,
  insertionPosition: { x: 0, y: 0 },
  topMenuOpen: false,
  contextMenu: null,
  providerBlock: null,
  queuePanelOpen: false,
  confirm: null,
  toasts: [],
  announcement: '',
  addAnnouncement(announcement) {
    set({ announcement })
  },
  saveStatus: 'idle',
  lastRequestTokens: 0,
  connectionStatus: 'connecting',
  models: [],
  connectionLatencyMs: null,
  connectionError: null,
  apiCapabilityLevel: 'unknown',
  lastConnectionCheck: null,
  importCandidate: null,
  workspaceConflict: null,
  promptErrors: {},
  preferences: loadUiPreferences(),
  appSettings: cloneAppSettings(DEFAULT_APP_SETTINGS),

  openPalette(position = null, filter = null, connect = null) {
    set({
      paletteOpen: true,
      palettePosition: position,
      paletteFilter: filter,
      paletteConnect: connect,
      topMenuOpen: false,
    })
  },
  closePalette() {
    set({
      paletteOpen: false,
      palettePosition: null,
      paletteFilter: null,
      paletteConnect: null,
      pendingResponseId: null,
    })
  },
  setPendingResponse(id) {
    set({ pendingResponseId: id })
  },
  openDialog(dialog, tab, nodeId) {
    set({
      dialog,
      ...(tab ? { settingsTab: tab } : {}),
      /*
       * Il nodo della compattazione si azzera a ogni apertura, non solo quando si
       * passa per un'altra finestra. Senza questo, chiudere la finestra e riaprirla
       * da un nodo diverso mostrerebbe due volte il contesto del nodo precedente:
       * la finestra direbbe di compattare qualcosa che non e' quello che l'utente ha
       * sotto il cursore.
       *
       * Anche il riassunto si azzera, per lo stesso motivo e per un motivo in piu':
       * quello della compattazione precedente e' ancora sul nodo, e senza azzerarlo
       * la finestra aprirebbe mostrando un riassunto gia' finito al posto del
       * «non e' ancora stato costruito» che e' la verita'.
       */
      ...(dialog === 'compact'
        ? { compactNodeId: nodeId ?? null, compactSummaryId: null }
        : {}),
      topMenuOpen: false,
    })
  },
  closeDialog() {
    set({ dialog: null })
  },
  setSelectedNode(id) {
    set({ selectedNodeId: id })
  },
  openSearch(scope = 'workspace') {
    // La query si azzera all'apertura. Tenerla farebbe riaprire la barra gia' filtrata
    // su una ricerca di tre giorni fa, e i risultati sembrerebbero quelli che ci
    // si aspettava per una parola che non e' piu' scritta.
    //
    // Anche l'ambito si azzera, e per la stessa ragione: riaprire sull'archivio quello
    // che era stato scritto cercando nel grafo mostrerebbe risultati di un'altra
    // domanda, e l'utente li leggerebbe come quelli che sta cercando adesso.
    set({ searchOpen: true, searchQuery: '', searchScope: scope })
  },
  closeSearch() {
    set({ searchOpen: false, searchQuery: '' })
  },
  setSearchQuery(query) {
    set({ searchQuery: query })
  },
  setSearchTarget(target) {
    set({ searchTarget: target })
  },
  askWhereToSave(draft) {
    // Anche il dialogo si apre pulito: se ne fosse rimasto uno aperto da un salvataggio
    // annullato, la finestra che si riaprirebbe mostrerebbe il testo di **quello**, e
    // l'utente che salva un'altra risposta si troverebbe nella finestra sbagliata con il
    // proprio testo gia' scritto dentro.
    set({ dialog: 'save-knowledge', knowledgeDraft: draft, topMenuOpen: false })
  },
  clearKnowledgeDraft() {
    set({ knowledgeDraft: null, dialog: null })
  },
  setCompactSummary(id) {
    set({ compactSummaryId: id })
  },
  setFocusNode(id) {
    set({ focusNodeId: id })
  },
  setInsertionPosition(position) {
    set({ insertionPosition: position })
  },
  setTopMenuOpen(open) {
    set({ topMenuOpen: open })
  },
  setContextMenu(menu) {
    set({ contextMenu: menu })
  },
  setProviderBlock(block) {
    set({ providerBlock: block })
  },
  setQueuePanelOpen(queuePanelOpen) {
    set({ queuePanelOpen })
  },
  requestConfirm(confirm) {
    set({ confirm, contextMenu: null, topMenuOpen: false })
  },
  closeConfirm() {
    set({ confirm: null })
  },
  addToast(toast) {
    const id = `toast-${(toastSequence += 1)}`
    set((state) => ({ toasts: [...state.toasts.slice(-2), { ...toast, id }] }))
    return id
  },
  dismissToast(id) {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
  },
  setSaveStatus(saveStatus) {
    set({ saveStatus })
  },
  setLastRequestTokens(lastRequestTokens) {
    set({ lastRequestTokens })
  },
  setConnection(status, models, latencyMs, error = null, capabilityLevel) {
    set((state) => ({
      connectionStatus: status,
      models: models ?? state.models,
      connectionLatencyMs: latencyMs === undefined ? state.connectionLatencyMs : latencyMs,
      connectionError: error,
      apiCapabilityLevel: capabilityLevel ?? state.apiCapabilityLevel,
      lastConnectionCheck: Date.now(),
    }))
  },
  setImportCandidate(importCandidate) {
    set({ importCandidate })
  },
  setWorkspaceConflict(workspaceConflict) {
    set({ workspaceConflict })
  },
  setPromptError(id, error) {
    set((state) => {
      const promptErrors = { ...state.promptErrors }
      if (error) promptErrors[id] = error
      else delete promptErrors[id]
      return { promptErrors }
    })
  },
  setPreferences(patch) {
    /*
     * Il fattore di dimensione viene ripulito **qui**, non solo quando si scrive.
     *
     * Le preferenze arrivano da tre porte: il pannello, il salvataggio su disco, e
     * l'idratazione all'avvio che legge un valore serializzato. Ripulire solo in scitta
     * lascerebbe passare un valore fuori scala letto da disco, e la conseguenza non e'
     * un valore strano in un form: e' un'applicazione che si disegna a 40 volte e non
     * piu' torna leggibile. Sanificare all'unico punto in cui le preferenze diventano
     * stato chiude tutte e tre le porte con una riga.
     */
    const preferences = {
      ...get().preferences,
      ...patch,
      ...('uiScale' in patch ? { uiScale: sanitizeUiScale(patch.uiScale) } : {}),
    }
    saveUiPreferences(preferences)
    set({ preferences })
  },
  setAppSettings(patch) {
    set({ appSettings: { ...get().appSettings, ...patch } })
  },
}))

export const defaultUiPreferences = DEFAULT_UI_PREFERENCES

if (import.meta.env.DEV) {
  // Debug handle for the browser console. The Inspector that can show a full
  // request preview is behind developer mode, and turning developer mode on from
  // the console is the chicken-and-egg this avoids.
  ;(globalThis as unknown as { __nchatGetUi?: () => UiState }).__nchatGetUi = () =>
    useUiStore.getState()
}
