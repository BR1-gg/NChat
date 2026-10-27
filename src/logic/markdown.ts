export function isSafeLink(href: string | undefined): boolean {
  if (!href) return false
  const normalized = href.trim().toLowerCase()
  return (
    normalized.startsWith('http://') ||
    normalized.startsWith('https://') ||
    normalized.startsWith('mailto:')
  )
}

export function languageFromClassName(className: string | undefined): string {
  if (!className) return ''
  const match = /language-([\w-]+)/.exec(className)
  return match?.[1] ?? ''
}
