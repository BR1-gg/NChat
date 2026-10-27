import { AlertCircle, ChevronDown } from 'lucide-react'
import type { AppError } from '../../types/errors'

export function ErrorCard({ error, compact = false }: { error: AppError; compact?: boolean }) {
  return (
    <div className="error-card" role="alert">
      <div className="error-card-header">
        <AlertCircle size={13} />
        <span>{error.message}</span>
      </div>
      {error.hint && !compact ? <div className="error-card-body">{error.hint}</div> : null}
      {error.raw ? (
        <details>
          <summary>
            Technical details <ChevronDown size={10} />
          </summary>
          <pre>{error.raw}</pre>
        </details>
      ) : null}
    </div>
  )
}
