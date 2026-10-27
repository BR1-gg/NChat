import { beforeEach, describe, expect, it } from 'vitest'
import { creationPosition, getLastPointerPosition, setLastPointerPosition } from './placement'
import { AUTO_FIT, autoFitHeight } from './autoFit'
import theme from '../styles/theme.css?raw'

/**
 * New nodes used to land in the middle of the visible canvas. The canvas records
 * where the pointer was, and creators read it, so a node appears under the
 * cursor.
 */
describe('node placement', () => {
  beforeEach(() => setLastPointerPosition(null))

  it('starts with no pointer position rather than a wrong guess', () => {
    expect(getLastPointerPosition()).toBeNull()
  })

  it('puts a new node under the pointer', () => {
    setLastPointerPosition({ x: 120, y: -40 })
    expect(creationPosition(null)).toEqual({ x: 120, y: -40 })
  })

  it('lets an explicit point win, because the user pointed at it', () => {
    setLastPointerPosition({ x: 10, y: 10 })
    expect(creationPosition({ x: 900, y: 500 })).toEqual({ x: 900, y: 500 })
  })

  it('falls back to the view centre when the pointer was never on the canvas', () => {
    // The palette can be opened from the top bar before the pointer ever
    // touches the canvas. Landing at the world origin would put the node far
    // outside the view, so the view centre is the honest answer.
    expect(creationPosition(null, { x: 500, y: 400 })).toEqual({ x: 500, y: 400 })
  })

  it('falls back to the origin only when there is nothing else', () => {
    expect(creationPosition(null)).toEqual({ x: 0, y: 0 })
    expect(creationPosition(null, null)).toEqual({ x: 0, y: 0 })
  })

  it('prefers the pointer over the view centre', () => {
    setLastPointerPosition({ x: 10, y: 20 })
    expect(creationPosition(null, { x: 500, y: 400 })).toEqual({ x: 10, y: 20 })
  })
})

/**
 * Auto-fit is what keeps a graph readable, and the cap is the other half: a node
 * that grows with a long answer becomes a column of text.
 */
describe('auto-fit height', () => {
  it('grows with short content', () => {
    expect(autoFitHeight(120, { min: 74, max: 320 })).toBe(120)
  })

  it('keeps a usable minimum for empty content', () => {
    expect(autoFitHeight(10, { min: 74, max: 320 })).toBe(74)
  })

  it('stops at the cap instead of growing without limit', () => {
    expect(autoFitHeight(5000, { min: 74, max: 320 })).toBe(320)
  })

  it('never inverts when the content is between min and max', () => {
    for (const height of [74, 100, 200, 320]) {
      expect(autoFitHeight(height, { min: 74, max: 320 })).toBe(height)
    }
  })

  it('exposes response caps that match the stylesheet', () => {
    // The response body is sized in CSS, not by a textarea, so the two have to
    // agree by hand. A mismatch shows up as a node that is taller than the cap
    // or shorter than the content.
    //
    // La prova confronta il numero **letto dal CSS**, non un numero scritto qui:
    // altrimenti i due possono divergere e questa continuerebbe a passare, che e
    // esattamente il difetto che presidia.
    const altezza = Number(
      theme.match(/\.response-body \{[\s\S]*?max-height:\s*(\d+)px/)?.[1],
    )
    const larghezza = Number(
      theme.match(/\.response-node:not\(\.has-explicit-size\) \.response-body \{[\s\S]*?max-width:\s*(\d+)px/)?.[1],
    )
    expect(altezza, 'max-height della risposta letto dal CSS').toBe(AUTO_FIT.maxResponseHeight)
    expect(larghezza, 'max-width della risposta letto dal CSS').toBe(AUTO_FIT.maxResponseWidth)
  })

  it('gives the response more vertical room than a prompt', () => {
    // Una risposta e lunga per natura; un prompt e un'istruzione. Con lo stesso
    // tetto, la risposta finiva in tre schermate di scroll dentro una schedina e il
    // prompt aveva spazio che non avrebbe mai usato.
    expect(AUTO_FIT.maxResponseHeight).toBeGreaterThan(AUTO_FIT.maxBodyHeight)
  })

  it('keeps the note cap below the body cap, since a note is a label', () => {
    expect(AUTO_FIT.maxNoteHeight).toBeLessThanOrEqual(AUTO_FIT.maxSystemHeight + AUTO_FIT.maxBodyHeight)
  })
})
