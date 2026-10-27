import { nanoid } from 'nanoid'
import { autoLayout } from '../logic/layout'
import { getRepository } from '../persistence/bootstrap'
import { cancelScheduledSave, parseImport, serializeDocument } from '../persistence/storage'
import { useTabsStore } from '../store/tabsStore'
import { useUiStore } from '../store/uiStore'
import { downloadBlob, formatBytes } from '../utils/download'
import {
  getActiveWorkspaceStore,
  useWorkspaceStore,
  workspaceDocumentFromState,
  type WorkspaceStoreApi,
} from '../store/workspaceStore'
import type { AppEdge, AppNode, WorkspaceDocument } from '../types/document'
import { DOC_VERSION } from '../types/document'
import { isAppError } from '../types/errors'
import { navigate } from '../router'

export type ImportMode = 'replace' | 'merge'

function currentDocument(): WorkspaceDocument {
  return workspaceDocumentFromState(useWorkspaceStore.getState())
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace'
}

function dateStamp(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function forceSave(showSuccess = false): void {
  cancelScheduledSave()
  const state = useWorkspaceStore.getState()
  const ui = useUiStore.getState()
  ui.setSaveStatus('saving')
  void getRepository().then(async (repository) => {
    const result = await repository.save(state.workspaceId, currentDocument(), state.revision)
    if (result.ok) {
      useWorkspaceStore.getState().markSaved(result.revision)
      useUiStore.getState().setSaveStatus('saved')
      if (showSuccess) useUiStore.getState().addToast({ tone: 'success', title: 'Workspace saved.' })
    } else if ('conflict' in result) {
      useUiStore.getState().setWorkspaceConflict({ workspaceId: state.workspaceId, currentRevision: result.currentRevision })
    } else {
      useUiStore.getState().setSaveStatus('error')
      useUiStore.getState().addToast({ tone: 'error', title: result.error.message, ...(result.error.hint ? { message: result.error.hint } : {}), sticky: true })
    }
  })
}

export function exportWorkspace(): void {
  const document = currentDocument()
  const serialized = serializeDocument(document)
  const json = JSON.stringify(serialized, null, 2)
  const result = downloadBlob(json, `nchat-${slugify(document.name)}-${dateStamp()}.json`, 'application/json')
  const ui = useUiStore.getState()
  if (result.ok) {
    ui.addToast({
      tone: 'success',
      title: 'Workspace exported.',
      message: `${serialized.nodes.length} nodes · ${serialized.edges.length} edges · ${formatBytes(result.bytes)}`,
    })
  } else {
    ui.addToast({ tone: 'error', title: 'Export failed.', message: result.error, sticky: true })
  }
}

export async function readImportFile(file: File): Promise<boolean> {
  try {
    useUiStore.getState().setImportCandidate(parseImport(await file.text()))
    return true
  } catch (error: unknown) {
    const appErr = isAppError(error) ? error : { kind: 'IMPORT_INVALID' as const, message: "That file isn't a valid NCHAT workspace." }
    useUiStore.getState().addToast({ tone: 'error', title: appErr.message, message: [appErr.hint, appErr.raw].filter(Boolean).join('\n\n') || undefined, sticky: true })
    return false
  }
}

function mergeDocuments(imported: WorkspaceDocument): WorkspaceDocument {
  const current = currentDocument()
  const offset = current.nodes.length === 0 ? { x: 80, y: 80 } : { x: Math.max(...current.nodes.map((node) => node.position.x + (node.width ?? 320))) + 80, y: Math.max(...current.nodes.map((node) => node.position.y + (node.height ?? 180))) + 80 }
  const idMap = new Map(imported.nodes.map((node) => [node.id, nanoid(12)]))
  const nodes: AppNode[] = [
    ...current.nodes,
    ...imported.nodes.map((node) => {
      const copy = structuredClone(node)
      copy.id = idMap.get(node.id) ?? nanoid(12)
      copy.position = { x: copy.position.x + offset.x, y: copy.position.y + offset.y }
      copy.selected = false
      if (copy.data.kind === 'response') copy.data.parentPromptId = idMap.get(copy.data.parentPromptId) ?? copy.data.parentPromptId
      if (copy.data.kind === 'set') copy.data.memberIds = copy.data.memberIds.map((id) => idMap.get(id) ?? id)
    if (copy.data.kind === 'output' && copy.data.sourceNodeIds) {
      copy.data.sourceNodeIds = copy.data.sourceNodeIds.map((id) => idMap.get(id) ?? id)
    }
      return copy
    }),
  ]
  const edges: AppEdge[] = [
    ...current.edges,
    ...imported.edges.map((edge) => ({ ...edge, id: nanoid(12), source: idMap.get(edge.source) ?? edge.source, target: idMap.get(edge.target) ?? edge.target, selected: false })),
  ]
  return { ...current, docVersion: DOC_VERSION, savedAt: Date.now(), nodes, edges }
}

export function applyImport(mode: ImportMode): void {
  const ui = useUiStore.getState()
  const candidate = ui.importCandidate
  if (!candidate) return
  const store = getActiveWorkspaceStore()
  const state = store.getState()
  const document = mode === 'merge' ? mergeDocuments(candidate) : candidate
  void getRepository().then(async (repository) => {
    if (mode === 'replace') await repository.snapshot(state.workspaceId, 'import-replace')
    store.getState().replaceDocument(document)
    const result = await repository.save(state.workspaceId, document, state.revision)
    if (result.ok) store.getState().markSaved(result.revision)
    useUiStore.getState().addToast({ tone: 'success', title: mode === 'merge' ? 'Workspace merged.' : 'Workspace imported.' })
  })
  useUiStore.getState().setImportCandidate(null)
}

export function requestNewWorkspace(): void {
  useUiStore.getState().requestConfirm({
    title: 'Create a new workspace?',
    message: 'The current workspace stays saved in your workspace list.',
    confirmLabel: 'New workspace',
    onConfirm: () => {
      void getRepository().then(async (repository) => {
        const metas = await repository.listMeta()
        const created = await repository.create(`Untitled workspace ${metas.length + 1}`)
        useTabsStore.getState().openTab(created.id)
        navigate({ name: 'workspace', workspaceId: created.id })
        window.dispatchEvent(new CustomEvent('nchat:workspaces-changed'))
      })
    },
  })
}

export async function restoreLocalBackup(): Promise<boolean> {
  const repository = await getRepository()
  const id = getActiveWorkspaceStore().getState().workspaceId
  const snapshots = await repository.listSnapshots(id)
  const latest = snapshots[0]
  if (!latest) return false
  const restored = await repository.restoreSnapshot(latest.id)
  if (restored) getActiveWorkspaceStore().getState().replaceDocument(restored.document)
  return Boolean(restored)
}

export async function deleteAllData(): Promise<void> {
  const repository = await getRepository()
  await repository.clearAll()
  window.location.reload()
}

export function storageUsageKb(): number {
  return new Blob([JSON.stringify(serializeDocument(currentDocument()))]).size / 1024
}

export function applyAutoLayout(): void {
  useWorkspaceStore.getState().setNodePositions(autoLayout(currentDocument()))
}

export function workspaceBackupExists(): boolean {
  return true
}

export function activeWorkspaceStore(): WorkspaceStoreApi {
  return getActiveWorkspaceStore()
}
