import { beforeEach, describe, expect, it } from 'vitest'
import { runBrain } from './brainActions'
import { useUiStore } from '../store/uiStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { DEFAULT_APP_SETTINGS } from '../types/settings'
import type { ProviderId } from '../logic/providers'

/**
 * The Brain refuses to run against a model in the cloud.
 *
 * This is the one refusal that is not about the shape of the graph. A Brain sends
 * the contents of every file in the folders wired into it, so with a cloud
 * provider the user's own text leaves the machine — and they chose the provider
 * for a chat, not for that. So the run stops, and the reason lands on the node
 * where the Run button is, not in a toast that is gone by the time they wonder
 * why nothing happened.
 */
describe('runBrain with a provider in the cloud', () => {
  beforeEach(() => {
    useWorkspaceStore.getState().resetDocument()
    useUiStore.getState().setAppSettings(DEFAULT_APP_SETTINGS)
  })

  const brain = (): string => useWorkspaceStore.getState().addNode('brain', { x: 0, y: 0 })

  it('refuses, and says why on the node', async () => {
    useUiStore.getState().setAppSettings({ ...DEFAULT_APP_SETTINGS, provider: 'nvidia' })
    const state = await runBrain(brain())
    expect(state.status).toBe('failed')
    // The reason has to name the actual blocker. "It failed" would leave the user
    // looking at the folders, which are not the problem.
    expect(state.message).toMatch(/on this machine/i)
    expect(state.message).toMatch(/LM Studio/)
    // "Switch to LM Studio" without saying from where is only half an answer.
    expect(state.message).toMatch(/NVIDIA/)
  })

  it('refuses before asking about the folders', async () => {
    // Se chiedesse le cartelle prima, l'utente ne sceglierebbe due per una corsa
    // che non parte, e la frustrazione avrebbe una causa sbagliata.
    useUiStore.getState().setAppSettings({ ...DEFAULT_APP_SETTINGS, provider: 'nvidia' })
    const state = await runBrain(brain())
    expect(state.message).not.toMatch(/one folder to read from/i)
  })

  it('leaves the folder permissions alone', async () => {
    // Il rifiuto viene per primo, prima di chiedere cartelle o permessi: se
    // chiedesse le cartelle prima, l'utente ne sceglierebbe due per una corsa che
    // non parte, e la frustrazione avrebbe una causa sbagliata.
    const id = brain()
    const state = await runBrain(id)
    expect(state.total).toBe(0)
    expect(state.log).toEqual([])
  })

  it('refuses for the cloud provider, not just for one of several', async () => {
    const cloud: ProviderId[] = ['nvidia']
    for (const provider of cloud) {
      useUiStore.getState().setAppSettings({ ...DEFAULT_APP_SETTINGS, provider })
      const state = await runBrain(brain())
      expect(state.status, provider).toBe('failed')
      expect(state.message, provider).toMatch(/in the cloud/i)
    }
  })

  it('says the reason on the node itself, not only in the return value', async () => {
    useUiStore.getState().setAppSettings({ ...DEFAULT_APP_SETTINGS, provider: 'nvidia' })
    const id = brain()
    await runBrain(id)
    const node = useWorkspaceStore
      .getState()
      .nodes.find((candidate) => candidate.id === id)
    // Un rifiuto che arriva solo come valore di ritorno sparisce: il pulsante Run
    // resta li e non spiega niente.
    expect(node?.data.kind).toBe('brain')
    if (node?.data.kind !== 'brain') throw new Error('not a brain')
    expect(node.data.run.status).toBe('failed')
    expect(node.data.run.message).toMatch(/in the cloud/i)
  })

  it('does not refuse for LM Studio, which is the whole point of the local path', async () => {
    // Il caso contrario: se anche LM Studio venisse rifiutato, il nodo non
    // servirebbe piu niente e il test passerebbe lo stesso.
    const state = await runBrain(brain())
    // Senza cartelle collegate il rifiuto e un altro, ma non quello sul provider.
    expect(state.message ?? '').not.toMatch(/in the cloud/i)
  })
})
