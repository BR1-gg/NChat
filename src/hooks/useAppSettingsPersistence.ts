import { useEffect } from 'react'
import { getRepository } from '../persistence/bootstrap'
import { useUiStore } from '../store/uiStore'

/**
 * Saves the app settings, debounced.
 *
 * These were written from `useAutosave`, which runs inside the workspace shell.
 * That was wrong in a way that was invisible until an app setting could be
 * changed from somewhere with no workspace: on the Home page `useAutosave` never
 * mounted, so the change landed in the store and on the screen and then was lost
 * on the next reload. The store said one thing, the screen another, and the disk
 * a third.
 *
 * Connection, appearance and install state belong to the installation, so this
 * belongs to the app and not to a workspace.
 */
const SAVE_DEBOUNCE_MS = 250

export function useAppSettingsPersistence(): void {
  const appSettings = useUiStore((state) => state.appSettings)

  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      void getRepository().then((repository) => repository.setAppState('appSettings', appSettings))
    }, SAVE_DEBOUNCE_MS)
    return () => globalThis.clearTimeout(timer)
  }, [appSettings])
}
