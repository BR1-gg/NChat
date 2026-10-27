import { describe, expect, it } from 'vitest'
import {
  computeGroupFrame,
  expandGroupMove,
  FRAME_PADDING,
  frameMatches,
  type FrameMember,
  type GroupMoveNode,
} from './groups'

const member = (
  id: string,
  x: number,
  y: number,
  width = 300,
  height = 200,
): FrameMember => ({ id, position: { x, y }, measured: { width, height } })

/**
 * A group is its own frame, so the frame has to enclose the answers exactly and
 * follow them when they move. `frameMatches` is what stops the sync effect from
 * writing on every render, so it is asserted too.
 */
describe('computeGroupFrame', () => {
  it('has no frame without members', () => {
    expect(computeGroupFrame('out1', [], [member('a', 0, 0)])).toBeNull()
  })

  it('has no frame when every member is gone', () => {
    // Deleting the answers must not leave a frame floating on the canvas.
    expect(computeGroupFrame('out1', ['gone'], [member('a', 0, 0)])).toBeNull()
  })

  it('encloses one member with the padding on every side', () => {
    const frame = computeGroupFrame('out1', ['a'], [member('a', 100, 50)])
    expect(frame).toEqual({
      id: 'out1',
      x: 100 - FRAME_PADDING,
      y: 50 - FRAME_PADDING,
      width: 300 + FRAME_PADDING * 2,
      height: 200 + FRAME_PADDING * 2,
    })
  })

  it('spans every member, not just the first', () => {
    const frame = computeGroupFrame(
      'out1',
      ['a', 'b', 'c'],
      [member('a', 0, 0), member('b', 400, 100, 300, 200), member('c', 100, 500, 300, 200)],
    )
    expect(frame?.x).toBe(-FRAME_PADDING)
    expect(frame?.y).toBe(-FRAME_PADDING)
    // widest member ends at 700, tallest at 700
    expect(frame?.width).toBe(700 + FRAME_PADDING * 2)
    expect(frame?.height).toBe(700 + FRAME_PADDING * 2)
  })

  it('follows a member that is dragged away', () => {
    const before = computeGroupFrame('out1', ['a', 'b'], [member('a', 0, 0), member('b', 0, 300)])
    const after = computeGroupFrame(
      'out1',
      ['a', 'b'],
      [member('a', 0, 0), member('b', 500, 300)],
    )
    expect(before?.width).not.toBe(after?.width)
    expect(after?.width).toBe(800 + FRAME_PADDING * 2)
  })

  it('prefers an explicit size over a stale measurement', () => {
    // A node the user resized keeps its size even if the measurement lags.
    const node: FrameMember = {
      id: 'a',
      position: { x: 0, y: 0 },
      width: 600,
      height: 400,
      measured: { width: 300, height: 200 },
    }
    const frame = computeGroupFrame('out1', ['a'], [node])
    expect(frame?.width).toBe(600 + FRAME_PADDING * 2)
  })

  it('survives a member whose size is not known yet', () => {
    const frame = computeGroupFrame('out1', ['a'], [{ id: 'a', position: { x: 10, y: 10 } }])
    expect(frame).not.toBeNull()
    // Zero measured size, so the frame falls back to the grabbable minimum
    // rather than collapsing to nothing.
    expect(frame?.width).toBe(80)
    expect(frame?.height).toBe(FRAME_PADDING * 2)
  })

  it('keeps a grabbable minimum for a group of collapsed nodes', () => {
    const frame = computeGroupFrame('out1', ['a'], [member('a', 0, 0, 0, 0)])
    expect(frame?.width).toBeGreaterThanOrEqual(80)
    expect(frame?.height).toBeGreaterThanOrEqual(48)
  })

  it('ignores padding for the frame of a group with a custom padding', () => {
    const frame = computeGroupFrame('out1', ['a'], [member('a', 0, 0)], 10)
    expect(frame?.x).toBe(-10)
  })
})

describe('frameMatches', () => {
  const frame = { x: 10, y: 20, width: 300, height: 200 }

  it('is true when the stored geometry already matches', () => {
    expect(
      frameMatches({ position: { x: 10, y: 20 }, width: 300, height: 200 }, frame),
    ).toBe(true)
  })

  it('is false on any difference, so the sync actually writes', () => {
    expect(frameMatches({ position: { x: 11, y: 20 }, width: 300, height: 200 }, frame)).toBe(false)
    expect(frameMatches({ position: { x: 10, y: 20 }, width: 301, height: 200 }, frame)).toBe(false)
    expect(frameMatches({ position: { x: 10, y: 20 } }, frame)).toBe(false)
  })
})

/**
 * Dragging a group has to move the answers, because the frame's own position is
 * recomputed from them and a direct move would be undone on the next render.
 */
describe('expandGroupMove', () => {
  const group = (id: string, x: number, y: number, sources: string[]): GroupMoveNode => ({
    id,
    type: 'output',
    position: { x, y },
    data: { kind: 'output', sourceNodeIds: sources },
  })
  const answer = (id: string, x: number, y: number): GroupMoveNode => ({
    id,
    type: 'response',
    position: { x, y },
    data: { kind: 'response' },
  })

  it('moves every answer by the drag delta', () => {
    const nodes = [group('out', 100, 100, ['a', 'b']), answer('a', 120, 140), answer('b', 500, 140)]
    const moves = expandGroupMove(nodes, 'out', { x: 160, y: 100 })
    expect(moves?.get('a')).toEqual({ x: 180, y: 140 })
    expect(moves?.get('b')).toEqual({ x: 560, y: 140 })
  })

  it('leaves a plain node to be moved the usual way', () => {
    expect(expandGroupMove([answer('a', 0, 0)], 'a', { x: 50, y: 50 })).toBeNull()
  })

  it('does nothing when the frame did not actually move', () => {
    const nodes = [group('out', 100, 100, ['a']), answer('a', 120, 140)]
    expect(expandGroupMove(nodes, 'out', { x: 100, y: 100 })).toBeNull()
  })

  it('ignores a group with no answers', () => {
    expect(expandGroupMove([group('out', 0, 0, [])], 'out', { x: 50, y: 0 })).toBeNull()
  })

  it('skips an answer that no longer exists', () => {
    const nodes = [group('out', 0, 0, ['gone', 'a']), answer('a', 10, 10)]
    const moves = expandGroupMove(nodes, 'out', { x: 5, y: 0 })
    expect(moves?.has('gone')).toBe(false)
    expect(moves?.get('a')).toEqual({ x: 15, y: 10 })
  })

  it('moves the answers of a nested group, not the nested frame', () => {
    // The inner frame is derived from its own answers, so moving it directly
    // would be reverted the moment the canvas recomputes it.
    const nodes = [
      group('outer', 0, 0, ['inner', 'a']),
      group('inner', 20, 20, ['b']),
      answer('a', 10, 10),
      answer('b', 30, 30),
    ]
    const moves = expandGroupMove(nodes, 'outer', { x: 100, y: 0 })
    expect(moves?.has('inner')).toBe(false)
    expect(moves?.get('b')).toEqual({ x: 130, y: 30 })
    expect(moves?.get('a')).toEqual({ x: 110, y: 10 })
  })

  it('survives a group that contains itself', () => {
    const nodes = [group('out', 0, 0, ['out', 'a']), answer('a', 10, 10)]
    const moves = expandGroupMove(nodes, 'out', { x: 5, y: 5 })
    expect(moves?.get('a')).toEqual({ x: 15, y: 15 })
  })
})
