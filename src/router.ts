import { useEffect, useState } from 'react'

export type AppRoute =
  | { name: 'home' }
  | { name: 'workspace'; workspaceId: string }
  | { name: 'knowledge' }

export function parseHash(hash: string): AppRoute {
  const trimmed = hash.trim()
  /*
   * La conoscenza sta **prima** del caso dei workspace, e l'ordine non e' decorativo: il
   * ramo dei workspace prende tutto quello che comincia con `#/w/`, quindi se la conoscenza
   * non venisse controllata per prima `#/knowledge` diventerebbe un workspace dal nome
   * «knowledge» che non esiste. Meglio esplicito che sottile da ricordare.
   */
  if (/^#\/knowledge\/?$/.test(trimmed)) return { name: 'knowledge' }
  const match = /^#\/w\/([^/?#]+)/.exec(trimmed)
  const workspaceId = match?.[1]
  return workspaceId ? { name: 'workspace', workspaceId } : { name: 'home' }
}

export function formatHash(route: AppRoute): string {
  if (route.name === 'home') return '#/'
  if (route.name === 'knowledge') return '#/knowledge'
  return `#/w/${encodeURIComponent(route.workspaceId)}`
}

export function navigate(route: AppRoute): void {
  const next = formatHash(route)
  if (window.location.hash !== next) window.location.hash = next
  else window.dispatchEvent(new HashChangeEvent('hashchange'))
}

export function useHashRoute(): AppRoute {
  const [route, setRoute] = useState<AppRoute>(() => parseHash(window.location.hash))
  useEffect(() => {
    const onChange = (): void => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
