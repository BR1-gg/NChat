import { create } from 'zustand'
import { db, type VaultRow } from '../persistence/db'
import {
  VAULT_INDEX,
  parseVaultIndex,
  parseVaultNote,
  renderVaultIndex,
  renderVaultNote,
  vaultFileName,
} from '../logic/knowledgeVault'
import { canWrite, requestPermission, supportsDirectories } from '../persistence/handles'
import { hubShellPoint } from '../logic/knowledge'
import { useKnowledgeStore } from './knowledgeStore'
import type { KnowledgeEntry } from '../types/knowledge'

/**
 * Il deposito: dove l'archivio viene scritto **come file**, e come si rilegge.
 *
 * Vive separato dallo store dell'archivio perche' parla d'un'altra cosa. Quello conosce le
 * note e sa dove stanno; questo sa scrivere e leggere una cartella. Mescolarli avrebbe
 * significato che ogni salvataggio di una nota accadesse dentro un'operazione di file — e la
 * prima cosa che si rompe, quando una scrittura su disco fallisce, e' che la nota non si salva
 * piu' nemmeno in memoria. Il file e' una copia; l'archivio e' l'archivio.
 *
 * Quindi il flusso va sempre da una parte all'altra e mai dentro: si salva la nota, e poi si
 * scrive il deposito. E se il deposito fallisce la nota c'e' lo stesso — si dice che il file
 * non e' stato aggiornato e l'utente riprova. Il contrario, cioe' la nota che non c'e' perche'
 * la cartella era piena, sarebbe un archivio che si cancella da solo perche' il computer ha
 * esaurito uno spazio che non c'entra niente con la nota.
 */

export type VaultStatus = 'unset' | 'ready' | 'needs-permission' | 'unsupported' | 'error'

export interface VaultState {
  /** The folder's path as text, or `null` when no folder has been chosen. */
  path: string | null
  status: VaultStatus
  /** What went wrong, in a sentence the user can act on. */
  message: string | null
  writtenAt: number | null
  noteCount: number
  /** True while a read or a write is in flight, so the buttons can say so. */
  busy: boolean

  /** Remembers the folder on start-up and says whether it can still be used. */
  refresh: () => Promise<void>
  /** Opens the browser's folder picker. Returns the path, or `null` if dismissed. */
  choose: () => Promise<string | null>
  /** Forgets the folder. Nothing on disk is touched. */
  forget: () => Promise<void>
  /** Writes every note as a file and updates the index. */
  write: () => Promise<{ written: number } | null>
  /** Reads the folder back and merges what is new or changed. */
  read: () => Promise<{ added: number; updated: number } | null>
}

const VAULT_ID = 'root'

/** The one row we keep, or `null`. Never a stale copy: the table is asked every time. */
async function vaultRow(): Promise<VaultRow | null> {
  try {
    return (await db.knowledgeVault.get(VAULT_ID)) ?? null
  } catch {
    return null
  }
}

/**
 * Whether the stored value is still a folder we can write into.
 *
 * Un handle riletto dal database puo' tornare come dato piatti, e allora e' come non averne
 * mai scelto uno: meglio dire «scegli la cartella» che fallire a ogni scrittura con un
 * errore che non spiega niente. E' la stessa regola di `persistence/handles.ts`, e lo e' per
 * la stessa ragione.
 */
function isUsableHandle(value: unknown): value is FileSystemDirectoryHandle {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { kind?: unknown; getFileHandle?: unknown }
  return candidate.kind === 'directory' && typeof candidate.getFileHandle === 'function'
}

export const useVaultStore = create<VaultState>((set, get) => ({
  path: null,
  status: 'unset',
  message: null,
  writtenAt: null,
  noteCount: 0,
  busy: false,

  async refresh() {
    if (!supportsDirectories()) {
      set({
        status: 'unsupported',
        path: null,
        message: 'This browser cannot save into a folder you choose.',
      })
      return
    }
    const row = await vaultRow()
    if (!row || !isUsableHandle(row.handle)) {
      set({
        status: 'unset',
        // Il percorso resta anche senza la capacita': e' l'informazione che permette di
        // sapere **dove** erano i file, e senza quello l'utente deve cercarli a mano nella
        // cronologia del file manager per scoprire che esistono.
        path: row?.path ?? null,
        message: row ? 'The folder needs to be chosen again.' : null,
        writtenAt: row?.writtenAt ?? null,
        noteCount: row?.noteCount,
      })
      return
    }
    // Il permesso si chiede **dentro** un gesto dell'utente, e questa funzione non e' un
    // gesto: quindi qui si controlla e non si chiede. Se manca, lo chiederà il pulsante che
    // salva — che e' lui stesso un clic, ed e' l'unico posto dove la richiesta può riuscire.
    const writable = await canWrite(row.handle)
    set({
      path: row.path,
      status: writable ? 'ready' : 'needs-permission',
      message: writable ? null : 'Allow writing, or choose the folder again.',
      writtenAt: row.writtenAt,
      noteCount: row.noteCount,
    })
  },

  async choose() {
    if (!supportsDirectories()) {
      set({ status: 'unsupported', message: 'This browser cannot save into a folder you choose.' })
      return null
    }
    const picker = (globalThis as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> })
      .showDirectoryPicker
    if (!picker) return null
    let handle: FileSystemDirectoryHandle
    try {
      handle = await picker.call(globalThis)
    } catch {
      // «Annulla» nel selettore e' una risposta, non un errore: non si dice niente e non si
      // cambia quello che c'era. La cartella di prima resta valida.
      return null
    }
    if ((await requestPermission(handle, 'readwrite')) === 'denied') {
      set({ status: 'error', message: 'Writing to that folder was not allowed.' })
      return null
    }
    const previous = await vaultRow()
    const row: VaultRow = {
      id: VAULT_ID,
      handle,
      path: handle.name || 'Chosen folder',
      chosenAt: Date.now(),
      writtenAt: previous?.writtenAt ?? null,
      noteCount: previous?.noteCount ?? 0,
    }
    try {
      await db.knowledgeVault.put(row)
    } catch (error) {
      set({ status: 'error', message: describe(error) })
      return null
    }
    set({ path: row.path, status: 'ready', message: null })
    /*
     * La prima scrittura avviene subito e non al primo salvataggio.
     *
     * Scegliere la cartella e' dichiarare «qui finisce il mio archivio», e una cartella vuota
     * non lo dimostra: sembra che il pulsante non abbia fatto niente. Il primo file che
     * compare e' la prova, ed e' l'unico modo che l'utente ha di sapere se ha funzionato —
     * e gli serve subito, perche' il primo posto in cui uno cerca le sue note quando non le
     * trova e' il file manager.
     */
    void get().write()
    return row.path
  },

  async forget() {
    try {
      await db.knowledgeVault.delete(VAULT_ID)
    } catch {
      /* niente da fare: si dice sotto comunque */
    }
    /*
     * Nessun file viene cancellato. «Dimentica la cartella» vuol dire che da adesso
     * l'archivio smette di scrivere li'; cancellare i file — o restituirli senza dirlo —
     * sarebbe fare una cosa che non e' stata chiesta. I file restano e sono leggibili, ed e'
     * l'unico modo di averli senza dover prima ricordarsi che esistono.
     */
    set({ path: null, status: 'unset', message: null, writtenAt: null, noteCount: 0 })
  },

  async write() {
    const row = await vaultRow()
    if (!row || !isUsableHandle(row.handle)) {
      set({ status: 'unset', message: 'Choose the folder first.' })
      return null
    }
    if ((await requestPermission(row.handle, 'readwrite')) === 'denied') {
      set({ status: 'needs-permission', message: 'Writing to that folder was not allowed.' })
      return null
    }
    set({ busy: true })
    try {
      const knowledge = useKnowledgeStore.getState()
      const entries = knowledge.entries
      const hubs = knowledge.hubs

      /*
       * Prima si legge l'indice, poi si cancella **solo** quello che c'era elencato e che non
       * c'e' piu'.
       *
       * E' la parte che rende accettabile scrivere in una cartella scelta da una persona.
       * Senza, l'unico modo per sapere quali file sono nostri sarebbe cancellare tutti i `.md`,
       * e in una cartella del computer ci sono anche le cose dell'utente: un file suo che
       * sparisce perche' l'applicazione ha salvato una nota e' il modo peggiore in cui una
       * funzione di salvare possa rompersi, perche' non si vede e non si annulla.
       */
      const listed = await readIndex(row.handle)
      const wanted = new Set(entries.map((entry) => vaultFileName(entry)))
      for (const name of listed) {
        if (wanted.has(name)) continue
        try {
          await row.handle.removeEntry(name)
        } catch {
          // Un file che non si cancella non blocca gli altri: la cartella resta in uno stato
          // quasi giusto, che e' meglio che non scrivere niente.
        }
      }

      let written = 0
      for (const entry of entries) {
        const name = vaultFileName(entry)
        const file = await row.handle.getFileHandle(name, { create: true })
        const stream = await file.createWritable()
        await stream.write(renderVaultNote(entry, hubs))
        await stream.close()
        written += 1
      }

      const index = await row.handle.getFileHandle(VAULT_INDEX, { create: true })
      const stream = await index.createWritable()
      await stream.write(renderVaultIndex(entries))
      await stream.close()

      const now = Date.now()
      await db.knowledgeVault.put({ ...row, writtenAt: now, noteCount: written })
      set({ busy: false, status: 'ready', message: null, writtenAt: now, noteCount: written })
      return { written }
    } catch (error) {
      // La nota e' gia' nell'archivio, in memoria e sul database: quello che e' fallito e' stato
      // solo la copia su carta. Si dice, e non si tocca n'altro.
      set({ busy: false, status: 'error', message: describe(error) })
      return null
    }
  },

  async read() {
    const row = await vaultRow()
    if (!row || !isUsableHandle(row.handle)) {
      set({ status: 'unset', message: 'Choose the folder first.' })
      return null
    }
    if ((await requestPermission(row.handle, 'read')) === 'denied') {
      set({ status: 'needs-permission', message: 'Reading that folder was not allowed.' })
      return null
    }
    set({ busy: true })
    try {
      const knowledge = useKnowledgeStore.getState()
      const incoming: KnowledgeEntry[] = []

      for await (const handle of row.handle.values()) {
        if (handle.kind !== 'file') continue
        if (!handle.name.endsWith('.md') || handle.name === VAULT_INDEX) continue
        const read = await handle.getFile()
        const note = parseVaultNote(handle.name, await read.text())
        /*
         * Un file che non dice niente non e' una nota: e' un file che sta nella cartella e non
         * e' nostro. Salta, e resta li'. Non si cancella mai qualcosa che non si sa che cosa
         * sia — e non si legge niente in un file che non si capisce.
         */
        if (!note) continue
        /*
         * Il file non vince sempre.
         *
         * Un file toccato **dopo** l'ultimo salvataggio e' l'utente che ha cambiato il
         * contenuto e vuole che il cambiamento entri; un file piu' vecchio no. E' l'unico
         * criterio che tiene insieme le due copie senza chiedere ogni volta, che e' la cosa
         * che fa smettere di usare una funzione che chiede. Senza, rileggere la cartella
         * riporterebbe indietro ogni modifica fatta nell'applicazione dopo l'ultima
         * sincronizzazione — cioe' perderebbe lavoro, in silenzio.
         */
        const known = note.id
          ? knowledge.entries.find((entry) => entry.id === note.id)
          : undefined
        if (known && known.updatedAt >= read.lastModified) continue
        incoming.push(rebuild(note, known, knowledge))
      }

      const result = incoming.length > 0
        ? await knowledge.importEntries(incoming)
        : { added: 0, updated: 0 }
      set({ busy: false, status: 'ready', message: null })
      return result
    } catch (error) {
      set({ busy: false, status: 'error', message: describe(error) })
      return null
    }
  },
}))

/** The index of managed files, or an empty list when there is none or it is unreadable. */
async function readIndex(handle: FileSystemDirectoryHandle): Promise<string[]> {
  try {
    const file = await handle.getFileHandle(VAULT_INDEX)
    const text = await (await file.getFile()).text()
    return parseVaultIndex(text)
  } catch {
    return []
  }
}

function describe(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'The folder could not be used.'
}

/**
 * Turns a parsed file back into an entry, keeping what only the archive knows.
 *
 * Il **posto** e il **gruppo** vengono dal file quando ci sono, e restano quelli altrimenti:
 * il punto di contesto e' scritto per nome e viene cercato per nome, perche' e' l'unica
 * cosa che un file spostato in un'altra cartella porta con se', e un id non gli sopravvive.
 * Se il nome non corrisponde a nessun centro, la nota resta libera — e resta libera anche
 * davanti a un errore, perche' una nota senza gruppo e' comunque una nota, mentre una nota
 * con un gruppo sbagliato e' una nota nel posto sbagliato senza che nessuno lo sappia.
 */
function rebuild(
  note: NonNullable<ReturnType<typeof parseVaultNote>>,
  existing: KnowledgeEntry | undefined,
  knowledge: ReturnType<typeof useKnowledgeStore.getState>,
): KnowledgeEntry {
  const id = note.id ?? `vault-${note.title.slice(0, 12)}`
  const hub = note.hubTitle
    ? knowledge.hubs.find((candidate) => candidate.title === note.hubTitle)
    : undefined
  return {
    id,
    title: note.title,
    text: note.text,
    source: {
      workspaceId: existing?.source.workspaceId ?? null,
      workspaceName: note.workspaceName,
      nodeTitle: note.nodeTitle,
      nodeId: existing?.source.nodeId ?? null,
    },
    hubId: hub?.id ?? existing?.hubId ?? null,
    // I legami sono per id e restano anche se la nota puntata non e' ancora stata letta:
    // resolverli al secondo passaggio e' la differenza fra un file spostato che si
    // ricolloca e un file che perde meta' dei suoi riferimenti appena lo si sposta.
    links: note.links.filter((link) => link.length > 0),
    color: existing?.color ?? 'default',
    position: hub
      ? hubShellPoint(hub, knowledge.entries.filter((entry) => entry.hubId === hub.id).length, id)
      : existing?.position ?? { x: 0, y: 0, z: 0 },
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    placedBecause: hub
      ? `under "${hub.title}"`
      : existing?.placedBecause ?? 'read from the vault',
  }
}