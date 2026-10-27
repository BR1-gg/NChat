export type ThemeName = 'dark' | 'light'
export type AutoCompactMode = 'off' | 'ask' | 'auto'
export type { ProviderId } from '../logic/providers'
import type { ProviderId } from '../logic/providers'

/**
 * How the app is drawn, independently of whether it is dark or light.
 *
 * `theme` answers "which colours", this answers "which shape". Keeping them
 * apart means a new look does not have to reinvent a light and a dark palette,
 * and it means the user can ask for translucent surfaces in either one.
 *
 * - `default` — the solid look this app has always had.
 * - `glass` — translucent surfaces over a blurred, tinted background.
 * - `google` — Material: white surfaces, a blue accent, pill buttons, almost no
 *   shadow, everything on a visible grid.
 * - `claude` — warm paper, serif headings, a soft orange accent, and generous
 *   spacing: the look of a page you would read rather than a tool you would drive.
 * - `ascii` — a terminal. Monospace everywhere, a single phosphor colour, hard
 *   borders, no blur, no shadow, no rounded corners. Every box drawn with
 *   characters, so it works on an LCD that cannot show the other looks at all.
 * - `minimal` — almost nothing. No borders, no shadows, no fills except the
 *   surfaces that carry text, and colour only where it means something: the
 *   selection and the error.
 *
 * Every one of them is **only tokens and shape**. None of them sets `z-index`,
 * `pointer-events`, or any layout box, and that is not a style choice: an
 * appearance that puts a panel above another one produces a button that looks
 * fine and cannot be pressed, and a user cannot tell that from a broken app.
 * Keeping each look to variables is what makes "every button works in every
 * style" true by construction instead of by testing.
 */
export type AppearanceName = 'default' | 'glass' | 'google' | 'claude' | 'ascii' | 'minimal'

/** The looks, in the order the picker shows them, with the name it shows. */
export const APPEARANCES: ReadonlyArray<{ id: AppearanceName; label: string; blurb: string }> = [
  { id: 'default', label: 'Solid', blurb: 'Neutral surfaces, a blue accent, soft borders.' },
  { id: 'glass', label: 'Liquid glass', blurb: 'Translucent panels over a blurred background.' },
  { id: 'google', label: 'Google', blurb: 'Material: white panels, blue accent, pill buttons.' },
  { id: 'claude', label: 'Claude', blurb: 'Warm paper, serif headings, generous spacing.' },
  {
    id: 'ascii',
    label: 'ASCII',
    blurb: 'A terminal: one colour, hard borders, no rounding, no blur.',
  },
  {
    id: 'minimal',
    label: 'Minimal',
    blurb: 'No borders, no shadows. Colour only where it means something.',
  },
]

/**
 * The look ids alone, for the places that validate a value instead of showing it.
 *
 * Derivato da `APPEARANCES` e non scritto per conto suo: due elenchi paralleli
 * divergono, e divergono nel modo peggiore — la tendina ne mostra sei e il loader ne
 * accetta due, quindi la scelta si perde al primo ricaricamento senza che nulla
 * dica perche'. Se domani un aspetto, il tipo lo sa gia'.
 */
export const APPEARANCE_NAMES = APPEARANCES.map((look) => look.id) as [
  AppearanceName,
  ...AppearanceName[],
]

/**
 * Whether a value read from disk is an appearance this build knows.
 *
 * Serve perche' il valore arriva da fuori — lo storage di un'altra versione, un file
 * importato a mano — e non ci si puo fidare che sia uno di quelli. Un valore ignoto
 * diventa il default **in silenzio**: non e' un errore, e' un'impostazione che
 * questa versione non sa disegnare.
 */
export function isAppearanceName(value: unknown): value is AppearanceName {
  return typeof value === 'string' && APPEARANCE_NAMES.includes(value as AppearanceName)
}

export interface GenerationDefaults {
  temperature: number
  topP: number
  maxTokens: number
  systemPrompt: string
}

export interface AppSettings {
  baseUrl: string
  useProxy: boolean
  defaultModel: string | null
  /**
   * Where the model actually runs: on this machine, or in someone's cloud.
   *
   * `lmstudio` stays the default. It is what this app was built around, and
   * choosing to send prompts to a third party has to be a decision, not what
   * happens the first time it starts.
   */
  provider: ProviderId
  /**
   * One key per provider, and the reason is simplicity of the failure: with a single
   * key, switching from NVIDIA to Google meant sending the NVIDIA key to Google and
   * getting a 401 that says nothing about why. They are different services with
   * different accounts, so each key stays with the one it belongs to.
   *
   * They live here, in this machine's local storage, and the local service holds them
   * only in memory while it runs. So a key survives a reload but is gone when the
   * service stops, and the app re-registers it on its own.
   */
  apiKeys: Partial<Record<ProviderId, string>>
  /**
   * An address per provider, overriding the one the local service has built in.
   *
   * It exists because the built-in addresses are knowledge, not measurement: a
   * provider can move them, and without an override a wrong guess costs a
   * debugging session with no way out. Only the providers that have a default
   * can be overridden, and only with an https address.
   */
  baseUrlOverrides: Partial<Record<ProviderId, string>>
  theme: ThemeName
  appearance: AppearanceName
  streaming: boolean
  queueConcurrency: number
  modelLoadTimeoutMs: number
  firstByteTimeoutMs: number
  preloadOnTyping: boolean
  singleModelInMemory: boolean
  autoCompact: AutoCompactMode
  compactMaxTokens: number
  compactSystemPrompt: string
}

export interface WorkspaceSettings {
  defaults: GenerationDefaults
  contextTokenWarning: number
}

/**
 * Compatibility view used by the live workspace store. v2 persistence stores
 * AppSettings in appState and only WorkspaceSettings inside a document.
 */
export interface Settings extends AppSettings, WorkspaceSettings {}

export interface UiPreferences {
  /**
   * Developer mode gates the Inspector entirely. It is off by default: the
   * panel is a development aid, and having it pop open on every node selection
   * covers the canvas the user is working on.
   */
  developerMode: boolean
  inspectorOpen: boolean
  minimapOpen: boolean
  /**
   * `default` is the built-in bezier edge in React Flow 12; the name "bezier"
   * is not registered and would fall back with a console warning.
   */
  edgeStyle: 'default' | 'smoothstep'
  reopenTabsOnStartup: boolean
  /**
   * How big the interface is drawn, as a multiplier: 1 is the size the app was
   * designed at.
   *
   * Un intero, non una stringa come "115%": e un numero che si moltiplica, si
   * confronta e si puo' sanificare. La percentuale e' come si legge, il fattore e'
   * come si calcola.
   *
   * Vive nelle preferenze e non nelle impostazioni del workspace perche' e' una
   * cosa della **macchina**, non del documento: le stesse impostazioni aperte su un
   * portatile piccolo e su un monitor grande devono restare leggibili in entrambi i
   * casi, e chi se lo ricorda e' l'utente di quella macchina, non il grafo.
   */
  uiScale: number
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  baseUrl: import.meta.env.VITE_LM_BASE_URL || 'http://localhost:1234/v1',
  useProxy: import.meta.env.VITE_DEFAULT_PROXY !== '0',
  defaultModel: null,
  provider: 'lmstudio',
  apiKeys: {},
  baseUrlOverrides: {},
  theme: 'dark',
  appearance: 'default',
  streaming: true,
  queueConcurrency: 1,
  modelLoadTimeoutMs: 300_000,
  // A cold reasoning model measured 29.2 s to its first token on this machine,
  // so the v1 value of 30 s sat right on the edge and aborted healthy runs.
  firstByteTimeoutMs: 180_000,
  preloadOnTyping: true,
  singleModelInMemory: true,
  autoCompact: 'off',
  compactMaxTokens: 1024,
  compactSystemPrompt:
    'Summarize the conversation faithfully and structurally. Preserve user goals, facts, decisions, constraints, important code or names, and open questions. Write in the conversation language. Do not invent details.',
}

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  defaults: {
    temperature: 0.7,
    topP: 1,
    maxTokens: 1024,
    systemPrompt: '',
  },
  contextTokenWarning: 4096,
}

export const DEFAULT_SETTINGS: Settings = {
  ...DEFAULT_APP_SETTINGS,
  ...DEFAULT_WORKSPACE_SETTINGS,
  defaults: { ...DEFAULT_WORKSPACE_SETTINGS.defaults },
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  developerMode: false,
  inspectorOpen: false,
  minimapOpen: true,
  edgeStyle: 'default',
  reopenTabsOnStartup: true,
  uiScale: 1,
}

/**
 * I limiti dello slider, e i motivi.
 *
 * Il massimo e' 1.4 e non di piu' perche' oltre la barra iniziale e il pannello dei
 * nodi iniziano a non entrare: a 1.6 il titolo di un nodo sta su tre righe e la
 * finestra di dialogo, che ha una larghezza fissa, comincia a tagliare il testo. Il
 * minimo di 0.8 basta per un portatile da 13 pollici e resta leggibile: sotto, i
 * caratteri da 9px diventano 7px e l'interfaccia smette di esserlo, che e' il
 * contrario di quello che si chiede a uno slider per la dimensione.
 *
 * Sono anche i limiti con cui viene sanificato un valore venuto da disco: un file
 * modificato a mano con `uiScale: 40` renderebbe l'app inutilizzabile senza lasciare
 * indicazione di come tornare indietro.
 */
export const UI_SCALE_MIN = 0.8
export const UI_SCALE_MAX = 1.4
export const UI_SCALE_STEP = 0.05

/** Il fattore, ripulito da qualsiasi valore che non sia un numero sensato. */
export function sanitizeUiScale(value: unknown): number {
  const fallback = DEFAULT_UI_PREFERENCES.uiScale
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Math.round(value * 100) / 100))
}

export function cloneAppSettings(settings: AppSettings = DEFAULT_APP_SETTINGS): AppSettings {
  return { ...settings }
}

export function cloneSettings(settings: Settings = DEFAULT_SETTINGS): Settings {
  return {
    ...settings,
    defaults: { ...settings.defaults },
  }
}

/**
 * The key that belongs to this provider, trimmed, or an empty string.
 *
 * One function, because reading `apiKeys[provider]` in four places means four
 * chances to forget the trim, and a key that only looks set is a key that
 * produces a confusing 401 instead of a clear "no key".
 *
 * The parameter is only the part of the settings it needs, so both `Settings` and
 * `AppSettings` can be passed and neither caller has to be the right one.
 */
export function apiKeyFor(
  settings: { apiKeys: Partial<Record<ProviderId, string>> },
  provider: ProviderId,
): string {
  return (settings.apiKeys[provider] ?? '').trim()
}

export function splitSettings(settings: Settings): {
  app: AppSettings
  workspace: WorkspaceSettings
} {
  return {
    app: {
      baseUrl: settings.baseUrl,
      useProxy: settings.useProxy,
      defaultModel: settings.defaultModel,
      provider: settings.provider,
      apiKeys: { ...settings.apiKeys },
      baseUrlOverrides: { ...settings.baseUrlOverrides },
      theme: settings.theme,
      appearance: settings.appearance,
      streaming: settings.streaming,
      queueConcurrency: settings.queueConcurrency,
      modelLoadTimeoutMs: settings.modelLoadTimeoutMs,
      firstByteTimeoutMs: settings.firstByteTimeoutMs,
      preloadOnTyping: settings.preloadOnTyping,
      singleModelInMemory: settings.singleModelInMemory,
      autoCompact: settings.autoCompact,
      compactMaxTokens: settings.compactMaxTokens,
      compactSystemPrompt: settings.compactSystemPrompt,
    },
    workspace: {
      defaults: { ...settings.defaults },
      contextTokenWarning: settings.contextTokenWarning,
    },
  }
}

export function mergeSettings(app: AppSettings, workspace: WorkspaceSettings): Settings {
  return {
    ...cloneAppSettings(app),
    defaults: { ...workspace.defaults },
    contextTokenWarning: workspace.contextTokenWarning,
  }
}
