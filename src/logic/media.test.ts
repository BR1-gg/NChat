import { describe, expect, it } from 'vitest'
import {
  byteLimitFor,
  checkMediaFile,
  fitWithin,
  formatBytes,
  isDecodable,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_EDGE,
  mediaKindOf,
} from './media'

/**
 * The bytes of a dropped image go into the document as a data URL. That is what
 * keeps export, import and copy working, and it is also why these limits are
 * asserted here rather than discovered when a workspace stops saving.
 */
describe('media classification', () => {
  it('recognises images and videos, and refuses anything else', () => {
    expect(mediaKindOf({ type: 'image/png' })).toBe('image')
    expect(mediaKindOf({ type: 'image/webp' })).toBe('image')
    expect(mediaKindOf({ type: 'video/mp4' })).toBe('video')
    expect(mediaKindOf({ type: 'application/pdf' })).toBe('unsupported')
    expect(mediaKindOf({ type: 'text/plain' })).toBe('unsupported')
  })

  it('knows which images it can actually resize', () => {
    expect(isDecodable('image/png')).toBe(true)
    expect(isDecodable('image/jpeg')).toBe(true)
    // Not decodable: kept as-is rather than wrongly re-encoded.
    expect(isDecodable('image/tiff')).toBe(false)
  })

  it('has a limit only for the kinds it accepts', () => {
    expect(byteLimitFor('image')).toBe(MAX_IMAGE_BYTES)
    expect(byteLimitFor('video')).not.toBeNull()
    expect(byteLimitFor('unsupported')).toBeNull()
  })
})

describe('checkMediaFile', () => {
  it('accepts an image inside the limit', () => {
    const result = checkMediaFile({ type: 'image/png', size: 1000, name: 'a.png' })
    expect(result).toEqual({ ok: true, kind: 'image' })
  })

  it('refuses an unsupported file and says what is supported', () => {
    const result = checkMediaFile({ type: 'application/pdf', size: 10, name: 'doc.pdf' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('unsupported')
      expect(result.hint).toContain('png')
    }
  })

  it('refuses an oversized image with the real numbers', () => {
    const result = checkMediaFile({ type: 'image/png', size: MAX_IMAGE_BYTES + 1, name: 'huge.png' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('too-large')
      expect(result.message).toContain('8.0 MB')
    }
  })

  it('accepts a file exactly at the limit', () => {
    expect(checkMediaFile({ type: 'image/png', size: MAX_IMAGE_BYTES, name: 'exact.png' }).ok).toBe(
      true,
    )
  })

  it('never reports ok for a zero-byte file without saying why', () => {
    // A zero-byte "image" decodes to nothing; the node would be silently empty.
    const result = checkMediaFile({ type: 'image/png', size: 0, name: 'empty.png' })
    expect(result.ok).toBe(false)
  })
})

describe('fitWithin', () => {
  it('leaves an image that already fits alone', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600, scale: 1 })
    expect(fitWithin(MAX_IMAGE_EDGE, 100)).toEqual({
      width: MAX_IMAGE_EDGE,
      height: 100,
      scale: 1,
    })
  })

  it('scales the longest side down to the cap and keeps the aspect ratio', () => {
    const fit = fitWithin(4000, 3000)
    expect(fit.width).toBe(MAX_IMAGE_EDGE)
    expect(fit.height).toBe(Math.round((3000 / 4000) * MAX_IMAGE_EDGE))
    expect(fit.scale).toBeLessThan(1)
  })

  it('handles a portrait image by capping the height instead', () => {
    const fit = fitWithin(1000, 5000)
    expect(fit.height).toBe(MAX_IMAGE_EDGE)
    expect(fit.width).toBe(Math.round((1000 / 5000) * MAX_IMAGE_EDGE))
  })

  it('never produces a zero side', () => {
    const fit = fitWithin(10000, 1)
    expect(fit.width).toBeGreaterThanOrEqual(1)
    expect(fit.height).toBeGreaterThanOrEqual(1)
  })

  it('does not blow up on a zero-sized image', () => {
    expect(fitWithin(0, 0)).toEqual({ width: 0, height: 0, scale: 1 })
  })

  it('never scales a small image up', () => {
    expect(fitWithin(50, 40, 1600).scale).toBe(1)
  })
})

describe('formatBytes', () => {
  it('is readable at every scale', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})
