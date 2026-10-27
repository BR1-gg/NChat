import { describe, expect, it } from 'vitest'
import {
  basename,
  checkTextFile,
  extensionOf,
  fileBlock,
  folderBlock,
  htmlToText,
  MAX_FILE_BYTES,
  MAX_TEXT_CHARS,
  readFolder,
  readTextFile,
  type FolderResult,
} from './filetext'

const fileOf = (name: string, content: string, path?: string): File => {
  const file = new File([content], name, { type: 'text/plain' })
  if (path) Object.defineProperty(file, 'webkitRelativePath', { value: path })
  return file
}

describe('extensionOf', () => {
  it('reads the extension in lower case', () => {
    expect(extensionOf('Report.PDF')).toBe('pdf')
    expect(extensionOf('main.tsx')).toBe('tsx')
  })

  it('handles names with no extension at all', () => {
    expect(extensionOf('Makefile')).toBe('makefile')
    expect(extensionOf('archive.tar.gz')).toBe('gz')
  })
})

describe('basename', () => {
  it('keeps only the file name from a path', () => {
    expect(basename('src/lib/notes.md')).toBe('notes.md')
    expect(basename(String.raw`C:\Users\me\notes.md`)).toBe('notes.md')
  })
})

/**
 * The refusals matter more than the acceptances: a PDF read as if it were text
 * returns confident nonsense, and the user has no way to tell.
 */
describe('checkTextFile', () => {
  it('accepts the formats a person actually has', () => {
    for (const name of ['a.txt', 'a.md', 'a.json', 'a.csv', 'a.yaml', 'a.html', 'a.ts', 'a.py', 'a.sql']) {
      expect(checkTextFile(name, 10).ok, name).toBe(true)
    }
  })

  it('refuses a PDF and says why', () => {
    const verdict = checkTextFile('paper.pdf', 1000)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toContain('text extractor')
    expect(verdict.reason).toContain('.txt')
  })

  it('refuses the other binary formats, each with a reason', () => {
    for (const name of ['a.docx', 'a.xlsx', 'a.zip', 'a.exe', 'a.mp3', 'a.mp4']) {
      const verdict = checkTextFile(name, 1000)
      expect(verdict.ok, name).toBe(false)
    }
  })

  it('points a video at the image node, which can send a frame', () => {
    const verdict = checkTextFile('clip.mp4', 1000)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toContain('image node')
  })

  it('refuses a file above the size cap before reading it', () => {
    const verdict = checkTextFile('big.txt', MAX_FILE_BYTES + 1)
    expect(verdict.ok).toBe(false)
  })

  it('refuses an empty file, which has nothing to send', () => {
    const verdict = checkTextFile('empty.txt', 0)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toContain('empty')
  })

  it('refuses an unknown format and names it', () => {
    const verdict = checkTextFile('mystery.qqq', 10)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toContain('qqq')
  })

  it('accepts a bare name that is a known file', () => {
    expect(checkTextFile('Dockerfile', 10).ok).toBe(true)
    expect(checkTextFile('.gitignore', 10).ok).toBe(true)
  })

  it('tells apart text, code, data and HTML, for the label only', () => {
    expect(checkTextFile('a.txt', 10)).toEqual({ ok: true, kind: 'text' })
    expect(checkTextFile('a.md', 10)).toEqual({ ok: true, kind: 'markdown' })
    expect(checkTextFile('a.ts', 10)).toEqual({ ok: true, kind: 'code' })
    expect(checkTextFile('a.json', 10)).toEqual({ ok: true, kind: 'data' })
    expect(checkTextFile('a.html', 10)).toEqual({ ok: true, kind: 'markup' })
  })
})

describe('htmlToText', () => {
  it('drops the tags and keeps the words', () => {
    expect(htmlToText('<p>Ciao <b>mondo</b></p>')).toBe('Ciao mondo')
  })

  it('throws away scripts and styles, which are not content', () => {
    const text = htmlToText('<style>p{color:red}</style><script>alert(1)</script><p>Testo</p>')
    expect(text).toBe('Testo')
  })

  it('turns block ends into line breaks', () => {
    // A single break between items: the paragraph rule adds a second one, and a
    // list that is double-spaced reads as a list of separate paragraphs.
    expect(htmlToText('<li>uno</li><li>due</li>')).toBe('uno\ndue')
    expect(htmlToText('<p>uno</p><p>due</p>')).toBe('uno\n\ndue')
  })

  it('does not let indentation spaces eat the line breaks', () => {
    expect(htmlToText('<pre>a\n  b</pre>')).toBe('a\nb')
  })

  it('decodes the entities that would otherwise reach the model as &amp;', () => {
    expect(htmlToText('<p>a &amp; b &lt;c&gt;</p>')).toBe('a & b <c>')
  })
})

describe('readTextFile', () => {
  it('reads a text file and reports what it is', async () => {
    const read = await readTextFile(fileOf('notes.txt', 'il contenuto'))
    expect(read.name).toBe('notes.txt')
    expect(read.text).toBe('il contenuto')
    expect(read.kind).toBe('text')
    expect(read.truncated).toBe(false)
  })

  it('converts HTML, because tags are never what the model needs', async () => {
    const read = await readTextFile(fileOf('page.html', '<p>Ciao</p>'))
    expect(read.text).toBe('Ciao')
  })

  it('caps the text and says it was cut', async () => {
    const read = await readTextFile(fileOf('long.txt', 'x'.repeat(MAX_TEXT_CHARS + 500)))
    expect(read.truncated).toBe(true)
    expect(read.text).toHaveLength(MAX_TEXT_CHARS)
  })

  it('throws with a reason for a format it cannot read', async () => {
    await expect(readTextFile(fileOf('paper.pdf', 'x'))).rejects.toThrow(/text extractor/)
  })

  it('keeps the relative path when one is given', async () => {
    const read = await readTextFile(fileOf('a.txt', 'x', 'progetto/src/a.txt'))
    expect(read.path).toBe('progetto/src/a.txt')
    expect(read.name).toBe('a.txt')
  })
})

describe('readFolder', () => {
  it('reads what it can and lists what it could not', async () => {
    const folder = await readFolder(
      [fileOf('a.txt', 'uno'), fileOf('b.md', 'due'), fileOf('c.pdf', 'tre')],
      'progetto',
    )
    expect(folder.files.map((file) => file.name)).toEqual(['a.txt', 'b.md'])
    expect(folder.refused).toHaveLength(1)
    expect(folder.refused[0]?.name).toBe('c.pdf')
  })

  it('does not fail on an unreadable file', async () => {
    const folder = await readFolder([fileOf('a.txt', 'uno'), fileOf('b.txt', '')], 'progetto')
    expect(folder.files).toHaveLength(1)
    expect(folder.refused).toHaveLength(1)
  })

  it('keeps the relative paths, so subdirectories survive', async () => {
    const folder = await readFolder(
      [fileOf('a.txt', 'uno', 'progetto/src/a.txt'), fileOf('b.txt', 'due', 'progetto/docs/b.txt')],
      'progetto',
    )
    expect(folder.files.map((file) => file.path)).toEqual([
      'progetto/src/a.txt',
      'progetto/docs/b.txt',
    ])
  })
})

describe('fileBlock', () => {
  it('heads the text with the file name and fences it', () => {
    const block = fileBlock({ name: 'notes.txt', text: 'ciao', truncated: false })
    expect(block).toContain('notes.txt')
    expect(block).toContain('```')
    expect(block).toContain('ciao')
  })

  it('says so when the text was cut, instead of passing half a file silently', () => {
    const block = fileBlock({ name: 'long.txt', text: 'abc', truncated: true })
    expect(block).toContain('truncated')
  })

  it('uses the path as the label when one is given', () => {
    const block = fileBlock({ name: 'a.txt', text: 'x', truncated: false }, 'src/a.txt')
    expect(block).toContain('src/a.txt')
  })
})

describe('folderBlock', () => {
  const folder = (over: Partial<FolderResult> = {}): FolderResult => ({
    name: 'progetto',
    files: [
      { name: 'a.txt', path: 'progetto/a.txt', kind: 'text', sizeBytes: 3, text: 'uno', truncated: false },
    ],
    refused: [],
    totalBytes: 3,
    truncated: false,
    ...over,
  })

  it('includes one block per file', () => {
    const block = folderBlock(folder())
    expect(block).toContain('progetto/a.txt')
    expect(block).toContain('uno')
  })

  it('names the files it skipped and why, so the gap is visible', () => {
    // Silently dropping a PDF would leave the user thinking the model read it.
    const block = folderBlock(folder({ refused: [{ name: 'c.pdf', reason: 'needs an extractor' }] }))
    expect(block).toContain('c.pdf')
    expect(block).toContain('needs an extractor')
  })

  it('says when files were left out for size', () => {
    expect(folderBlock(folder({ truncated: true }))).toContain('left out')
  })
})
