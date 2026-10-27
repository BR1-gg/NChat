import type { ChatRequest } from '../llm/types'
import type { GenerationParams } from '../types/document'
import type { RequiredGenerationParams } from './params-types'
import { providerSpec } from './providers'
import type { ProviderId } from './providers'
import type { Settings } from '../types/settings'

export function resolveParams(
  params: GenerationParams,
  settings: Settings,
): RequiredGenerationParams {
  return {
    temperature: params.temperature ?? settings.defaults.temperature,
    topP: params.topP ?? settings.defaults.topP,
    maxTokens: params.maxTokens ?? settings.defaults.maxTokens,
    stop: params.stop,
  }
}

export function resolveModel(settings: Settings): string | null {
  return settings.defaultModel?.trim() || null
}

/**
 * La temperatura che questo provider accetta davvero.
 *
 * Il caso reale e' Claude: il suo strato di compatibilita OpenAI accetta la
 * temperatura da 0 a 1 e **riduce** i valori maggiori invece di rifiutarli. Mandare 1.4
 * quindi non da errore — restituisce risultati diversi da quelli chiesti, e l'utente non
 * ha modo di sapere perche'. Limitandola qui la richiesta parte con un valore che il
 * provider onora, e la differenza resta visibile invece che silenziosa.
 *
 * Il proxy rifa la stessa correzione, perche' e lui l'ultimo a toccare il corpo prima
 * dell'invio. Qui serve a **direzione opposta**: il proxy corregge in silenzio e la
 * pagina non lo sa, mentre qui la pagina sa e puo' dirlo all'utente prima di partire.
 */
export function temperatureFor(
  provider: ProviderId,
  params: RequiredGenerationParams,
): { temperature?: number; adjusted: boolean } {
  if (typeof params.temperature !== 'number' || !Number.isFinite(params.temperature)) {
    return { adjusted: false }
  }
  const limit = providerSpec(provider).maxTemperature
  if (limit === undefined || params.temperature <= limit) {
    return { temperature: params.temperature, adjusted: false }
  }
  return { temperature: limit, adjusted: true }
}

export function buildChatRequest(
  model: string,
  messages: ChatRequest['messages'],
  params: RequiredGenerationParams,
  streaming: boolean,
  thinking = true,
  provider: ProviderId = 'lmstudio',
): ChatRequest {
  const { temperature, adjusted } = temperatureFor(provider, params)
  return {
    model,
    messages,
    ...(typeof temperature === 'number' && !adjusted ? { temperature } : {}),
    ...(typeof params.topP === 'number' && Number.isFinite(params.topP)
      ? { topP: params.topP }
      : {}),
    maxTokens: params.maxTokens,
    ...(params.stop && params.stop.length > 0 ? { stop: params.stop } : {}),
    stream: streaming,
    // Verified against LM Studio: `chat_template_kwargs.enable_thinking` is
    // ignored, `reasoning_effort: "none"` makes the model answer directly.
    ...(thinking ? {} : { reasoningEffort: 'none' as const }),
  }
}

export function systemPromptFromMessages(messages: ChatRequest['messages']): string {
  return messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n')
}
