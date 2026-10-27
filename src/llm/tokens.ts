import type { ChatContentPart, ChatMessage } from './types'

export const estimateTokens = (text: string): number => Math.ceil(text.length / 4)

/** The text of a message, whichever form its content takes. */
export function messageText(message: ChatMessage): string {
  if (typeof message.content === 'string') return message.content
  return message.content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
}

/**
 * Token estimate for one message.
 *
 * An image has no text, so charging it the length of its data URL would be
 * nonsense. Vision models bill an image by its dimensions, not its bytes, and
 * the widely used approximation is roughly `width * height / 750` tokens for a
 * modern tiling scheme. The point of the estimate is to warn before a request is
 * sent, so being roughly right is enough; the note is why it is not exact.
 */
export function estimateImageTokens(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 0
  return Math.ceil((width * height) / 750)
}

export const estimateMessageTokens = (message: ChatMessage): number => {
  if (typeof message.content === 'string') return estimateTokens(message.content)
  let total = 0
  for (const part of message.content as ChatContentPart[]) {
    if (part.type === 'text') total += estimateTokens(part.text)
    else {
      const size = imageSizeFromDataUrl(part.image_url.url)
      total += estimateImageTokens(size.width, size.height)
    }
  }
  return total
}

export const estimateMessages = (messages: readonly ChatMessage[]): number =>
  messages.reduce((sum, message) => sum + estimateMessageTokens(message) + 4, 3)

/**
 * Reads the pixel size out of an image data URL without decoding it. PNG and
 * JPEG both carry their dimensions in the first bytes of the file, which is why
 * this works on the string that is about to be sent rather than on a decoded
 * image. Returns zeroes for anything it cannot read, which makes the token
 * estimate degrade to "text only" instead of lying.
 */
export function imageSizeFromDataUrl(url: string): { width: number; height: number } {
  const marker = url.indexOf('base64,')
  if (marker < 0) return { width: 0, height: 0 }
  const base64 = url.slice(marker + 'base64,'.length, marker + 'base64,'.length + 64)
  try {
    const binary = atob(base64)
    // PNG: bytes 16..24 are the width and height, big-endian.
    if (binary.charCodeAt(1) === 0x50 && binary.charCodeAt(2) === 0x4e && binary.charCodeAt(3) === 0x47) {
      const width =
        charCodeAt(binary, 16) * 0x1000000 +
        charCodeAt(binary, 17) * 0x10000 +
        charCodeAt(binary, 18) * 0x100 +
        charCodeAt(binary, 19)
      const height =
        charCodeAt(binary, 20) * 0x1000000 +
        charCodeAt(binary, 21) * 0x10000 +
        charCodeAt(binary, 22) * 0x100 +
        charCodeAt(binary, 23)
      return { width, height }
    }
    // JPEG: walk the segment markers to the start-of-frame, which holds the size.
    let offset = 2
    while (offset < binary.length - 9) {
      if (binary.charCodeAt(offset) !== 0xff) {
        offset += 1
        continue
      }
      const marker = binary.charCodeAt(offset + 1)
      const length = charCodeAt(binary, offset + 2) * 256 + charCodeAt(binary, offset + 3)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return {
          height: charCodeAt(binary, offset + 5) * 256 + charCodeAt(binary, offset + 6),
          width: charCodeAt(binary, offset + 7) * 256 + charCodeAt(binary, offset + 8),
        }
      }
      offset += 2 + length
    }
  } catch {
    return { width: 0, height: 0 }
  }
  return { width: 0, height: 0 }
}

function charCodeAt(binary: string, index: number): number {
  return index < binary.length ? binary.charCodeAt(index) : 0
}
