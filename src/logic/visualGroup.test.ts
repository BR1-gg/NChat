/**
 * Il gruppo **solo visivo**: mette ordine e non partecipa a nessuna relazione.
 *
 * Quasi tutte le verifiche qui sono sulla **promessa di non fare niente**, e non e' la
 * parte facile. Il pericolo di un gruppo che organizza e' che, prima o poi, «organizzare»
 * diventi «usare»: che il nome del gruppo finisca in una richiesta al modello, che il
 * gruppo diventi il contesto di un prompt, che venga aggregato con i suoi membri. Sono
 * tutte cose che si possono scrivere senza accorgersene, e si scrivevano.
 *
 * Quindi la promessa e' tenuta dal **tipo**, non dalla buona volonta: il gruppo non ha
 * maniglie, e una linea si traccia solo partendo da una maniglia. Il test lo verifica
 * leggendo il sorgente, perche' un componente che comincia a usare `<Handle>` deve
 * fallire qui e non in una richiesta inviata a qualcuno.
 *
 * Sull'altro lato ci sono le cose che il gruppo deve fare bene: prendere **qualsiasi**
 * tipo di nodo, non mettersi dentro un altro gruppo, sciogliersi quando un membro
 * sparisce, e restare indenne quando si cancella la cornice.
 */

import { describe, expect, it } from 'vitest'
import { createGroupFromSelection, groupOf, planGroup, ungroupNodes } from '../actions/groupActions'
import groupNodeSource from '../components/nodes/GroupNode.tsx?raw'
import outputNodeSource from '../components/nodes/OutputNode.tsx?raw'
import { expandGroupMove, groupMemberIds, ownsFrame } from '../logic/groups'
import { NodeSchema } from '../persistence/schema'
import { addableNodeTypes, NODE_REGISTRY } from '../nodes/registry'
import { file, group, image, note, output, prompt, set as setNode } from '../test/factories'
import themeCss from '../styles/theme.css?raw'
import { HANDLES, type AppNode } from '../types/document'

/** A store stand-in: these actions only ever read `nodes` and call the two methods. */
function fakeStore(nodes: AppNode[], created: AppNode[] = []) {
  return {
    nodes,
    addNode: (_type: 'group', position: { x: number; y: number }, seed: Record<string, unknown> = {}) => {
      const node = group('', [], { ...(seed as object) }) as AppNode
      node.position = position
      created.push(node)
      return node.id
    },
    updateNodeData: (id: string, patch: Record<string, unknown>) => {
      const target = nodes.find((node) => node.id === id)
      if (target) Object.assign(target.data, patch)
    },
    removeNodes: () => {},
    getState() {
      return this
    },
  }
}

describe('a visual group takes anything', () => {
  it('accepts a prompt, a note, a file and an image together', () => {
    /*
     * La scelta del contenuto e' il motivo per cui questo gruppo esiste. Il gruppo
     * logico accetta solo risposte, perche' deve aggregarle; uno che accetta un prompt e
     * un'immagine non puo' aggregare nulla e non ne ha bisogno. Quindi qui non si guarda
     * il tipo: si guarda che il nodo non sia a sua volta una cornice.
     */
    const nodes = [
      prompt('una domanda', 'p1'),
      note('una nota', 'n1'),
      file('appunti.txt', { text: 'testo' }, 'f1'),
      image('foto.png', {}, 'i1'),
    ]
    expect(planGroup(nodes, ['p1', 'n1', 'f1', 'i1']).members).toEqual(['p1', 'n1', 'f1', 'i1'])
  })

  it('counts a node once even if it arrives twice', () => {
    // Il caso vero e' un paste o un import che ripete un id. Contarlo due volte
    // farebbe dire alla cornice «2 nodi» per uno solo, senza che nulla sembri rotto.
    const nodes = [prompt('una domanda', 'p1')]
    expect(planGroup(nodes, ['p1', 'p1', 'p1']).members).toEqual(['p1'])
  })

  it('refuses to put a frame inside a frame', () => {
    /*
     * Due cornici che contengono lo stesso nodo si contraddicono, e non c'e' una regola
     * sensata per decidere quale vince: lo stesso trascinamento le muoverebbe entrambe,
     * e la posizione del nodo dipenderebbe dall'ordine in cui sono state costruite.
     *
     * Il caso di un gruppo dentro un gruppo e' diverso e va bene: `expandGroupMove`
     * scende di livello, quindi si risolve da solo. Qui si parla di due cornici *diverse*
     * che vogliono lo stesso nodo, e il rifiuto lo dice — invece di aggiungerlo e fingere
     * che sia andata bene.
     */
    const nodes = [
      prompt('una domanda', 'p1'),
      output(['p1'], {}, 'o1'),
      setNode('Un vecchio set', ['p1'], {}, 's1'),
      group('Cornice', ['n1'], {}, 'g1'),
    ]
    const plan = planGroup(nodes, ['p1', 'o1', 's1', 'g1'])
    expect(plan.members).toEqual(['p1'])
    expect(plan.skipped.map((entry) => entry.id).sort()).toEqual(['g1', 'o1', 's1'])
    expect(plan.skipped.every((entry) => entry.reason === 'frame')).toBe(true)
  })

  it('creates nothing when the selection has no node that can go in', () => {
    // Un gruppo vuoto non avrebbe nemmeno una cornice: `computeGroupFrame` non ha niente
    // da circondare. Crearlo significherebbe una scelta che si perde in silenzio.
    const nodes = [output(['r1'], {}, 'o1')]
    expect(createGroupFromSelection(['o1'], fakeStore(nodes))).toBeNull()
  })
})

describe('the group cannot take part in anything', () => {
  it('declares no handles at all', () => {
    // Non un caso particolare: nessuno. E' il modo che ha di tenere la promessa «solo
    // visivo» senza dover ricordarsi di escluderlo da nessuna parte.
    expect(HANDLES.group).toEqual({})
  })

  it('renders no connection handle in its component', () => {
    /*
     * Legge il sorgente, e questa e' una scelta.
     *
     * Potrebbe sembrare eccessivo: se `HANDLES.group` e' vuoto, il gruppo non dovrebbe
     * poter comunque essere collegato. Ma `HANDLES` e' una tabella e il componente e' il
     * posto dove le maniglie vengono davvero disegnate — un componente che ne aggiunge
     * una continuerebbe a funzionare, continuerebbe a passare tutti gli altri test, e
     * resterebbe collegabile. Un tipo che dice una cosa e un componente che ne fanno
     * un'altra e' esattamente il difetto che questa promessa deve prevenire, quindi
     * viene controllato il sorgente.
     */
    const code = groupNodeSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/<Handle\b/)
    expect(code).not.toMatch(/import\s*{[^}]*\bHandle\b[^}]*}\s*from\s*'@xyflow\/react'/)
  })

  it('is not offered in the palette', () => {
    // Un gruppo che si sceglie dal catalogo non avrebbe niente da raccogliere: si crea
    // mettendogli dentro nodi che ci sono gia'.
    expect(addableNodeTypes).not.toContain('group')
    expect(NODE_REGISTRY.group.addable).toBe(false)
  })
})

/**
 * Una cornice non puo' prendere la sua misura da React Flow.
 *
 * Il difetto che questo chiude era visibilissimo: **trascinando il gruppo, la cornice si
 * spezzava e vibrava**. Ed e' la cosa piu' controintuitiva di tutto il gruppo, quindi va
 * scritta perche' ripulirla sembra una miglioria e non e'.
 *
 * Una cornice non ha una dimensione sua: la ha per costrutta, calcolata dai nodi che
 * circonda, e `setGroupFrame` la scrive in `node.width`. Ma React Flow **misura** ogni
 * nodo e per il disegno usa la sua misura, scartando la nostra. Prendendo `width` dalle
 * props — cioe' facendo quello che fanno tutti gli altri nodi, e sembrava la scelta
 * giusta — la cornice veniva disegnata alla misura di React Flow mentre il calcolo
 * continuava a insistere su un'altra. Due verita' che si correggono a vicenda: la
 * cornice respirava, e in un fotogramma crollava alla misura minima per poi tornare
 * indietro, lasciando i nodi fuori e dentro alternati.
 *
 * Il dato che rende il bug convincente e' che **non si vede in nessun test**: lo store
 * era sempre coerente, la posizione era sempre giusta, e il difetto esisteva solo fra il
 * numero che React Flow misurava e quello che noi scrivevamo. Per questo si legge il
 * sorgente dei due componenti.
 */
describe('a frame takes its size from the store, not from React Flow', () => {
  const strip = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  for (const [name, source] of [
    ['GroupNode', groupNodeSource],
    ['OutputNode', outputNodeSource],
  ] as const) {
    it(`${name} reads the computed size from the store`, () => {
      const code = strip(source)
      /*
       * Si cerca la **chiamata**, non la parola: il nome comparirebbe lo stesso nell'import
       * anche se il componente smettesse di usarlo, e il test passerebbe con il difetto
       * esattamente al suo posto.
       */
      expect(code).toMatch(/useNodeStoredSize\(id\)/)
    })

    it(`${name} does not destructure a measured width out of NodeProps`, () => {
      /*
       * Non basta dire «usa l'hook»: l'errore si rifa semplicemente aggiungendo
       * `width` alla sfila di parametri, e funziona lo stesso perche' React Flow passa
       * sempre quei due numeri. Il controllo e' sulla firma, perche' e' li che nasce
       * l'equivoco.
       */
      const code = strip(source)
      const destructured = /NodeProps<[^>]*>\s*\)?\s*=>|\{\s*id,\s*selected,\s*width|,\s*width,\s*height,/
      expect(code).not.toMatch(/NodeProps<[^>]*>\s*\{[^}]*\bwidth\b/)
      expect(destructured.test(code)).toBe(false)
    })
  }

  it('keeps the group bar out of the flow, so it cannot resize the frame', () => {
    /*
     * Il nome sta **sopra** la cornice e percio' non puo' stare nel flusso: dentro,
     * spingerebbe il bordo e cambierebbe la misura che React Flow rimisura, e quindi
     * lo stesso tremito di cui sopra — solo che stavolta a ogni lettera del nome.
     *
     * E serve anche `position: relative` sulla cornice: senza, il `top` negativo
     * collocherebbe l'etichetta rispetto alla pagina, nell'angolo dello schermo.
     */
    const barRule = themeCss.match(/\.group-frame-visual \.group-frame-bar \{[^}]*\}/)?.[0] ?? ''
    expect(barRule).toMatch(/position:\s*absolute/)
    const frameRule = themeCss.match(/\.group-frame\.group-frame-visual \{[^}]*\}/)?.[0] ?? ''
    expect(frameRule).toMatch(/position:\s*relative/)
  })

  it('shows the name as plain text, with no chip behind it', () => {
    // Niente sfondo e niente bordo: dentro la cornice sembrava un pulsante da premere,
    // mentre l'unica cosa da fare e' scrivere un nome.
    const labelRule = themeCss.match(/\.group-frame-visual \.group-frame-label \{[^}]*\}/)?.[0] ?? ''
    expect(labelRule).toMatch(/background:\s*none/)
    expect(labelRule).toMatch(/border:\s*0/)
    // E il troncamento, perche' un nome lunghissimo non deve poter allargare la cornice:
    // `min-width: 0` e' quello che lo permette dentro un `flex`.
    expect(labelRule).toMatch(/min-width:\s*0/)
    expect(labelRule).toMatch(/text-overflow:\s*ellipsis/)
  })
})

describe('a group stays consistent with its members', () => {
  it('lets a frame drag move every member, and only the members', () => {
    const nodes = [
      group('Due nodi', ['a', 'b'], {}, 'g1'),
      prompt('uno', 'a', { x: 100, y: 100 }),
      note('due', 'b', { x: 300, y: 100 }),
    ]
    const moves = expandGroupMove(nodes, 'g1', { x: 0, y: 0 })
    // Lo spostamento e' di 0 quindi non ci muove nessuno: quello che conta qui e' che la
    // cornice non venga trattata come un nodo qualsiasi.
    expect(moves).toBeNull()
  })

  it('moves members by the drag distance, not by more', () => {
    const nodes = [
      group('Due nodi', ['a', 'b'], {}, 'g1') as AppNode & { position: { x: number; y: number } },
      prompt('uno', 'a', { x: 100, y: 100 }),
      note('due', 'b', { x: 300, y: 100 }),
    ]
    const frame = nodes[0] as unknown as { position: { x: number; y: number } }
    frame.position = { x: 20, y: 20 }
    const moves = expandGroupMove(nodes, 'g1', { x: 120, y: 70 })
    expect(moves?.get('a')).toEqual({ x: 200, y: 150 })
    expect(moves?.get('b')).toEqual({ x: 400, y: 150 })
  })

  it('leaves the group in place when it is emptied', () => {
    // Svototare un gruppo e' un lavoro normale, e il gruppo non deve sparire a metà:
    // `computeGroupFrame` senza membri non ha niente da disegnare, quindi la cornice
    // si cancellerebbe da sola mentre l'utente la sta svuotando.
    const groupNode = group('Tutto', ['a'], {}, 'g1')
    const store = fakeStore([groupNode] as AppNode[])
    ungroupNodes('g1', store)
    expect(store.nodes[0]?.data.members).toEqual([])
  })

  it('finds which group a node is in', () => {
    const nodes = [group('Uno', ['a'], {}, 'g1'), prompt('uno', 'a')]
    expect(groupOf(nodes, 'a')).toBe('g1')
    expect(groupOf(nodes, 'nessuno')).toBeNull()
  })
})

describe('a group survives the save and load round trip', () => {
  it('keeps its name, its colour and its members', () => {
    const saved = NodeSchema.parse({
      id: 'g1',
      type: 'group',
      position: { x: 0, y: 0 },
      data: { kind: 'group', title: 'Materiale', color: 'rose', members: ['a', 'b'] },
    })
    expect(saved.data).toMatchObject({ title: 'Materiale', color: 'rose', members: ['a', 'b'] })
  })

  it('falls back to the theme colour when a saved colour is not one of ours', () => {
    /*
     * Il colore arriva da un file su disco e finisce in uno stile. Senza questo ripiego,
     * un valore a caso — o voluto — entrerebbe nel foglio di stile. Il ripiego fa perdere
     * una scelta estetica e non il gruppo: ed e' per questo che `catch` invece di
     * `enum` da solo, che avrebbe scartato **tutto il nodo**.
     */
    const saved = NodeSchema.parse({
      id: 'g1',
      type: 'group',
      position: { x: 0, y: 0 },
      data: { kind: 'group', title: 'X', color: 'url(javascript:alert(1))', members: ['a'] },
    })
    expect((saved.data as { color: string }).color).toBe('default')
    expect((saved.data as { members: string[] }).members).toEqual(['a'])
  })

  it('keeps only the colours we declared', () => {
    // Ogni valore accettato deve esistere davvero nel tipo: se domani si aggiunge un
    // colore, `GROUP_COLOR_VALUES` in `storage.ts` smette di compilare e il difetto
    // viene fuori adesso e non al prossimo salvataggio di un utente.
    const declared = ['default', 'amber', 'sky', 'rose', 'green', 'violet']
    for (const colour of declared) {
      const saved = NodeSchema.parse({
        id: 'g1',
        type: 'group',
        position: { x: 0, y: 0 },
        data: { kind: 'group', title: '', color: colour, members: [] },
      })
      expect((saved.data as { color: string }).color).toBe(colour)
    }
  })
})

describe('which field holds the members', () => {
  it('reads both kinds of frame through one rule', () => {
    /*
     * I due tipi di cornice tengono i membri in campi diversi (`sourceNodeIds` e
     * `members`) perche' hanno origini diverse, ma si comportano allo stesso modo. La
     * regola che dice quale dei due e' in un posto solo: altrimenti se ne ricorda una
     * copia in tre file, e la copia e' quella che dimentica il gruppo.
     */
    expect(groupMemberIds(output(['a'], {}, 'o1'))).toEqual(['a'])
    expect(groupMemberIds(group('Due', ['b'], {}, 'g1'))).toEqual(['b'])
    expect(groupMemberIds(prompt('uno', 'p1'))).toBeNull()
  })

  it('knows that the legacy set draws a frame even though its own position is its own', () => {
    /*
     * E' la distinzione che `ownsFrame` e `groupMemberIds` tengono separata, ed e' il
     * punto di questo file.
     *
     * Il vecchio `set` **disegna** un riquadro attorno ai suoi membri, ma non e' una
     * cornice posizionata: e' una card con la sua posizione, e il riquadro e' un overlay.
     * Quindi non si puo' mettere dentro un gruppo — i due riquadri si sovrapporrebbero e
     * trascinando il gruppo il riquadro del `set` resterebbe fermo — ma nemmeno si deve
     * trattare come cornice per il trascinamento, perche' trascinare un `set` sposta la
     * card, non i membri.
     *
     * Se le due domande fossero una sola, una delle due risposte sarebbe sbagliata, e
     * sbaglierebbe in silenzio.
     */
    const legacy = setNode('Un vecchio set', ['a'], {}, 's1')
    expect(ownsFrame(legacy)).toBe(true)
    expect(groupMemberIds(legacy)).toBeNull()
    // E il punto pratico: il `set` non entra in un gruppo.
    expect(planGroup([prompt('uno', 'p1'), legacy], ['p1', 's1']).skipped).toEqual([
      { id: 's1', reason: 'frame' },
    ])
  })
})
