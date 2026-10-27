/**
 * Il lato applicazione del proxy locale.
 *
 * Tutte le `fetch` restano in `src/llm/`, e questo file e l'unico che parla con il
 * servizio locale. Per un provider cloud la richiesta non cambia forma: cambia
 * l'indirizzo, e la chiave la mette il proxy invece di noi.
 *
 * Il proxy e un servizio in ascolto su 127.0.0.1 che puo anche non essere
 *in esecuzione: l'utente chiude il tray e riapre solo l'app. Per questo ogni errore
 * qui dice **perche** il servizio non c'e, invece di restare un `fetch` fallito
 * che l'utente non può distinguere da un problema di rete.
 */

import { isCloudProvider, providerSpec, type ProviderId } from '../logic/providers'
import { log } from '../logging/logger'
import { apiKeyFor, type Settings } from '../types/settings'

/**
 * La porta del servizio locale.
 *
 * 1235 e subito dopo LM Studio (1234), cosi sono vicini da ricordare. Cambiarla
 * significa cambiare anche `tools/run-tray.ps1`, altrimenti il tray avvia il
 * servizio su una porta e l'app lo cerca su un'altra, e il sintomo e "compaiono
 * chiavi che non ho messo".
 */
export const PROXY_PORT = 1235
export const PROXY_ORIGIN = `http://127.0.0.1:${PROXY_PORT}`

/**
 * A failure with a cause, not just a message.
 *
 * The `reason` is what lets the message say what to do. "fetch failed" tells the
 * user nothing they can act on; "the local service is not running" tells them to
 * start it from the tray.
 */
export class ProxyError extends Error {
  readonly reason: 'not-running' | 'no-key' | 'refused' | 'network' | 'bad-address'

  constructor(reason: ProxyError['reason'], message: string) {
    super(message)
    this.name = 'ProxyError'
    this.reason = reason
  }
}

/** Il messaggio che spiega cosa fare, per ogni modo in cui puo fallire. */
export function proxyHelp(reason: ProxyError['reason']): string {
  switch (reason) {
    case 'not-running':
      return 'The local service is not running. Start it from the tray icon, or run tools/cloud-proxy.mjs.'
    case 'no-key':
      return 'The local service has no key for this provider. Enter it again in Settings → Connection.'
    case 'refused':
      return 'The local service refused the request. Check the key and the address in Settings → Connection.'
    case 'bad-address':
      return 'That service address is not usable. It must be https, or http on this machine.'
    default:
      return 'The local service could not be reached.'
  }
}

/**
 * Register the key with the local service.
 *
 * Called whenever the key changes and once at startup, and the answer to "why
 * isn't my key working" is almost always that the service restarted and no
 * longer has it. So the app re-registers on its own instead of making the user
 * guess.
 *
 * @returns true when the service took the key
 */
export async function registerKey(settings: Settings): Promise<boolean> {
  if (!isCloudProvider(settings.provider)) return false
  const key = apiKeyFor(settings, settings.provider)
  if (!key) return false
  const body: { key: string; baseUrl?: string } = { key }
  // L'indirizzo che vale: quello scritto dall'utente se c'e, altrimenti quello che
  // il servizio ha gia. E una correzione, non una configurazione: l'app funziona
  // anche senza toccarlo.
  const override = settings.baseUrlOverrides[settings.provider]?.trim() ?? ''
  if (override) body.baseUrl = override
  let response: Response
  try {
    response = await fetch(`${PROXY_ORIGIN}/provider/${settings.provider}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new ProxyError('not-running', 'The local service is not running.')
  }
  if (response.status === 400) {
    throw new ProxyError('bad-address', 'The local service refused the service address.')
  }
  if (!response.ok) {
    throw new ProxyError('refused', `The local service refused the key (${response.status}).`)
  }
  return true
}

/**
 * What is between the user and a working cloud request.
 *
 * This is the piece that was missing, and its absence is why selecting a cloud
 * provider looked like a dead end: the key was typed into a field, and nothing
 * ever handed it to the local service, so the model list stayed empty and every
 * run refused with a message about LM Studio.
 *
 * It answers one question — "can this provider answer right now?" — and says what
 * is missing. Callers use it to decide between "go" and "show this", so it must
 * never be a boolean that hides the reason.
 */
export type ProviderReadiness =
  | { ready: true; provider: ProviderId }
  | {
      ready: false
      provider: ProviderId
      reason: 'no-key' | 'service-down' | 'refused'
      /** One sentence, already written for a person. */
      message: string
      /** What the user can do about it, when there is something. */
      action: 'open-settings' | 'start-service' | 'none'
    }

export async function prepareProvider(settings: Settings): Promise<ProviderReadiness> {
  if (!isCloudProvider(settings.provider)) return { ready: true, provider: 'lmstudio' }
  const spec = providerSpec(settings.provider)
  const label = spec.label

  if (!apiKeyFor(settings, settings.provider)) {
    /*
     * Se la chiave e stata cancellata, il servizio la deve smettere di tenere.
     *
     * Il campo vuoto e una promessa che l'utente si aspetta di poter onorare — e il
     * messaggio sotto il campo dice esattamente che la chiave non viene scritta e
     * non viene mandata fuori. Ma il proxy la tiene in memoria finche non glielo
     * si dice, quindi cancellare il campo da solo lasciava la credenziali viva e
     * ancora in uso: le richieste successive avrebbero continuato a mandarla a un
     * provider per cui l'utente aveva deciso di non usarla piu.
     *
     * Non e un caso teorico: si cancella una chiave proprio quando ci si e fidati
     * abbastanza da volerla fuori dai registri del servizio.
     */
    await forgetKey(settings.provider)
    return {
      ready: false,
      provider: settings.provider,
      reason: 'no-key',
      message: `${label} needs an API key.`,
      action: 'open-settings',
    }
  }
  // Nessun caso "manca l'indirizzo": i provider cloud ne hanno uno, e se
  // l'utente lo sovrascrive sbagliando lo dice il proxy, che e il posto giusto
  // per dirlo.
  try {
    await registerKey(settings)
  } catch (error: unknown) {
    const reason = error instanceof ProxyError ? error.reason : 'refused'
    const message =
      reason === 'not-running'
        ? 'The local service is not running, so nothing can reach the provider.'
        : reason === 'bad-address'
          ? `${label} refused the address.`
          : `The local service refused the key for ${label}.`
    // Il registro distingue «non c'e il servizio» da «il servizio ha rifiutato la
    // chiave»: sono due problemi opposti, e confonderli porta a riavviare la macchina
    // invece che a correggere una chiave.
    log.error('proxy', message, {
      provider: settings.provider,
      motivo: reason === 'not-running' ? 'service-down' : 'refused',
    })
    return {
      ready: false,
      provider: settings.provider,
      reason: reason === 'not-running' ? 'service-down' : 'refused',
      message,
      action: reason === 'not-running' ? 'start-service' : 'open-settings',
    }
  }
  /*
   * La consegna della chiave succede a **ogni** controllo di connessione, cioe ogni
   * due minuti. Registrarlo ogni volta produce una riga che non dice niente e
   * spinge in fondo quelle che servono. Quindi solo quando la chiave e cambiata,
   * e il confronto e su un'impronta, non sulla chiave: nemmeno quella finisce in
   * memoria.
   */
  const fingerprint = fingerprintOf(settings)
  if (lastRegisteredFingerprint !== fingerprint) {
    lastRegisteredFingerprint = fingerprint
    log.info('proxy', `Chiave consegnata al servizio locale per ${label}`, {
      provider: settings.provider,
    })
  }
  return { ready: true, provider: settings.provider }
}

/**
 * L'ultima chiave consegnata, come impronta.
 *
 * Un modulo, non uno stato: `prepareProvider` e una funzione e deve poter ricordare
 * qualcosa senza diventare un componente.
 */
let lastRegisteredFingerprint: string | null = null

/**
 * Un'impronta della chiave, non la chiave.
 *
 * Serve solo a capire se e cambiata, e tiene dentro quattro caratteri della coda:
 * abbastanza per distinguere due chiavi, nessuno per usarle. Se anche questo fosse
 * un rischio, il confronto si farebbe su un numero.
 */
function fingerprintOf(settings: Settings): string {
  const key = apiKeyFor(settings, settings.provider)
  return `${settings.provider}:${key.length}:${key.slice(-4)}`
}

/** Forget the key on the local service. Used when the provider changes away. */
export async function forgetKey(id: ProviderId): Promise<void> {
  if (!isCloudProvider(id)) return
  try {
    await fetch(`${PROXY_ORIGIN}/provider/${id}`, { method: 'DELETE' })
  } catch {
    // Se il servizio non c'e, la chiave e gia sparita con lui.
  }
}

/** Whether the service is up, and which providers it holds a key for. */
export async function proxyStatus(): Promise<{ up: boolean; registered: ProviderId[] }> {
  try {
    const response = await fetch(`${PROXY_ORIGIN}/status`)
    if (!response.ok) return { up: false, registered: [] }
    const body = (await response.json()) as { ok?: boolean; registered?: unknown }
    const registered = Array.isArray(body.registered) ? body.registered.filter(isCloudProvider) : []
    return { up: body.ok === true, registered }
  } catch {
    return { up: false, registered: [] }
  }
}

/**
 * Where a request for this provider should go.
 *
 * Same origin for both, deliberately: with the proxy the request is same-origin,
 * so no CORS is involved and the key never sits in the page. Without it, the
 * provider's own address.
 */
export function requestBase(settings: Settings): string {
  if (isCloudProvider(settings.provider)) {
    return `${PROXY_ORIGIN}/p/${settings.provider}`
  }
  if (settings.useProxy) return '/lm/v1'
  return settings.baseUrl.replace(/\/+$/, '')
}

/** The full URL of a chat completion, for this provider. */
export function completionUrlFor(settings: Settings): string {
  return `${requestBase(settings)}/chat/completions`
}

/**
 * Whether a model list can be asked for at all.
 *
 * LM Studio answers from what it has loaded, so it never needs the network. A
 * cloud provider has to be asked, and without a key the answer is a 401 that
 * looks like a broken service.
 */
export function canListModels(settings: Settings): boolean {
  return !isCloudProvider(settings.provider) || Boolean(apiKeyFor(settings, settings.provider))
}
