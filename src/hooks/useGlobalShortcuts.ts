import { useEffect } from 'react'
import { getRepository } from '../persistence/bootstrap'
import { navigate } from '../router'
import { requestCloseTab } from '../actions/tabLifecycle'
import { nextActiveTab } from '../store/tabsStore'
import { useTabsStore } from '../store/tabsStore'
import { useUiStore } from '../store/uiStore'

/**
 * Window-level shortcuts. They live outside the canvas so they also work on the
 * Home page. Only Alt combinations are used for navigation: Ctrl+T/W/N/Tab and
 * Ctrl+1..9 are reserved by the browser and must not be intercepted.
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return
      const ui = useUiStore.getState()
      const tabs = useTabsStore.getState()

      if (event.key.toLowerCase() === 'h') {
        event.preventDefault()
        tabs.activate('home')
        navigate({ name: 'home' })
        return
      }
      if (event.key.toLowerCase() === 't') {
        event.preventDefault()
        void getRepository().then(async (repository) => {
          const metas = await repository.listMeta()
          const created = await repository.create(`Untitled workspace ${metas.length + 1}`)
          window.dispatchEvent(new CustomEvent('nchat:workspaces-changed'))
          tabs.openTab(created.id)
          navigate({ name: 'workspace', workspaceId: created.id })
        })
        return
      }
      if (event.key.toLowerCase() === 'w') {
        const active = tabs.activeId
        if (active === 'home') {
          ui.addToast({ tone: 'info', title: 'The Home tab cannot be closed.' })
          return
        }
        event.preventDefault()
        requestCloseTab(active)
        return
      }
      if (event.key === 'PageDown' || event.key === 'PageUp') {
        event.preventDefault()
        if (tabs.tabs.length === 0) return
        const current = tabs.tabs.indexOf(tabs.activeId)
        const delta = event.key === 'PageDown' ? 1 : -1
        const next =
          tabs.tabs[Math.min(tabs.tabs.length - 1, Math.max(0, (current < 0 ? 0 : current) + delta))]
        if (!next) return
        tabs.activate(next)
        navigate({ name: 'workspace', workspaceId: next })
        return
      }
      const digit = Number(event.key)
      if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
        event.preventDefault()
        const target = tabs.tabs[digit - 1]
        if (!target) return
        tabs.activate(target)
        navigate({ name: 'workspace', workspaceId: target })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

export { nextActiveTab }
