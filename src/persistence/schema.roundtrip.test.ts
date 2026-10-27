import { describe, expect, it } from 'vitest'
import { NodeSchema } from './schema'

/**
 * A plain `z.object` **strips** any key it does not declare. A field missing from
 * the schema is therefore not "kept as is", it is silently deleted on load, which
 * is how the Thinking toggle came to reset itself every time a workspace was
 * reopened.
 *
 * These tests fill in every field each node kind can hold and check that all of
 * them come back. When a field is added to a node's TypeScript type, the
 * matching test here is what notices that nobody told the schema.
 */
const base = { position: { x: 0, y: 0 } }

const params = { temperature: 0.7, topP: 1, maxTokens: 512, stop: null }

const cases: Array<{ name: string; node: unknown; expected: Record<string, unknown> }> = [
  {
    name: 'prompt',
    node: {
      ...base,
      id: 'p1',
      type: 'prompt',
      data: {
        kind: 'prompt',
        text: 'ciao',
        params,
        title: 'Titolo',
        runCount: 3,
        lastRunAt: 1_767_323_045_000,
        thinking: false,
        concise: true,
        collapsed: true,
      },
    },
    expected: { thinking: false, concise: true, collapsed: true, title: 'Titolo', runCount: 3, lastRunAt: 1_767_323_045_000 },
  },
  {
    name: 'response with an image in its snapshot',
    node: {
      ...base,
      id: 'r1',
      type: 'response',
      data: {
        kind: 'response',
        status: 'done',
        text: 'e una foto',
        reasoning: 'pensato',
        parentPromptId: 'p1',
        runIndex: 2,
        promptSnapshot: 'domanda',
        title: 'Risposta',
        collapsed: false,
        messagesSnapshot: [
          { role: 'system', content: 'sistema' },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'cosa c e' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
            ],
          },
        ],
      },
    },
    expected: { title: 'Risposta', collapsed: false },
  },
  {
    name: 'system',
    node: {
      ...base,
      id: 's1',
      type: 'system',
      data: { kind: 'system', text: 'sii breve', title: 'Regole', collapsed: true },
    },
    expected: { text: 'sii breve', title: 'Regole', collapsed: true },
  },
  {
    name: 'note',
    node: {
      ...base,
      id: 'n1',
      type: 'note',
      data: { kind: 'note', text: 'appunto', color: 'amber', collapsed: false },
    },
    expected: { text: 'appunto', color: 'amber', collapsed: false },
  },
  {
    name: 'set',
    node: {
      ...base,
      id: 'set1',
      type: 'set',
      data: {
        kind: 'set',
        title: 'Insieme',
        memberIds: ['r1'],
        pick: 'all-done',
        format: 'json',
        includePromptText: false,
        color: '#ff0000',
        collapsed: true,
      },
    },
    expected: { pick: 'all-done', format: 'json', includePromptText: false, color: '#ff0000' },
  },
  {
    name: 'output group',
    node: {
      ...base,
      id: 'o1',
      type: 'output',
      data: {
        kind: 'output',
        text: ' aggregato',
        title: 'Gruppo',
        sourceNodeIds: ['r1', 'r2'],
        format: 'plain',
        includePromptText: false,
        collapsed: true,
        synthesis: { text: 'sintesi', status: 'done' },
      },
    },
    expected: { sourceNodeIds: ['r1', 'r2'], format: 'plain', collapsed: true },
  },
  {
    /*
     * Il gruppo solo visivo, che e' l'unico tipo la cui **ragione d'essere** e' un campo
     * che deve sopravvivere al salvataggio. Se `title`, `color` o `members` non sono
     * dichiarati nello schema, zod li toglie in silenzio e il gruppo si riapre senza nome,
     * senza colore e — peggio — con zero membri: una cornice vuota che l'utente aveva
     * costruito per mettere ordine, svuotata da un salvataggio.
     */
    name: 'visual group keeps its name, colour and members',
    node: {
      ...base,
      id: 'g1',
      type: 'group',
      data: {
        kind: 'group',
        title: 'Materiale del trimestre',
        color: 'rose',
        members: ['p1', 'n1', 'f1'],
      },
    },
    expected: { title: 'Materiale del trimestre', color: 'rose', members: ['p1', 'n1', 'f1'] },
  },
  {
    name: 'summary',
    node: {
      ...base,
      id: 'sum1',
      type: 'summary',
      data: {
        kind: 'summary',
        text: 'sintesi',
        status: 'done',
        instructions: 'riepiui',
        coveredNodeIds: ['r1'],
        coveredMessageCount: 4,
        tokensBefore: 900,
        tokensAfter: 100,
        coverageHash: 'abc',
        title: 'Riassunto',
        collapsed: false,
      },
    },
    expected: { coverageHash: 'abc', tokensAfter: 100, title: 'Riassunto' },
  },
  {
    name: 'image',
    node: {
      ...base,
      id: 'i1',
      type: 'image',
      data: {
        kind: 'image',
        name: 'foto.png',
        mediaType: 'image/png',
        isVideo: false,
        src: 'data:image/png;base64,AAA',
        width: 800,
        height: 600,
        sizeBytes: 12345,
        title: 'La foto',
        collapsed: true,
      },
    },
    expected: { name: 'foto.png', sizeBytes: 12345, title: 'La foto', collapsed: true },
  },
  {
    name: 'video keeps its poster frame',
    node: {
      ...base,
      id: 'i2',
      type: 'image',
      data: {
        kind: 'image',
        name: 'clip.mp4',
        mediaType: 'video/mp4',
        isVideo: true,
        src: 'data:video/mp4;base64,AAAA',
        posterSrc: 'data:image/png;base64,POSTER',
        width: 1920,
        height: 1080,
        sizeBytes: 999,
      },
    },
    expected: { isVideo: true, posterSrc: 'data:image/png;base64,POSTER' },
  },
  {
    name: 'brain with a finished run and its undo copies',
    node: {
      ...base,
      id: 'b1',
      type: 'brain',
      data: {
        kind: 'brain',
        instruction: 'Traduci in inglese',
        model: 'qwen3.5-9b',
        onExisting: 'overwrite',
        inputPath: 'C:/Users/me/ingresso',
        outputPath: 'C:/Users/me/uscita',
        collapsed: true,
        run: {
          status: 'stopped',
          total: 3,
          done: 2,
          message: 'Stopped after 2 of 3 files.',
          log: [
            { path: 'a.txt', status: 'written', writtenAs: 'a.txt', bytes: 10, durationMs: 1200 },
            { path: 'b.pdf', status: 'refused', reason: 'needs an extractor' },
            { path: 'c.txt', status: 'pending' },
          ],
          undo: [
            { path: 'a.txt', existed: true, previousText: 'prima', previousSize: 5 },
            { path: 'nuova.txt', existed: false, previousText: null, previousSize: null },
          ],
        },
      },
    },
    expected: {
      instruction: 'Traduci in inglese',
      onExisting: 'overwrite',
      inputPath: 'C:/Users/me/ingresso',
      collapsed: true,
    },
  },
]

describe('node schema round trip', () => {
  for (const testCase of cases) {
    it(`keeps every field of a ${testCase.name}`, () => {
      const parsed = NodeSchema.safeParse(testCase.node)
      expect(parsed.success).toBe(true)
      if (!parsed.success) return
      for (const [key, value] of Object.entries(testCase.expected)) {
        expect(parsed.data.data).toHaveProperty(key)
        expect((parsed.data.data as Record<string, unknown>)[key]).toEqual(value)
      }
    })
  }

  it('does not silently drop a field the schema does not know about', () => {
    // The failure mode this guards: a typo or a new field parses fine and comes
    // back missing, and nothing complains.
    const parsed = NodeSchema.parse({
      ...base,
      id: 'p9',
      type: 'prompt',
      data: {
        kind: 'prompt',
        text: 'ciao',
        params,
        runCount: 0,
        aBrandNewField: 'hello',
      },
    })
    expect(parsed.data).not.toHaveProperty('aBrandNewField')
    // That is the documented behaviour of a stripping schema, and the reason the
    // cases above enumerate fields instead of trusting the type alone.
    expect(Object.keys(parsed.data).sort()).toEqual(['kind', 'params', 'runCount', 'text'])
  })
})
