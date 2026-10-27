/**
 * Una nota deve poter arrivare dove arriva ogni altro testo.
 *
 * Il difetto che questo file chiude e' che una nota era un vicolo cieco: si scriveva
 * qualcosa e non poteva arrivare da nessuna parte — non nel contesto di un prompt, non
 * in un gruppo. Il sintomo non era un errore, era l'assenza di qualcosa: nessun
 * collegamento accettato, nessun messaggio, e un nodo che sembrava utile e non lo era.
 *
 * Un nodo che serve solo da appunto ha senso solo se l'appunto puo' essere usato, e il
 * posto naturale per usarlo e il contesto della domanda successiva.
 */

import { describe, expect, it } from 'vitest'
import { handlesOf } from './connections'
import { connectionKind } from './graph'
import { assembleMessages } from './assemble'
import { document, edge, note, prompt } from '../test/factories'

describe('a note has somewhere to go', () => {
  it('offers an output handle, which it did not before', () => {
    // Senza maniglia non c'e niente da trascinare: il collegamento non parte nemmeno,
    // e la mancanza non si vede da nessuna parte se non provando.
    expect(handlesOf(note('a note'))).toEqual([
      { id: 'out', hint: 'as context, or into a group' },
    ])
  })

  it('connects to a prompt as context', () => {
    const question = prompt('Question')
    const annotation = note('Always answer in Italian.')
    const doc = document([question, annotation], [])
    const kind = connectionKind(doc, {
      sourceId: annotation.id,
      sourceHandle: 'out',
      targetId: question.id,
      targetHandle: 'context',
    })
    expect(kind).toBe('context')
  })

  it('is refused where it makes no sense', () => {
    const question = prompt('Question')
    const annotation = note('n')
    const doc = document([question, annotation], [])
    /*
     * Non diventa un'istruzione di sistema: una nota e' un appunto, e il sistema
     * comanda il comportamento mentre l'appunto e' contenuto. Mescolarli cambierebbe
     * il significato di quello che l'utente ha scritto.
     */
    const asSystem = connectionKind(doc, {
      sourceId: annotation.id,
      sourceHandle: 'out',
      targetId: question.id,
      targetHandle: 'system',
    })
    expect(typeof asSystem, 'a note must not become system instructions').toBe('object')
  })

  it('cannot connect to itself', () => {
    const annotation = note('n')
    const doc = document([annotation], [])
    const kind = connectionKind(doc, {
      sourceId: annotation.id,
      sourceHandle: 'out',
      targetId: annotation.id,
      targetHandle: 'context',
    })
    expect(typeof kind).toBe('object')
  })
})

describe('note text reaches the prompt', () => {
  it('is sent as a labelled block, not as bare text', () => {
    /*
     * L'intestazione non e' un dettaglio. Un prompt che riceve tre note non sa quale
     * sia un'istruzione, quale un esempio e quale un appunto: senza l'intestazione il
     * modello riceve tre paragrafi anonimi e li mescola. E' la differenza fra mandare
     * un appunto e mandare rumore.
     */
    const question = prompt('Question')
    const annotation = note('Always answer in Italian.')
    const doc = document([question, annotation], [edge(annotation, question, 'context')])
    const { messages } = assembleMessages(doc, question.id)
    const text = messages
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n')
    expect(text).toContain('## Note')
    expect(text).toContain('Always answer in Italian.')
  })

  it('sends nothing for an empty note', () => {
    // Una nota vuota e' un segnaposto. Mandare un blocco vuoto consumerebbe token per
    // non dire niente, e aggiungerebbe rumore a un contesto che l'utente crede pulito.
    const question = prompt('Question')
    const empty = note('')
    const doc = document([question, empty], [edge(empty, question, 'context')])
    const { messages } = assembleMessages(doc, question.id)
    const text = messages
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n')
    expect(text).not.toContain('## Note')
  })

  it('puts the note before the question it belongs to, separated by a rule', () => {
    /*
     * Il contesto e la domanda stanno **nello stesso messaggio**, separati da `---`, e
     * non in due messaggi. Non e' una scelta mia: e' come `assemble.ts` tratta file,
     * cartelle e gruppi, e cambiarlo per le note solo romperebbe la regola che l'utente
     * ha gia' imparato dagli altri nodi.
     *
     * Il motivo e' che il modello risponde all'ultimo messaggio: mettere la domanda in
     * un messaggio e il contesto in quello precedente porta a una risposta all'appunto
     * invece che alla domanda. Quindi: contesto, regola, domanda — tutto insieme.
     */
    const question = prompt('What did we decide?')
    const annotation = note('Context: the user writes in Italian.')
    const doc = document([question, annotation], [edge(annotation, question, 'context')])
    const { messages } = assembleMessages(doc, question.id)
    const text = messages[messages.length - 1]?.content
    expect(typeof text).toBe('string')
    const body = text as string
    expect(body.indexOf('## Note')).toBeGreaterThanOrEqual(0)
    // La domanda viene **dopo** il contesto: e' l'ultima cosa che il modello legge.
    expect(body.indexOf('What did we decide?')).toBeGreaterThan(body.indexOf('## Note'))
  })

  it('lets a prompt carry several notes at once', () => {
    // Il caso per cui serve l'intestazione: due note non si distinguono a primo
    // ragguardo, e senza etichette il modello le tratta come un unico paragrafo.
    const question = prompt('Question')
    const first = note('Answer in Italian.')
    const second = note('Cite the sources.')
    const doc = document([question, first, second], [
      edge(first, question, 'context'),
      edge(second, question, 'context'),
    ])
    const { messages } = assembleMessages(doc, question.id)
    const text = messages
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n')
    expect(text).toContain('Answer in Italian.')
    expect(text).toContain('Cite the sources.')
  })
})
