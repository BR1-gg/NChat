import { beforeEach, describe, expect, it, vi } from 'vitest'
import { document, edge, image, prompt, response } from '../test/factories'
import { DOC_VERSION } from '../types/document'
import { isAppError } from '../types/errors'
import { APPEARANCE_NAMES, UI_SCALE_MAX, UI_SCALE_MIN } from '../types/settings'
import {
  load,
  loadUiPreferences,
  normalizeDocument,
  parseImport,
  saveNow,
  sanitizeAppSettings,
  serializeDocument,
  UI_KEY,
  WORKSPACE_KEY,
} from './storage'

describe('app settings from storage', () => {
  /**
   * Le impostazioni dell'app sono l'unica cosa che questo progetto legge da
   * IndexedDB **senza** passare da `normalizeDocument`, perche appartengono
   * all'installazione e non a un workspace.
   *
   * Il prezzo di quella scelta era che i controlli di `sanitizeSettings` non
   * giravano, e non era una cosa teorica: un `provider` preso da IndexedDB
   * arrivava dritto nel percorso della richiesta senza mai passare da
   * `isProviderId` — che e il controllo che impedisce a un valore modificato a
   * mano di diventare una destinazione. Con piu provider in cloud la cosa e
   * diventata piu probabile, non meno: due destinazioni in tabella significano
   * che scegliere quella sbagliata non e piu un errore che si vede.
   */
  it('rifiuta un provider che non e nel catalogo', () => {
    const app = sanitizeAppSettings({ provider: 'http://mio-indirizzo' })
    expect(app.provider).toBe('lmstudio')
  })

  it('muove la chiave di prima nel suo provider, anche per le impostazioni dell app', () => {
    // Il percorso vero e questo, non quello del documento: la chiave sta nelle
    // impostazioni dell'app. Se la migrazione girasse solo sui documenti, la chiave
    // dell'utente sparirebbe senza che nulla lo dica.
    const app = sanitizeAppSettings({ provider: 'nvidia', apiKey: 'nvapi-di-prima' })
    expect(app.apiKeys.nvidia).toBe('nvapi-di-prima')
  })

  it('migra la chiave di Google, non solo quella di NVIDIA', () => {
    // La regola non deve essere scritta per il provider che c'era ieri: se
    // domani il catalogo cambia ancora, la stessa riga deve continuare a valere.
    const app = sanitizeAppSettings({ provider: 'google', apiKey: 'goog-di-prima' })
    expect(app.apiKeys.google).toBe('goog-di-prima')
    expect(app.apiKeys.nvidia).toBeUndefined()
  })

  it('non lascia una chiave sotto un provider che non ne chiede', () => {
    const app = sanitizeAppSettings({ apiKeys: { lmstudio: 'non-serve', nvidia: 'serve' } })
    expect(app.apiKeys.lmstudio).toBeUndefined()
    expect(app.apiKeys.nvidia).toBe('serve')
  })

  it('non crepa davanti a robba che non e un oggetto', () => {
    for (const value of [null, undefined, 42, 'nvidia', []]) {
      expect(() => sanitizeAppSettings(value), String(value)).not.toThrow()
    }
    expect(sanitizeAppSettings(null).provider).toBe('lmstudio')
  })
})

describe('workspace persistence', () => {
  beforeEach(() => localStorage.clear())

  it('serializes only durable node and edge fields', () => {
    const p1 = prompt('Question')
    p1.selected = true
    p1.measured = { width: 320, height: 200 }
    p1.dragging = true
    const r1 = response(p1.id, 'Answer')
    const source = document([p1, r1], [edge(p1, r1, 'run')])
    source.edges[0]!.selected = true
    source.edges[0]!.animated = true

    const serialized = serializeDocument(source)
    expect(serialized.docVersion).toBe(DOC_VERSION)
    expect(serialized.nodes[0]).not.toHaveProperty('selected')
    expect(serialized.nodes[0]).not.toHaveProperty('measured')
    expect(serialized.edges[0]).not.toHaveProperty('selected')
    expect(serialized.edges[0]).not.toHaveProperty('animated')
  })

  it('moves the old single key to the provider that was selected', () => {
    /*
     * La chiave che l'utente aveva gia incollato non deve sparire perche l'app ha
     * cambiato forma. Riscriverla a mano e un modo perfettamente evitabile di
     * perdere una credenziale, e il danno non e visibile subito: la lista dei modelli
     * resta vuota e il messaggio parla di chiave mancante, come se non ne fosse
     * mai esistita una.
     */
    const normalized = normalizeDocument({
      ...document([], []),
      settings: { provider: 'nvidia', apiKey: 'nvapi-chiave-di-prima' },
    })
    expect(normalized.document.settings.provider).toBe('nvidia')
    expect(normalized.document.settings.apiKeys.nvidia).toBe('nvapi-chiave-di-prima')
  })

  it('does not move the old key when the document already has the new form', () => {
    // Se ci sono gia le chiavi per provider, quelle vincono: la nuova forma e quella
    // giusta e deve restare l'unica fonte.
    const normalized = normalizeDocument({
      ...document([], []),
      settings: {
        provider: 'nvidia',
        apiKey: 'vecchia',
        apiKeys: { google: 'nuova-di-google' },
      },
    })
    expect(normalized.document.settings.apiKeys.nvidia).toBeUndefined()
    expect(normalized.document.settings.apiKeys.google).toBe('nuova-di-google')
  })

  it('keeps no key for a provider that needs none', () => {
    // Una stringa che sembra una credenziale e non serve a niente e il tipo di cosa
    // che finisce in un file di backup per un motivo sbagliato.
    const normalized = normalizeDocument({
      ...document([], []),
      settings: { provider: 'lmstudio', apiKeys: { lmstudio: 'non-serve', nvidia: 'svrai' } },
    })
    expect(normalized.document.settings.apiKeys.lmstudio).toBeUndefined()
    expect(normalized.document.settings.apiKeys.nvidia).toBe('svrai')
  })

  it('marks queued and streaming responses as interrupted while keeping text', () => {
    const p1 = prompt('Question')
    const r1 = response(p1.id, 'Partial', { status: 'streaming' })
    const normalized = normalizeDocument(
      document([p1, r1], [edge(p1, r1, 'run')]),
      123,
    )
    expect(normalized.document.nodes[1]?.data.kind).toBe('response')
    if (normalized.document.nodes[1]?.data.kind === 'response') {
      expect(normalized.document.nodes[1].data.status).toBe('interrupted')
      expect(normalized.document.nodes[1].data.text).toBe('Partial')
      expect(normalized.document.nodes[1].data.stats.finishedAt).toBe(123)
    }
  })

  it('preserves the exact request messages used by a response', () => {
    const p1 = prompt('Question')
    const r1 = response(p1.id, 'Answer', {
      messagesSnapshot: [
        { role: 'user', content: 'Question' },
        { role: 'assistant', content: 'Answer' },
      ],
    })
    const saved = serializeDocument(document([p1, r1], [edge(p1, r1, 'run')]))
    const restored = normalizeDocument(saved).document.nodes[1]
    expect(restored?.data.kind === 'response' && restored.data.messagesSnapshot).toEqual([
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: 'Answer' },
    ])
  })

  it('reattaches an orphan response when its parent prompt still exists', () => {
    const p1 = prompt('Question')
    const r1 = response(p1.id, 'Kept answer')
    const normalized = normalizeDocument(document([p1, r1], []))
    expect(normalized.repairedResponses).toBe(1)
    expect(normalized.document.edges).toHaveLength(1)
    expect(normalized.document.edges[0]).toMatchObject({
      kind: 'run',
      source: p1.id,
      target: r1.id,
    })
  })

  it('retains an orphan response as an error when its parent is missing', () => {
    const r1 = response('missing-prompt', 'User content')
    const normalized = normalizeDocument(document([r1], []))
    const retained = normalized.document.nodes[0]
    expect(retained?.data.kind).toBe('response')
    if (retained?.data.kind === 'response') {
      expect(retained.data.status).toBe('error')
      expect(retained.data.error?.message).toBe('Original prompt missing')
    }
  })

  it('loads saved data and normalizes interrupted sessions', () => {
    const p1 = prompt('Question')
    const r1 = response(p1.id, 'Partial', { status: 'queued' })
    const saved = serializeDocument(document([p1, r1], [edge(p1, r1, 'run')]))
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(saved))
    const loaded = load()
    const loadedResponse = loaded.doc.nodes.find((node) => node.data.kind === 'response')
    expect(loadedResponse?.data.kind === 'response' && loadedResponse.data.status).toBe('interrupted')
  })

  it('rejects malformed imports with IMPORT_INVALID', () => {
    try {
      parseImport('{ definitely not json')
      throw new Error('Expected parseImport to throw')
    } catch (error: unknown) {
      expect(isAppError(error) && error.kind).toBe('IMPORT_INVALID')
    }
  })

  it('maps quota failures to STORAGE_FULL without retry looping', () => {
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    const result = saveNow(document([prompt('Question')], []))
    setItem.mockRestore()
    expect(result.ok).toBe(false)
    expect(result.error?.kind).toBe('STORAGE_FULL')
  })
})

describe('UI preferences', () => {
  beforeEach(() => localStorage.clear())

  it('keeps a stored "bezier" edge style meaning the curve, not the step', () => {
    // React Flow 12 names the curve "default"; "bezier" was never registered and
    // fell back with a console warning. A stored "bezier" must still be a curve.
    localStorage.setItem(UI_KEY, JSON.stringify({ edgeStyle: 'bezier' }))
    expect(loadUiPreferences().edgeStyle).toBe('default')
  })

  it('keeps smoothstep and falls back to the curve for anything unknown', () => {
    localStorage.setItem(UI_KEY, JSON.stringify({ edgeStyle: 'smoothstep' }))
    expect(loadUiPreferences().edgeStyle).toBe('smoothstep')
    localStorage.setItem(UI_KEY, JSON.stringify({ edgeStyle: 'nonsense' }))
    expect(loadUiPreferences().edgeStyle).toBe('default')
    localStorage.clear()
    expect(loadUiPreferences().edgeStyle).toBe('default')
  })

  it('keeps a stored interface size', () => {
    localStorage.setItem(UI_KEY, JSON.stringify({ uiScale: 1.15 }))
    expect(loadUiPreferences().uiScale).toBe(1.15)
  })

  it('falls back to 100% when no size was ever chosen', () => {
    // Un utente che non ha toccato lo slider non deve trovarsi con un fattore
    // inventato: il default e' la dimensione con cui l'app e stata disegnata.
    localStorage.setItem(UI_KEY, JSON.stringify({ edgeStyle: 'smoothstep' }))
    expect(loadUiPreferences().uiScale).toBe(1)
  })

  it('clamps a stored size to something the interface can still be read at', () => {
    // Il pericolo vero di questo campo: un valore a mano da 40 disegna l'app a 40
    // volte e non c'e piu' modo di tornare indietro dalla schermata, perche' la
    // schermata stessa non si vede piu'. Il limite si applica alla lettura.
    localStorage.setItem(UI_KEY, JSON.stringify({ uiScale: 40 }))
    expect(loadUiPreferences().uiScale).toBe(UI_SCALE_MAX)
    localStorage.setItem(UI_KEY, JSON.stringify({ uiScale: 0.01 }))
    expect(loadUiPreferences().uiScale).toBe(UI_SCALE_MIN)
  })

  it('ignores a stored size that is not a number', () => {
    for (const value of ['grande', null, {}, [], Number.NaN]) {
      localStorage.setItem(UI_KEY, JSON.stringify({ uiScale: value }))
      expect(loadUiPreferences().uiScale, String(value)).toBe(1)
    }
  })
})

/**
 * The chosen look has to survive a reload.
 *
 * A field that parses fine and comes back missing is the failure this project has
 * already been bitten by twice, and a user who picks "liquid glass" and finds the
 * app back to solid on restart has no way to tell that from the setting not
 * having been saved.
 */
describe('appearance persistence', () => {
  beforeEach(() => localStorage.clear())

  const withAppearance = (appearance: unknown) => {
    const p1 = prompt('Question')
    const source = document([p1], [])
    source.settings = { ...source.settings, appearance } as typeof source.settings
    return normalizeDocument(JSON.parse(JSON.stringify(source))).document
  }

  it('keeps the glass look', () => {
    expect(withAppearance('glass').settings.appearance).toBe('glass')
  })

  it('keeps the solid look', () => {
    expect(withAppearance('default').settings.appearance).toBe('default')
  })

  it('keeps every look, not just the two it knew about', () => {
    /*
     * Il difetto che questo chiude. Il validatore era
     * `value.appearance === 'glass' ? 'glass' : 'default'`: accettava due valori e
     * **buttava via gli altri in silenzio**.
     *
     * Il sintomo non era un errore — era l'assenza di un effetto. Si sceglieva
     * Google, si ricaricava, e la tendina diceva di nuovo «Solid», senza dire
     * niente. E il peggio e' che il valore era **perso**: la scelta dell'utente non
     * tornava, e non c'era modo di sapere perche' era sparita.
     *
     * Percio' il confronto e' con l'elenco degli aspetti, non con una lista scritta
     * qui: una lista qui ricomincerebbe a divergere al primo aspetto aggiunto.
     */
    for (const look of APPEARANCE_NAMES) {
      expect(withAppearance(look).settings.appearance, look).toBe(look)
    }
  })

  it('falls back to solid for anything unknown', () => {
    // A document hand-edited, or written by a future version, must not leave the
    // app with no styling at all.
    expect(withAppearance('nonsense').settings.appearance).toBe('default')
    expect(withAppearance(undefined).settings.appearance).toBe('default')
  })

  it('defaults to solid for a document saved before the setting existed', () => {
    const p1 = prompt('Question')
    const source = document([p1], [])
    const raw = JSON.parse(JSON.stringify(source)) as Record<string, unknown>
    delete (raw.settings as Record<string, unknown>).appearance
    expect(normalizeDocument(raw).document.settings.appearance).toBe('default')
  })
})
describe('image node persistence', () => {
  beforeEach(() => localStorage.clear())

  const PNG = 'data:image/png;base64,iVBORw0KGgo='

  it('keeps the data URL through a save and reload', () => {
    // The bytes live in the document. Losing them on save would leave a node
    // that looks fine and sends nothing to the model.
    const pic = image('photo.png', { src: PNG, width: 800, height: 600 })
    const saved = serializeDocument(document([pic], []))
    const restored = normalizeDocument(saved).document.nodes[0]
    expect(restored?.data.kind).toBe('image')
    if (restored?.data.kind === 'image') {
      expect(restored.data.src).toBe(PNG)
      expect(restored.data.width).toBe(800)
      expect(restored.data.isVideo).toBe(false)
    }
  })

  it('keeps the poster frame of a video', () => {
    const clip = image('clip.mp4', {
      isVideo: true,
      mediaType: 'video/mp4',
      src: 'data:video/mp4;base64,AAAA',
      posterSrc: PNG,
    })
    const restored = normalizeDocument(serializeDocument(document([clip], []))).document.nodes[0]
    if (restored?.data.kind === 'image') {
      expect(restored.data.posterSrc).toBe(PNG)
      expect(restored.data.isVideo).toBe(true)
    } else {
      throw new Error('expected an image node')
    }
  })

  it('repairs a hand-edited node with nonsense numbers', () => {
    const broken = {
      id: 'img1',
      type: 'image',
      position: { x: 0, y: 0 },
      data: { kind: 'image', name: 'x.png', width: 'wide', height: null, sizeBytes: -4, src: PNG },
    }
    const restored = normalizeDocument({ ...document([], []), nodes: [broken as never] }).document
      .nodes[0]
    if (restored?.data.kind === 'image') {
      expect(restored.data.width).toBe(0)
      expect(restored.data.height).toBe(0)
      expect(restored.data.sizeBytes).toBe(0)
      expect(restored.data.src).toBe(PNG)
    } else {
      throw new Error('expected an image node')
    }
  })

  it('remembers the collapsed state like any other node flag', () => {
    const pic = image('photo.png')
    pic.data.collapsed = true
    const restored = normalizeDocument(serializeDocument(document([pic], []))).document.nodes[0]
    expect(restored?.data.kind === 'image' && restored.data.collapsed).toBe(true)
  })
})