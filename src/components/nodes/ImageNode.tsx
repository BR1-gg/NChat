import { FileImage, Film, ImageOff, Trash2, Upload } from 'lucide-react'
import { memo, useRef } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { askAboutImage, buildImageData } from '../../actions/imageActions'
import { useNodeData, useNodeHasExplicitSize } from '../../hooks/useNodeData'
import { estimateImageTokens } from '../../llm/tokens'
import { checkMediaFile, formatBytes } from '../../logic/media'
import { useUiStore } from '../../store/uiStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import type { ImageNode as ImageNodeType, ImageNodeData } from '../../types/document'
import { Button, IconButton } from '../common/Button'
import { NodeShell } from './NodeShell'

export const ImageNode = memo(function ImageNode({
  id,
  selected,
}: NodeProps<ImageNodeType>) {
  const hasExplicitSize = useNodeHasExplicitSize(id)
  const data = useNodeData<ImageNodeData>(id, 'image')
  const fileRef = useRef<HTMLInputElement>(null)
  /*
   * Due cose, e non una per disattenzione.
   *
   * `state` e' lo stato con le azioni gia' srotolate: ci si scrive e basta, e lo si
   * fa una volta per gesto, quindi nessun problema a perderlo fra un render e l'altro.
   *
   * `askAboutImage` prende invece lo **store**, perche' crea un nodo e poi un
   * collegamento in due tempi e non puo' funzionare con uno stato. Passargli
   * `state` romperebbe proprio al secondo passo, con la meta' del lavoro fatta.
   */
  const state = useWorkspaceStore.getState()

  if (!data) return null

  /*
   * La domanda scritta sul nodo quando esisteva ancora quel campo, e nient'altro.
   *
   * Il campo non si propone piu' — «Ask about it» crea un prompt — ma una domanda
   * gia' scritta resta leggibile e cancellabile. Il motivo e' che il campo viaggia
   * nelle richieste: cancellarlo dal codice senza migrazione cambierebbe quello che il
   * modello riceve, in silenzio, e l'utente si troverebbe una risposta a una domanda
   * che non ha piu' scritto da nessuna parte.
   */
  const legacyCaption = (data.caption ?? '').trim()
  /** C'e' qualcosa che il modello possa guardare. Un video vale per il suo fotogramma. */
  const hasPicture = data.isVideo ? Boolean(data.posterSrc) : Boolean(data.src)

  const replace = async (file: File | undefined): Promise<void> => {
    if (!file) return
    const check = checkMediaFile(file)
    if (!check.ok) {
      useUiStore.getState().addToast({ tone: 'warning', title: check.message, message: check.hint })
      return
    }
    try {
      const built = await buildImageData(file)
      if (!built.data) return
      // Scritto sopra il nodo esistente: id, posizione e collegamenti restano.
      state.updateNodeData(id, { ...built.data })
      if (built.reduced) {
        useUiStore.getState().addToast({
          tone: 'info',
          title: `Image reduced to ${built.reduced.width}×${built.reduced.height}.`,
        })
      }
    } catch (error: unknown) {
      useUiStore.getState().addToast({
        tone: 'error',
        title: `${file.name} could not be loaded.`,
        message: error instanceof Error ? error.message : 'Unknown error.',
      })
    }
  }

  const tokenCost = estimateImageTokens(data.width, data.height)

  return (
    <NodeShell
      id={id}
      explicitSize={hasExplicitSize}
      nodeKind="image"
      icon={data.isVideo ? <Film size={12} /> : <FileImage size={12} />}
      title={data.title || data.name || 'Image'}
      subtitle={
        data.width > 0
          ? `${data.width}×${data.height}${data.isVideo ? ' · frame' : ''} · ${formatBytes(data.sizeBytes)}`
          : formatBytes(data.sizeBytes)
      }
      selected={selected}
      collapsed={data.collapsed === true}
      collapsedPreview={data.name}
      className="image-node"
      actions={
        <>
          <IconButton
            label="Replace the file"
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={11} />
          </IconButton>
          <IconButton
            label="Remove the image"
            danger
            onClick={() => state.removeNodes([id])}
          >
            <Trash2 size={11} />
          </IconButton>
        </>
      }
      footer={
        <>
          <span>
            {/* Un nodo vuoto non ha un costo da dire: "~0 tokens" sarebbe un numero
                inventato, e `tokenCost` a 0×0 non vuol dire che l'immagine e' gratis. */}
            {!data.src
              ? 'No image yet'
              : data.isVideo
                ? 'Video: one frame is sent to the model'
                : `~${tokenCost} tokens for the image`}
          </span>
          <div className="node-footer-actions">
            <Button size="small" onClick={() => fileRef.current?.click()}>
              {data.src ? 'Replace' : 'Choose image'}
            </Button>
            {/*
              Il bottone che sostituisce il campo «Ask about it».

              Non crea niente di speciale: crea un **prompt normale** e ci collega
              l'immagine con un bordo normale. E' perche' il collegamento resta
              facoltativo — non c'e' un interruttore da disattivare, perche' la strada
              corta e quella lunga sono lo stesso oggetto: se il prompt non serve si
              cancella lui e il bordo viene via con lui, e se ne vuoi un altro lo
              colleghi a mano come prima.
            */}
            <Button
              size="small"
              disabled={!hasPicture}
              title={
                hasPicture
                  ? 'Create a prompt and send this image to it'
                  : 'Load a picture first — there would be nothing for the model to look at'
              }
              onClick={() => {
                const result = askAboutImage(id, useWorkspaceStore)
                if (result.refused) {
                  useUiStore.getState().addToast({ tone: 'info', title: result.refused })
                }
              }}
            >
              Ask about it
            </Button>
          </div>
        </>
      }
    >
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        className="handle-image"
        aria-label="Send this image to a prompt"
      />
      <div className="image-body">
        {/*
          Un nodo immagine vuoto non mostra un `<img>` senza sorgente.

          Prima lo mostrava, e insieme a lui due frasi lunghe in `.image-notes`. Il
          nodo e' posizionato in modo assoluto e senza larghezza fissa, quindi la sua
          larghezza la decide il contenuto piu' largo: in un contenuto che si adatta,
          la larghezza massima di un paragrafo e' la frase **senza a capo**. Il
          risultato era un nodo vuoto largo quanto "Connect to a prompt's image input
          to send it with the question." su una riga sola — cioe' il nodo piu' largo
          della tela, per non contenere niente.

          Qui diventa un riquadro tratteggiato come `FileNode`, che e' gia' il modo in
          cui questo progetto dice "manca qualcosa": due parole, un'icona, un bottone.
        */}
        {!data.src ? (
          <div className="image-empty">
            <ImageOff size={16} />
            <p>Drop a picture here.</p>
            <Button size="small" onClick={() => fileRef.current?.click()}>
              Choose image
            </Button>
          </div>
        ) : data.isVideo ? (
          <>
            {/* The video itself is kept so the node is a usable player; what goes
                to the model is the poster frame, and the footer says so. */}
            <video className="image-preview" src={data.src} controls preload="metadata" />
            {data.posterSrc ? (
              <p className="image-note">
                Sent to the model: one frame grabbed from the clip. No chat model accepts
                video.
              </p>
            ) : null}
          </>
        ) : (
          <img className="image-preview" src={data.src} alt={data.name} />
        )}
        {/*
          Una domanda **vecchia**, scritta qui quando il campo esisteva ancora.

          Si mostra solo se c'e' gia', e per una ragione precisa: una domanda che non si
          vede e non si puo' cancellare e' peggio di una che non e' mai stata scritta.
          L'utente saprebbe che il modello riceve qualcosa che lui non trova, e non
          avrebbe modo di toglierlo.

          Non se ne propongono di nuove — il bottone «Ask about it» crea un prompt e ci
          collega l'immagine, e li' la domanda si scrive. Questo campo e' solo la
          porta attraverso cui uscire da quello che e' gia' stato scritto.
        */}
        {legacyCaption ? (
          <label className="image-caption is-legacy">
            <span>Question on the image node</span>
            <textarea
              value={legacyCaption}
              rows={2}
              onChange={(event) =>
                state.updateNodeData(id, { caption: event.currentTarget.value })
              }
            />
            <p className="image-note">
              Written before prompts could be attached here. It still travels with the
              image. Use “Ask about it” to put the question in a prompt instead.
            </p>
          </label>
        ) : null}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          void replace(file)
        }}
      />
      <span className="visually-hidden">
        {data.isVideo ? 'Video' : 'Image'} {data.name}, {data.width} by {data.height} pixels
      </span>
    </NodeShell>
  )
})
