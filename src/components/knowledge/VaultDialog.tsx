import { useEffect, useState } from 'react'
import { FolderOpen, FolderPlus, RefreshCw, Save, Unlink } from 'lucide-react'
import { useVaultStore } from '../../store/knowledgeVault'
import { useKnowledgeStore } from '../../store/knowledgeStore'
import { useUiStore } from '../../store/uiStore'
import { Button } from '../common/Button'
import { Modal } from '../common/Modal'

/**
 * Il deposito: la cartella del computer in cui l'archivio viene scritto come file.
 *
 * Una nota per file, in markdown, con dentro quello che non si vede guardando il testo — il
 * punto di contesto e i collegamenti. E' il motivo per cui la finestra si chiama cosi': non e'
 * un'copia di sicurezza nascosta in un posto che non si conosce, e' **l'archivio in forma di
 * file**. Si puo' aprire con un editor, spostare in un'altra cartella, mettere su una chiavetta
 * e trovare con la ricerca del sistema.
 *
 * Percio' il pulsante principale dice «scegli la cartella» e non «esporta»: l'archivio non
 * esce da qui, cambia forma. Ed esportare — che e' un'operazione diversa e con un costo
 * diverso — non c'e', perche' un secondo posto dove finirebbero le stesse note e' il primo
 * passo di un archivio che non si sa piu' qual e' l'ultimo.
 *
 * Il pulsante di lettura esiste per il caso vero: si sono spostati dei file a mano nella
 * cartella, o si e' cambiato computer e la cartella e' gia' piena. E dice **quante** ne ha
 * presi, perche' un pulsante che funziona e non dice niente sembra rotto, e quello che
 * sembra rotto viene premuto di nuovo.
 */
export function VaultDialog({ onClose }: { onClose: () => void }) {
  const path = useVaultStore((state) => state.path)
  const status = useVaultStore((state) => state.status)
  const message = useVaultStore((state) => state.message)
  const writtenAt = useVaultStore((state) => state.writtenAt)
  const noteCount = useVaultStore((state) => state.noteCount)
  const busy = useVaultStore((state) => state.busy)
  const refresh = useVaultStore((state) => state.refresh)
  const choose = useVaultStore((state) => state.choose)
  const forget = useVaultStore((state) => state.forget)
  const write = useVaultStore((state) => state.write)
  const read = useVaultStore((state) => state.read)
  const entries = useKnowledgeStore((state) => state.entries)
  const [report, setReport] = useState<string | null>(null)

  useEffect(() => {
    void refresh()
  }, [refresh])

  function say(text: string): void {
    setReport(text)
  }

  return (
    <Modal
      title="Where your notes are stored"
      onClose={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <p className="save-note-where">
        Choose a folder and every note is written there as a{' '}
        <strong>markdown file</strong> — one per note, named after its title. You can open
        them in any editor, move them anywhere, and they will still be here when you come
        back.
      </p>

      <div className="vault-where">
        <span className="vault-where-label">Folder</span>
        <span className="vault-where-path">
          {path ?? 'No folder chosen yet'}
        </span>
      </div>

      {/*
        Il numero di note scritte e' la prova che il deposito funziona, e sta li' perche' e'
        l'unica informazione che distingue «ho scelto la cartella» da «i file ci sono». Senza,
        l'unica prova e' aprire il file manager — e il sospetto che il pulsante non abbia
        fatto niente arriva prima.
      */}
      {writtenAt !== null ? (
        <p className="vault-where-saved">
          {noteCount} {noteCount === 1 ? 'file' : 'files'} written, last on{' '}
          {new Date(writtenAt).toLocaleString()}.
        </p>
      ) : null}

      {message ? <p className="vault-where-error">{message}</p> : null}
      {report ? <p className="vault-where-report">{report}</p> : null}
      {status === 'unsupported' ? (
        <p className="vault-where-error">
          This browser cannot save into a folder you choose. The notes are still kept inside
          the app, so nothing is lost — they just will not be files you can move.
        </p>
      ) : null}

      <div className="vault-where-actions">
        <Button
          size="small"
          icon={path ? <FolderOpen size={12} /> : <FolderPlus size={12} />}
          disabled={busy || status === 'unsupported'}
          onClick={() => void choose()}
        >
          {path ? 'Change folder' : 'Choose folder…'}
        </Button>
        <Button
          size="small"
          icon={<Save size={12} />}
          disabled={busy || !path}
          onClick={() => {
            void write().then((result) => {
              say(result ? `Wrote ${result.written} files.` : 'Nothing was written.')
            })
          }}
        >
          Write now
        </Button>
        <Button
          size="small"
          icon={<RefreshCw size={12} />}
          disabled={busy || !path}
          onClick={() => {
            void read().then((result) => {
              /*
               * Il messaggio conta **anche quando non e' successo niente**, e dice il numero.
               * Un pulsante che funziona e resta zitto sembra rotto, e quello che sembra
               * rotto viene premuto tre volte: ogni pressione rilegge tutta la cartella, e
               * su un archivio grande e' lavoro buttato.
               */
              say(
                result
                  ? `${result.added} new, ${result.updated} changed.`
                  : 'Nothing was read from the folder.',
              )
            })
          }}
        >
          Read from folder
        </Button>
        {path ? (
          <Button
            size="small"
            variant="danger"
            icon={<Unlink size={12} />}
            disabled={busy}
            onClick={() => {
              /*
               * Dimenticare la cartella **non cancella i file**, e la conferma lo dice.
               *
               * Il pulsante genera paura e la paura fa evitare il gesto giusto: con un
               * «cancella tutto quello che c'è dentro» senza spiegare che dentro non c'e'
               * niente che sparisca col collegamento, l'unica cosa che l'utente fa e' non
               * premere. Il testo dice una riga sola — i file restano — e la domanda resta
               * una domanda semplice, con una risposta che si puo' dare senza paura.
               */
              useUiStore.getState().requestConfirm({
                title: 'Stop writing to this folder?',
                message: `Nothing is deleted. "${path}" stays exactly as it is, with your notes in it, and NCHAT stops writing there. You can choose it again later, and the notes are still here in the app either way.`,
                confirmLabel: 'Stop using this folder',
                destructive: true,
                onConfirm: () => {
                  void forget()
                  say('The files were left where they were.')
                },
              })
            }}
          >
            Stop using it
          </Button>
        ) : null}
      </div>

      <p className="vault-where-note">
        {entries.length} {entries.length === 1 ? 'note' : 'notes'} in the archive right now.
        Nothing here deletes a note, and nothing here is required for the notes to be safe —
        the folder is a second copy that happens to be readable without this app.
      </p>
    </Modal>
  )
}