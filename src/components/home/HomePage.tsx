import {
  Copy,
  Download,
  FilePlus2,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Search,
  Settings,
  Trash2,
  Upload,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { getRepository } from '../../persistence/bootstrap'
import type { WorkspaceMeta } from '../../persistence/db'
import { parseImport } from '../../persistence/storage'
import { navigate } from '../../router'
import {
  getInstallState,
  installLabel,
  promptInstall,
  subscribeInstall,
  type InstallState,
} from '../../pwa/install'
import { filterAndSortWorkspaces, nextUntitledName, relativeTime, type WorkspaceSort } from '../../logic/home'
import { useTabsStore } from '../../store/tabsStore'
import { useUiStore } from '../../store/uiStore'
import { downloadBlob } from '../../utils/download'
import { workspaceRegistry } from '../../store/workspaceRegistry'
import { Button, IconButton } from '../common/Button'
import { Select, TextInput } from '../common/FormControls'
import { Modal } from '../common/Modal'

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function HomePage() {
  const [workspaces, setWorkspaces] = useState<WorkspaceMeta[]>([])
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<WorkspaceSort>('last-opened')
  const [activeIndex, setActiveIndex] = useState(0)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceMeta | null>(null)
  const [installState, setInstallState] = useState<InstallState>(getInstallState)
  const fileRef = useRef<HTMLInputElement>(null)

  // The browser reports installability only after the page has settled, so the
  // control appears and disappears on its own without a manual reload.
  useEffect(() => subscribeInstall(setInstallState), [])
  const install = installLabel(installState)
  const installLabelText = install?.text
  const installLabelHint = install?.hint
  const openTab = useTabsStore((state) => state.openTab)
  const tabs = useTabsStore((state) => state.tabs)

  const refresh = useCallback(async () => {
    const repository = await getRepository()
    setWorkspaces(await repository.listMeta())
  }, [])

  useEffect(() => {
    void refresh()
    const onChange = (): void => void refresh()
    window.addEventListener('nchat:workspaces-changed', onChange)
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('nchat') : null
    channel?.addEventListener('message', onChange)
    return () => {
      window.removeEventListener('nchat:workspaces-changed', onChange)
      channel?.close()
    }
  }, [refresh])

  const filtered = useMemo(
    () => filterAndSortWorkspaces(workspaces, query, sort),
    [query, sort, workspaces],
  )

  const changed = (): void => {
    window.dispatchEvent(new CustomEvent('nchat:workspaces-changed'))
  }

  const openWorkspace = (id: string): void => {
    openTab(id)
    navigate({ name: 'workspace', workspaceId: id })
  }

  const createWorkspace = async (): Promise<void> => {
    const repository = await getRepository()
    const created = await repository.create(nextUntitledName(workspaces.map((item) => item.name)))
    changed()
    openWorkspace(created.id)
  }

  const importJson = async (file: File): Promise<void> => {
    try {
      const document = parseImport(await file.text())
      const repository = await getRepository()
      const created = await repository.create(document.name)
      await repository.save(created.id, document, created.meta.revision)
      changed()
      openWorkspace(created.id)
    } catch (error: unknown) {
      useUiStore.getState().addToast({
        tone: 'error',
        title: "That file isn't a valid NCHAT workspace.",
        message: error instanceof Error ? error.message : undefined,
        sticky: true,
      })
    }
  }

  const rename = async (id: string, name: string): Promise<void> => {
    const repository = await getRepository()
    await repository.rename(id, name.trim() || 'Untitled workspace')
    setRenamingId(null)
    changed()
  }

  const duplicate = async (id: string): Promise<void> => {
    const repository = await getRepository()
    await repository.duplicate(id)
    changed()
  }

  const exportMeta = async (meta: WorkspaceMeta): Promise<void> => {
    const repository = await getRepository()
    const loaded = await repository.load(meta.id)
    if (!loaded) return
    const json = JSON.stringify(loaded.document, null, 2)
    const name = `nchat-${meta.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`
    const result = downloadBlob(json, name, 'application/json')
    if (!result.ok) {
      useUiStore.getState().addToast({ tone: 'error', title: 'Export failed.', message: result.error, sticky: true })
    }
  }

  const deleteWorkspace = async (): Promise<void> => {
    if (!deleteTarget) return
    const repository = await getRepository()
    await repository.snapshot(deleteTarget.id, 'delete')
    const snapshots = await repository.listSnapshots(deleteTarget.id)
    await repository.delete(deleteTarget.id)
    workspaceRegistry.close(deleteTarget.id)
    const useTabs = useTabsStore.getState()
    if (useTabs.tabs.includes(deleteTarget.id)) {
      const active = useTabs.closeTab(deleteTarget.id)
      navigate(active === 'home' ? { name: 'home' } : { name: 'workspace', workspaceId: active })
    }
    setDeleteTarget(null)
    changed()
    const snapshotId = snapshots[0]?.id
    if (snapshotId) {
      useUiStore.getState().addToast({
        tone: 'info',
        title: 'Workspace deleted.',
        message: 'You can undo this for 10 seconds.',
        actionLabel: 'Undo',
        onAction: () => {
          void repository.restoreSnapshot(snapshotId).then(() => changed())
        },
      })
    }
  }

  const onCardKeyDown = (event: KeyboardEvent<HTMLElement>, meta: WorkspaceMeta): void => {
    const index = filtered.findIndex((item) => item.id === meta.id)
    if (event.key === 'Enter') openWorkspace(meta.id)
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      setActiveIndex(Math.min(filtered.length - 1, index + 1))
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      setActiveIndex(Math.max(0, index - 1))
    } else if (event.key === 'F2') {
      setRenamingId(meta.id)
    } else if (event.key === 'Delete') {
      setDeleteTarget(meta)
    }
  }

  return (
    <main className="home-page">
      <header className="home-header">
        <div className="home-brand"><FolderOpen size={20} /><span>NCHAT</span></div>
        <div className="home-actions">
          <Button variant="primary" icon={<FilePlus2 size={13} />} onClick={() => void createWorkspace()}>
            New workspace
          </Button>
          <Button icon={<Upload size={13} />} onClick={() => fileRef.current?.click()}>Import JSON</Button>
          {/*
            Settings, qui, non per completezza ma perche questa e la pagina in
            cui si atterra: e la prima che si vede all'avvio e l'unica che
            esiste quando non c'e ancora un workspace. Senza, dalla Home si
            arrivava ai Settings solo con Ctrl+,. Il collegamento del workspace
            li ha gia, quindi toglierlo da li e peggio, non migliore.
          */}
          <Button icon={<Settings size={13} />} onClick={() => useUiStore.getState().openDialog('settings')}>
            Settings
          </Button>
          {installLabelText ? (
            <Button
              icon={<Download size={13} />}
              title={installLabelHint}
              onClick={() => void promptInstall()}
            >
              {installLabelText}
            </Button>
          ) : null}
          <div className="home-search"><Search size={13} /><TextInput value={query} placeholder="Search workspaces" onChange={(event) => setQuery(event.currentTarget.value)} /></div>
          <Select value={sort} aria-label="Sort workspaces" onChange={(event) => setSort(event.currentTarget.value as WorkspaceSort)}>
            <option value="last-opened">Last opened</option>
            <option value="last-modified">Last modified</option>
            <option value="name">Name</option>
            <option value="size">Size</option>
          </Select>
        </div>
      </header>

      {filtered.length === 0 ? (
        <section className="home-empty">
          <FolderOpen size={34} />
          <h1>{workspaces.length === 0 ? 'Create your first workspace' : 'No workspace found'}</h1>
          <p>Each workspace is a private graph stored in your browser.</p>
          <Button variant="primary" icon={<FilePlus2 size={13} />} onClick={() => void createWorkspace()}>New workspace</Button>
        </section>
      ) : (
        <section className="workspace-grid" aria-label="Workspaces">
          {filtered.map((meta, index) => (
            <article
              key={meta.id}
              tabIndex={0}
              className={`workspace-card ${index === activeIndex ? 'focused' : ''}`}
              onFocus={() => setActiveIndex(index)}
              onDoubleClick={() => (renamingId === meta.id ? void rename(meta.id, meta.name) : openWorkspace(meta.id))}
              onKeyDown={(event) => onCardKeyDown(event, meta)}
            >
              <div className="workspace-card-head">
                {renamingId === meta.id ? (
                  <TextInput
                    autoFocus
                    defaultValue={meta.name}
                    onBlur={(event) => void rename(meta.id, event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        void rename(meta.id, event.currentTarget.value)
                        event.currentTarget.blur()
                      }
                    }}
                  />
                ) : (
                  <button type="button" onClick={() => openWorkspace(meta.id)}>
                    <strong>{meta.name}</strong>
                  </button>
                )}
                <IconButton label="Workspace actions"><MoreHorizontal size={14} /></IconButton>
              </div>
              {meta.thumbnail ? (
                <div className="workspace-card-preview">
                  <img
                    className="workspace-card-thumb"
                    src={`data:image/svg+xml;utf8,${encodeURIComponent(meta.thumbnail)}`}
                    alt=""
                    aria-hidden="true"
                  />
                </div>
              ) : (
                <div className="workspace-card-preview">
                  <FolderOpen size={28} />
                  <span>{meta.nodeCount} nodes</span>
                </div>
              )}
              <div className="workspace-card-meta">
                <span>Modified {relativeTime(meta.updatedAt)}</span>
                <span>{meta.nodeCount} nodes · {meta.edgeCount} edges · {sizeLabel(meta.sizeBytes)}</span>
              </div>
              <footer className="workspace-card-actions">
                {tabs.includes(meta.id) ? <span className="open-badge">Open</span> : <span />}
                <Button size="small" icon={<FolderOpen size={10} />} onClick={() => openWorkspace(meta.id)}>Open</Button>
                <IconButton label="Rename workspace" onClick={() => setRenamingId(meta.id)}><Pencil size={11} /></IconButton>
                <IconButton label="Duplicate workspace" onClick={() => void duplicate(meta.id)}><Copy size={11} /></IconButton>
                <IconButton label="Export workspace" onClick={() => void exportMeta(meta)}><Download size={11} /></IconButton>
                <IconButton label="Delete workspace" danger onClick={() => setDeleteTarget(meta)}><Trash2 size={11} /></IconButton>
              </footer>
            </article>
          ))}
        </section>
      )}

      <input ref={fileRef} hidden type="file" accept="application/json,.json" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void importJson(file); event.currentTarget.value = '' }} />
      {deleteTarget ? (
        <Modal title="Delete workspace" size="small" onClose={() => setDeleteTarget(null)} footer={<><Button onClick={() => setDeleteTarget(null)}>Cancel</Button><Button variant="danger" autoFocus onClick={() => void deleteWorkspace()}>Delete</Button></>}>
          {/* No typing the name. The name only ever appeared to guard against a
              misclick, and a recovery snapshot is taken before the delete, so
              the confirmation below is enough. */}
          <p className="inspector-value">
            Delete <strong>{deleteTarget.name}</strong>? It has {deleteTarget.nodeCount} node
            {deleteTarget.nodeCount === 1 ? '' : 's'}. A recovery snapshot is created first, so this can
            be undone from the snapshots.
          </p>
        </Modal>
      ) : null}
    </main>
  )
}
