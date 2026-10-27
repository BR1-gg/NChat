import type { ProviderId } from './providers'
import { providerSpec } from './providers'

/**
 * What the app says about the model server, and what it must never say.
 *
 * The confusion this file exists to prevent, and it is a confusion the app caused
 * itself: it showed a red **Offline** and the user read it as *the app did not open*.
 * The app had opened perfectly. What was down was the **model server** — a program
 * the user runs separately, on their machine, that has nothing to do with whether
 * NCHAT is up.
 *
 * The two are separate processes, so the wording has to keep them separate. One
 * sentence that says both, every time, and the user never has to guess which of the
 * two is broken:
 *
 * > NCHAT is running. The model server is not answering.
 *
 * It is also **not an error**. Nothing failed, nothing was lost, the canvas works,
 * the nodes can be written and rearranged. It is a state, like "no model downloaded",
 * and it gets the same calm treatment. An offline model server is a normal Tuesday
 * for someone who mostly works in the cloud.
 */

/** Short enough for the pill, true in every state. */
export type ConnectionState =
  | 'connected'
  | 'connecting'
  | 'offline'
  | 'no-model'
  | 'loading-model'

/** What the pill says. Never the word "error": it names a state, not a failure. */
export function connectionLabel(status: ConnectionState): string {
  switch (status) {
    case 'connected':
      return 'Connected'
    case 'connecting':
      return 'Connecting…'
    case 'loading-model':
      return 'Loading model…'
    case 'no-model':
      return 'No model loaded'
    case 'offline':
      // "Offline" diceva «sono offline», cioe io. In realta' e il server dei modelli,
      // quindi la parola nomina **lui**: e la differenza fra un'etichetta e una
      // diagnosi.
      return 'Model server down'
  }
}

/**
 * The one sentence that says what is up and what is not.
 *
 * Always names NCHAT first, because that is the question the user has: «l'app si e
 * aperta?». Then the thing that is actually missing, by name — "Local (LM Studio)" or
 * "NVIDIA NIM (cloud)" — because a generic "the server" is what the user has to
 * translate themselves, and translating is where they get it wrong.
 */
export function connectionExplanation(status: ConnectionState, provider: ProviderId): string {
  const label = providerSpec(provider).label
  switch (status) {
    case 'connected':
      return `NCHAT is running and ${label} answered.`
    case 'connecting':
      return `NCHAT is running. Asking ${label}…`
    case 'loading-model':
      return `NCHAT is running. ${label} is loading the model.`
    case 'no-model':
      return `NCHAT is running and ${label} answered, but no model is loaded. Pick one and it starts.`
    case 'offline':
      return `NCHAT is running. ${label} is not answering, so there are no models to choose from yet. The canvas still works.`
  }
}

/**
 * The one thing to do about it, or nothing.
 *
 * Returns `null` when there is genuinely nothing to do, so the caller can stay quiet
 * instead of offering a button that does not help. Silence is better than a
 * suggestion that turns out to be useless.
 */
export function connectionAdvice(status: ConnectionState, provider: ProviderId): string | null {
  const label = providerSpec(provider).label
  if (status === 'connected' || status === 'loading-model') return null
  if (status === 'no-model') return 'Choose a model to load it.'
  if (status === 'connecting') return null
  return provider === 'lmstudio'
    ? 'Start LM Studio, load a model, and come back. The list fills in by itself.'
    : `Start the local service for ${label} from the tray icon, then check the API key.`
}
