import { useEffect } from 'react'
import { runPrompt } from '../actions/runPrompt'
import { runSelectionTopologically } from '../actions/runSelection'
import { applyAutoLayout, exportWorkspace, forceSave } from '../actions/workspaceIO'
import { useUiStore } from '../store/uiStore'
import { useRunStore } from '../store/runStore'
import { useWorkspaceStore } from '../store/workspaceStore'

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

/**
 * Undoes or redoes one step and says which one, in words.
 *
 * It refuses while a request is streaming. The answer is being written into the
 * store token by token at that moment, so undoing would restore a text the run
 * has already replaced: the canvas would flicker and the next chunk would undo it
 * again. Saying so beats a shortcut that appears broken.
 */
function runHistory(redo: boolean): string | null {
  const workspace = useWorkspaceStore.getState()
  if (Object.keys(useRunStore.getState().runs).length > 0) {
    useUiStore.getState().addToast({
      tone: 'info',
      title: 'Wait for the answer to finish.',
      message: 'Undo is paused while the model is writing.',
    })
    return null
  }
  const label = redo ? workspace.redo() : workspace.undo()
  if (!label) {
    useUiStore.getState().addToast({
      tone: 'info',
      title: redo ? 'Nothing to redo.' : 'Nothing to undo.',
    })
    return null
  }
  useUiStore.getState().addToast({
    tone: 'info',
    title: `${redo ? 'Redone' : 'Undone'}: ${label}.`,
  })
  return label
}

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const mod = event.ctrlKey || event.metaKey
      const editable = isEditableTarget(event.target)
      const ui = useUiStore.getState()

      if (event.key === 'Escape') {
        /*
         * Una catena, dal piu' in alto al piu' in basso, e la ricerca va **prima** della
         * palette: e' l'unica delle due che sta sopra a tutto il resto, e se chiudesse
         * la palette mentre la ricerca era aperta l'utente si troverebbe con la ricerca
         * ancora li' e la palette sparita — cioe' Escape che ha fatto due cose diverse
         * dallo stesso tasto.
         */
        if (ui.confirm) ui.closeConfirm()
        else if (ui.searchOpen) ui.closeSearch()
        else if (ui.dialog) ui.closeDialog()
        else if (ui.paletteOpen) ui.closePalette()
        else if (ui.contextMenu) ui.setContextMenu(null)
        else if (ui.topMenuOpen) ui.setTopMenuOpen(false)
        event.preventDefault()
        return
      }

      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault()
        forceSave(true)
        return
      }
      // Undo e redo stanno **prima** del filtro sugli elementi editabili: se il
      // cursore e in un campo di testo, Ctrl+Z deve restare l'undo del browser
      // su quel testo, non diventare un passo della cronologia del documento.
      if (mod && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) {
        if (editable) return
        const redo = event.shiftKey || event.key.toLowerCase() === 'y'
        const label = runHistory(redo)
        if (label) event.preventDefault()
        return
      }
      if (editable) return

      if (mod && event.key === 'Enter') {
        const workspace = useWorkspaceStore.getState()
        const multiPrompts = workspace.nodes
          .filter((candidate) => candidate.selected && candidate.data.kind === 'prompt')
          .map((candidate) => candidate.id)
        if (multiPrompts.length > 1) {
          void runSelectionTopologically(multiPrompts)
          event.preventDefault()
          return
        }
        const selected = useUiStore.getState().selectedNodeId
        if (selected) {
          const node = workspace.nodes.find((candidate) => candidate.id === selected)
          if (node?.data.kind === 'prompt') void runPrompt(selected)
        }
        event.preventDefault()
        return
      }
      /*
       * `Ctrl+K` e' la **ricerca**, e non la palette.
       *
       * Era la palette, e per un tempo sono state entrambe: lo stesso tasto in due
       * gestori diversi, quindi una pressione apriva la ricerca e la palette insieme.
       * Due finestre che si aprono dallo stesso tasto sono il caso peggiore — non si
       * sa quale delle due sia quella che l'utente sta guardando, e quella sotto
       * ruba i tasti a quella sopra.
       *
       * Adesso il tasto e' uno solo e la palette sta su `Tab`, che resta il suo posto
       * naturale: `Tab` per aggiungere, `Ctrl+K` per trovare. Sono due azioni diverse
       * e si confondono facilmente, quindi tengono tasti diversi.
       *
       * Va intercettato anche quando la ricerca e' **gia' aperta**, per chiuderla —
       * come fa Spotlight. Altrimenti una seconda pressione azzererebbe la casella
       * mentre l'utente sta ancora scrivendo, e sembrerebbe che la barra abbia
       * dimenticato cosa aveva trovato.
       */
      if (mod && event.key.toLowerCase() === 'k') {
        if (ui.searchOpen) ui.closeSearch()
        else ui.openSearch()
        event.preventDefault()
        return
      }
      if (mod && event.key.toLowerCase() === 'e') {
        event.preventDefault()
        exportWorkspace()
        return
      }
      if (mod && event.key.toLowerCase() === 'd') {
        const workspace = useWorkspaceStore.getState()
        for (const node of workspace.nodes.filter((candidate) => candidate.selected)) {
          workspace.duplicateNode(node.id)
        }
        event.preventDefault()
        return
      }
      if (mod && event.key === ',') {
        ui.openDialog('settings')
        event.preventDefault()
        return
      }
      if (event.key === 'Tab') {
        /*
         * `Tab` non e' un tasto con modificatore, quindi qui non c'e' il
         * `preventDefault` che fermerebbe i gestori. Va fermato a mano quando la
         * ricerca e' aperta.
         *
         * Senza, con la ricerca in campo `Tab` apriva la palette **sopra** di lei:
         * due finestra, e quella sotto si mangiava i tasti. Lo stesso vale per una
         * finestra di dialogo, che per definizione ha gia' tutto il posto.
         *
         * Il motivo e' che `Ctrl+K` e' gia' stato spostato dalla palette per non
         * avere due azioni sullo stesso tasto; lasciare anche `Tab` a passare
         * attraverso la ricerca avrebbe spostato il problema invece di risolverlo.
         */
        if (ui.searchOpen || ui.dialog || ui.confirm) return
        ui.openPalette()
        event.preventDefault()
        return
      }
      if (event.key.toLowerCase() === 'f') {
        window.dispatchEvent(new CustomEvent('nchat:fit-view'))
        event.preventDefault()
        return
      }
      if (event.key.toLowerCase() === 'a') {
        applyAutoLayout()
        window.dispatchEvent(new CustomEvent('nchat:layout-complete'))
        event.preventDefault()
        return
      }
      if (event.key === '1') {
        window.dispatchEvent(new CustomEvent('nchat:zoom-reset'))
        event.preventDefault()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const workspace = useWorkspaceStore.getState()
        const selectedNodes = workspace.nodes.filter((node) => node.selected)
        const selectedEdges = workspace.edges.filter((edge) => edge.selected)
        if (selectedNodes.length === 0 && selectedEdges.length === 0) return
        const promptWithChildren = selectedNodes.find(
          (node) =>
            node.data.kind === 'prompt' &&
            workspace.edges.some((edge) => edge.kind === 'run' && edge.source === node.id),
        )
        const remove = (): void => {
          workspace.removeNodes(selectedNodes.map((node) => node.id))
          for (const edge of selectedEdges) workspace.removeEdge(edge.id)
        }
        if (promptWithChildren) {
          ui.requestConfirm({
            title: 'Delete this prompt branch?',
            message: 'All response nodes created by the selected prompt will also be deleted.',
            confirmLabel: 'Delete branch',
            destructive: true,
            onConfirm: remove,
          })
        } else {
          remove()
        }
        event.preventDefault()
        return
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        const workspace = useWorkspaceStore.getState()
        const selected = workspace.nodes.filter((node) => node.selected)
        if (selected.length === 0) return
        const distance = event.shiftKey ? 32 : 8
        const positions = new Map(
          selected.map((node) => [
            node.id,
            {
              x: node.position.x + (event.key === 'ArrowRight' ? distance : event.key === 'ArrowLeft' ? -distance : 0),
              y: node.position.y + (event.key === 'ArrowDown' ? distance : event.key === 'ArrowUp' ? -distance : 0),
            },
          ]),
        )
        workspace.setNodePositions(positions)
        event.preventDefault()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
