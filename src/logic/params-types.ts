import type { GenerationParams, ResolvedGenerationParams } from '../types/document'

export type RequiredGenerationParams = ResolvedGenerationParams

export function isGenerationParams(value: unknown): value is GenerationParams {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    (candidate.temperature === null || typeof candidate.temperature === 'number') &&
    (candidate.topP === null || typeof candidate.topP === 'number') &&
    (candidate.maxTokens === null || typeof candidate.maxTokens === 'number') &&
    (candidate.stop === null || Array.isArray(candidate.stop))
  )
}
