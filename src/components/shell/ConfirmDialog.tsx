import { useUiStore } from '../../store/uiStore'
import { Button } from '../common/Button'
import { Modal } from '../common/Modal'

export function ConfirmDialog() {
  const confirm = useUiStore((state) => state.confirm)
  if (!confirm) return null
  const cancel = (): void => {
    confirm.onCancel?.()
    useUiStore.getState().closeConfirm()
  }
  return (
    <Modal
      title={confirm.title}
      size="small"
      onClose={cancel}
      footer={
        <>
          <Button onClick={cancel}>{confirm.cancelLabel ?? 'Cancel'}</Button>
          <Button
            variant={confirm.destructive ? 'danger' : 'primary'}
            onClick={() => {
              confirm.onConfirm()
              useUiStore.getState().closeConfirm()
            }}
          >
            {confirm.confirmLabel}
          </Button>
        </>
      }
    >
      <p style={{ margin: 0, color: 'var(--text-dim)', lineHeight: 1.55 }}>{confirm.message}</p>
    </Modal>
  )
}
