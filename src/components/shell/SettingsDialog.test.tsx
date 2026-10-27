import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useUiStore } from '../../store/uiStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { workspaceRegistry } from '../../store/workspaceRegistry'
import { APPEARANCES, DEFAULT_APP_SETTINGS } from '../../types/settings'
import { SettingsDialog } from './SettingsDialog'

/**
 * The look picker, where it lives and what it writes.
 *
 * `appearance` is separate from `theme` on purpose: the theme is which colours,
 * the look is which material. If a future change folds them together, the glass
 * look can only exist in one theme, and the test that says they are independent
 * is the one that catches it.
 *
 * Il selettore non e' piu' una tendina ma un gruppo di schede, e questi test
 * premono le schede perche' e' cosi' che funziona l'utente: una tendina e' un
 * elemento che si cambia con `change`, e se il test continuasse a usare quello
 * passerebbe anche con la scheda rotta — cioe' non testerebbe niente.
 */
describe('SettingsDialog look picker', () => {
  beforeEach(() => {
    useWorkspaceStore.getState().resetDocument()
    useUiStore.getState().setAppSettings(DEFAULT_APP_SETTINGS)
    useUiStore.getState().openDialog('settings', 'appearance')
  })

  const open = (): void => {
    render(<SettingsDialog onTestConnection={() => {}} />)
  }

  /** La scheda di un aspetto, per nome. */
  const card = (name: RegExp): HTMLElement => {
    const found = screen.getAllByRole('radio').find((element) => {
      const label = element.querySelector('.look-name')?.textContent ?? ''
      return name.test(label)
    })
    if (!found) throw new Error(`no look card matching ${name}`)
    return found
  }

  it('offers every look, each named, and shows which one is in use', () => {
    open()
    const radios = screen.getAllByRole('radio')
    // Uno per aspetto, e non uno di piu' o di meno: una scheda che manca non si
    // nota, quindi l'elenco viene confrontato con la lista degli aspetti.
    expect(radios.map((element) => element.querySelector('.look-name')?.textContent)).toEqual(
      APPEARANCES.map((look) => look.label),
    )
    expect(screen.getAllByRole('radio', { checked: true })).toHaveLength(1)
    expect(card(/solid/i).getAttribute('aria-checked')).toBe('true')
  })

  it('starts on the look currently in use', () => {
    useUiStore.getState().setAppSettings({ ...DEFAULT_APP_SETTINGS, appearance: 'ascii' })
    open()
    expect(card(/ascii/i).getAttribute('aria-checked')).toBe('true')
    // E non su un altro: due schede marcate come scelte non si distinguono, e
    // l'utente non sa quale sta applicata.
    expect(screen.getAllByRole('radio', { checked: true })).toHaveLength(1)
  })

  it('writes the choice straight away, so it can be seen without saving', () => {
    open()
    fireEvent.click(card(/claude/i))
    // act: il clic passa per lo store, che i pannelli devono rileggere.
    act(() => {})
    expect(useUiStore.getState().appSettings.appearance).toBe('claude')
  })

  it('writes every look, not just the first two', () => {
    /*
     * Il difetto che questo chiude: la tendina ne mostrava due e il resto non
     * esisteva, ma soprattutto — il validatore del caricamento ne accettava due e
     * **buttava via gli altri in silenzio**. Quindi un aspetto nuovo si perdeva al
     * primo ricaricamento e la tendina tornava indietro senza dire niente.
     */
    open()
    for (const look of APPEARANCES) {
      fireEvent.click(card(new RegExp(look.label, 'i')))
      act(() => {})
      expect(useUiStore.getState().appSettings.appearance, look.id).toBe(look.id)
    }
  })

  it('leaves the theme alone', () => {
    open()
    fireEvent.click(card(/glass/i))
    act(() => {})
    // Choosing a material is not choosing colours.
    expect(useUiStore.getState().appSettings.theme).toBe('dark')
  })

  it('does not write the material into the document settings', () => {
    // The document belongs to a workspace and travels in exports. A look is a
    // property of this installation, and exporting it would carry one machine's
    // appearance into another.
    open()
    fireEvent.click(card(/google/i))
    act(() => {})
    expect(useWorkspaceStore.getState().workspaceSettings).not.toHaveProperty('appearance')
  })
})

/**
 * Settings has to be reachable without a workspace open.
 *
 * It used to live inside the workspace shell, so from the Home page — the landing
 * page, shown first on every start, and the only page that exists before the
 * first workspace — the dialog was never mounted. A button on the Home page set
 * the store flag and nothing appeared, which is worse than no button at all.
 */
describe('SettingsDialog without a workspace', () => {
  beforeEach(() => {
    useWorkspaceStore.getState().resetDocument()
    useUiStore.getState().setAppSettings(DEFAULT_APP_SETTINGS)
    useUiStore.getState().openDialog('settings', 'generation')
    workspaceRegistry.resetForTests()
  })

  it('renders with no workspace open', () => {
    render(<SettingsDialog onTestConnection={() => {}} />)
    expect(workspaceRegistry.activeId()).toBeNull()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('does not offer the sampling defaults, which have nowhere to go', () => {
    render(<SettingsDialog onTestConnection={() => {}} />)
    expect(screen.getByText(/belong to a workspace, not to the app/i)).toBeInTheDocument()
    // The control itself is the trap: it would accept a value and drop it.
    expect(screen.queryByLabelText(/^Temperature$/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Maximum output tokens')).not.toBeInTheDocument()
  })

  it('still offers what belongs to the app', () => {
    // Queue, compaction and streaming are app settings and work from anywhere.
    render(<SettingsDialog onTestConnection={() => {}} />)
    expect(screen.getByText(/Fallback system prompt/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Stream responses')).toBeInTheDocument()
  })

  it('offers the sampling defaults again once a workspace is open', () => {
    workspaceRegistry.activate('w1')
    render(<SettingsDialog onTestConnection={() => {}} />)
    expect(screen.getByLabelText('Maximum output tokens')).toBeInTheDocument()
    expect(screen.queryByText(/belong to a workspace, not to the app/i)).not.toBeInTheDocument()
  })
})
