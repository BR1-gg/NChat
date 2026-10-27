import { getActiveWorkspaceStore } from '../store/workspaceStore'
import { useUiStore } from '../store/uiStore'
import { mergeSettings, type Settings } from '../types/settings'
import { createOpenAIClient } from './openai'
import type { LLMClient } from './types'

export function getLLMClient(settings: Settings): LLMClient {
  return createOpenAIClient(settings)
}

/**
 * The settings a request must actually use, right now.
 *
 * The app settings exist in two places: the UI store, which is the live one, and
 * the workspace store, which gets a copy when a workspace opens and is then only
 * refreshed when the workspace is saved. Reading the workspace copy is what made
 * the cloud path look fake: the top bar showed one provider, the request went to
 * another, and the error named a provider the user had not chosen in months.
 *
 * The rule is therefore one line, and it lives here so it cannot be forgotten:
 * **the app part comes from the UI store at the moment of use, the workspace part
 * from the workspace store.** Changing provider, key or address takes effect on
 * the very next run, with nothing to save.
 *
 * The one thing that is a workspace decision stays one: `defaults` and
 * `contextTokenWarning`, which live with the document.
 */
export function liveSettings(): Settings {
  const app = useUiStore.getState().appSettings
  const workspace = getActiveWorkspaceStore().getState().workspaceSettings
  return mergeSettings(app, workspace)
}
