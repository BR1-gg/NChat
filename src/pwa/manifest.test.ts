import { describe, expect, it } from 'vitest'

/**
 * The manifest is what makes the app installable as its own window.
 * Chromium requires exact members, so the requirements are asserted here rather
 * than discovered later as a button that never appears.
 */
// Read through Vite so the test needs no Node typings and no duplicated copy
// of the manifest: what is asserted here is exactly the file that is served.
const sources = import.meta.glob('../../public/manifest.webmanifest', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>
const raw = Object.values(sources)[0]
if (typeof raw !== 'string') {
  throw new Error('public/manifest.webmanifest is missing: the app would not be installable.')
}
const manifest = JSON.parse(raw) as {
  name?: string
  short_name?: string
  icons?: Array<{ src: string; sizes: string; purpose?: string; type?: string }>
  start_url?: string
  scope?: string
  display?: string
  display_override?: string[]
  prefer_related_applications?: boolean
  background_color?: string
  theme_color?: string
  shortcuts?: Array<{ name?: string; url?: string }>
}

describe('web app manifest', () => {
  it('has a name, so the window and the shortcut are labelled', () => {
    expect(manifest.name).toBeTruthy()
    expect(manifest.short_name).toBeTruthy()
    // A short name is what Windows puts under the icon; keep it icon-sized.
    expect((manifest.short_name ?? '').length).toBeLessThanOrEqual(12)
  })

  it('declares the 192 and 512 icons Chromium demands', () => {
    const sizes = (manifest.icons ?? []).map((icon) => icon.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
  })

  it('uses relative URLs, so the installed app follows the port it is served on', () => {
    // An absolute start_url would pin the installed window to the dev port
    // forever, even after moving to a production build.
    expect(manifest.start_url?.startsWith('/')).toBe(false)
    expect(manifest.start_url?.startsWith('.')).toBe(true)
    expect(manifest.scope?.startsWith('.')).toBe(true)
    for (const icon of manifest.icons ?? []) {
      expect(icon.src.startsWith('/')).toBe(false)
      expect(icon.src).not.toMatch(/^https?:/)
    }
  })

  it('opens without browser chrome and can fall back', () => {
    expect(manifest.display).toBe('standalone')
    expect(manifest.display_override).toContain('standalone')
    // Last resort must be a mode every browser understands.
    expect(manifest.display_override?.at(-1)).toBe('browser')
  })

  it('does not claim to be related to a native app', () => {
    expect(manifest.prefer_related_applications ?? false).toBe(false)
  })

  it('declares a maskable icon inside the safe zone', () => {
    const maskable = (manifest.icons ?? []).find((icon) => icon.purpose === 'maskable')
    expect(maskable).toBeDefined()
    // The maskable artwork is drawn at 56/64 of the canvas, well inside the
    // 80% circle Android and Windows crop to.
    expect(maskable?.sizes).toBe('512x512')
  })

  it('points the Home shortcut at the app itself', () => {
    const home = manifest.shortcuts?.find((entry) => entry.url === './#/')
    expect(home?.name).toBeTruthy()
  })

  it('uses colours that match the dark shell', () => {
    for (const color of [manifest.background_color, manifest.theme_color]) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})
