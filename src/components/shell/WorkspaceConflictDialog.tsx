import { Copy, RefreshCw, Save } from 'lucide-react'
import { getRepository } from '../../persistence/bootstrap'
import { navigate } from '../../router'
import { useTabsStore } from '../../store/tabsStore'
import { useUiStore } from '../../store/uiStore'
import { getActiveWorkspaceStore } from '../../store/workspaceStore'
import { Button } from '../common/Button'
import { Modal } from '../common/Modal'

export function WorkspaceConflictDialog() {
  const conflict = useUiStore((state) => state.workspaceConflict)
  if (!conflict) return null
  const close = (): void => useUiStore.getState().setWorkspaceConflict(null)

  const reload = async (): Promise<void> => {
    const repository = await getRepository()
    const loaded = await repository.load(conflict.workspaceId)
    if (loaded) {
      const store = getActiveWorkspaceStore()
      store.getState().replaceDocument(loaded.document)
      store.getState().setRevision(loaded.meta.revision)
      store.getState().markSaved(loaded.meta.revision)
    }
    close()
  }

  const overwrite = async (): Promise<void> => {
    const store = getActiveWorkspaceStore()
    const repository = await getRepository()
    store.getState().setRevision(conflict.currentRevision)
    const result = await repository.save(
      conflict.workspaceId,
      store.getState().nodes.length >= 0
        ? {
            docVersion: store.getState().docVersion,
            savedAt: 0,
            name: store.getState().name,
            nodes: store.getState().nodes,
            edges: store.getState().edges,
            settings: store.getState().settings,
            viewport: store.getState().viewport,
          }
        : (() => { throw new Error('Invalid workspace state') })(),
      conflict.currentRevision,
    )
    if (result.ok) store.getState().markSaved(result.revision)
    close()
  }

  const saveCopy = async (): Promise<void> => {
    const store = getActiveWorkspaceStore()
    const state = store.getState()
    const repository = await getRepository()
    const created = await repository.create(`${state.name} (conflict copy)`)
    await repository.save(created.id, {
      docVersion: state.docVersion,
      savedAt: 0,
      name: `${state.name} (conflict copy)`,
      nodes: state.nodes,
      edges: state.edges,
      settings: state.settings,
      viewport: state.viewport,
    }, created.meta.revision)
    useTabsStore.getState().openTab(created.id)
    navigate({ name: 'workspace', workspaceId: created.id })
    close()
  }

  return (
    <Modal title="This workspace was changed in another window" size="small" onClose={close}>
      <p className="inspector-value">Choose whether to reload the newer version, overwrite it, or keep both.</p>
      <div className="import-choice" style={{ marginTop: 12 }}>
        <Button icon={<RefreshCw size={12} />} onClick={() => void reload()}>Reload latest</Button>
        <Button icon={<Save size={12} />} onClick={() => void overwrite()}>Overwrite</Button>
        <Button icon={<Copy size={12} />} onClick={() => void saveCopy()}>Save as copy</Button>
      </div>
    </Modal>
  )
}
