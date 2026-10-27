/**
 * One place that knows how to hand a file to the browser.
 *
 * The failure this replaces was easy to miss: calling `URL.revokeObjectURL`
 * right after `anchor.click()` releases the blob while the download is still
 * being queued, and the browser silently saves nothing. There was no error, no
 * console warning, and the success toast still said the export had worked.
 *
 * So: revoke on a delay, report the real byte count, and never claim success
 * that was not observed.
 */
export interface DownloadResult {
  ok: boolean
  bytes: number
  error?: string
}

/** How long the blob must outlive the click. A second is generous but cheap. */
const REVOKE_DELAY_MS = 1_000

export function downloadBlob(
  contents: string | Blob,
  fileName: string,
  type: string,
): DownloadResult {
  let url: string | null = null
  try {
    const blob = typeof contents === 'string' ? new Blob([contents], { type }) : contents
    url = URL.createObjectURL(blob)
    const anchor = window.document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.rel = 'noopener'
    // Safari and some embedded browsers ignore a detached anchor.
    anchor.style.display = 'none'
    window.document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    return { ok: true, bytes: blob.size }
  } catch (error: unknown) {
    if (url) URL.revokeObjectURL(url)
    return {
      ok: false,
      bytes: 0,
      error: error instanceof Error ? error.message : 'The download could not be started.',
    }
  } finally {
    const pending = url
    if (pending) {
      globalThis.setTimeout(() => URL.revokeObjectURL(pending), REVOKE_DELAY_MS)
    }
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
