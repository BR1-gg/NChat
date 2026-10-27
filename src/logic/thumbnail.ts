import type { AppNode, WorkspaceDocument } from '../types/document'

const PALETTE: Record<string, string> = {
  prompt: '#7c6cf6',
  response: '#34d3a6',
  system: '#f4b740',
  note: '#94a3b8',
  set: '#c084fc',
  output: '#38bdf8',
  summary: '#22c55e',
}

const WIDTH = 320
const HEIGHT = 180
const PADDING = 12
const NODE_W = 18
const NODE_H = 11

function bounds(nodes: AppNode[]): { minX: number; minY: number; scale: number } {
  if (nodes.length === 0) return { minX: 0, minY: 0, scale: 1 }
  const minX = Math.min(...nodes.map((node) => node.position.x))
  const minY = Math.min(...nodes.map((node) => node.position.y))
  const maxX = Math.max(...nodes.map((node) => node.position.x + (node.width ?? 320)))
  const maxY = Math.max(...nodes.map((node) => node.position.y + (node.height ?? 180)))
  const spanX = Math.max(1, maxX - minX)
  const spanY = Math.max(1, maxY - minY)
  const scale = Math.min(
    (WIDTH - PADDING * 2) / spanX,
    (HEIGHT - PADDING * 2) / spanY,
  )
  return { minX, minY, scale }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Renders a small, deterministic SVG preview of a workspace: one coloured
 * rectangle per node at its real position, connected by thin lines. No React
 * Flow instance is needed on the Home page, and the result is stable for the
 * same document so it can be cached in `workspaces.thumbnail`.
 */
export function renderThumbnail(document: WorkspaceDocument): string {
  const nodes = document.nodes
  if (nodes.length === 0) {
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Empty workspace">`,
      `<title>${escapeXml(document.name)}</title>`,
      '</svg>',
    ].join('')
  }
  const { minX, minY, scale } = bounds(nodes)
  const toX = (x: number): number =>
    Math.round((x - minX) * scale * 100) / 100 + PADDING
  const toY = (y: number): number =>
    Math.round((y - minY) * scale * 100) / 100 + PADDING

  const byId = new Map(nodes.map((node) => [node.id, node]))
  const lines = document.edges
    .filter((edge) => edge.kind !== 'run')
    .flatMap((edge) => {
      const from = byId.get(edge.source)
      const to = byId.get(edge.target)
      if (!from || !to) return []
      const x1 = toX(from.position.x + 160)
      const y1 = toY(from.position.y + 90)
      const x2 = toX(to.position.x + 160)
      const y2 = toY(to.position.y + 90)
      return [
        `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-opacity="0.22" stroke-width="1"/>`,
      ]
    })

  const rects = [...nodes]
    .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
    .map((node) => {
      const fill = PALETTE[node.type] ?? '#94a3b8'
      return `<rect x="${toX(node.position.x)}" y="${toY(node.position.y)}" width="${NODE_W}" height="${NODE_H}" rx="2" fill="${fill}"/>`
    })

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Workspace preview">`,
    `<title>${escapeXml(document.name)}</title>`,
    ...lines,
    ...rects,
    '</svg>',
  ].join('')
}

export function thumbnailIsValid(svg: string): boolean {
  return svg.startsWith('<svg') && svg.endsWith('</svg>') && svg.includes('viewBox=')
}
