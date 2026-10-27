import type { NodeTypes } from '@xyflow/react'
import {
  BrainCircuit,
  Boxes,
  FileImage,
  FileOutput,
  FileText,
  FolderOpen,
  Layers3,
  LibraryBig,
  MessageSquareText,
  NotebookPen,
  Settings2,
  Sparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { BrainNode } from '../components/nodes/BrainNode'
import { FileNode } from '../components/nodes/FileNode'
import { FolderNode } from '../components/nodes/FolderNode'
import { GroupNode } from '../components/nodes/GroupNode'
import { ImageNode } from '../components/nodes/ImageNode'
import { KnowledgeNode } from '../components/nodes/KnowledgeNode'
import { NoteNode } from '../components/nodes/NoteNode'
import { OutputNode } from '../components/nodes/OutputNode'
import { SetNode } from '../components/nodes/SetNode'
import { PromptNode } from '../components/nodes/PromptNode'
import { ResponseNode } from '../components/nodes/ResponseNode'
import { SummaryNode } from '../components/nodes/SummaryNode'
import { SystemNode } from '../components/nodes/SystemNode'
import type { AddableNodeType, NodeType } from '../types/document'

export interface NodeKindSpec {
  kind: NodeType
  label: string
  description: string
  shortcut?: string
  icon: LucideIcon
  minimapColor: string
  defaultWidth: number
  defaultHeight: number
  minWidth: number
  minHeight: number
  maxWidth: number
  maxHeight: number
  estimatedHeight: number
  addable: boolean
  copyable: boolean
  contextMenu: string[]
}

export const NODE_REGISTRY: Record<NodeType, NodeKindSpec> = {
  prompt: {
    kind: 'prompt',
    label: 'Prompt',
    description: 'Ask the model something',
    shortcut: 'P',
    icon: MessageSquareText,
    minimapColor: 'var(--accent)',
    defaultWidth: 320,
    defaultHeight: 220,
    minWidth: 260,
    minHeight: 160,
    maxWidth: 1400,
    maxHeight: 1800,
    estimatedHeight: 220,
    addable: true,
    copyable: true,
    contextMenu: ['Run', 'Duplicate', 'Copy text', 'Delete'],
  },
  response: {
    kind: 'response',
    label: 'Response',
    description: 'Generated answer record',
    icon: MessageSquareText,
    minimapColor: 'var(--edge-context)',
    defaultWidth: 320,
    defaultHeight: 180,
    minWidth: 280,
    minHeight: 120,
    maxWidth: 1400,
    maxHeight: 1800,
    estimatedHeight: 180,
    addable: false,
    copyable: true,
    contextMenu: ['Copy', 'Retry', 'Run again', 'Continue', 'Delete'],
  },
  system: {
    kind: 'system',
    label: 'System',
    description: 'Instructions for downstream prompts',
    shortcut: 'S',
    icon: Settings2,
    minimapColor: 'var(--edge-system)',
    defaultWidth: 320,
    defaultHeight: 170,
    minWidth: 240,
    minHeight: 120,
    maxWidth: 1400,
    maxHeight: 1800,
    estimatedHeight: 170,
    addable: true,
    copyable: true,
    contextMenu: ['Duplicate', 'Copy text', 'Delete'],
  },
  note: {
    kind: 'note',
    label: 'Note',
    description: 'Annotate your graph',
    shortcut: 'N',
    icon: NotebookPen,
    minimapColor: 'var(--warn)',
    defaultWidth: 320,
    defaultHeight: 160,
    minWidth: 200,
    minHeight: 100,
    maxWidth: 1400,
    maxHeight: 1800,
    estimatedHeight: 160,
    addable: true,
    copyable: true,
    contextMenu: ['Duplicate', 'Copy text', 'Delete'],
  },
  set: {
    kind: 'set',
    label: 'Set (legacy)',
    description: 'Older grouping node, kept so saved documents still load',
    icon: Layers3,
    minimapColor: 'var(--accent-2)',
    defaultWidth: 340,
    defaultHeight: 240,
    minWidth: 300,
    minHeight: 180,
    maxWidth: 1400,
    maxHeight: 1800,
    estimatedHeight: 240,
    addable: false,
    copyable: true,
    contextMenu: ['Duplicate', 'Delete'],
  },
  output: {
    kind: 'output',
    label: 'Output',
    description: 'Grouped answers as one result you can plug into another node',
    icon: FileOutput,
    minimapColor: 'var(--stream)',
    defaultWidth: 360,
    defaultHeight: 260,
    minWidth: 280,
    minHeight: 160,
    maxWidth: 1400,
    maxHeight: 1800,
    estimatedHeight: 260,
    // Not offered in the palette. A group is made by grouping what is already on
    // the canvas, so an empty Output card on its own is a dead end: it has
    // nothing to gather. It stays addable in the type system, because grouping
    // creates one, and it stays in the registry so saved documents still load.
    addable: false,
    copyable: true,
    contextMenu: ['Copy', 'Export .md', 'Delete'],
  },
  group: {
    kind: 'group',
    label: 'Group',
    description: 'A frame to arrange nodes in — it holds them, it does not change them',
    icon: Boxes,
    minimapColor: 'var(--accent-2)',
    defaultWidth: 360,
    defaultHeight: 260,
    minWidth: 280,
    minHeight: 160,
    maxWidth: 1400,
    maxHeight: 1800,
    estimatedHeight: 260,
    // Come l'output, non e' nel catalogo: un gruppo nasce mettendoci dentro nodi che ci
    // sono gia'. Quello che lo distingue e' che accetta **qualsiasi** tipo di nodo,
    // anche un prompt o una risposta, perche' non deve aggregare nulla e quindi non ha
    // niente da cui essere limitato.
    addable: false,
    copyable: true,
    contextMenu: ['Rename', 'Copy', 'Delete'],
  },
  image: {
    kind: 'image',
    label: 'Image',
    description: 'An image or video to send with a prompt',
    icon: FileImage,
    minimapColor: 'var(--accent)',
    defaultWidth: 320,
    defaultHeight: 260,
    minWidth: 220,
    minHeight: 160,
    maxWidth: 1400,
    maxHeight: 1800,
    estimatedHeight: 260,
    addable: true,
    copyable: true,
    contextMenu: ['Replace file', 'Delete'],
  },
  file: {
    kind: 'file',
    label: 'File',
    description: 'A text file to send with a prompt',
    icon: FileText,
    minimapColor: 'var(--edge-context)',
    defaultWidth: 340,
    defaultHeight: 280,
    minWidth: 240,
    minHeight: 160,
    maxWidth: 1400,
    maxHeight: 1800,
    estimatedHeight: 280,
    addable: true,
    copyable: true,
    contextMenu: ['Replace file', 'Delete'],
  },
  folder: {
    kind: 'folder',
    label: 'Folder',
    description: 'A folder of text files to send with a prompt',
    icon: FolderOpen,
    minimapColor: 'var(--edge-context)',
    defaultWidth: 360,
    defaultHeight: 300,
    minWidth: 260,
    minHeight: 180,
    maxWidth: 1400,
    maxHeight: 1800,
    estimatedHeight: 300,
    addable: true,
    copyable: true,
    contextMenu: ['Replace folder', 'Delete'],
  },
  brain: {
    kind: 'brain',
    label: 'Brain',
    description: 'Work through the files of one folder and write the results into another',
    icon: BrainCircuit,
    minimapColor: 'var(--ok)',
    defaultWidth: 380,
    defaultHeight: 460,
    minWidth: 300,
    minHeight: 260,
    maxWidth: 1400,
    maxHeight: 1800,
    estimatedHeight: 460,
    addable: true,
    copyable: true,
    contextMenu: ['Duplicate', 'Delete'],
  },
  knowledge: {
    kind: 'knowledge',
    label: 'Knowledge',
    description: 'Send notes from your archive to a prompt, by main point',
    icon: LibraryBig,
    minimapColor: 'var(--edge-context)',
    defaultWidth: 320,
    defaultHeight: 300,
    minWidth: 280,
    minHeight: 220,
    maxWidth: 1400,
    maxHeight: 1800,
    // L'altezza stima e' quella di **una nota** piu' le scelte, e non quella di tutte: un
    // centro con venti note non deve far crescere il nodo di venti righe, sennò coprirebbe
    // metà canvas e il resto del grafico sparirebbe sotto. L'elenco scorre dentro.
    estimatedHeight: 300,
    addable: true,
    copyable: true,
    contextMenu: ['Duplicate', 'Delete'],
  },
  summary: {
    kind: 'summary',
    label: 'Summary',
    description: 'Non-destructive conversation checkpoint',
    icon: Sparkles,
    minimapColor: 'var(--ok)',
    defaultWidth: 340,
    defaultHeight: 240,
    minWidth: 280,
    minHeight: 140,
    maxWidth: 1400,
    maxHeight: 1800,
    estimatedHeight: 240,
    addable: false,
    copyable: true,
    contextMenu: ['Regenerate', 'Show original history', 'Delete'],
  },
}

const components: Record<NodeType, NodeTypes[string]> = {
  prompt: PromptNode,
  response: ResponseNode,
  system: SystemNode,
  note: NoteNode,
  set: SetNode,
  output: OutputNode,
  group: GroupNode,
  summary: SummaryNode,
  image: ImageNode,
  file: FileNode,
  folder: FolderNode,
  brain: BrainNode,
  knowledge: KnowledgeNode,
}

export const nodeTypes: NodeTypes = Object.fromEntries(
  (Object.keys(NODE_REGISTRY) as NodeType[]).map((kind) => [kind, components[kind]]),
)

export function isKnownNodeType(value: unknown): value is NodeType {
  return typeof value === 'string' && value in NODE_REGISTRY
}

export function getNodeSpec(kind: NodeType): NodeKindSpec {
  return NODE_REGISTRY[kind]
}

export const addableNodeTypes = (Object.keys(NODE_REGISTRY) as NodeType[]).filter(
  (kind) => NODE_REGISTRY[kind].addable,
) as AddableNodeType[]
