/**
 * Rules for what an image or video node may hold.
 *
 * The bytes go into the document as a data URL, which is what keeps export,
 * import, copy and paste working with no extra machinery. The cost is document
 * size, so the limits live here as pure functions and are asserted by tests:
 * the decision "this file is too big, and here is the number" must not depend on
 * a canvas being available.
 */

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif'
export const VIDEO_ACCEPT = 'video/mp4,video/webm,video/quicktime'

/** Formats a browser can decode into a canvas, which downscaling needs. */
const DECODABLE = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/avif',
])

/**
 * Longest side kept when an image is downscaled. A vision model resizes anyway,
 * and a 4000px photo becomes a data URL several times larger for no gain in the
 * answer. 1600 is comfortably above what the model will use.
 */
export const MAX_IMAGE_EDGE = 1600

/**
 * Hard ceiling on the encoded size of an image node. A data URL is roughly 4/3
 * of the binary, and IndexedDB is per-origin quota, so an unbounded image would
 * quietly eat the workspace's storage.
 */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024

/**
 * Videos are only ever sent as one frame, so the file itself is the only reason
 * to cap it. Kept low on purpose: past this the node is more likely to break a
 * workspace than to be useful.
 */
export const MAX_VIDEO_BYTES = 12 * 1024 * 1024

export type MediaKind = 'image' | 'video' | 'unsupported'

export function mediaKindOf(file: { type: string }): MediaKind {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  return 'unsupported'
}

export function isDecodable(mediaType: string): boolean {
  return DECODABLE.has(mediaType)
}

/** The byte ceiling for a kind, or null when the kind is not supported. */
export function byteLimitFor(kind: MediaKind): number | null {
  if (kind === 'image') return MAX_IMAGE_BYTES
  if (kind === 'video') return MAX_VIDEO_BYTES
  return null
}

export interface MediaRejection {
  ok: false
  reason: 'unsupported' | 'too-large' | 'empty'
  message: string
  hint?: string
}

export type MediaCheck = { ok: true; kind: 'image' | 'video' } | MediaRejection

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Decides whether a dropped file can become a node, and says why not when it
 * cannot. Refusing with a number the user can check beats a silent failure or a
 * workspace that stops saving halfway.
 */
export function checkMediaFile(file: { type: string; size: number; name: string }): MediaCheck {
  const kind = mediaKindOf(file)
  if (kind === 'unsupported') {
    return {
      ok: false,
      reason: 'unsupported',
      message: `${file.name} is not an image or a video.`,
      hint: `Supported: ${IMAGE_ACCEPT.replace(/image\//g, '').replace(/,/g, ', ')} and ${VIDEO_ACCEPT
        .replace(/video\//g, '')
        .replace(/,/g, ', ')}.`,
    }
  }
  if (file.size === 0) {
    // Un file da zero byte passa il controllo del tipo ma non decodifica: senza
    // questo si creerebbe un nodo vuoto senza alcun avviso.
    return {
      ok: false,
      reason: 'empty',
      message: `${file.name} is empty.`,
      hint: 'The file could not be read; copy it again and drop it once more.',
    }
  }
  const limit = byteLimitFor(kind)
  if (limit !== null && file.size > limit) {
    return {
      ok: false,
      reason: 'too-large',
      message: `${file.name} is ${formatBytes(file.size)}; the limit is ${formatBytes(limit)}.`,
      hint:
        kind === 'image'
          ? 'Shrink the image, or crop it, and drop it again.'
          : 'A video is kept whole in the workspace. Use a shorter or smaller clip.',
    }
  }
  return { ok: true, kind }
}

/**
 * The size an image should be stored at: unchanged when it already fits inside
 * the cap, otherwise scaled down so the longest side is exactly `maxEdge`.
 * Never scales up, because a bigger copy of a small image helps nobody.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number = MAX_IMAGE_EDGE,
): { width: number; height: number; scale: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0, scale: 1 }
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height, scale: 1 }
  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  }
}
