import type { ResponseStatus } from '../../types/document'

export function StatusDot({ status }: { status: ResponseStatus | 'idle' }) {
  return (
    <span
      className={`status-dot ${status}`}
      title={status === 'idle' ? 'Idle' : status}
      aria-label={status === 'idle' ? 'Idle' : status}
    />
  )
}
