import { connectNodes } from './connectNodes'
import { getActiveWorkspaceStore, type WorkspaceStoreApi } from '../store/workspaceStore'
import { useUiStore } from '../store/uiStore'
import type { ImageNodeData } from '../types/document'
import {
  checkMediaFile,
  fitWithin,
  formatBytes,
  isDecodable,
} from '../logic/media'

/**
 * Turns a dropped file into an image node.
 *
 * Two things happen here that the node itself must not do: the bytes are read
 * once, and an image is downscaled before it is stored. Downscaling on the way
 * in is what keeps a workspace small enough to keep saving.
 */

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'))
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('The image could not be decoded.'))
    image.src = src
  })
}

function drawToDataUrl(
  source: CanvasImageSource,
  width: number,
  height: number,
  type: string,
): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot resize images (no 2D canvas).')
  context.drawImage(source, 0, 0, width, height)
  return canvas.toDataURL(type, 0.92)
}

/**
 * Grabs a representative frame from a video. No chat model accepts a video, so
 * this frame is what will actually be sent; the node labels it as such instead of
 * pretending the model saw the clip.
 */
function grabPosterFrame(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    const cleanup = (): void => {
      URL.revokeObjectURL(url)
      video.removeAttribute('src')
    }
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    video.onerror = () => {
      cleanup()
      reject(new Error('This video format could not be read by the browser.'))
    }
    video.onloadeddata = () => {
      try {
        // A frame a little way in: the first frame of a clip is often black.
        video.currentTime = Math.min(0.5, (video.duration || 1) / 4)
      } catch {
        resolve('')
        cleanup()
      }
    }
    video.onseeked = () => {
      try {
        const width = video.videoWidth
        const height = video.videoHeight
        if (!width || !height) throw new Error('The video has no visible frame.')
        const fit = fitWithin(width, height)
        resolve(drawToDataUrl(video, fit.width, fit.height, 'image/jpeg'))
      } catch (error) {
        reject(error instanceof Error ? error : new Error('The video frame could not be read.'))
      } finally {
        cleanup()
      }
    }
    video.src = url
  })
}

export interface BuildImageResult {
  data?: ImageNodeData
  reduced?: { width: number; height: number }
  error?: string
}

/**
 * Reads a file into node data, downscaling an image on the way in.
 *
 * Separate from node creation so "replace the file" can reuse it: the node keeps
 * its id, its position and its edges instead of being deleted and rebuilt.
 */
export async function buildImageData(file: File): Promise<BuildImageResult> {
  const dataUrl = await readAsDataUrl(file)
  let src = dataUrl
  let posterSrc: string | undefined
  let width = 0
  let height = 0
  let reduced: { width: number; height: number } | undefined

  if (file.type.startsWith('video/')) {
    posterSrc = await grabPosterFrame(file)
    if (posterSrc) {
      const size = await loadImage(posterSrc)
      width = size.width
      height = size.height
    }
  } else {
    const decoded = await decodeToImageElement(dataUrl)
    const fit = fitWithin(decoded.naturalWidth, decoded.naturalHeight)
    if (fit.scale < 1 && isDecodable(file.type)) {
      // Re-encode as JPEG: a downscaled photo is far smaller that way, and the
      // model never sees the difference.
      src = drawToDataUrl(decoded, fit.width, fit.height, 'image/jpeg')
      reduced = { width: fit.width, height: fit.height }
    }
    width = fit.width
    height = fit.height
  }

  return {
    data: {
      kind: 'image',
      name: file.name,
      mediaType: file.type,
      isVideo: file.type.startsWith('video/'),
      src,
      ...(posterSrc ? { posterSrc } : {}),
      width,
      height,
      sizeBytes: file.size,
    },
    ...(reduced ? { reduced } : {}),
  }
}

export interface CreateImageResult {
  nodeId?: string
  rejected?: boolean
}

/**
 * How far to the right of the image the new prompt lands.
 *
 * Abbastanza da non finire **sopra** l'immagine: il prompt e' piu' largo di lei, e se
 * nascesse nella stessa x coprirebbe la foto, che e' la cosa che si sta per guardare.
 * Senza questo la domanda nascerebbe sopra la risposta, e si leggerebbe come un
 * errore di posizione.
 */
const PROMPT_GAP = 360

export async function createImageNodeFromFile(
  file: File,
  position: { x: number; y: number },
  store: WorkspaceStoreApi = getActiveWorkspaceStore(),
): Promise<CreateImageResult> {
  const ui = useUiStore.getState()
  const check = checkMediaFile(file)
  if (!check.ok) {
    ui.addToast({ tone: 'warning', title: check.message, message: check.hint })
    return { rejected: true }
  }

  try {
    const built = await buildImageData(file)
    if (!built.data) {
      ui.addToast({ tone: 'error', title: `${file.name} could not be read.` })
      return { rejected: true }
    }
    const nodeId = store.getState().addNode('image', position, built.data)
    useUiStore.getState().setSelectedNode(nodeId)
    if (built.reduced) {
      useUiStore.getState().addToast({
        tone: 'info',
        title: `Image reduced to ${built.reduced.width}×${built.reduced.height}.`,
        message: `A vision model resizes it anyway; the original ${formatBytes(file.size)} was not stored.`,
      })
    }
    return { nodeId }
  } catch (error: unknown) {
    ui.addToast({
      tone: 'error',
      title: `${file.name} could not be loaded.`,
      message: error instanceof Error ? error.message : 'Unknown error.',
    })
    return { rejected: true }
  }
}

/**
 * Creates a prompt next to an image and wires the image into it.
 *
 * Il difetto che chiude: per chiedere qualcosa di un'immagine bisognava **trascinare
 * a mano** la maniglia del nodo immagine su un prompt, e su un grafo grande e' una
 * operazione da tre gesti su una maniglia di otto pixel. E la parte peggiore non era il
 * fastidio: era che la domanda non poteva essere scritta da nessuna parte finche' il
 * collegamento non c'era, quindi la domanda — che e' la parte difficile — dipendeva
 * da un gesto meccanico.
 *
 * Ora il bottone crea il prompt **e** lo collega, con la domanda da scrivere gia' li'
 * e il cursore che ci va: un gesto, e si scrive.
 *
 * Il collegamento che ne nasce e' un **bordo normale**, non un aggancio speciale: si
 * vede nella tela, si stacca, si ricolllega, si duplica, e si puo' anche collegare
 * la stessa immagine a un secondo prompt. E' esattamente perche' il collegamento e'
 * facoltativo: non c'e' niente di nascosto da disattivare, perche' la strada breve e
 * quella lunga sono lo stesso oggetto. Se il prompt creato non serve, si cancella lui e
 * il bordo viene via con lui.
 */
export function askAboutImage(
  imageId: string,
  store: WorkspaceStoreApi = getActiveWorkspaceStore(),
): { promptId?: string; refused?: string } {
  const state = store.getState()
  const image = state.nodes.find((node) => node.id === imageId)
  if (!image || image.data.kind !== 'image') return { refused: 'That node is not an image.' }

  /*
   * Senza immagine non c'e' niente da chiedere, e il prompt nascerebbe collegato a un
   * ingresso vuoto: il testo partirebbe senza la foto e il modello risponderebbe a
   * parole senza saperlo. Sarebbe la cosa peggiore — una risposta plausibile e falsa.
   * Meglio dirlo, e non creare niente.
   */
  const hasPicture = image.data.isVideo ? Boolean(image.data.posterSrc) : Boolean(image.data.src)
  if (!hasPicture) {
    return { refused: 'Load a picture first — there would be nothing for the model to look at.' }
  }

  const promptId = state.addNode('prompt', { x: image.position.x + PROMPT_GAP, y: image.position.y })
  const result = connectNodes({
    source: imageId,
    sourceHandle: 'out',
    target: promptId,
    targetHandle: 'image',
  })
  if (result) {
    // La regola ha rifiutato il collegamento: senza, il prompt sarebbe una domanda
    // senza immagine, e il modello risponderebbe a parole senza saperlo. Si rimuove
    // il prompt neonato, cosi' non resta un nodo muto. Non dovrebbe accadere — la
    // regola esiste e questa funzione le passa esattamente la connessione che la
    // soddisfa — ma un prompt senza immagine e' peggio di nessun prompt.
    store.getState().removeNodes([promptId])
    return { refused: result.message }
  }

  const ui = useUiStore.getState()
  ui.setSelectedNode(promptId)
  // Il fuoco va al **testo**, non al nodo: la domanda e' la parte difficile, e
  // mettere il cursore dentro e' la differenza fra «premere un bottone» e «premere un
  // bottone e poi un altro posto per scrivere».
  ui.setFocusNode(promptId)
  return { promptId }
}

function decodeToImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The image could not be decoded.'))
    image.src = src
  })
}
