/**
 * Il deposito in forma di file: come si scrive e come si rilegge.
 *
 * Il motivo per cui questo file esiste come funzione pura e non dentro lo store e' che la
 * parte che costa non e' scrivere il file: e' **non perdere niente**. Un file che si rilegge
 * sbagliato non da un errore, da' un archivio con dentro cose che l'utente aveva scritto e
 * che non sono piu' li' — e non c'e' nessun segnale che distingua quello da un archivio
 * vuoto.
 *
 * I test sono quindi scritti sulle cose che **rompono** la copia, non sul caso in cui
 * funziona:
 *
 * - un file spostato o rinominato a mano non deve diventare una nota nuova a ogni lettura;
 * - un file **senza** front matter e' comunque una nota, non un file da scartare;
 * - un titolo con due punti, con spazi o con caratteri che il file system non accetta deve
 *   tornare uguale;
 * - un indice illeggibile non deve mai far cancellare i file dell'utente.
 */

import { describe, expect, it } from 'vitest'
import {
  VAULT_INDEX,
  parseVaultIndex,
  parseVaultNote,
  renderVaultIndex,
  renderVaultNote,
  vaultFileName,
} from './knowledgeVault'
import type { KnowledgeEntry, KnowledgeHub } from '../types/knowledge'

function entry(over: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: over.id ?? 'note123456',
    title: over.title ?? 'Margine listino',
    text: over.text ?? 'Il margine cala del 12%.',
    source: over.source ?? {
      workspaceId: null,
      workspaceName: 'Trimestre 2',
      nodeTitle: 'Risposta su listini',
      nodeId: null,
    },
    hubId: over.hubId ?? null,
    links: over.links ?? [],
    color: over.color ?? 'default',
    position: over.position ?? { x: 0, y: 0, z: 0 },
    createdAt: over.createdAt ?? 1_700_000_000_000,
    updatedAt: over.updatedAt ?? 1_700_000_000_000,
    placedBecause: over.placedBecause ?? 'test',
  }
}

const hub: KnowledgeHub = {
  id: 'h1',
  title: 'Prezzi e listini',
  position: { x: 0, y: 0, z: 0 },
  createdAt: 1,
  updatedAt: 1,
}

describe('a note written to a file', () => {
  it('reads back exactly what was written', () => {
    const note = entry({ hubId: 'h1', links: ['other1'] })
    const file = renderVaultNote(note, [hub])
    const back = parseVaultNote(vaultFileName(note), file)
    expect(back?.id).toBe(note.id)
    expect(back?.title).toBe(note.title)
    expect(back?.text).toBe(note.text)
    expect(back?.hubTitle).toBe('Prezzi e listini')
    expect(back?.links).toEqual(['other1'])
  })

  it('keeps the text readable without any of the fields around it', () => {
    /*
     * Il file e' **testo**. Se per leggerlo serve un programma, non e' un deposito: e' un
     * formato proprietario travestito da file. Il corpo comincia dopo il front matter ed e'
     * il testo della nota, quindi chiunque apra il file con un editor ci legge dentro quello
     * che c'era — che e' la meta' del motivo per cui il deposito esiste.
     */
    const file = renderVaultNote(entry(), [])
    const [, , body] = file.split('---\n')
    expect(body).toContain('Il margine cala del 12%.')
  })

  it('survives a title with a colon, spaces and quotes in it', () => {
    // Un titolo con due punti rompe il front matter se non viene protetto, e il file si
    // rilegge con il titolo tagliato al primo due punti — cioe' con un nome diverso da quello
    // che l'utente ha scritto, senza che nulla lo dica.
    const awkward = 'Q3: "margine" e listini — 2026'
    const note = entry({ title: awkward })
    const back = parseVaultNote(vaultFileName(note), renderVaultNote(note, []))
    expect(back?.title).toBe(awkward)
  })

  it('survives a title the file system would refuse, because the name is built from it', () => {
    const note = entry({ title: 'A/B:C*D?E"F<G>H|I' })
    const name = vaultFileName(note)
    expect(name).not.toMatch(/[\\/:*?"<>|]/)
    expect(name.endsWith('.md')).toBe(true)
  })

  it('gives two notes with the same title two different files', () => {
    /*
     * Senza l'id nel nome, due note con lo stesso titolo si scrivono l'una sopra l'altra e una
     * sparisce senza avviso. E' il modo peggiore in cui un deposito possa perdere una nota:
     * il file c'e', il nome e' giusto, e dentro c'e' il testo sbagliato.
     */
    const first = entry({ id: 'aaa111', title: 'Lista' })
    const second = entry({ id: 'bbb222', title: 'Lista' })
    expect(vaultFileName(first)).not.toBe(vaultFileName(second))
  })
})

describe('files that did not come from here', () => {
  it('still reads a file with no front matter, because the text is the note', () => {
    /*
     * Un file scritto a mano nella cartella e' una nota che l'utente ha messo li' lui. Scartarla
     * perche' manca un'intestazione che non conosce significa che mettere un file a mano
     * significa non leggerlo — e cioe' che il modo piu' ovvio di usare la cartella non funziona.
     */
    const back = parseVaultNote('qualcosa.md', 'Un appunto scritto a mano.\n\nE una seconda riga.')
    expect(back?.text).toContain('scritto a mano')
    expect(back?.title).toBe('Un appunto scritto a mano.')
  })

  it('takes the id from the file name when the front matter has none', () => {
    /*
     * Il caso di un file **rinominato a mano**: senza questa regola l'id non c'e' e la nota
     * diventerebbe nuova a ogni lettura — cioe' rileggere la cartella due volte raddopperebbe
     * l'archivio. E' il difetto piu' subdolo di tutti, perche' non perde niente e fa solo
     * crescere tutto.
     */
    const back = parseVaultNote('Margine-listino-note123.md', 'testo')
    expect(back?.id).toBe('note123')
  })

  it('keeps a hand-written note with no id at all, rather than dropping it', () => {
    const back = parseVaultNote('appunto.md', 'qualcosa che vale')
    expect(back).not.toBeNull()
    expect(back?.text).toBe('qualcosa che vale')
  })

  it('gives up only on a file with nothing in it', () => {
    // Un file vuoto non e' una nota, e trattarlo come una farebbe comparire in mappa una
    // pallina senza niente dentro — che e' la cosa che l'utente non saprebbe spiegare.
    expect(parseVaultNote('vuoto.md', '   \n\n')).toBeNull()
  })
})

describe('the index of managed files', () => {
  it('lists the files, and only those', () => {
    const notes = [entry({ id: 'aaa111', title: 'Una' }), entry({ id: 'bbb222', title: 'Due' })]
    const names = parseVaultIndex(renderVaultIndex(notes))
    expect(names).toHaveLength(2)
    expect(names).toContain(vaultFileName(notes[0]!))
  })

  it('treats an unreadable index as no index, so nothing gets deleted', () => {
    /*
     * Questa e' la riga piu' importante del file.
     *
     * L'indice serve a una cosa: sapere **quali file sono nostri**, per poter togliere solo
     * quelli. Se non si puo' leggere, la risposta non e' «cancella tutto il markdown» ma
     * «non toccare niente»: nella cartella di una persona ci sono anche le sue cose, e un
     * file che sparisce perche' l'indice era corrotto non si annulla e non si vede.
     */
    expect(parseVaultIndex('non e' + ' json')).toEqual([])
    expect(parseVaultIndex('{"altro": 1}')).toEqual([])
  })

  it('does not confuse its own index with a note', () => {
    expect(VAULT_INDEX.endsWith('.json')).toBe(true)
  })
})