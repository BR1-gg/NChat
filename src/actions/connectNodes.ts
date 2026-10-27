import type { Connection } from '@xyflow/react'
import { isAppError, type AppError } from '../types/errors'
import { useUiStore } from '../store/uiStore'
import { useWorkspaceStore } from '../store/workspaceStore'

export function connectNodes(connection: Connection): AppError | null {
  const result = useWorkspaceStore.getState().addConnection(connection)
  if (isAppError(result)) {
    useUiStore.getState().addToast({
      tone: 'error',
      title: result.message,
      ...(result.hint ? { message: result.hint } : {}),
    })
    return result
  }
  return null
}

export function continueFromResponse(responseId: string): string | null {
  const workspace = useWorkspaceStore.getState()
  const response = workspace.nodes.find(
    (node) => node.id === responseId && node.data.kind === 'response',
  )
  if (!response) return null
  const promptId = workspace.addNode('prompt', {
    x: response.position.x + 410,
    y: response.position.y + 30,
  })
  const error = connectNodes({
    source: responseId,
    sourceHandle: 'context',
    target: promptId,
    targetHandle: 'context',
  })
  if (error) {
    workspace.removeNodes([promptId])
    return null
  }
  const ui = useUiStore.getState()
  ui.setSelectedNode(promptId)
  ui.setFocusNode(promptId)
  return promptId
}
