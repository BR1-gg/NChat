import { Copy, Home, Library, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { requestCloseTab } from '../../actions/tabLifecycle'
import { getRepository } from '../../persistence/bootstrap'
import type { WorkspaceMeta } from '../../persistence/db'
import { navigate, type AppRoute } from '../../router'
import { useRunStore } from '../../store/runStore'
import { useTabsStore } from '../../store/tabsStore'
import { workspaceRegistry } from '../../store/workspaceRegistry'
import { IconButton } from '../common/Button'
import { primeWorkspaceNames } from '../shell/QueuePanel'

export function TabBar({ route }: { route: AppRoute }) {
  const tabs = useTabsStore((state) => state.tabs)
  const activeId = useTabsStore((state) => state.activeId)
  const activate = useTabsStore((state) => state.activate)
  const moveTab = useTabsStore((state) => state.moveTab)
  const runs = useRunStore((state) => state.runs)
  const [meta, setMeta] = useState<WorkspaceMeta[]>([])
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const draggingId = useRef<string | null>(null)

  useEffect(() => {
    void getRepository().then((repository) =>
      repository.listMeta().then((list) => {
        setMeta(list)
        primeWorkspaceNames(list)
      }),
    )
  }, [tabs])

  const activateTab = (id: string): void => {
    activate(id)
    navigate({ name: 'workspace', workspaceId: id })
  }

  const close = (event: React.MouseEvent, id: string): void => {
    event.stopPropagation()
    requestCloseTab(id)
  }

  const activeRuns = (id: string): number =>
    Object.values(runs).filter((run) => run.workspaceId === id && !run.controller.signal.aborted).length

  return (
    <nav className="tab-bar" aria-label="Open workspaces" onDoubleClick={(event) => {
      if (event.target === event.currentTarget) {
        workspaceRegistry.activate(null)
        navigate({ name: 'home' })
      }
    }}>
      <button
        type="button"
        className={`tab home-tab ${route.name === 'home' ? 'active' : ''}`}
        onClick={() => { activate('home'); navigate({ name: 'home' }) }}
        aria-label="Home"
        title="Home (Alt+H)"
      >
        <Home size={13} />
      </button>
      {/*
        La conoscenza sta **accanto** al bottone Home, e non fra le schede dei workspace.
        Non e' una scelta di posizione: e' una scelta di cosa e'. Una scheda workspace vuota
        da aprire e chiudere, e l'archivio non e' un progetto — non si duplica, non si
        rinomina, non si chiude, e non finisce nella lista di quelli che si aprono. Metterlo
        li' avrebbe reso una cosa sola cose diverse, che e' il modo in cui una barra di
        navigazione smette di dire dove sei.

        Per questo il pulsante e' **sempre lo stesso** e non cambia aspetto quando la
        conoscenza e' aperta: e' un posto, non uno stato.
      */}
      <button
        type="button"
        className="tab knowledge-tab"
        onClick={() => navigate({ name: 'knowledge' })}
        aria-label="Knowledge"
        title="Knowledge — everything you have saved, in one place"
      >
        <Library size={13} />
      </button>
      <div className="tab-strip">
        {tabs.map((id, index) => {
          const store = workspaceRegistry.get(id)
          const dirty = store?.getState().dirty ?? false
          const running = activeRuns(id)
          const item = meta.find((entry) => entry.id === id)
          return (
            <button
              key={id}
              type="button"
              draggable
              className={`workspace-tab ${activeId === id && route.name === 'workspace' ? 'active' : ''}`}
              onClick={() => activateTab(id)}
              onAuxClick={(event) => {
                if (event.button === 1) close(event, id)
              }}
              onDragStart={() => { draggingId.current = id }}
              onDragOver={(event: DragEvent) => event.preventDefault()}
              onDrop={() => {
                const from = tabs.indexOf(draggingId.current ?? '')
                if (from >= 0) moveTab(from, index)
                draggingId.current = null
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                setMenu({ x: event.clientX, y: event.clientY, id })
              }}
            >
              <span className="tab-title">{item?.name ?? 'Workspace'}</span>
              {running > 0 ? <span className="tab-running">{running}</span> : null}
              {dirty ? <span className="tab-dirty" title="Unsaved changes" /> : null}
              <span
                role="button"
                tabIndex={0}
                className="tab-close"
                aria-label={`Close ${item?.name ?? 'workspace'}`}
                onClick={(event) => close(event, id)}
              ><X size={11} /></span>
            </button>
          )
        })}
        <IconButton label="New workspace tab" onClick={() => navigate({ name: 'home' })}><Plus size={12} /></IconButton>
      </div>
      {menu ? (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }} onMouseLeave={() => setMenu(null)}>
          <button type="button" onClick={() => { activateTab(menu.id); setMenu(null) }}>Open</button>
          <button type="button" onClick={() => { const next = useTabsStore.getState().closeTab(menu.id); if (next === 'home') navigate({ name: 'home' }); setMenu(null) }}>Close</button>
          <button type="button" onClick={() => { useTabsStore.getState().closeOthers(menu.id); setMenu(null) }}>Close others</button>
          <button type="button" onClick={() => { useTabsStore.getState().closeRight(menu.id); setMenu(null) }}>Close tabs to the right</button>
          <button type="button" onClick={() => { void getRepository().then((repository) => repository.duplicate(menu.id)).then((result) => { if (result) { useTabsStore.getState().openTab(result.id); navigate({ name: 'workspace', workspaceId: result.id }) } }); setMenu(null) }}><Copy size={11} /> Duplicate workspace</button>
          <button type="button" onClick={() => { activateTab(menu.id); navigate({ name: 'home' }); setMenu(null) }}>Reveal in Home</button>
        </div>
      ) : null}
    </nav>
  )
}
