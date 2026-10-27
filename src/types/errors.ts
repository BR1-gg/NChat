export type AppErrorKind =
  | 'OFFLINE'
  | 'CORS_BLOCKED'
  | 'TIMEOUT'
  | 'MODEL_NOT_LOADED'
  | 'CONTEXT_OVERFLOW'
  | 'RATE_LIMIT'
  | 'SERVER_ERROR'
  | 'BAD_RESPONSE'
  | 'GRAPH_CYCLE'
  | 'CONTEXT_NOT_READY'
  | 'EMPTY_PROMPT'
  | 'NO_MODEL'
  | 'INVALID_CONNECTION'
  | 'IMPORT_INVALID'
  | 'ABORTED'
  | 'STORAGE_FULL'
  | 'INTERNAL'
  | 'NOT_FOUND'

export interface AppError {
  kind: AppErrorKind
  message: string
  hint?: string
  status?: number
  raw?: string
}

export function appError(
  kind: AppErrorKind,
  message: string,
  options: Omit<AppError, 'kind' | 'message'> = {},
): AppError {
  return { kind, message, ...options }
}

export function isAppError(value: unknown): value is AppError {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.kind === 'string' && typeof candidate.message === 'string'
}
