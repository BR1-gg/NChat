import { CopyPlus, Replace } from 'lucide-react'
import { applyImport } from '../../actions/workspaceIO'
import { useUiStore } from '../../store/uiStore'
import { Button } from '../common/Button'
import { Modal } from '../common/Modal'

export function ImportDialog() {
  const candidate = useUiStore((state) => state.importCandidate)
  if (!candidate) return null
  return (
    <Modal
      title="Import workspace"
      size="small"
      onClose={() => useUiStore.getState().setImportCandidate(null)}
    >
      <div className="import-choice">
        <p className="inspector-value">
          Valid workspace: <strong>{candidate.name}</strong> · {candidate.nodes.length} nodes ·{' '}
          {candidate.edges.length} edges
        </p>
        <Button
          icon={<Replace size={13} />}
          onClick={() => applyImport('replace')}
        >
          Replace current workspace
        </Button>
        <Button
          icon={<CopyPlus size={13} />}
          onClick={() => applyImport('merge')}
        >
          Merge into current workspace
        </Button>
      </div>
    </Modal>
  )
}
