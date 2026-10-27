import { describe, expect, it } from 'vitest'
import { addableNodeTypes, NODE_REGISTRY } from './registry'
import type { AddableNodeType, NodeType } from '../types/document'

/**
 * What the palette offers, and what it must not.
 *
 * `addable` is not a cosmetic flag: it is the difference between a node the user
 * can put on the canvas and a node that only exists because the graph made it.
 */
describe('addableNodeTypes', () => {
  it('does not offer Output', () => {
    // A group is made by grouping what is already there. An empty Output card on
    // its own has nothing to gather: it is a dead end the user has to delete.
    expect(addableNodeTypes).not.toContain('output')
  })

  it('does not offer a response either', () => {
    // A response is produced by running a prompt, not by placing a card.
    expect(addableNodeTypes).not.toContain('response')
  })

  it('offers the kinds a workflow is actually built from', () => {
    expect(addableNodeTypes).toEqual(
      expect.arrayContaining(['prompt', 'system', 'note', 'image', 'file', 'folder', 'brain']),
    )
  })

  it('keeps every offered type in the registry, with a label and a description', () => {
    // A type with no registry entry would render as an empty palette row.
    for (const type of addableNodeTypes) {
      const spec = NODE_REGISTRY[type as NodeType]
      expect(spec, type).toBeTruthy()
      expect(spec.label.trim(), type).not.toBe('')
      expect(spec.description.trim(), type).not.toBe('')
    }
  })

  it('keeps Output in the registry, so documents with groups still load', () => {
    // The flag says "not offered", not "gone". A workspace saved with groups must
    // still open, and grouping still creates one.
    expect(NODE_REGISTRY.output).toBeTruthy()
    expect(NODE_REGISTRY.output.addable).toBe(false)
  })

  it('is the whole addable set, with nothing filtered out on top of it', () => {
    // A second list somewhere else would drift from this one and quietly
    // reintroduce a node nobody intended to offer.
    const byFlag = (Object.keys(NODE_REGISTRY) as NodeType[]).filter(
      (kind) => NODE_REGISTRY[kind].addable,
    ) as AddableNodeType[]
    expect(addableNodeTypes).toEqual(byFlag)
  })
})
