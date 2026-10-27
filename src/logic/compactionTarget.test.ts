/**
 * Compattare deve volere dire la stessa cosa da **qualsiasi** nodo.
 *
 * Il difetto che questo file chiude e' che la compattazione esisteva solo sul prompt
 * e sulla risposta. Non perche' mancasse il bottone, ma perche' mancava la risposta a
 * una domanda: la compattazione agisce sul **prompt**, quindi premere «compatta» su un
 * file, una nota o un'immagine non poteva significare niente — nodo non e' un prompt,
 * e senza sapere di chi e' il contesto che quel nodo fa crescere, il comando non aveva
 * un bersaglio.
 *
 * Qui si blocca la regola: la stessa azione, dallo stesso effetto, da qualunque nodo,
 * e — quando non si puo' fare — un rifiuto che dice **perche'**, non un silenzio.
 */

import { describe, expect, it } from 'vitest'
import {
  compactableHistory,
  promptsReachableFrom,
  refusalMessage,
  resolveCompactionTarget,
} from './compactionTarget'
import { document, edge, note, prompt, response, summary } from '../test/factories'

/**
 * La forma vera di una conversazione: una domanda, la sua risposta, e un **secondo**
 * prompt che riceve la risposta come contesto. E' il secondo prompt che si
 * compatta, perche' e' l'unico ad avere una cronologia.
 *
 * La risposta non e' collegata al proprio prompt: `assembleMessages` segue
 * `parentPromptId` e troverebbe un ciclo. Quindi la risposta alimenta un prompt
 * diverso — ed e' esattamente cosi' che funziona «Compact up to here».
 */
function graphWithHistory() {
  const first = prompt('What did we decide?')
  const answer = response(first.id, 'We decided to ship on Friday.')
  const question = prompt('Recap the thread and tell me if it changed.')
  const annotation = note('The user writes in Italian.')
  return {
    first,
    answer,
    question,
    annotation,
    doc: document([first, answer, question, annotation], [
      edge(answer, question, 'context'),
      edge(annotation, question, 'context'),
    ]),
  }
}

describe('compacting from any node', () => {
  it('works from the prompt itself', () => {
    const { question, doc } = graphWithHistory()
    const resolution = resolveCompactionTarget(doc, question.id)
    expect(resolution.ok).toBe(true)
    if (!resolution.ok) return
    expect(resolution.target.promptId).toBe(question.id)
    expect(resolution.target.messages.length).toBeGreaterThan(0)
  })

  it('works from a note, and names the prompt it affects', () => {
    /*
     * Questo e' il caso che non esisteva. Una nota non ha un contesto: ha un testo
     * che finisce nel contesto di qualcun altro. Senza seguire i collegamenti, il
     * comando su una nota non avrebbe un bersaglio, e il contesto da accorciare
     * — la parte che cresce — resterebbe com'era senza che nessuno lo dica.
     */
    const { question, annotation, doc } = graphWithHistory()
    const resolution = resolveCompactionTarget(doc, annotation.id)
    expect(resolution.ok).toBe(true)
    if (!resolution.ok) return
    expect(resolution.target.promptId).toBe(question.id)
    // Il nodo premuto resta distinto dal prompt: la finestra deve poter dire quale
    // dei due l'utente ha scelto.
    expect(resolution.target.fromNodeId).toBe(annotation.id)
  })

  it('works from a response, which is where it already worked by hand', () => {
    const { question, answer, doc } = graphWithHistory()
    const resolution = resolveCompactionTarget(doc, answer.id)
    expect(resolution.ok).toBe(true)
    if (!resolution.ok) return
    expect(resolution.target.promptId).toBe(question.id)
  })

  it('agrees on the same target no matter which node is used', () => {
    /*
     * Il punto della feature: da tre nodi diversi si arriva allo stesso prompt. Se i
     * tre dessero target diversi, l'utente non saprebbe quale contesto sta per
     * accorciare, e la finestra che mostra il confronto direbbe il falso.
     */
    const { question, answer, annotation, doc } = graphWithHistory()
    const targets = [question, answer, annotation].map((node) => {
      const resolution = resolveCompactionTarget(doc, node.id)
      return resolution.ok ? resolution.target.promptId : null
    })
    expect(new Set(targets).size).toBe(1)
    expect(targets[0]).toBe(question.id)
  })

  it('reports the same history and token count from every node', () => {
    const { question, answer, doc } = graphWithHistory()
    const fromPrompt = resolveCompactionTarget(doc, question.id)
    const fromAnswer = resolveCompactionTarget(doc, answer.id)
    expect(fromPrompt.ok && fromAnswer.ok).toBe(true)
    if (!fromPrompt.ok || !fromAnswer.ok) return
    expect(fromAnswer.target.tokensBefore).toBe(fromPrompt.target.tokensBefore)
    expect(fromAnswer.target.messages).toEqual(fromPrompt.target.messages)
  })
})

describe('what gets compacted, and what does not', () => {
  it('leaves the question out of the summary', () => {
    /*
     * Comprimere anche la domanda produrrebbe un riassunto di una conversazione che
     * finisce a meta', e il prompt si ritroverebbe senza niente da chiedere. E' la
     * stessa regola che `compactContext` usava gia', verificata qui sul posto dove
     * ora viene applicata anche agli altri nodi.
     */
    const { question, doc } = graphWithHistory()
    const resolution = resolveCompactionTarget(doc, question.id)
    expect(resolution.ok).toBe(true)
    if (!resolution.ok) return
    const joined = resolution.target.messages.map((message) => message.content).join('\n')
    expect(joined).not.toContain('Recap the thread')
    // Il testo completo, invece, lo contiene: e' la richiesta che verra' inviata.
    expect(
      resolution.target.fullContext.map((message) => message.content).join('\n'),
    ).toContain('Recap the thread')
  })

  it('excludes the system message from the summary but keeps it in the request', () => {
    const history = compactableHistory([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'earlier answer' },
      { role: 'user', content: 'the question being asked now' },
    ])
    expect(history.map((message) => message.role)).toEqual(['user', 'assistant'])
  })

  it('counts the whole request, not only the part being compacted', () => {
    /*
     * I due numeri rispondono a domande diverse e serves sapere quale e' quale: il
     * primo e' quanto si paga **adesso** per questa richiesta, il secondo e' quanto
     * il riassunto dovrebbe battere. Mostrarli entrambi come un numero solo
     * costringerebbe l'utente a indovinare quale sta guardando.
     */
    const { question, doc } = graphWithHistory()
    const resolution = resolveCompactionTarget(doc, question.id)
    expect(resolution.ok).toBe(true)
    if (!resolution.ok) return
    expect(resolution.target.tokensNow).toBeGreaterThanOrEqual(resolution.target.tokensBefore)
  })
})

describe('following the graph to find the prompt', () => {
  it('finds a prompt two hops away, through an intermediate node', () => {
    const first = prompt('first question')
    const second = prompt('second question')
    const answer = response(first.id, 'an answer')
    const doc = document([first, answer, second], [edge(answer, second, 'context')])
    expect(promptsReachableFrom(doc, answer.id)).toEqual([second.id])
  })

  it('crosses a run edge, not only a context edge', () => {
    /*
     * Una risposta che alimenta un prompt con un bordo `run` — cioe' «continua da
     * qui» — porta comunque la sua cronologia in quel prompt. Cercando solo i bordi
     * di contesto, il caso piu' comune dopo la risposta stessa restava scoperto.
     */
    const first = prompt('first question')
    const second = prompt('and then?')
    const answer = response(first.id, 'an answer')
    const doc = document([first, answer, second], [edge(answer, second, 'run')])
    expect(promptsReachableFrom(doc, answer.id)).toEqual([second.id])
  })

  it('picks the first of several prompts, rather than guessing', () => {
    const first = prompt('first question')
    const second = prompt('second question')
    const answer = response(first.id, 'an answer')
    const doc = document([first, answer, second], [
      edge(answer, first, 'context'),
      edge(answer, second, 'context'),
    ])
    // Una risposta che alimenta due prompt non puo' compattarli entrambi: si sceglie
    // il primo in ordine di scoperta e la finestra dice quale, cosi' il colpo e'
    // leggibile. Scegliere a caso sarebbe peggio che non scegliere.
    expect(promptsReachableFrom(doc, answer.id)).toEqual([first.id, second.id])
  })

  it('does not loop forever on a cycle', () => {
    const first = prompt('first question')
    const second = prompt('second question')
    const doc = document([first, second], [edge(first, second, 'context')])
    // Un ciclo fra prompt e' gia' vietato da `connectionKind`, ma la ricerca non
    // deve dipendere da quello: un documento caricato da un'altra versione puo'
    // contenerne uno, e qui la funzione deve terminare e basta.
    expect(() => promptsReachableFrom(doc, first.id)).not.toThrow()
  })
})

describe('when there is nothing to compact', () => {
  it('says the node reaches no prompt', () => {
    const annotation = note('a note')
    const doc = document([annotation], [])
    const resolution = resolveCompactionTarget(doc, annotation.id)
    expect(resolution.ok).toBe(false)
    if (resolution.ok) return
    expect(resolution.refusal.reason).toBe('not-connected-to-prompt')
    const { message } = refusalMessage(resolution.refusal)
    expect(message).toMatch(/prompt/i)
  })

  it('says the prompt has no history, on a prompt with nothing attached', () => {
    /*
     * Un prompt da solo non ha niente prima della domanda. Il caso e' diverso da
     * quello sopra e la differenza conta: qui il collegamento c'e', e quel che
     * manca e' il materiale. Un messaggio unico costringerebbe l'utente a indovinare
     * quale dei due sia.
     */
    const question = prompt('a question on its own')
    const doc = document([question], [])
    const resolution = resolveCompactionTarget(doc, question.id)
    expect(resolution.ok).toBe(false)
    if (resolution.ok) return
    expect(resolution.refusal.reason).toBe('nothing-to-compact')
    const { message } = refusalMessage(resolution.refusal)
    expect(message).toMatch(/connect/i)
  })

  it('reports a deleted node instead of pretending it is empty', () => {
    const resolution = resolveCompactionTarget(document([], []), 'nope')
    expect(resolution.ok).toBe(false)
    if (resolution.ok) return
    expect(resolution.refusal.reason).toBe('no-node')
  })

  it('refuses to compact a context that is already one summary, and says so', () => {
    /*
     * Dopo una compattazione il contesto e' gia' un riassunto, e `assemble` lo mette
     * in un messaggio **system** insieme alle istruzioni del prompt. Comprimerlo di
     * nuovo riscriverebbe «rispondi in italiano» in forma parafrasata: non accorciarebbe
     * il contesto, cambierebbe il comportamento del prompt. Quindi si rifiuta.
     *
     * Ma il rifiuto deve essere **suo**. Dire «collega qualcosa al prompt» sarebbe
     * falso — l'utente ha gia' collegato tutto — e gli farebbe collegare roba inutile
     * per far smettere all'app di segnalarlo. Questo e' il caso in cui un messaggio
     * generico fa piu' danno di nessun messaggio.
     */
    const question = prompt('Recap the thread and tell me if it changed.')
    const condensed = summary('We decided to ship on Friday.')
    const doc = document([question, condensed], [edge(condensed, question, 'context')])
    const resolution = resolveCompactionTarget(doc, condensed.id)
    expect(resolution.ok).toBe(false)
    if (resolution.ok) return
    expect(resolution.refusal.reason).toBe('already-compact')
    const { title, message } = refusalMessage(resolution.refusal)
    expect(title).toMatch(/already a summary/i)
    // Non la frase di «collega qualcosa»: e' l'indicazione sbagliata per un contesto
    // che c'e' gia', e porta a collegare roba inutile.
    expect(message).not.toMatch(/connect something to the prompt/i)
  })

  it('still compacts when a summary sits alongside real history', () => {
    /*
     * Il caso precedente e' il caso peggiore, non l'unico. Se il prompt ha anche
     * risposte vere oltre al riassunto, quelle si possono ancora accorciare, e
     * rifiutare sarebbe falso come il contrario. Il rifiuto vale solo quando il
     * riassunto e' **tutto** il contesto.
     */
    const first = prompt('What did we decide?')
    const answer = response(first.id, 'We decided to ship on Friday.')
    const question = prompt('Recap the thread and tell me if it changed.')
    const condensed = summary('An earlier round of the same discussion.')
    const doc = document([first, answer, question, condensed], [
      edge(answer, question, 'context'),
      edge(condensed, question, 'context'),
    ])
    const resolution = resolveCompactionTarget(doc, question.id)
    expect(resolution.ok).toBe(true)
    if (!resolution.ok) return
    expect(resolution.target.promptId).toBe(question.id)
  })
})
