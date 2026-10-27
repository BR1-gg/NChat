/**
 * Turning files and folders into text the model can read.
 *
 * Two rules shaped this module.
 *
 * **Only formats that are really text.** A PDF needs a parser, a parser needs a
 * dependency, and a half-working PDF extractor is worse than none: it returns
 * confident garbage. So PDF and friends are refused with a message that says so,
 * rather than imported as mojibake. HTML is converted to its text, because the
 * tags are never what the model needs.
 *
 * **A browser cannot be handed a path.** There is no filesystem access: a
 * folder arrives only through the directory picker or a drop, and everything is
 * copied into the document. That is a real limit, and the folder node says it on
 * its face instead of pretending to be a live link.
 */

export const FILE_ACCEPT = [
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.jsonl',
  '.ndjson',
  '.csv',
  '.tsv',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.xml',
  '.html',
  '.htm',
  '.log',
  '.env',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
  '.php',
  '.sh',
  '.bash',
  '.ps1',
  '.sql',
  '.css',
  '.scss',
  '.less',
  '.vue',
  '.svelte',
  '.r',
  '.jl',
  '.lua',
  '.swift',
  '.dart',
  '.gradle',
  '.dockerfile',
  '.gitignore',
  '.editorconfig',
  '.tex',
  '.bib',
  '.srt',
  '.vtt',
].join(',')

/** One file: refused above this, so a stray video cannot become a huge node. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024

/** All the files of a folder together, refused above this. */
export const MAX_TOTAL_BYTES = 8 * 1024 * 1024

/** A folder is a pile of files; refuse to read an unreasonable number. */
export const MAX_FOLDER_FILES = 200

/**
 * Text is cut here. The cap is what keeps a request inside the context window:
 * the model is told the file was truncated instead of silently receiving half a
 * novel with no sign that anything is missing.
 */
export const MAX_TEXT_CHARS = 120_000

const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h',
  'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'ps1', 'sql', 'css', 'scss', 'less', 'vue', 'svelte',
  'r', 'jl', 'lua', 'swift', 'dart', 'gradle',
])

const DATA_EXTENSIONS = new Set([
  'json', 'jsonl', 'ndjson', 'csv', 'tsv', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'xml',
])

const PLAIN_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'log', 'env', 'tex', 'bib', 'srt', 'vtt', 'gitignore', 'editorconfig',
  'dockerfile',
])

/**
 * Formats that look like text but are not, refused with a reason.
 *
 * A PDF is the important one: it is the format people reach for first, and
 * refusing it without saying why would look like a bug.
 */
const REFUSED = new Map<string, string>([
  ['pdf', 'PDF needs a text extractor, which this app does not ship. Open the file and paste the text, or convert it to .txt or .md.'],
  ['doc', 'Word documents need a text extractor, which this app does not ship. Save it as .txt or .md.'],
  ['docx', 'Word documents need a text extractor, which this app does not ship. Save it as .txt or .md.'],
  ['odt', 'OpenDocument text needs a text extractor. Save it as .txt or .md.'],
  ['xls', 'Spreadsheets need a parser, which this app does not ship. Save it as .csv.'],
  ['xlsx', 'Spreadsheets need a parser, which this app does not ship. Save it as .csv.'],
  ['pptx', 'Presentations need a parser, which this app does not ship. Export the text as .md.'],
  ['epub', 'EPUB needs a parser, which this app does not ship.'],
  ['zip', 'Archives are not opened. Pick the files inside it.'],
  ['gz', 'Archives are not opened. Pick the files inside it.'],
  ['tar', 'Archives are not opened. Pick the files inside it.'],
  ['7z', 'Archives are not opened. Pick the files inside it.'],
  ['exe', 'Binaries cannot be read as text.'],
  ['dll', 'Binaries cannot be read as text.'],
  ['so', 'Binaries cannot be read as text.'],
  ['dylib', 'Binaries cannot be read as text.'],
  ['mp3', 'Audio cannot be sent to a chat model.'],
  ['wav', 'Audio cannot be sent to a chat model.'],
  ['mp4', 'Video cannot be sent to a chat model. Drop it on the canvas as an image node to send a frame.'],
  ['mov', 'Video cannot be sent to a chat model. Drop it on the canvas as an image node to send a frame.'],
  ['sqlite', 'Binary databases cannot be read as text. Export a query to .csv.'],
])

export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  const dot = base.lastIndexOf('.')
  // A dotfile such as `.gitignore` has its whole name as the extension, without
  // the leading dot: that is the name people recognise and the one REFUSED and
  // PLAIN_EXTENSIONS are written with.
  if (dot === 0) return base.slice(1).toLowerCase()
  if (dot < 0) return base.toLowerCase()
  return base.slice(dot + 1).toLowerCase()
}

export function basename(name: string): string {
  return name.split(/[\\/]/).pop() ?? name
}

export type FileVerdict = { ok: true; kind: FileKind } | { ok: false; reason: string }

export type FileKind = 'text' | 'code' | 'data' | 'markup' | 'markdown'

/**
 * Whether a file can be read, and what kind of text it is.
 *
 * The kind is only used to pick a label in the node: a model does not care
 * whether it was given code or a CSV, but a person reading the node does.
 */
export function checkTextFile(name: string, sizeBytes: number): FileVerdict {
  const extension = extensionOf(name)
  const base = basename(name).toLowerCase()
  const refused = REFUSED.get(extension) ?? REFUSED.get(base)
  if (refused) return { ok: false, reason: refused }
  // Checked before reading, never after: the whole point of the cap is that a
  // 400 MB file costs nothing to refuse.
  if (sizeBytes > MAX_FILE_BYTES) {
    return {
      ok: false,
      reason: `The file is ${(sizeBytes / (1024 * 1024)).toFixed(1)} MB, over the ${(MAX_FILE_BYTES / (1024 * 1024)).toFixed(0)} MB limit for a single file. Split it, or keep the part that matters.`,
    }
  }
  const kind = MARKUP.has(extension)
    ? 'markup'
    : CODE_EXTENSIONS.has(extension)
      ? 'code'
      : DATA_EXTENSIONS.has(extension)
        ? 'data'
        : PLAIN_EXTENSIONS.has(extension)
          ? extension === 'md' || extension === 'markdown'
            ? 'markdown'
            : 'text'
          : null
  if (kind) {
    // An empty file is a real file that happens to hold nothing. Accepting it
    // would make a node that looks loaded and sends an empty block.
    if (sizeBytes === 0) {
      return { ok: false, reason: 'The file is empty, so there is nothing to send.' }
    }
    return { ok: true, kind }
  }
  return {
    ok: false,
    reason: `"${extension || basename(name)}" is not a text format this app reads. Open it and paste the content, or save it as .txt or .md.`,
  }
}

const MARKUP = new Set(['html', 'htm'])

export const FILE_KIND_LABEL: Record<FileKind, string> = {
  text: 'Text',
  code: 'Code',
  data: 'Data',
  markup: 'HTML',
  markdown: 'Markdown',
}

/** Strips tags and collapses the blank space they leave behind. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // A paragraph ends with a blank line, a list item or a table row with a
    // single one. The difference is the only structure left once the tags are
    // gone, so it is worth keeping.
    .replace(/<\/(p|div|section|article|h[1-6]|blockquote|pre|table)>/gi, '\n\n')
    .replace(/<\/(li|tr|dt|dd)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // Spaces are collapsed per line, not across line breaks: a global
    // `[ \t]+` would eat the newline a block end had just produced.
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export interface ReadFileResult {
  name: string
  path: string
  kind: FileKind
  sizeBytes: number
  text: string
  truncated: boolean
}

/**
 * Reads one file as text.
 *
 * Rejects before reading, so a 400 MB video costs nothing. The text is capped and
 * the fact is reported, because a model that is silently given the first half of
 * a file will answer about the first half confidently.
 */
export async function readTextFile(file: File, relativePath?: string): Promise<ReadFileResult> {
  const path = relativePath || (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
  const name = basename(path)
  const verdict = checkTextFile(name, file.size)
  if (!verdict.ok) throw new Error(verdict.reason)
  const raw = await file.text()
  const text = verdict.kind === 'markup' ? htmlToText(raw) : raw
  const truncated = text.length > MAX_TEXT_CHARS
  return {
    name,
    path,
    kind: verdict.kind,
    sizeBytes: file.size,
    text: truncated ? text.slice(0, MAX_TEXT_CHARS) : text,
    truncated,
  }
}

export interface FolderResult {
  name: string
  files: ReadFileResult[]
  refused: Array<{ name: string; reason: string }>
  totalBytes: number
  truncated: boolean
}

/**
 * Reads a folder, keeping what it can and saying what it left out.
 *
 * The refused list is part of the result on purpose. Silently skipping a PDF
 * would leave the user thinking the model saw the whole folder.
 */
export async function readFolder(files: File[], folderName: string): Promise<FolderResult> {
  const accepted: ReadFileResult[] = []
  const refused: Array<{ name: string; reason: string }> = []
  let totalBytes = 0
  let truncated = false

  for (const file of files.slice(0, MAX_FOLDER_FILES)) {
    const verdict = checkTextFile(basename(file.name), file.size)
    if (!verdict.ok) {
      refused.push({ name: file.name, reason: verdict.reason })
      continue
    }
    if (totalBytes + file.size > MAX_TOTAL_BYTES) {
      truncated = true
      continue
    }
    try {
      const read = await readTextFile(file, (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name)
      totalBytes += read.sizeBytes
      accepted.push(read)
    } catch (error: unknown) {
      refused.push({ name: file.name, reason: error instanceof Error ? error.message : 'Unreadable.' })
    }
  }
  if (files.length > MAX_FOLDER_FILES) truncated = true
  return { name: folderName, files: accepted, refused, totalBytes, truncated }
}

/**
 * The block a file contributes to a request, headed by its name.
 *
 * The header is inside a fence so the model can tell where the document ends and
 * where the question begins: a file that ends with a question mark would
 * otherwise run straight into the prompt.
 */
export function fileBlock(file: Pick<ReadFileResult, 'name' | 'text' | 'truncated'>, label = 'File'): string {
  const tail = file.truncated ? `\n\n[truncated at ${MAX_TEXT_CHARS.toLocaleString()} characters]` : ''
  return `## ${label}: ${file.name}\n\`\`\`\n${file.text}\n\`\`\`${tail}`
}

/** The same for a whole folder, one fence per file and its relative path. */
export function folderBlock(folder: FolderResult): string {
  const parts = folder.files.map((file) => fileBlock(file, file.path))
  if (folder.refused.length > 0) {
    parts.push(
      `## Not read from ${folder.name}\n${folder.refused
        .map((entry) => `- ${entry.name}: ${entry.reason}`)
        .join('\n')}`,
    )
  }
  if (folder.truncated) {
    parts.push(`_Some files were left out: the folder is over the size limit._`)
  }
  return parts.join('\n\n')
}
