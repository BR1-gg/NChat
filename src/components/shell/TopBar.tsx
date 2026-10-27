import {
  CircleHelp,
  Download,
  Ellipsis,
  FilePlus2,
  Gauge,
  LayoutDashboard,
  Maximize,
  PanelRight,
  Plus,
  Redo2,
  ScrollText,
  Search,
  Settings,
  Square,
  Trash2,
  Undo2,
  Upload,
  Workflow,
} from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'
import {
  exportWorkspace,
  readImportFile,
  requestNewWorkspace,
} from '../../actions/workspaceIO'
import { stopAllRuns } from '../../actions/stopRun'
import { selectModel } from '../../actions/modelManager'
import { formatDuration } from '../../queue/runQueue'
import { useModelStore } from '../../store/modelStore'
import { connectionAdvice, connectionExplanation, connectionLabel as connectionLabelFor } from '../../logic/connectionState'
import { isCloudProvider } from '../../logic/providers'
import { formatCost } from '../../logic/pricing'
import { useQueueStore } from '../../queue/queueStore'
import { useRunStore } from '../../store/runStore'
import { useUiStore } from '../../store/uiStore'
import { currentTotals, useUsageStore } from '../../store/usageStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { Button, IconButton } from '../common/Button'
import { ProviderPicker } from './ProviderPicker'

export function TopBar() {
  const name = useWorkspaceStore((state) => state.name)
  const allModels = useModelStore((state) => state.models)
  const models = useMemo(
    () => allModels.filter((model) => model.type === 'llm'),
    [allModels],
  )
  const selectedModel = useUiStore((state) => state.appSettings.defaultModel)
  const connectionStatus = useUiStore((state) => state.connectionStatus)
  const provider = useUiStore((state) => state.appSettings.provider)
  const topMenuOpen = useUiStore((state) => state.topMenuOpen)
  const activeRunCount = useRunStore((state) => Object.keys(state.runs).length)
  const activeRuns = Object.keys(useRunStore.getState().runs)
  const queueJobs = useQueueStore((state) => state.jobs)
  const usageRecords = useUsageStore((state) => state.records)
  const queue = {
    running: queueJobs.filter((job) => job.state === 'running').length,
    waiting: queueJobs.filter((job) => job.state === 'waiting' || job.state === 'blocked').length,
  }
  const importRef = useRef<HTMLInputElement>(null)
  const { fitView } = useReactFlow()
  const developerMode = useUiStore((state) => state.preferences.developerMode)
  const inspectorOpen = useUiStore((state) => state.preferences.inspectorOpen)
  // The depths are 0 or 1, so this re-renders only when a button becomes usable.
  const canUndo = useWorkspaceStore((state) => state.undoDepth === 1)
  const canRedo = useWorkspaceStore((state) => state.redoDepth === 1)

  const onHistory = (redo: boolean): void => {
    const workspace = useWorkspaceStore.getState()
    if (Object.keys(useRunStore.getState().runs).length > 0) {
      useUiStore.getState().addToast({
        tone: 'info',
        title: 'Wait for the answer to finish.',
        message: 'Undo is paused while the model is writing.',
      })
      return
    }
    const label = redo ? workspace.redo() : workspace.undo()
    useUiStore.getState().addToast({
      tone: 'info',
      title: label
        ? `${redo ? 'Redone' : 'Undone'}: ${label}.`
        : redo
          ? 'Nothing to redo.'
          : 'Nothing to undo.',
    })
  }

  useEffect(() => {
    if (!topMenuOpen) return
    const close = (): void => useUiStore.getState().setTopMenuOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [topMenuOpen])


  const loadingSince = useModelStore((state) => {
    const runtime = Object.values(state.runtimes).find((entry) => entry.state === 'loading')
    return runtime?.loadStartedAt
  })
  const loadingElapsed = loadingSince ? formatDuration(Date.now() - loadingSince) : null
  /*
   * La pastiglia dice **lo stato**, e non «sono guasto».
   *
   * Prima diceva "Offline" con un punto rosso, e l'utente ha letto «l'app non si e
   * aperta». L'app era aperta: era giusto il **server dei modelli**, che e un programma
   * separato che l'utente avvia per conto suo. Le due cose non hanno niente a che
   * fare, e la parola sbagliata fa perdere il filo prima ancora di cominciare.
   */
  const connectionLabel =
    connectionStatus === 'loading-model'
      ? `Loading model…${loadingElapsed ? ` ${loadingElapsed}` : ''}`
      : connectionLabelFor(connectionStatus)
  /*
   * La frase lunga vive nel suggerimento e nell'`aria-label`. Nella pastiglia non ci
   * starebbe, e nell'`aria-label` serve: quello lo sente chi naviga con uno screen
   * reader, ed e l'unico posto dove la frase intera esiste per tutti.
   */
  const connectionExplanationText = connectionExplanation(connectionStatus, provider)

  /*
   * La spesa fin qui, calcolata con i prezzi di oggi.
   *
   * Il totale e' `null` quando qualche corsa ha un prezzo sconosciuto, e in quel caso
   * l'etichetta non mostra un numero: «$0.00» su un provider a pagamento farebbe
   * credere che sia gratis, ed e' il modo piu rapido di smettere di controllare. Il
   * testo del titolo spiega il perche', quindi l'informazione non si perde.
   */
  const usageTotals = currentTotals(usageRecords, false)
  const usageTitle =
    usageTotals.costUsd === null
      ? `Usage: ${usageTotals.totalTokens.toLocaleString()} tokens · ${usageTotals.unpricedRuns} run${
          usageTotals.unpricedRuns === 1 ? '' : 's'
        } without a published price`
      : `Usage: ${formatCost(usageTotals.costUsd)} · ${usageTotals.totalTokens.toLocaleString()} tokens`
  const usageLabel = usageTotals.costUsd === null ? '—' : formatCost(usageTotals.costUsd)

  return (
    <header className="topbar">
      <div className="brand-mark" title="NCHAT">
        <Workflow size={16} />
      </div>
      <input
        className="workspace-name"
        value={name}
        aria-label="Workspace name"
        onChange={(event) => useWorkspaceStore.getState().setName(event.currentTarget.value)}
      />
      <div className="topbar-spacer" />
      {activeRunCount > 0 || queue.waiting > 0 ? (
        <button
          type="button"
          className="running-pill"
          style={{ color: 'var(--stream)' }}
          onClick={() => useUiStore.getState().setQueuePanelOpen(true)}
          aria-label="Open generation queue"
        >
          <span className="status-dot streaming" />
          {activeRunCount} running{queue.waiting > 0 ? ` · ${queue.waiting} queued` : ''}
        </button>
      ) : null}
      {activeRunCount > 0 ? (
        <IconButton label="Stop all running generations" danger onClick={stopAllRuns}>
          <Square size={9} fill="currentColor" />
        </IconButton>
      ) : null}
      <button
        type="button"
        className={`connection-pill is-${connectionStatus}`}
        onClick={() => useUiStore.getState().openDialog('settings', 'connection')}
        title={`${connectionExplanationText}${
          connectionAdvice(connectionStatus, provider) ? ` ${connectionAdvice(connectionStatus, provider)}` : ''
        }`}
        aria-label={`${connectionLabel}. ${connectionExplanationText} Open connection settings.`}
      >
        {/*
          Il punto non e rosso quando il server dei modelli e giu. Non e un errore:
          e uno stato come «nessun modello scaricato», e su una macchina che lavora
          soprattutto in cloud e la normalita. Il rosso dice «qualcosa e rotto» e
          questo e il messaggio che ha fatto cercare un problema in NCHAT quando il
          problema era un programma che non era avviato.
        */}
        <span
          className={`status-dot ${
            connectionStatus === 'connected'
              ? 'done'
              : connectionStatus === 'offline'
                ? 'idle'
                : connectionStatus === 'connecting'
                  ? 'streaming'
                  : 'aborted'
          }`}
        />
        {connectionLabel}
      </button>
      <ProviderPicker />
      <select
        className="model-select"
        value={selectedModel ?? ''}
        aria-label="Default model"
        disabled={models.length === 0}
        onChange={(event) =>
          void selectModel(event.currentTarget.value)
        }
      >
        {models.length === 0 ? <option value="">No chat models available</option> : null}
        {models.map((model) => (
          <option key={model.id} value={model.id} title={model.contextLength ? `${model.contextLength.toLocaleString()} token context` : undefined}>
            {model.state === 'loaded' ? '● ' : model.state === 'loading' ? '◌ ' : '○ '}
            {model.displayName ?? model.id}
          </option>
        ))}
      </select>
      {/*
        Il bottone dei consumi sta **accanto** al provider e al modello, e non nel
        menu "Altro": la domanda "quanto mi e costato" arriva mentre si sceglie il
        modello, ed e' la domanda che decide se si continua con quello o con uno piu
        economico. Nel menu sarebbe una voce che si cerca quando il danno e' gia'
        fatto.

        L'etichetta porta la spesa perche' e' l'unica cosa che cambia e l'unica che
        non si legge altrove. In locale non mostra un numero: il costo e' zero e
        scriverlo a ogni corsa sarebbe rumore.
      */}
      <button
        type="button"
        className="usage-button"
        onClick={() => useUiStore.getState().openDialog('usage')}
        title={usageTitle}
        aria-label={usageTitle}
      >
        <Gauge size={13} />
        <span className="usage-button-label">
          {isCloudProvider(provider) ? usageLabel : 'Usage'}
        </span>
      </button>
      <Button
        variant="primary"
        icon={<Plus size={12} />}
        onClick={() => useUiStore.getState().openPalette()}
      >
        <span className="optional-label">Add</span> node
      </Button>
      <IconButton
        label="Undo (Ctrl Z)"
        disabled={!canUndo}
        onClick={() => onHistory(false)}
      >
        <Undo2 size={14} />
      </IconButton>
      <IconButton
        label="Redo (Ctrl Shift Z)"
        disabled={!canRedo}
        onClick={() => onHistory(true)}
      >
        <Redo2 size={14} />
      </IconButton>
      <IconButton
        label="Auto-layout (A)"
        onClick={() => window.dispatchEvent(new CustomEvent('nchat:layout'))}
      >
        <LayoutDashboard size={14} />
      </IconButton>
      <IconButton
        label="Fit view (F)"
        onClick={() => window.dispatchEvent(new CustomEvent('nchat:fit-view'))}
      >
        <Maximize size={14} />
      </IconButton>
      {developerMode ? (
        <IconButton
          label={inspectorOpen ? 'Hide the inspector' : 'Show the inspector'}
          active={inspectorOpen}
          onClick={() => useUiStore.getState().setPreferences({ inspectorOpen: !inspectorOpen })}
        >
          <PanelRight size={14} />
        </IconButton>
      ) : null}
      <div style={{ position: 'relative' }} onClick={(event) => event.stopPropagation()}>
        <IconButton
          label="More actions"
          active={topMenuOpen}
          onClick={() => useUiStore.getState().setTopMenuOpen(!topMenuOpen)}
        >
          <Ellipsis size={15} />
        </IconButton>
        {topMenuOpen ? (
          <div className="context-menu" style={{ top: 36, right: 0, minWidth: 210 }}>
            {/*
              La ricerca sta **in cima** al menu, non in fondo, e non per abitudine.

              Un menu si legge dall'alto in bassi e la prima voce e' la piu' usata; la
              ricerca e' la cosa che si usa di piu' in un grafo grande, e metterla in
              fondo la renderebbe l'ultima che si scopre. Sta anche qui, e non solo con
              la scorciatoia, perche' una scorciatoia che non si conosce non esiste:
              il menu e' il posto dove si scopre cosa c'e'.
            */}
            <button type="button" onClick={() => { useUiStore.getState().openSearch(); useUiStore.getState().setTopMenuOpen(false) }}>
              <Search size={12} /> Search this workspace <span className="kbd">Ctrl K</span>
            </button>
            <div className="context-separator" />
            <button type="button" onClick={() => { exportWorkspace(); useUiStore.getState().setTopMenuOpen(false) }}>
              <Download size={12} /> Export workspace <span className="kbd">Ctrl E</span>
            </button>
            <button type="button" onClick={() => { importRef.current?.click(); useUiStore.getState().setTopMenuOpen(false) }}>
              <Upload size={12} /> Import workspace
            </button>
            <div className="context-separator" />
            <button type="button" onClick={() => { requestNewWorkspace(); }}>
              <FilePlus2 size={12} /> New workspace
            </button>
            <button type="button" onClick={() => useUiStore.getState().openDialog('settings', 'data')}>
              <Trash2 size={12} /> Data & storage
            </button>
            <button type="button" onClick={() => useUiStore.getState().openDialog('settings', 'help')}>
              <CircleHelp size={12} /> Help
            </button>
            <button type="button" onClick={() => useUiStore.getState().openDialog('log')}>
              <ScrollText size={12} /> Log
            </button>
            <button type="button" onClick={() => useUiStore.getState().openDialog('settings')}>
              <Settings size={12} /> Settings <span className="kbd">Ctrl ,</span>
            </button>
          </div>
        ) : null}
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
      {activeRunCount > 0 ? (
        <button
          type="button"
          className="visually-hidden"
          onClick={() =>
            void fitView({ nodes: activeRuns.map((id) => ({ id })), padding: 0.3, duration: 350 })
          }
        >
          Focus active responses
        </button>
      ) : null}
    </header>
  )
}
