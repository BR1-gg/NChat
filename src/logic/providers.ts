/**
 * I provider che l'app sa usare.
 *
 * Tre: **LM Studio** sulla tua macchina, e nel cloud **NVIDIA NIM** e **Google AI
 * Studio**. Non c'e
 * una voce "qualsiasi servizio OpenAI-compatible" perche e una promessa che questo
 * progetto non puo onorare: gli indirizzi degli altri provider sono conoscenza
 *mia, non misurazioni, e un menu che offre servizi non verificati e un menu che
 * sembra funzionare e non funziona. Se un giorno serve un altro provider, si
 * aggiunge qui con l'indirizzo giusto e un test.
 *
 * Qui ci sono solo **nomi e comportamento**, non indirizzi. Gli indirizzi stanno
 * in `tools/cloud-proxy.mjs`: la pagina non deve poter scegliere la destinazione di
 * una richiesta che porta una chiave, altrimenti un sito qualsiasi la
 * dirotterebbe. Quindi la tabella degli indirizzi e nel proxy, che non e
 * raggiungibile da una pagina.
 */

export type ProviderId = 'lmstudio' | 'nvidia' | 'google' | 'openai' | 'anthropic' | 'groq' | 'mistral' | 'deepseek' | 'xai' | 'openrouter' | 'together' | 'cerebras' | 'fireworks'

export interface ProviderSpec {
  id: ProviderId
  label: string
  /** Una riga: perche lo scegli, o cosa ti costa. */
  blurb: string
  /** Se serve una chiave. LM Studio no: e in casa tua. */
  needsKey: boolean
  /** Dove si prende la chiave. Aperto in una scheda nuova, niente dentro l'app. */
  keysUrl?: string
  /**
   * Il proxy ha un indirizzo per questo provider e l'app non lo cambia da sola.
   *
   * Non vuol dire che non si possa correggere: la correzione sta nelle
   * impostazioni, perche l'indirizzo qui e conoscenza e non una misurazione. Ma la
   * differenza e che un provider noto funziona senza toccare niente, mentre uno da
   * scrivere richiede che l'utente sappia gia dove guardare.
   */
  fixedBaseUrl: boolean
  /** Serve una base URL scritta a mano. Nessun provider oggi. */
  needsBaseUrl: boolean
  /**
   * Se il provider ammette immagini in ingresso, in generale.
   *
   * "In generale" e voluto: la capacita e del **modello**, non del provider, e un
   * provider che mescola modelli con e senza visione non puo essere dichiarato
   * tale o falso. Percio questo dice "chiedere", e la risposta vera la da il
   * provider quando rifiuta. Dichiarare il contrario inventerebbe una capacita.
   */
  vision: 'yes' | 'no' | 'ask'
  /**
   * Se la spesa e legata a un credito che finisce.
   *
   * `no` e diverso da `limited` per l'utente: `limited` vuol dire che si puo provare
   * senza pagare, `no` che il primo token costa gia. Con una sola bandiera per le due
   * cose, un utente su OpenAI o Anthropic leggerebbe "piano gratuito" dove non
   * esiste, e la scoperta arriva dalla fattura.
   */
  freeTier: 'yes' | 'limited' | 'no' | 'unknown'
  /**
   * Se il Brain puo funzionare. Oggi nessun provider cloud: il Brain scrive
   * davvero dei file e vuole il modello in locale per non mandare fuori il
   * contenuto delle cartelle dell'utente. Dopo averlo deciso con lui si cambia
   * questo valore e il messaggio nel nodo.
   */
  brain: 'local-only'
  /**
   * Un limite del provider che questa app conosce e che non si deduce dal 400.
   *
   * Vale solo per i provider che ne hanno uno. Il caso reale e' Claude: il suo strato
   * di compatibilita OpenAI accetta `temperature` solo da 0 a 1 e **riduce** i valori
   * maggiori invece di rifiutarli, quindi una corsa con 1.4 va a buon fine e restituisce
   * qualcos'altro da quello chiesto, senza dire nulla. Un campo che lo dichiara serve
   * a due cose: l'app puo' ridurre il valore prima di partire, e puo' spiegare il
   * perche' il risultato non corrisponde a quello impostato.
   */
  maxTemperature?: number
}

export const PROVIDER_SPECS: readonly ProviderSpec[] = [
  {
    id: 'lmstudio',
    label: 'Local (LM Studio)',
    blurb: 'Runs on this machine. Nothing leaves the computer, no key, no account.',
    needsKey: false,
    fixedBaseUrl: false,
    needsBaseUrl: false,
    vision: 'yes',
    freeTier: 'yes',
    brain: 'local-only',
  },
  {
    id: 'nvidia',
    label: 'NVIDIA NIM (cloud)',
    blurb: 'Runs on NVIDIA. Your prompts leave this computer, and the catalogue is theirs.',
    needsKey: true,
    keysUrl: 'https://build.nvidia.com/',
    fixedBaseUrl: true,
    needsBaseUrl: false,
    vision: 'ask',
    freeTier: 'limited',
    brain: 'local-only',
  },
  {
    id: 'google',
    label: 'Google AI Studio (cloud)',
    blurb: 'Runs on Google. Your prompts leave this computer, and the catalogue is theirs.',
    needsKey: true,
    keysUrl: 'https://aistudio.google.com/apikey',
    fixedBaseUrl: true,
    needsBaseUrl: false,
    /*
     * "ask" anche qui, e per la stessa ragione di NVIDIA: e il **modello** che sa
     * se accetta immagini, non il servizio, e Google mescola modelli con e senza
     * visione. Dichiarare "yes" qui direbbe all'utente che puo mandare un'immagine
     * a un modello che la rifiuta, e l'errore arriverebbe come un blocco invece che
     * come una scelta.
     */
    vision: 'ask',
    freeTier: 'limited',
    brain: 'local-only',
  },

  /*
   * Gli altri provider che espongono un endpoint OpenAI-compatible.
   *
   * Sono tutti uguali per il client: stessa richiesta, stessa risposta, chiave in
   * `Authorization`. Per questo sono voci quasi identiche, e non un caso da normalizzare
   * con una scorciatoia: `blurb`, `keysUrl` e `freeTier` sono le tre cose che
   * l'utente deve poter confrontare prima di scegliere, e ognuna e diversa per ognuno.
   *
   * Gli indirizzi stanno in `tools/cloud-proxy.mjs`, non qui: la pagina non deve poter
   * scegliere la destinazione di una richiesta che porta una chiave.
   */
  {
    id: 'openai',
    label: 'OpenAI (cloud)',
    blurb: 'Runs on OpenAI. Your prompts leave this computer, and the catalogue is theirs.',
    needsKey: true,
    keysUrl: 'https://platform.openai.com/api-keys',
    fixedBaseUrl: true,
    needsBaseUrl: false,
    vision: 'ask',
    freeTier: 'limited',
    brain: 'local-only',
  },
  {
    id: 'anthropic',
    label: 'Claude / Anthropic (cloud)',
    blurb: 'Runs on Anthropic, through its OpenAI-compatible layer.',
    needsKey: true,
    keysUrl: 'https://platform.claude.com/settings/keys',
    fixedBaseUrl: true,
    needsBaseUrl: false,
    vision: 'ask',
    freeTier: 'no',
    brain: 'local-only',
    /*
     * Il limite che vale solo per questo provider, e il motivo per cui il campo esiste.
     * Lo strato di compatibilita di Claude accetta `temperature` solo da 0 a 1 e
     * **riduce** i valori maggiori invece di rifiutarli: una corsa con 1.4 andrebbe a
     * buon fine usando 1, e la differenza — che cambia le risposte — resterebbe
     * invisibile. Dichiarandolo qui, l'app riduce prima e spiega dopo.
     */
    maxTemperature: 1,
  },
  {
    id: 'groq',
    label: 'Groq (cloud)',
    blurb: 'Runs on Groq hardware. Very fast, small catalogue, free tier with limits.',
    needsKey: true,
    keysUrl: 'https://console.groq.com/keys',
    fixedBaseUrl: true,
    needsBaseUrl: false,
    vision: 'no',
    freeTier: 'yes',
    brain: 'local-only',
  },
  {
    id: 'mistral',
    label: 'Mistral (cloud)',
    blurb: 'Runs on Mistral. European models, with a free tier to try them.',
    needsKey: true,
    keysUrl: 'https://console.mistral.ai/api-keys',
    fixedBaseUrl: true,
    needsBaseUrl: false,
    vision: 'ask',
    freeTier: 'yes',
    brain: 'local-only',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek (cloud)',
    blurb: 'Runs on DeepSeek. Cheap, with a free allowance.',
    needsKey: true,
    keysUrl: 'https://platform.deepseek.com/api_keys',
    fixedBaseUrl: true,
    needsBaseUrl: false,
    vision: 'no',
    freeTier: 'limited',
    brain: 'local-only',
  },
  {
    id: 'xai',
    label: 'xAI / Grok (cloud)',
    blurb: 'Runs on xAI. Your prompts leave this computer.',
    needsKey: true,
    keysUrl: 'https://console.x.ai/',
    fixedBaseUrl: true,
    needsBaseUrl: false,
    vision: 'ask',
    freeTier: 'no',
    brain: 'local-only',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter (cloud)',
    blurb: 'One key, many providers. OpenRouter bills you and chooses where it runs.',
    needsKey: true,
    keysUrl: 'https://openrouter.ai/keys',
    fixedBaseUrl: true,
    needsBaseUrl: false,
    /*
     * "ask" perche' con centinaia di modelli la risposta cambia da riga a riga, e il
     * provider che rifiuta un'immagine lo dice. Dichiarare "yes" farebbe fallire la
     * domanda su metà del catalogo.
     */
    vision: 'ask',
    freeTier: 'no',
    brain: 'local-only',
  },
  {
    id: 'together',
    label: 'Together AI (cloud)',
    blurb: 'Open models served together. Credit-based, with a small free allowance.',
    needsKey: true,
    keysUrl: 'https://api.together.xyz/settings/api-keys',
    fixedBaseUrl: true,
    needsBaseUrl: false,
    vision: 'ask',
    freeTier: 'limited',
    brain: 'local-only',
  },
  {
    id: 'cerebras',
    label: 'Cerebras (cloud)',
    blurb: 'Runs on Cerebras. Very fast, and mainly open models.',
    needsKey: true,
    keysUrl: 'https://cloud.cerebras.ai/',
    fixedBaseUrl: true,
    needsBaseUrl: false,
    vision: 'no',
    freeTier: 'limited',
    brain: 'local-only',
  },
  {
    id: 'fireworks',
    label: 'Fireworks AI (cloud)',
    blurb: 'Runs on Fireworks. Open and fine-tuned models, credit-based.',
    needsKey: true,
    keysUrl: 'https://fireworks.ai/api-keys',
    fixedBaseUrl: true,
    needsBaseUrl: false,
    vision: 'ask',
    freeTier: 'limited',
    brain: 'local-only',
  },
] as const

/**
 * True only for an id in the catalogue.
 *
 * Exists for the same reason the proxy keeps its own list: an id that is not
 * known must never become a destination. A hand-edited or imported file must not
 * be able to point the app anywhere, so this is used wherever an id arrives from
 * outside.
 */
export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && PROVIDER_SPECS.some((spec) => spec.id === value)
}

export function providerSpec(id: ProviderId): ProviderSpec {
  const found = PROVIDER_SPECS.find((spec) => spec.id === id)
  // Il default e LM Studio perche e quello su cui questa app e stata costruita, e
  // cambiare provider deve essere una scelta, non quello che capita al primo avvio.
  return found ?? (PROVIDER_SPECS[0] as ProviderSpec)
}

/**
 * Gli id, nell'ordine del catalogo.
 *
 * Serve a `z.enum`, che vuole i valori **a runtime** e non puo' leggerli da un tipo.
 * Senza questo, ogni posto che valida un provider — lo schema del documento, quello
 * dei consumi — dovrebbe ripetere l'elenco, e i due elenchi divergerebbero: si
 * aggiunge un provider al catalogo, si salva un documento con quel provider, e la
 * validazione lo **rifiuta** dicendo che il file e corrotto. Il sintomo sarebbe un
 * provider che funziona finche' non si riavvia, che e' il tipo di bug piu' difficile
 * da collegare alla sua causa.
 */
export const PROVIDER_IDS = PROVIDER_SPECS.map((spec) => spec.id) as readonly ProviderId[]

/**
 * True for a provider that is not on this machine.
 *
 * A type guard, not a boolean, so that after the check the id is known to be one
 * of the five the proxy knows. That is what lets the code build a proxy URL
 * without a cast, and it is why there is not a second, near-identical predicate
 * in `llm/cloudProxy.ts`: two functions with two names answering one question is
 * how they drift apart.
 */
export function isCloudProvider(id: ProviderId): id is Exclude<ProviderId, 'lmstudio'> {
  return id !== 'lmstudio'
}
