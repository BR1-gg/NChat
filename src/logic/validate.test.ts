import { describe, expect, it } from 'vitest'
import { validateRunDetailed } from './validate'
import { document, edge, prompt, response } from '../test/factories'
import type { AppEdge, AppNode } from '../types/document'

function withModel(nodes: AppNode[] = [prompt('Question')], edges: AppEdge[] = []) {
  const doc = document(nodes, edges)
  doc.settings.defaultModel = 'test-model'
  return doc
}

describe('validateRun', () => {
  it('rejects an empty prompt', () => {
    const p1 = prompt('   ')
    const result = validateRunDetailed(withModel([p1]), p1.id)
    expect(result.error?.kind).toBe('EMPTY_PROMPT')
  })

  it('rejects a missing model', () => {
    const p1 = prompt('Question')
    const doc = document([p1], [])
    expect(validateRunDetailed(doc, p1.id).error?.kind).toBe('NO_MODEL')
  })

  it('rejects a response context that is still streaming', () => {
    const p1 = prompt('Question')
    const r1 = response(p1.id, 'Working', { status: 'streaming' })
    const p2 = prompt('Continue')
    const doc = withModel(
      [p1, r1, p2],
      [edge(p1, r1, 'run'), edge(r1, p2, 'context')],
    )
    expect(validateRunDetailed(doc, p2.id).error?.kind).toBe('CONTEXT_NOT_READY')
  })

  it('returns a soft warning above the token threshold but still allows the run', () => {
    const p1 = prompt('x'.repeat(16_400))
    const result = validateRunDetailed(withModel([p1]), p1.id)
    expect(result.error).toBeNull()
    expect(result.softWarnings.some((warning) => warning.kind === 'CONTEXT_OVERFLOW')).toBe(true)
  })
})

/**
 * Un provider in cloud non vieneValidato sull'indirizzo di LM Studio.
 *
 * Il difetto che questo blocco chiude: `validateRunDetailed` controllava sempre che
 * `baseUrl` fosse un URL valido, e con un provider cloud la corsa veniva **rifiutata
 * prima di partire** con «The LM Studio base URL is invalid» — un indirizzo e un
 * programma che quella richiesta non usa. Il rifiuto e anche peggio di un messaggio
 * sbagliato, perche non c'e niente da correggere: l'utente poteva solo indovinare.
 */
describe('validateRun with a cloud provider', () => {
  const cloudDoc = (provider: 'google' | 'nvidia', baseUrl: string) => {
    const p1 = prompt('Question')
    const doc = document([p1], [])
    doc.settings.defaultModel = 'test-model'
    doc.settings.provider = provider
    doc.settings.baseUrl = baseUrl
    return { doc, promptId: p1.id }
  }

  it('does not reject a cloud run because the local base URL is unusable', () => {
    for (const provider of ['google', 'nvidia'] as const) {
      for (const baseUrl of ['', 'not a url', 'localhost:1234']) {
        const { doc, promptId } = cloudDoc(provider, baseUrl)
        const result = validateRunDetailed(doc, promptId, { provider })
        expect(result.error, `${provider} / ${baseUrl}`).toBeNull()
      }
    }
  })

  it('still rejects a local run with a broken base URL', () => {
    const p1 = prompt('Question')
    const doc = document([p1], [])
    doc.settings.defaultModel = 'test-model'
    doc.settings.provider = 'lmstudio'
    doc.settings.baseUrl = 'not a url'
    expect(validateRunDetailed(doc, p1.id, { provider: 'lmstudio' }).error?.kind).toBe('OFFLINE')
  })

  it('trusts the live provider over the copy in the document', () => {
    /*
     * Il documento tiene una copia del provider che si riscrive solo al salvataggio.
     * Se la validazione la leggesse, un utente che cambia provider dalla barra
     * ragionerebbe ancora da locali e vedrebbe un rifiuto che nomina LM Studio.
     */
    const { doc, promptId } = cloudDoc('google', '')
    doc.settings.provider = 'lmstudio'
    expect(validateRunDetailed(doc, promptId, { provider: 'google' }).error).toBeNull()
  })

  it('sends the cloud user to the model list, not to LM Studio, when no model is picked', () => {
    const p1 = prompt('Question')
    const doc = document([p1], [])
    doc.settings.provider = 'lmstudio'
    const result = validateRunDetailed(doc, p1.id, { provider: 'google', model: null })
    expect(result.error?.kind).toBe('NO_MODEL')
    expect(result.error?.hint).not.toMatch(/LM Studio/i)
  })
})
