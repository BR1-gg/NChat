/**
 * Installability of the app as its own window.
 *
 * The manifest is served from `public/`, so it is valid both from the Vite dev
 * server and from a production build. Chromium considers `http://127.0.0.1` a
 * secure origin, so the app can be installed while still running in
 * development and keeps hot module replacement.
 *
 * `beforeinstallprompt` is a Chromium-only event, so every decision the UI has
 * to make is a pure function of what the browser supports. Firefox cannot
 * install a manifest at all and Safari has no such event: there the honest
 * answer is to say so rather than show a button that does nothing.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type InstallState =
  | 'unsupported' // the browser will never offer installation
  | 'dismissed' // nothing to install yet
  | 'ready' // the browser will install on request
  | 'accepted'
  | 'declined'

/**
 * True only when the app is already its own window and the installed
 * experience has been chosen. In that case an install button is noise.
 */
export function isRunningInstalled(): boolean {
  if (typeof window === 'undefined') return false
  const displayMode = window.matchMedia?.('(display-mode: standalone)').matches
  // `display-mode: minimal-ui` also counts: it is still a window without tabs.
  const minimalUi = window.matchMedia?.('(display-mode: minimal-ui)').matches
  // `navigator.standalone` is the old iOS name, kept for older Safari WebViews.
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone
  return Boolean(displayMode || minimalUi || iosStandalone === true)
}

/**
 * The state a freshly loaded page starts from. A browser that has already
 * installed the app is reported as `accepted`: asking again is wrong.
 */
export function initialInstallState(): InstallState {
  if (isRunningInstalled()) return 'accepted'
  return 'dismissed'
}

export function isInstallableState(state: InstallState): boolean {
  return state === 'ready'
}

/**
 * Text for the install control, or `null` when it must not be rendered.
 *
 * Ora restituisce sempre `null`, e la ragione vale piu della funzione che rimane.
 *
 * Il pulsante offriva a **due modi di aprire la stessa cosa**, e quello di Edge e
 * peggiore in modo concreto, non solo minore:
 *
 * 1. non avvia niente. La scorciatoia chiama il browser su `127.0.0.1:5173`, quindi
 *    se il server non e gia su apre una pagina vuota — e l'utente vede un'icona che
 *    non funziona e non sa perche;
 * 2. non ha il tray, quindi non c'e il menu per fermare il server; e non c'e il proxy
 *    per i modelli in cloud, quindi senza proxy la chiave non arriva da nessuna parte
 *    e il sintomo e «la mia chiave non funziona»;
 * 3. usa il profilo di Edge, non quello del launcher, quindi due finestre con due
 *    situazioni diverse e due copie dei dati.
 *
 * Il risultato pratico e stato quello che l'utente ha descritto: **due icone sul
 * Desktop**, una delle quali non funziona, e nessun modo per capire quale premere.
 *
 * Quindi l'app non si offre piu da installare da sola. Il collegamento del Desktop
 * avvia tutto — server, servizio per i modelli in cloud, finestra e tray — ed e
 * l'unico modo che si puo consigliare. Chi lo vuole lo crea con
 * `tools\install-shortcut.ps1`, che rimuove anche le scorciatoie di app installate.
 *
 * La funzione resta, e resta pronta a tornare a restituire testo, per due motivi: il
 * manifest continua a esistere e qualcuno puo installare l'app dal menu del browser,
 * e togliere il codice avrebbe reso impossibile distinguere «non offerto perche la via
 * giusta e il tray» da «rotto».
 */
export function installLabel(_state: InstallState): { text: string; hint?: string } | null {
  return null
}

type Listener = (state: InstallState) => void

let deferred: BeforeInstallPromptEvent | null = null
let state: InstallState = initialInstallState()
const listeners = new Set<Listener>()

function emit(next: InstallState): void {
  state = next
  for (const listener of listeners) listener(state)
}

export function getInstallState(): InstallState {
  return state
}

export function subscribeInstall(listener: Listener): () => void {
  listeners.add(listener)
  listener(state)
  return () => {
    listeners.delete(listener)
  }
}

let wired = false

/**
 * Starts listening for the browser's install event. Safe to call more than
 * once. Returns a teardown function.
 */
export function initInstallPrompt(): () => void {
  if (typeof window === 'undefined' || wired) return () => undefined
  wired = true

  const onBeforeInstall = (event: Event): void => {
    // Suppressing the mini-infobar lets the app show its own control.
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    emit('ready')
  }
  const onInstalled = (): void => {
    deferred = null
    emit('accepted')
  }

  window.addEventListener('beforeinstallprompt', onBeforeInstall)
  window.addEventListener('appinstalled', onInstalled)
  return () => {
    window.removeEventListener('beforeinstallprompt', onBeforeInstall)
    window.removeEventListener('appinstalled', onInstalled)
    wired = false
    deferred = null
  }
}

/** Opens the browser's install dialog. Returns false when nothing was pending. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false
  const pending = deferred
  deferred = null
  try {
    await pending.prompt()
    const choice = await pending.userChoice
    emit(choice.outcome === 'accepted' ? 'accepted' : 'declined')
    return choice.outcome === 'accepted'
  } catch {
    emit('declined')
    return false
  }
}

/**
 * Forces a state the browser did not produce. Used only by the development
 * test hook so the button can be exercised without installing anything.
 */
export function __setInstallStateForTests(next: InstallState): void {
  emit(next)
}
