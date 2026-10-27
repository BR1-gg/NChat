import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { useUiStore, type Toast } from '../../store/uiStore'
import { IconButton } from '../common/Button'

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useCallback((): void => {
    useUiStore.getState().dismissToast(toast.id)
  }, [toast.id])
  useEffect(() => {
    if (toast.sticky) return
    const timer = globalThis.setTimeout(dismiss, 5_000)
    return () => globalThis.clearTimeout(timer)
  }, [dismiss, toast.sticky])
  const Icon =
    toast.tone === 'success'
      ? CheckCircle2
      : toast.tone === 'warning'
        ? AlertTriangle
        : toast.tone === 'error'
          ? XCircle
          : Info
  return (
    <div className={`toast ${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
      <span className="toast-marker" />
      <span className="toast-copy">
        <strong><Icon size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />{toast.title}</strong>
        {toast.message ? <p>{toast.message}</p> : null}
        {toast.actionLabel ? (
          <button
            type="button"
            className="toast-action"
            onClick={() => {
              toast.onAction?.()
              dismiss()
            }}
          >
            {toast.actionLabel}
          </button>
        ) : null}
      </span>
      <IconButton label="Dismiss notification" onClick={dismiss}>
        <X size={12} />
      </IconButton>
    </div>
  )
}

export function Toasts() {
  const toasts = useUiStore((state) => state.toasts)
  return (
    <div className="toast-stack" aria-live="polite" aria-relevant="additions">
      {toasts.map((toast) => <ToastItem key={toast.id} toast={toast} />)}
    </div>
  )
}
