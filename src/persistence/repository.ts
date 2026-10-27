import { nanoid } from 'nanoid'
import { appError, type AppError } from '../types/errors'
import { createEmptyDocument, type WorkspaceDocument } from '../types/document'
import { DEFAULT_APP_SETTINGS, type AppSettings, type UiPreferences } from '../types/settings'
import { migrate } from './migrations'
import { renderThumbnail } from '../logic/thumbnail'
import { normalizeDocument, serializeDocument, WORKSPACE_KEY, BACKUP_KEY, UI_KEY } from './storage'
import { db, type AppStateRow, type SnapshotReason, type SnapshotRow, type WorkspaceMeta } from './db'

export interface LoadResult {
  document: WorkspaceDocument
  meta: WorkspaceMeta
  problem?: AppError
}

export type SaveResult =
  | { ok: true; revision: number; sizeBytes: number }
  | { ok: false; conflict: true; currentRevision: number }
  | { ok: false; error: AppError }

export interface WorkspaceRepository {
  readonly kind: 'indexeddb' | 'memory'
  init(): Promise<void>
  listMeta(): Promise<WorkspaceMeta[]>
  create(name?: string): Promise<{ id: string; meta: WorkspaceMeta; document: WorkspaceDocument }>
  load(id: string): Promise<LoadResult | null>
  save(id: string, document: WorkspaceDocument, baseRevision?: number): Promise<SaveResult>
  rename(id: string, name: string): Promise<void>
  duplicate(id: string): Promise<{ id: string; meta: WorkspaceMeta; document: WorkspaceDocument } | null>
  delete(id: string): Promise<void>
  snapshot(id: string, reason: SnapshotReason): Promise<void>
  restoreSnapshot(snapshotId: string): Promise<LoadResult | null>
  listSnapshots(id: string): Promise<SnapshotRow[]>
  getAppState<T>(key: string): Promise<T | undefined>
  setAppState<T>(key: string, value: T): Promise<void>
  estimate(): Promise<{ usage: number; quota: number } | null>
  clearAll(): Promise<void>
}

const MAX_SNAPSHOTS = 5
const LEGACY_FLAG = 'nchat.migrated.v2'

/** Identifies this browser tab so it can ignore its own broadcast messages. */
export const REPOSITORY_CLIENT_ID = nanoid(8)

function now(): number {
  return Date.now()
}

function sizeOf(document: WorkspaceDocument): number {
  return new Blob([JSON.stringify(serializeDocument(document))]).size
}

function metaFor(id: string, document: WorkspaceDocument, revision: number, createdAt = now()): WorkspaceMeta {
  const timestamp = now()
  return {
    id,
    name: document.name,
    createdAt,
    updatedAt: timestamp,
    lastOpenedAt: timestamp,
    nodeCount: document.nodes.length,
    edgeCount: document.edges.length,
    sizeBytes: sizeOf(document),
    docVersion: document.docVersion,
    revision,
  }
}

function normalize(value: unknown): WorkspaceDocument {
  return normalizeDocument(migrate(value)).document
}

async function migrateLegacyWorkspace(repository: DexieWorkspaceRepository): Promise<void> {
  if (typeof localStorage === 'undefined') return
  const alreadyMigrated = localStorage.getItem(LEGACY_FLAG)
  const raw = localStorage.getItem(WORKSPACE_KEY)
  if (alreadyMigrated === '1' || !raw) return
  try {
    const parsed = normalize(JSON.parse(raw) as unknown)
    const id = repository.pendingLegacyId ?? nanoid(12)
    const meta = metaFor(id, parsed, 0)
    await repository.writeNew(id, meta, parsed)
    await repository.setAppState('appSettings', {
      ...DEFAULT_APP_SETTINGS,
      ...parsed.settings,
    })
    const backup = localStorage.getItem(BACKUP_KEY)
    if (backup) {
      try {
        await repository.database.snapshots.add({
          id: nanoid(12),
          workspaceId: id,
          createdAt: now(),
          reason: 'manual',
          document: normalize(JSON.parse(backup) as unknown),
        })
        await repository.pruneSnapshots(id)
      } catch {
        // A legacy backup is best effort.
      }
    }
    await repository.setAppState(LEGACY_FLAG, '1')
    localStorage.setItem(LEGACY_FLAG, '1')
    // Rename, never delete, so a failed migration can be retried safely.
    localStorage.setItem(`nchat.legacy.${WORKSPACE_KEY}`, raw)
    localStorage.removeItem(WORKSPACE_KEY)
    if (backup) {
      localStorage.setItem(`nchat.legacy.${BACKUP_KEY}`, backup)
      localStorage.removeItem(BACKUP_KEY)
    }
  } catch {
    // Leave legacy keys untouched; the app can still start with a warning.
  }
}

export class DexieWorkspaceRepository implements WorkspaceRepository {
  readonly kind = 'indexeddb' as const
  pendingLegacyId: string | null = null
  private dbRef = db
  private channel: BroadcastChannel | null = null

  get database() {
    return this.dbRef
  }

  async init(): Promise<void> {
    await this.dbRef.open()
    await migrateLegacyWorkspace(this)
    try {
      await navigator.storage?.persist?.()
    } catch {
      // Persistence is an enhancement, not a reason to fail startup.
    }
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel('nchat')
    }
  }

  async listMeta(): Promise<WorkspaceMeta[]> {
    return this.dbRef.workspaces.orderBy('lastOpenedAt').reverse().toArray()
  }

  async create(name = 'Untitled workspace') {
    const id = nanoid(12)
    const document = createEmptyDocument()
    document.name = name
    const meta = metaFor(id, document, 0)
    await this.writeNew(id, meta, document)
    return { id, meta, document }
  }

  async load(id: string): Promise<LoadResult | null> {
    const row = await this.dbRef.documents.get(id)
    if (!row) return null
    const document = normalize(row.document)
    const meta = (await this.dbRef.workspaces.get(id)) ?? metaFor(id, document, 0)
    await this.dbRef.workspaces.update(id, { lastOpenedAt: now() })
    return { document, meta: { ...meta, lastOpenedAt: now() } }
  }

  async save(id: string, document: WorkspaceDocument, baseRevision?: number): Promise<SaveResult> {
    const serialized = serializeDocument(document)
    const sizeBytes = sizeOf(document)
    try {
      return await this.dbRef.transaction('rw', this.dbRef.workspaces, this.dbRef.documents, async () => {
        const current = await this.dbRef.workspaces.get(id)
        if (!current) return { ok: false, error: appError('NOT_FOUND', 'Workspace not found.') }
        if (baseRevision !== undefined && current.revision > baseRevision) {
          return { ok: false, conflict: true, currentRevision: current.revision }
        }
        const revision = current.revision + 1
        await this.dbRef.documents.put({ id, document: serialized })
        const meta = metaFor(id, serialized, revision, current.createdAt)
        // The preview is a pure function of the document, so it is cheap to
        // regenerate and keeps the Home list free of React Flow.
        meta.thumbnail = renderThumbnail(serialized)
        await this.dbRef.workspaces.put(meta)
        this.channel?.postMessage({
          type: 'saved',
          workspaceId: id,
          revision,
          clientId: REPOSITORY_CLIENT_ID,
        })
        return { ok: true, revision, sizeBytes }
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        error: appError(
          message.toLowerCase().includes('quota') ? 'STORAGE_FULL' : 'INTERNAL',
          message.toLowerCase().includes('quota') ? 'Browser storage is full.' : 'The workspace could not be saved.',
          { hint: message.toLowerCase().includes('quota') ? 'Export and delete old workspaces to free space.' : undefined },
        ),
      }
    }
  }

  async writeNew(id: string, meta: WorkspaceMeta, document: WorkspaceDocument): Promise<void> {
    await this.dbRef.transaction('rw', this.dbRef.workspaces, this.dbRef.documents, async () => {
      await this.dbRef.workspaces.put(meta)
      await this.dbRef.documents.put({ id, document: serializeDocument(document) })
    })
  }

  async rename(id: string, name: string): Promise<void> {
    await this.dbRef.workspaces.update(id, { name, updatedAt: now() })
  }

  async duplicate(id: string) {
    const loaded = await this.load(id)
    if (!loaded) return null
    const nextId = nanoid(12)
    const document = structuredClone(loaded.document)
    document.name = `${document.name} (copy)`
    const meta = metaFor(nextId, document, 0)
    await this.writeNew(nextId, meta, document)
    return { id: nextId, meta, document }
  }

  async delete(id: string): Promise<void> {
    const loaded = await this.load(id)
    if (loaded) await this.snapshot(id, 'delete')
    await this.dbRef.transaction('rw', this.dbRef.workspaces, this.dbRef.documents, async () => {
      await this.dbRef.workspaces.delete(id)
      await this.dbRef.documents.delete(id)
    })
  }

  async snapshot(id: string, reason: SnapshotReason): Promise<void> {
    const row = await this.dbRef.documents.get(id)
    if (!row) return
    await this.dbRef.snapshots.add({
      id: nanoid(12),
      workspaceId: id,
      createdAt: now(),
      reason,
      document: normalize(row.document),
    })
    await this.pruneSnapshots(id)
  }

  async pruneSnapshots(id: string): Promise<void> {
    const rows = await this.dbRef.snapshots.where('workspaceId').equals(id).sortBy('createdAt')
    for (const row of rows.slice(0, Math.max(0, rows.length - MAX_SNAPSHOTS))) {
      await this.dbRef.snapshots.delete(row.id)
    }
  }

  async listSnapshots(id: string): Promise<SnapshotRow[]> {
    const rows = await this.dbRef.snapshots.where('workspaceId').equals(id).sortBy('createdAt')
    return rows.reverse()
  }

  async restoreSnapshot(snapshotId: string): Promise<LoadResult | null> {
    const snapshot = await this.dbRef.snapshots.get(snapshotId)
    if (!snapshot) return null
    const document = normalize(snapshot.document)
    const current = await this.dbRef.workspaces.get(snapshot.workspaceId)
    const result = await this.save(snapshot.workspaceId, document, current?.revision)
    if (!result.ok) return null
    return this.load(snapshot.workspaceId)
  }

  async getAppState<T>(key: string): Promise<T | undefined> {
    const row = await this.dbRef.appState.get(key)
    return row?.value as T | undefined
  }

  async setAppState<T>(key: string, value: T): Promise<void> {
    await this.dbRef.appState.put({ key, value } satisfies AppStateRow)
  }

  async estimate() {
    const result = await navigator.storage?.estimate?.()
    return result ? { usage: result.usage ?? 0, quota: result.quota ?? 0 } : null
  }

  async clearAll(): Promise<void> {
    await this.dbRef.workspaces.clear()
    await this.dbRef.documents.clear()
    await this.dbRef.snapshots.clear()
    await this.dbRef.appState.clear()
  }
}

export class MemoryWorkspaceRepository implements WorkspaceRepository {
  readonly kind = 'memory' as const
  private meta = new Map<string, WorkspaceMeta>()
  private documents = new Map<string, WorkspaceDocument>()
  private snapshots: SnapshotRow[] = []
  private appState = new Map<string, unknown>()

  async init(): Promise<void> {}
  async listMeta() { return [...this.meta.values()].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt) }
  async create(name = 'Untitled workspace') {
    const id = nanoid(12)
    const document = createEmptyDocument()
    document.name = name
    const meta = metaFor(id, document, 0)
    this.meta.set(id, meta)
    this.documents.set(id, document)
    return { id, meta, document }
  }
  async load(id: string) {
    const document = this.documents.get(id)
    if (!document) return null
    const meta = this.meta.get(id)
    if (!meta) return null
    meta.lastOpenedAt = now()
    return { document, meta: { ...meta } }
  }
  async save(id: string, document: WorkspaceDocument, baseRevision?: number): Promise<SaveResult> {
    const current = this.meta.get(id)
    if (!current) return { ok: false, error: appError('NOT_FOUND', 'Workspace not found.') }
    if (baseRevision !== undefined && current.revision > baseRevision) return { ok: false, conflict: true, currentRevision: current.revision }
    const revision = current.revision + 1
    this.documents.set(id, serializeDocument(document))
    this.meta.set(id, metaFor(id, document, revision, current.createdAt))
    return { ok: true, revision, sizeBytes: sizeOf(document) }
  }
  async rename(id: string, name: string) { const meta = this.meta.get(id); if (meta) { meta.name = name; this.meta.set(id, meta) } }
  async duplicate(id: string) {
    const loaded = await this.load(id)
    if (!loaded) return null
    const next = await this.create(`${loaded.document.name} (copy)`)
    this.documents.set(next.id, structuredClone(loaded.document))
    return { ...next, document: this.documents.get(next.id)! }
  }
  async delete(id: string) { this.meta.delete(id); this.documents.delete(id) }
  async snapshot(id: string, reason: SnapshotReason) { const document = this.documents.get(id); if (!document) return; this.snapshots.push({ id: nanoid(12), workspaceId: id, createdAt: now(), reason, document: structuredClone(document) }); await this.pruneSnapshots(id) }
  async pruneSnapshots(id: string) { const rows = this.snapshots.filter((s) => s.workspaceId === id).sort((a, b) => a.createdAt - b.createdAt); for (const row of rows.slice(0, Math.max(0, rows.length - MAX_SNAPSHOTS))) this.snapshots = this.snapshots.filter((s) => s.id !== row.id) }
  async listSnapshots(id: string) { return this.snapshots.filter((s) => s.workspaceId === id).sort((a, b) => b.createdAt - a.createdAt) }
  async restoreSnapshot(snapshotId: string) { const row = this.snapshots.find((s) => s.id === snapshotId); if (!row) return null; await this.save(row.workspaceId, row.document); return this.load(row.workspaceId) }
  async getAppState<T>(key: string) { return this.appState.get(key) as T | undefined }
  async setAppState<T>(key: string, value: T) { this.appState.set(key, value) }
  async estimate() { return null }
  async clearAll() { this.meta.clear(); this.documents.clear(); this.snapshots = []; this.appState.clear() }
}

export async function createRepository(): Promise<WorkspaceRepository> {
  if (typeof indexedDB === 'undefined') return new MemoryWorkspaceRepository()
  const repository = new DexieWorkspaceRepository()
  try {
    await repository.init()
    return repository
  } catch {
    return new MemoryWorkspaceRepository()
  }
}

export async function loadLegacyPreferences(): Promise<{ appSettings?: AppSettings; uiPreferences?: UiPreferences }> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(UI_KEY)
    const uiPreferences = raw ? (JSON.parse(raw) as UiPreferences) : undefined
    const workspaceRaw = localStorage.getItem(WORKSPACE_KEY)
    let appSettings: AppSettings | undefined
    if (workspaceRaw) {
      const parsed = JSON.parse(workspaceRaw) as { settings?: Partial<AppSettings> }
      if (parsed.settings) appSettings = { ...DEFAULT_APP_SETTINGS, ...parsed.settings }
    }
    return { ...(appSettings ? { appSettings } : {}), ...(uiPreferences ? { uiPreferences } : {}) }
  } catch {
    return {}
  }
}
