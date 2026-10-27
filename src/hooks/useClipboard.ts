import { useEffect } from 'react'
import { copySelection, cutSelection, pasteAt } from '../actions/clipboardActions'
import { hasClipboardContent, readClipboardContents } from '../logic/pastedFiles'
import { useWorkspaceStoreApi } from '../store/workspaceStore'

/**
 * Wires the browser copy/cut/paste events. DOM events are used instead of
 * keydown so the system clipboard is respected and the browser menu works.
 * Handlers stay out of text fields so ordinary text copy/paste still works.
 *
 * La paste si legge **dall'evento**, e non da `navigator.clipboard.readText()`.
 *
 * Il motivo e' che `readText()` vede solo il testo, e su un'immagine degli appunti
 * di Windows restituisce la stringa vuota — non un errore, la stringa vuota. La
 * paste finiva sul ramo del testo, la condizione `if (!text.trim())` non passava, e
 * non succedeva niente: nessun nodo, nessun messaggio, niente nel registro. Il
 * sintomo era l'assenza di un effetto, che e' il difetto piu' difficile da
 * diagnosticare in un'applicazione, perche' l'utente vede solo che qualcosa non e'
 * successo e non ha niente su cui ragionare.
 *
 * L'evento porta anche i **file**, che `readText()` non puo' vedere: e da li' che
 * arrivano una schermata e i file copiati in Gestione File. E porta i file in modo
 * **sincrono**, che e' quello che permette a `preventDefault()` di arrivare in tempo:
 * con `await readText()` la chiamata al browser era gia' partita e il paste finiva
 * anche nel documento.
 */
export function useClipboard(): void {
  const store = useWorkspaceStoreApi()

  useEffect(() => {
    const editable = (target: EventTarget | null): boolean =>
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)

    const onCopy = (event: ClipboardEvent): void => {
      if (editable(event.target)) return
      void copySelection(store).then((copied) => {
        if (copied) event.preventDefault()
      })
    }
    const onCut = (event: ClipboardEvent): void => {
      if (editable(event.target)) return
      if (cutSelection(store)) event.preventDefault()
    }
    const onPaste = (event: ClipboardEvent): void => {
      if (editable(event.target)) return
      /*
       * Si impedisce il comportamento predefinito **subito**, e in base al solo fatto
       * che ci sia qualcosa. Aspettare la promise per decidere sarebbe troppo tardi:
       * a quel punto il browser ha gia' incollato, e in un'app a tela intera non c'e'
       * un campo su cui il testo sia finito — quindi sparisce senza che nessuno lo
       * veda. Meglio impedire e poi, se la nostra paste non produce nulla, non
       * succede niente: due cose che non si vedono invece di una che sparisce.
       */
      const contents = readClipboardContents(event.clipboardData)
      if (!hasClipboardContent(contents)) return
      event.preventDefault()
      void pasteAt({ x: 0, y: 0 }, store, undefined, contents)
    }
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCut)
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCut)
      document.removeEventListener('paste', onPaste)
    }
  }, [store])
}
