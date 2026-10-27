import { describe, expect, it } from 'vitest'
import {
  MAX_NAME_LENGTH,
  outputNameFor,
  safeFileName,
  safeRelativePath,
  uniqueName,
} from './paths'

/**
 * These are the rules that decide what lands on the user's disk. A test that
 * passes a friendly name proves nothing; what matters is the hostile input.
 */
describe('safeFileName', () => {
  it('accepts an ordinary name', () => {
    expect(safeFileName('relazione.txt')).toEqual({ ok: true, name: 'relazione.txt' })
  })

  it('trims before checking, so a stray space is not a refusal', () => {
    expect(safeFileName('  relazione.txt  ')).toEqual({ ok: true, name: 'relazione.txt' })
  })

  it('refuses an attempt to climb out with ..', () => {
    // The single most important case: the name comes from model output.
    expect(safeFileName('..').ok).toBe(false)
    expect(safeFileName('../../notes.txt').ok).toBe(false)
  })

  it('refuses any path separator', () => {
    expect(safeFileName('a/b.txt').ok).toBe(false)
    expect(safeFileName(String.raw`a\b.txt`).ok).toBe(false)
  })

  it('refuses an absolute path or a drive letter', () => {
    expect(safeFileName('/etc/passwd').ok).toBe(false)
    expect(safeFileName('C:/Windows/system32/x.dll').ok).toBe(false)
    expect(safeFileName('C:notes.txt').ok).toBe(false)
  })

  it('refuses a Windows alternate data stream', () => {
    expect(safeFileName('notes.txt:hidden').ok).toBe(false)
  })

  it('refuses an empty or blank name', () => {
    expect(safeFileName('').ok).toBe(false)
    expect(safeFileName('   ').ok).toBe(false)
  })

  it('refuses control characters, including NUL', () => {
    expect(safeFileName('a\u0000b.txt').ok).toBe(false)
    expect(safeFileName('a\nb.txt').ok).toBe(false)
  })

  it('normalises a trailing space but refuses a trailing dot', () => {
    // A space is removed by the trim, which is honest normalisation. A dot cannot
    // be removed without changing the name, and Windows strips it silently, so
    // "notes." and "notes" would be the same file with no visible difference.
    expect(safeFileName('notes.txt ')).toEqual({ ok: true, name: 'notes.txt' })
    expect(safeFileName('notes.').ok).toBe(false)
  })

  it('refuses a reserved Windows device name', () => {
    expect(safeFileName('con').ok).toBe(false)
    expect(safeFileName('CON.txt').ok).toBe(false)
    expect(safeFileName('com1.md').ok).toBe(false)
    expect(safeFileName('nul').ok).toBe(false)
  })

  it('refuses a name over the length budget', () => {
    expect(safeFileName('x'.repeat(MAX_NAME_LENGTH + 1)).ok).toBe(false)
    expect(safeFileName('x'.repeat(MAX_NAME_LENGTH)).ok).toBe(true)
  })

  it('says why, every time', () => {
    const verdict = safeFileName('../x')
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason.length).toBeGreaterThan(10)
  })
})

describe('outputNameFor', () => {
  it('keeps the input name when the answer is longer than one line', () => {
    // The rule is deliberately un clever: one line is a proposed name, more than
    // one line is content. Guessing inside a paragraph is how a file ends up
    // called after its first word.
    expect(outputNameFor('relazione.txt', 'Questo e il testo.\nE continua.')).toEqual({
      ok: true,
      name: 'relazione.txt',
    })
  })

  it('uses the name the model offers, when the answer is a single line', () => {
    expect(outputNameFor('relazione.txt', 'risultato.txt')).toEqual({
      ok: true,
      name: 'risultato.txt',
    })
  })

  it('keeps the input name when the whole answer is a code fence', () => {
    // The first line inside a fence is a language tag or content, never a name.
    expect(outputNameFor('a.txt', '```\ncontenuto\n```')).toEqual({
      ok: true,
      name: 'a.txt',
    })
  })

  it('takes only the leaf of a path the model offered', () => {
    // A whole path is a reasonable thing for a model to answer with. The leaf is
    // taken and the directory part is dropped, never followed.
    expect(outputNameFor('a.txt', '/home/me/Desktop/risultato.txt')).toEqual({
      ok: true,
      name: 'risultato.txt',
    })
  })

  it('refuses an escaping path rather than quietly reducing it', () => {
    // Reducing "../../etc/passwd" to "passwd" would write a file the user never
    // asked for and hide that the model misunderstood the instruction.
    expect(outputNameFor('a.txt', '../../etc/passwd')).toEqual({ ok: true, name: 'a.txt' })
  })

  it('reports a refusal when neither the answer nor the input name is usable', () => {
    expect(outputNameFor('con', 'con').ok).toBe(false)
  })

  it('falls back to the input name when the proposed one is hostile', () => {
    expect(outputNameFor('relazione.txt', 'notes.')).toEqual({
      ok: true,
      name: 'relazione.txt',
    })
    expect(outputNameFor('relazione.txt', 'con')).toEqual({
      ok: true,
      name: 'relazione.txt',
    })
  })

  it('takes the leaf of a single-line path, whatever the shape', () => {
    // A drive letter is not a reason to refuse: the path is never followed, only
    // the leaf is kept, so "C:/Windows/x.dll" writes "x.dll" in the granted
    // folder and touches nothing else.
    expect(outputNameFor('relazione.txt', 'sub/file.txt')).toEqual({
      ok: true,
      name: 'file.txt',
    })
    expect(outputNameFor('relazione.txt', 'C:/Windows/x.dll')).toEqual({
      ok: true,
      name: 'x.dll',
    })
  })
})

describe('uniqueName', () => {
  it('keeps the name when it is free', () => {
    expect(uniqueName('a.txt', new Set())).toBe('a.txt')
  })

  it('adds a counter before the extension', () => {
    expect(uniqueName('a.txt', new Set(['a.txt']))).toBe('a (1).txt')
    expect(uniqueName('a.txt', new Set(['a.txt', 'a (1).txt']))).toBe('a (2).txt')
  })

  it('handles a name with no extension', () => {
    expect(uniqueName('README', new Set(['README']))).toBe('README (1)')
  })

  it('does not treat a dotfile as an extension', () => {
    expect(uniqueName('.gitignore', new Set(['.gitignore']))).toBe('.gitignore (1)')
  })
})

describe('safeRelativePath', () => {
  it('accepts a normal relative path', () => {
    expect(safeRelativePath('src/main.ts')).toBe('src/main.ts')
  })

  it('accepts backslashes, which is how Windows reports them', () => {
    expect(safeRelativePath(String.raw`src\lib\main.ts`)).toBe('src/lib/main.ts')
  })

  it('refuses a path that climbs out', () => {
    expect(safeRelativePath('../secrets.txt')).toBeNull()
    expect(safeRelativePath('src/../../secrets.txt')).toBeNull()
  })

  it('refuses an empty path', () => {
    expect(safeRelativePath('')).toBeNull()
    expect(safeRelativePath('/')).toBeNull()
    expect(safeRelativePath('././.')).toBeNull()
  })

  it('drops a leading separator instead of treating it as absolute', () => {
    expect(safeRelativePath('/src/a.ts')).toBe('src/a.ts')
  })

  it('collapses repeated separators and single dots', () => {
    expect(safeRelativePath('src//lib/./a.ts')).toBe('src/lib/a.ts')
  })

  it('refuses a segment with a colon', () => {
    expect(safeRelativePath('src/C:/a.ts')).toBeNull()
  })

  it('refuses an over-long segment', () => {
    expect(safeRelativePath(`src/${'x'.repeat(MAX_NAME_LENGTH + 1)}.ts`)).toBeNull()
  })
})
