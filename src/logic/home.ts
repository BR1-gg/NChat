import type { WorkspaceMeta } from '../persistence/db'

export type WorkspaceSort = 'last-opened' | 'last-modified' | 'name' | 'size'

export function nextUntitledName(existingNames: string[]): string {
  let candidate = 1
  while (existingNames.includes(candidate === 1 ? 'Untitled workspace' : `Untitled workspace ${candidate}`)) {
    candidate += 1
    if (candidate > 10_000) break
  }
  return candidate === 1 ? 'Untitled workspace' : `Untitled workspace ${candidate}`
}

export function filterAndSortWorkspaces(
  workspaces: WorkspaceMeta[],
  query: string,
  sort: WorkspaceSort,
): WorkspaceMeta[] {
  const needle = query.trim().toLowerCase()
  const filtered = needle
    ? workspaces.filter((workspace) => workspace.name.toLowerCase().includes(needle))
    : [...workspaces]
  return filtered.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name)
    if (sort === 'size') return b.sizeBytes - a.sizeBytes
    if (sort === 'last-modified') return b.updatedAt - a.updatedAt
    return b.lastOpenedAt - a.lastOpenedAt
  })
}

export function relativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} d ago`
  const months = Math.round(days / 30)
  return `${months} mo ago`
}
