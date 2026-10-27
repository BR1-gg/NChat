import { create } from 'zustand'

export type ActiveTabId = 'home' | string

interface TabsState {
  tabs: string[]
  activeId: ActiveTabId
  hydrate: (tabs: string[], activeId: ActiveTabId) => void
  openTab: (workspaceId: string) => void
  activate: (id: ActiveTabId) => void
  closeTab: (workspaceId: string) => ActiveTabId
  closeOthers: (workspaceId: string) => void
  closeRight: (workspaceId: string) => void
  moveTab: (from: number, to: number) => void
}

export function nextActiveTab(
  tabs: string[],
  closingId: string,
  activeId: ActiveTabId,
): ActiveTabId {
  const index = tabs.indexOf(closingId)
  if (index < 0) return activeId
  const remaining = tabs.filter((id) => id !== closingId)
  if (activeId !== closingId) return activeId
  return remaining[index] ?? remaining[index - 1] ?? 'home'
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeId: 'home',
  hydrate(tabs, activeId) {
    set({ tabs: [...new Set(tabs)], activeId })
  },
  openTab(workspaceId) {
    set((state) => ({
      tabs: state.tabs.includes(workspaceId)
        ? state.tabs
        : [...state.tabs, workspaceId],
      activeId: workspaceId,
    }))
  },
  activate(id) {
    if (id === 'home' || get().tabs.includes(id)) set({ activeId: id })
  },
  closeTab(workspaceId) {
    const next = nextActiveTab(get().tabs, workspaceId, get().activeId)
    set((state) => ({ tabs: state.tabs.filter((id) => id !== workspaceId), activeId: next }))
    return next
  },
  closeOthers(workspaceId) {
    set({ tabs: [workspaceId], activeId: workspaceId })
  },
  closeRight(workspaceId) {
    set((state) => {
      const index = state.tabs.indexOf(workspaceId)
      return {
        tabs: state.tabs.slice(0, index + 1),
        activeId: state.tabs.includes(state.activeId)
          ? state.activeId
          : workspaceId,
      }
    })
  },
  moveTab(from, to) {
    set((state) => {
      if (from < 0 || from >= state.tabs.length || to < 0 || to >= state.tabs.length) return state
      const tabs = [...state.tabs]
      const [moved] = tabs.splice(from, 1)
      if (!moved) return state
      tabs.splice(to, 0, moved)
      return { tabs }
    })
  },
}))
