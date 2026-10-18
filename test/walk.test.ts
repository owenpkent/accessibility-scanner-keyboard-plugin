import {describe, expect, it} from 'vitest'
import {
  detectCycle,
  isPositiveTabindex,
  nextFocusableAfter,
  orderDivergences,
  unreachableCandidates,
  type Candidate,
} from '../src/walk.js'

function cand(i: number, over: Partial<Candidate> = {}): Candidate {
  return {
    i,
    tag: 'button',
    selector: `button:nth-of-type(${i + 1})`,
    tabindex: null,
    focusable: true,
    type: '',
    name: '',
    role: '',
    editable: false,
    composite: '',
    html: '<button>',
    ...over,
  }
}

describe('detectCycle', () => {
  it('finds no cycle in a linear walk', () => {
    expect(detectCycle([0, 1, 2, 3, 4])).toBeNull()
  })
  it('needs two full periods before it calls a pair a trap', () => {
    // One revisit is not yet a verdict; the second full period is.
    expect(detectCycle([0, 1, 2, 3, 2])).toBeNull()
    expect(detectCycle([0, 1, 2, 3, 2, 3])).toEqual([2, 3])
  })
  it('finds a single element that focus is stuck on', () => {
    expect(detectCycle([0, 1, 4, 4])).toEqual([4])
  })
  it('never forms a cycle out of unknown focus', () => {
    expect(detectCycle([0, -1, -1, -1, -1])).toBeNull()
  })
  it('finds a longer cycle at the tail', () => {
    expect(detectCycle([0, 1, 5, 6, 7, 5, 6, 7])).toEqual([5, 6, 7])
  })
})

describe('orderDivergences', () => {
  it('reports each backwards jump', () => {
    expect(orderDivergences([0, 1, 5, 2, 3])).toEqual([[5, 2]])
  })
  it('ignores a jump the probe made itself', () => {
    // Position 3 is where focus was moved programmatically past a trap.
    expect(orderDivergences([0, 1, 5, 2, 3], new Set([3]))).toEqual([])
  })
  it('is empty for DOM order', () => {
    expect(orderDivergences([0, 1, 2, 3])).toEqual([])
  })
})

describe('unreachableCandidates', () => {
  it('reports an unvisited, uncontained element', () => {
    const cands = [cand(0), cand(1, {tag: 'div', focusable: false}), cand(2)]
    const out = unreachableCandidates(cands, new Set([0, 2]), new Set())
    expect(out.map(c => c.i)).toEqual([1])
  })
  it('does not report an element reachable through a visited descendant or ancestor', () => {
    const cands = [cand(0, {tag: 'div', focusable: false}), cand(1, {tag: 'a'})]
    const out = unreachableCandidates(cands, new Set([1]), new Set([0]))
    expect(out).toEqual([])
  })
  it('lets a radio group keep one tab stop', () => {
    const cands = [
      cand(0, {tag: 'input', type: 'radio', name: 'size'}),
      cand(1, {tag: 'input', type: 'radio', name: 'size'}),
      cand(2, {tag: 'input', type: 'radio', name: 'size'}),
    ]
    expect(unreachableCandidates(cands, new Set([0]), new Set())).toEqual([])
  })
  it('lets a roving-tabindex composite keep one tab stop', () => {
    const cands = [
      cand(0, {role: 'tab', composite: 'div.tabs'}),
      cand(1, {role: 'tab', composite: 'div.tabs', tabindex: '-1', focusable: false}),
      cand(2, {role: 'tab', composite: 'div.tabs', tabindex: '-1', focusable: false}),
    ]
    expect(unreachableCandidates(cands, new Set([0]), new Set())).toEqual([])
  })
  it('does not judge anything past a trap', () => {
    const cands = [cand(0), cand(1, {focusable: false}), cand(2), cand(3, {focusable: false})]
    const out = unreachableCandidates(cands, new Set([0, 2]), new Set(), 2)
    expect(out.map(c => c.i)).toEqual([1])
  })
})

describe('helpers', () => {
  it('nextFocusableAfter skips unfocusable and visited elements', () => {
    const cands = [cand(0), cand(1, {focusable: false}), cand(2), cand(3)]
    expect(nextFocusableAfter(cands, 0, new Set([2]))).toBe(3)
    expect(nextFocusableAfter(cands, 3, new Set())).toBeNull()
  })
  it('isPositiveTabindex', () => {
    expect(isPositiveTabindex('1')).toBe(true)
    expect(isPositiveTabindex('+3')).toBe(true)
    expect(isPositiveTabindex('0')).toBe(false)
    expect(isPositiveTabindex('-1')).toBe(false)
    expect(isPositiveTabindex(null)).toBe(false)
    expect(isPositiveTabindex('abc')).toBe(false)
  })
})
