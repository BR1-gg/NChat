/**
 * Where a file may be written, and where it may not.
 *
 * This module is the safety boundary for the Brain node, which writes real files
 * on the user's disk. Everything that decides a path goes through here, and
 * nothing else is allowed to build a path.
 *
 * The browser already gives one guarantee: a `FileSystemDirectoryHandle` can only
 * reach the directory the user picked. That is the outer wall, and it is the
 * reason this feature is possible at all. But it says nothing about the *name*
 * we write inside it, and a name is fully under our control: an output path comes
 * from a model's text, and a model will happily produce `../../notes.txt` or
 * `C:\Windows\...` if asked in the wrong way.
 *
 * So the rules here are deliberately strict and deliberately boring:
 *
 * - the output name is always a **single file name**, never a path. A model that
 *   returns a path gets the last segment and nothing else;
 * - a name may not be empty, `.`, `..`, a Windows reserved device name, or
 *   contain a path separator, a colon, a control character or a NUL;
 * - the character budget is small, because a file name longer than the limit is
 *   not something a person meant to write.
 *
 * Refusing is always better than sanitising here. A name we quietly rewrite to
 * `output_2.txt` when the model asked for `../../x.txt` hides the problem; a
 * refusal is visible and the file simply does not appear.
 */

/** Longest single file name accepted. NTFS allows 255, ext4 255. */
export const MAX_NAME_LENGTH = 120

/** Windows device names, which are files you cannot create. */
const RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
])

export type NameVerdict = { ok: true; name: string } | { ok: false; reason: string }

/** Anything that is not a plain file name, refused with the reason. */
function refuse(reason: string): NameVerdict {
  return { ok: false, reason }
}

/**
 * Accepts a single file name, or refuses.
 *
 * The input is whatever the model produced, so it is treated as hostile: it is
 * trimmed, checked, and returned only if nothing about it is surprising.
 */
export function safeFileName(raw: string): NameVerdict {
  const name = raw.trim()
  if (name === '') return refuse('The name is empty.')
  if (name.length > MAX_NAME_LENGTH) {
    return refuse(`The name is ${name.length} characters, over the ${MAX_NAME_LENGTH} limit.`)
  }
  if (name === '.' || name === '..') return refuse('The name is a directory reference, not a file.')
  if (name.includes('/') || name.includes('\\')) {
    return refuse('The name contains a path separator. Only a plain file name is allowed.')
  }
  if (name.includes(':')) {
    return refuse('The name contains a colon, which Windows reads as a drive or a stream.')
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    return refuse('The name contains a control character.')
  }
  // A trailing dot cannot be fixed without changing the name, and Windows strips
  // it silently, so it is refused. A trailing space was already removed by the
  // trim above: normalising a space is honest, rewriting a dot is not.
  if (name.endsWith('.')) {
    return refuse('The name ends with a dot, which Windows would strip.')
  }
  const stem = name.split('.')[0]?.toLowerCase() ?? ''
  if (RESERVED.has(stem)) return refuse(`"${name}" is a reserved device name on Windows.`)
  return { ok: true, name }
}

/**
 * The name to write, derived from an input name and the model's answer.
 *
 * The rule is deliberately un clever: **a single-line answer is a proposed name,
 * anything longer is content.** Guessing inside a multi-line answer is how a file
 * ends up called `Ecco il file:` or called after the first word of a paragraph.
 *
 * A path is accepted, because a model asked for a filename sometimes offers a
 * whole one and that is a reasonable thing to do; the leaf is taken and the
 * directory part is dropped, never followed. A path that tries to **escape** with
 * `..` is refused outright rather than quietly reduced to its last segment: that
 * shape means the model misunderstood the instruction, and writing a file called
 * `passwd` into the output folder would hide the misunderstanding instead of
 * showing it.
 */
export function outputNameFor(inputName: string, modelText: string): NameVerdict {
  const lines = modelText.split('\n').filter((line) => line.trim() !== '')
  if (lines.length === 1) {
    const proposed = lines[0]?.trim() ?? ''
    if (proposed !== '' && !isEscapingPath(proposed)) {
      const leaf = proposed.split(/[\\/]/).pop() ?? proposed
      const verdict = safeFileName(leaf)
      if (verdict.ok) return verdict
    }
  }
  return safeFileName(inputName)
}

/** True when a path tries to leave its directory, or names a device. */
function isEscapingPath(candidate: string): boolean {
  const parts = candidate.split(/[\\/]/)
  if (parts.some((part) => part === '..')) return true
  const leaf = parts.at(-1) ?? candidate
  return !safeFileName(leaf).ok
}

/**
 * A file name that cannot collide, used when overwriting is not allowed.
 *
 * `relazione.txt` becomes `relazione (1).txt`, then `relazione (2).txt`. The
 * number goes before the extension because that is where a person looks for it.
 */
export function uniqueName(preferred: string, taken: ReadonlySet<string>): string {
  if (!taken.has(preferred)) return preferred
  const dot = preferred.lastIndexOf('.')
  const stem = dot > 0 ? preferred.slice(0, dot) : preferred
  const extension = dot > 0 ? preferred.slice(dot) : ''
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = `${stem} (${index})${extension}`
    if (!taken.has(candidate)) return candidate
  }
  // Unreachable in practice: a directory cannot hold ten thousand of the same
  // name. Returning something valid beats throwing inside a write path.
  return `${stem}-${Date.now()}${extension}`
}

/**
 * Normalises a relative path read from a folder, for display and for reading.
 *
 * Reading is less dangerous than writing, but the same shape is refused so that
 * a path which cannot be read is also never offered as an output name.
 */
export function safeRelativePath(raw: string): string | null {
  const cleaned = raw.replace(/\\/g, '/').replace(/^\/+/, '').trim()
  if (cleaned === '') return null
  const parts = cleaned.split('/').filter((part) => part !== '' && part !== '.')
  if (parts.some((part) => part === '..')) return null
  if (parts.length === 0) return null
  for (const part of parts) {
    if (part.includes(':') || part.length > MAX_NAME_LENGTH) return null
  }
  return parts.join('/')
}
