import type { NodeTypes } from '@xyflow/react'
import { NoteNode } from '../nodes/NoteNode'
import { PromptNode } from '../nodes/PromptNode'
import { ResponseNode } from '../nodes/ResponseNode'
import { SystemNode } from '../nodes/SystemNode'

export const nodeTypes: NodeTypes = {
  prompt: PromptNode,
  response: ResponseNode,
  system: SystemNode,
  note: NoteNode,
}
