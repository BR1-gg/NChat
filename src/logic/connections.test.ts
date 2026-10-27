import { describe, expect, it } from 'vitest'
import { document, edge, image, nodeOfType, output, prompt, response, system } from '../test/factories'
import { compatibleTargets, compatibleTypes, handlesOf, targetHandleFor } from './connections'

/**
 * The list is the answer to "where can this go", worked out before the drop
 * rather than after. A wrong entry is the cost: it shows a connection the graph
 * would then refuse, so the tests lean on the refusals as much as the offers.
 */
describe('compatibleTargets', () => {
  it('offers a prompt from a response handle', () => {
    const p1 = prompt('Question')
    const r1 = response(p1.id, 'Answer')
    const doc = document([p1, r1], [])
    const targets = compatibleTargets(doc, r1.id, 'context')
    expect(targets).toEqual([
      { nodeId: p1.id, handleId: 'context', kind: 'context', label: 'Question', hint: 'as context' },
    ])
  })

  it('never offers the source node to itself', () => {
    const p1 = prompt('Question')
    const r1 = response(p1.id, 'Answer')
    const doc = document([p1, r1], [])
    expect(compatibleTargets(doc, r1.id, 'context').some((entry) => entry.nodeId === r1.id)).toBe(false)
  })

  it('offers a picture only to a prompt image input', () => {
    const p1 = prompt('What is this?')
    const pic = image('photo.png')
    const doc = document([p1, pic], [])
    const targets = compatibleTargets(doc, pic.id, 'out')
    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({ nodeId: p1.id, handleId: 'image', kind: 'image' })
  })

  it('offers nothing for a picture pointed at a picture', () => {
    const pic = image('a.png')
    const other = image('b.png')
    const doc = document([pic, other], [])
    expect(compatibleTargets(doc, pic.id, 'out')).toEqual([])
  })

  it('offers a system node to a prompt system input', () => {
    const p1 = prompt('Question')
    const s1 = system('Be brief')
    const doc = document([p1, s1], [])
    const targets = compatibleTargets(doc, s1.id, 'out')
    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({ handleId: 'system', kind: 'system' })
  })

  it('offers both of a folder handles, each with its own meaning', () => {
    // This is the case the list exists for: `out` reads, `in` is written, and
    // they look identical on the node.
    const brain = {
      id: 'b1',
      type: 'brain' as const,
      position: { x: 0, y: 0 },
      data: {
        kind: 'brain' as const,
        instruction: 'traduci',
        model: '',
        onExisting: 'rename' as const,
        run: { status: 'idle' as const, total: 0, done: 0, log: [], undo: [] },
      },
    }
    const folder = {
      id: 'f1',
      type: 'folder' as const,
      position: { x: 0, y: 0 },
      data: {
        kind: 'folder' as const,
        name: 'uscita',
        fileCount: 0,
        totalBytes: 0,
        text: '',
        truncated: false,
        refused: [],
      },
    }
    const doc = document([brain, folder], [])
    const targets = compatibleTargets(doc, folder.id, 'out')
    // The keys are the **target's** handles, so the Brain offers its `in`.
    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({ nodeId: 'b1', handleId: 'in', kind: 'flow' })
  })

  it('offers the other direction too, with its own handle', () => {
    const brain = {
      id: 'b1',
      type: 'brain' as const,
      position: { x: 0, y: 0 },
      data: {
        kind: 'brain' as const,
        instruction: 'traduci',
        model: '',
        onExisting: 'rename' as const,
        run: { status: 'idle' as const, total: 0, done: 0, log: [], undo: [] },
      },
    }
    const folder = {
      id: 'f1',
      type: 'folder' as const,
      position: { x: 0, y: 0 },
      data: {
        kind: 'folder' as const,
        name: 'ingresso',
        fileCount: 0,
        totalBytes: 0,
        text: '',
        truncated: false,
        refused: [],
      },
    }
    // From the Brain: the folder's `in` is where the results go, and its `out`
    // would read it, which is a different edge and is offered separately.
    const targets = compatibleTargets(document([brain, folder], []), 'b1', 'out')
    expect(targets).toEqual([
      { nodeId: 'f1', handleId: 'in', kind: 'flow', label: 'ingresso', hint: 'a Brain writes here' },
    ])
  })

  it('labels a node by what the person recognises it by', () => {
    const p1 = prompt('Line one of the question\nand more')
    const r1 = response(p1.id, 'Answer', { title: 'The title' })
    const doc = document([p1, r1], [])
    const labels = compatibleTargets(doc, r1.id, 'context').map((entry) => entry.label)
    // The first line of the question, not the whole thing: the label is for a list.
    expect(labels).toEqual(['Line one of the question'])
  })

  it('offers nothing from a prompt, whose output is a run and not a wire', () => {
    // A prompt produces a response by running, so its `out` handle has no target.
    // Offering one would be a dead end in the list.
    const p1 = prompt('Question')
    const r1 = response(p1.id, 'Answer')
    const doc = document([p1, r1], [])
    expect(compatibleTargets(doc, p1.id, 'out')).toEqual([])
  })

  it('does not offer a connection the graph would refuse as a cycle', () => {
    const p1 = prompt('First')
    const r1 = response(p1.id, 'Answer')
    const p2 = prompt('Second')
    const doc = document([p1, r1, p2], [edge(p1, r1, 'run')])
    // r1 already feeds nothing, so p2 is offered. After connecting r1 to p2, the
    // reverse is no longer offered.
    expect(compatibleTargets(doc, r1.id, 'context').some((e) => e.nodeId === p2.id)).toBe(true)
    const wired = document([p1, r1, p2], [edge(p1, r1, 'run'), edge(r1, p2, 'context')])
    const fromP2 = compatibleTargets(wired, p2.id, 'out')
    expect(fromP2.some((e) => e.nodeId === r1.id)).toBe(false)
  })

  it('offers the ordinary connection first', () => {
    // Document order would put a group above the prompt, which is the opposite
    // of what is meant most of the time.
    const group = output(['r1'], {}, 'out1')
    const p1 = prompt('Question')
    const r1 = response(p1.id, 'Answer')
    const doc = document([group, p1, r1], [])
    const targets = compatibleTargets(doc, r1.id, 'context')
    expect(targets[0]?.nodeId).toBe(p1.id)
  })

  it('offers a note as a context source, which it did not before', () => {
    /*
     * Questo test diceva il contrario, e cioe' che una nota non si puo' collegare a
     * niente. Era il difetto, non la specifica: una nota e' testo, e il testo va nel
     * contesto di un prompt. Senza questo, si scriveva un appunto e non poteva
     * arrivare da nessuna parte — e la mancanza non si vedeva da nessuna parte se
     * non provando a collegarla.
     */
    const annotation = {
      id: 'n1',
      type: 'note' as const,
      position: { x: 0, y: 0 },
      data: { kind: 'note' as const, text: 'x' },
    }
    expect(handlesOf(annotation)).toEqual([{ id: 'out', hint: 'as context, or into a group' }])
    const p1 = prompt('Question')
    const doc = document([annotation, p1], [])
    expect(compatibleTargets(doc, annotation.id, 'out').map((target) => target.nodeId)).toEqual([
      p1.id,
    ])
  })

  it('offers a Knowledge node as a context source, because that is the whole point of it', () => {
    /*
     * Un nodo Knowledge che non si puo' collegare a un prompt non serve a niente: e' un
     * elenco di note che non arriva da nessuna parte. Quindi questa non e' una formalta' —
     * e' la funzione del nodo, e il posto in cui si puo' perdere senza che nessuno se ne
     * accorga.
     *
     * Il motivo per cui finisce qui come test e non solo come codice e' che `handlesOf` e
     * `connectionKind` sono due posti che devono dire la stessa cosa. Se uno conosce il tipo
     * e l'altro no, la maniglia c'e' ma il filo non si forma: il sintomo e' un nodo che
     * sembra scollegato e da cui non si puo' collegare niente, senza errore in console.
     */
    const k = nodeOfType('knowledge')
    expect(handlesOf(k)).toEqual([{ id: 'out', hint: 'as context' }])
    const p1 = prompt('Che cosa hai scritto sui listini?')
    const doc = document([k, p1], [])
    const offered = compatibleTargets(doc, k.id, 'out')
    expect(offered.map((target) => target.nodeId)).toEqual([p1.id])
    expect(offered[0]?.handleId).toBe('context')
    expect(offered[0]?.kind).toBe('context')
  })

  it('does not offer the Knowledge node itself as its own target', () => {
    const k = nodeOfType('knowledge')
    const doc = document([k, prompt('domanda')], [])
    expect(compatibleTargets(doc, k.id, 'out').map((t) => t.nodeId)).not.toContain(k.id)
  })

it('cannot close a loop, and the reason is structural rather than a guard', () => {
    /*
     * Qui la versione di questo test diceva che il controllo dei cicli deve impedire a un
     * nodo Knowledge di chiudere un anello. Era una domanda sbagliata, e vale la pena dire
     * perche' invece di lasciare li' un test che sembra proteggere da una cosa impossibile.
     *
     * Un nodo Knowledge **non ha maniglie di ingresso**: non riceve niente. E un prompt non
     * manda niente a un Knowledge â€” il suo `out` e' una corsa, che finisce in una risposta.
     * Quindi l'unico modo che ha un nodo di essere dentro un ciclo di contesto e' avere un
     * contesto che entra in lui, e qui non ne entra mai nessuno. Il ciclo non e' «controllato
     * e respinto»: non e' costruibile.
     *
     * Questo e' il motivo per cui `connectionKind` chiama comunque il controllo dei cicli su
     * questo ramo. Non perche' serva oggi, ma perche' il giorno in cui a questo nodo si
     * aggiunge una maniglia di ingresso, il controllo ci sara' gia' e l'anello verra'
     * respinto, invece di far partire una richiesta che non finisce.
     */
    const k = nodeOfType('knowledge')
    // Nessuna maniglia di ingresso: la prova strutturale, non quella del risultato.
    expect(handlesOf(k).filter((handle) => handle.id !== 'out')).toEqual([])
    expect(k.type).toBe('knowledge')
  })

  it('has nothing to say about a source that does not exist', () => {
    const p1 = prompt('Question')
    expect(compatibleTargets(document([p1], []), 'missing', 'out')).toEqual([])
  })

  it('survives a null handle id', () => {
    const p1 = prompt('Question')
    const doc = document([p1], [])
    // A connection started from the node body rather than a handle.
    expect(() => compatibleTargets(doc, p1.id, null)).not.toThrow()
  })
})

/**
 * Releasing a dragged handle on empty canvas means "I want the next node", so the
 * palette offers only the types that would connect. Offering everything and
 * refusing after the fact is worse: by then a node exists that has to be deleted.
 */
describe('compatibleTypes', () => {
  it('offers a prompt from a response context handle', () => {
    const p1 = prompt('Question')
    const r1 = response(p1.id, 'Answer')
    const doc = document([p1, r1], [])
    expect(compatibleTypes(doc, r1.id, 'context')).toContain('prompt')
  })

  it('does not offer a response, which is produced by running, not by wiring', () => {
    const p1 = prompt('Question')
    const r1 = response(p1.id, 'Answer')
    const doc = document([p1, r1], [])
    expect(compatibleTypes(doc, r1.id, 'context')).not.toContain('response')
  })

  it('offers a prompt for a picture, through its image input', () => {
    const p1 = prompt('What is this?')
    const pic = image('photo.png')
    const doc = document([p1, pic], [])
    expect(compatibleTypes(doc, pic.id, 'out')).toEqual(['prompt'])
  })

  it('offers nothing from a prompt, whose output is a run', () => {
    const p1 = prompt('Question')
    expect(compatibleTypes(document([p1], []), p1.id, 'out')).toEqual([])
  })

  it('offers a Brain for a folder, and both its handles mean different things', () => {
    const brain = {
      id: 'b1',
      type: 'brain' as const,
      position: { x: 0, y: 0 },
      data: {
        kind: 'brain' as const,
        instruction: 'x',
        model: '',
        onExisting: 'rename' as const,
        run: { status: 'idle' as const, total: 0, done: 0, log: [], undo: [] },
      },
    }
    const folder = {
      id: 'f1',
      type: 'folder' as const,
      position: { x: 0, y: 0 },
      data: {
        kind: 'folder' as const,
        name: 'cartella',
        fileCount: 0,
        totalBytes: 0,
        text: '',
        truncated: false,
        refused: [],
      },
    }
    const doc = document([brain, folder], [])
    // `out` on a folder reaches a prompt and a Brain, and they are ordered by how
    // likely they are meant.
    const types = compatibleTypes(doc, 'f1', 'out')
    expect(types).toContain('brain')
    expect(types).toContain('prompt')
    // The `in` side only **receives**: nothing can be dragged out of it, so the
    // palette after such a drag is honestly empty rather than a dead end.
    expect(compatibleTypes(doc, 'f1', 'in')).toEqual([])
  })

  it('puts the ordinary connection first', () => {
    // A prompt from a response, not the groups that happen to come earlier.
    const group = output(['x'], {}, 'out1')
    const p1 = prompt('Question')
    const r1 = response(p1.id, 'Answer')
    const doc = document([group, p1, r1], [])
    expect(compatibleTypes(doc, r1.id, 'context')[0]).toBe('prompt')
  })

  it('offers nothing for a source that does not exist', () => {
    expect(compatibleTypes(document([prompt('Q')], []), 'missing', 'out')).toEqual([])
  })
})

/**
 * Which handle on the new node the wire should arrive at. Worked out with the same
 * check that produced the offer, so the two can never disagree.
 */
describe('targetHandleFor', () => {
  it('uses the image input for a picture', () => {
    const p1 = prompt('What is this?')
    const pic = image('photo.png')
    const doc = document([p1, pic], [])
    expect(targetHandleFor(doc, pic.id, 'out', 'prompt')).toBe('image')
  })

  it('uses the context input for text', () => {
    const p1 = prompt('Question')
    const r1 = response(p1.id, 'Answer')
    const doc = document([p1, r1], [])
    expect(targetHandleFor(doc, r1.id, 'context', 'prompt')).toBe('context')
  })

  it('uses the folder input a Brain writes into', () => {
    const folder = {
      id: 'f1',
      type: 'folder' as const,
      position: { x: 0, y: 0 },
      data: {
        kind: 'folder' as const,
        name: 'uscita',
        fileCount: 0,
        totalBytes: 0,
        text: '',
        truncated: false,
        refused: [],
      },
    }
    const doc = document([folder], [])
    expect(targetHandleFor(doc, 'f1', 'out', 'brain')).toBe('in')
  })

  it('has no answer for a type that takes nothing from this handle', () => {
    const p1 = prompt('Question')
    expect(targetHandleFor(document([p1], []), p1.id, 'out', 'prompt')).toBeNull()
  })

  it('agrees with the offer, for every type it offers', () => {
    // The bug this guards: a type appears in the list and then the wire lands on
    // the wrong handle, so the node is created and the connection refused.
    const p1 = prompt('Question')
    const r1 = response(p1.id, 'Answer')
    const pic = image('photo.png')
    const doc = document([p1, r1, pic], [])
    for (const [source, handle] of [
      [r1.id, 'context'],
      [pic.id, 'out'],
      [p1.id, 'out'],
    ] as Array<[string, string]>) {
      for (const type of compatibleTypes(doc, source, handle)) {
        expect(targetHandleFor(doc, source, handle, type), `${source} -> ${type}`).not.toBeNull()
      }
    }
  })
})
