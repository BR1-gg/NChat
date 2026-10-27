import { useCallback } from 'react'
import { retryResponse, runPrompt } from '../actions/runPrompt'
import { stopRun } from '../actions/stopRun'

export function useRun(): {
  run: (promptId: string) => Promise<void>
  stop: (responseId: string) => void
  retry: (responseId: string) => Promise<void>
} {
  const run = useCallback((promptId: string) => runPrompt(promptId), [])
  const stop = useCallback((responseId: string) => stopRun(responseId), [])
  const retry = useCallback((responseId: string) => retryResponse(responseId), [])
  return { run, stop, retry }
}
