// Pure walk analysis. No browser here, so test/walk.test.ts can exercise every
// branch without Playwright. A port of the same functions in keyboard_scan.py;
// if one changes, change the other.

export type Candidate = {
  i: number
  tag: string
  selector: string
  tabindex: string | null
  focusable: boolean
  type: string
  name: string
  role: string
  editable: boolean
  composite: string
  html: string
}

/**
 * Return the member indices of a focus cycle at the tail of `seq`, or null.
 *
 * A Tab walk never legitimately revisits an element (revisiting means focus
 * looped), but a single revisit can also be a probe artifact, so this demands
 * two full periods: the last 2p entries repeat with period p. Unknown elements
 * (-1) never form a cycle; focus we cannot identify is not evidence.
 */
export function detectCycle(seq: number[], maxPeriod = 12): number[] | null {
  const limit = Math.min(maxPeriod, Math.floor(seq.length / 2))
  for (let p = 1; p <= limit; p++) {
    const window = seq.slice(-2 * p)
    const first = window.slice(0, p)
    const second = window.slice(p)
    const repeats = first.every((v, k) => v === second[k])
    const known = window.every(v => v >= 0)
    const distinct = new Set(first).size === p
    if (repeats && known && distinct) return Array.from(new Set(first))
  }
  return null
}

/**
 * (from, to) pairs where the first-visit order jumps backwards in the DOM.
 *
 * `barriers` holds positions in `firstVisit` where the probe moved focus
 * programmatically (past an iframe or a trap); the jump across a barrier is
 * the probe's doing, not the page's, so it is not a divergence.
 */
export function orderDivergences(
  firstVisit: number[],
  barriers: Set<number> = new Set(),
): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let pos = 1; pos < firstVisit.length; pos++) {
    const prev = firstVisit[pos - 1]!
    const cur = firstVisit[pos]!
    if (cur < prev && !barriers.has(pos)) out.push([prev, cur])
  }
  return out
}

/**
 * Candidates that never received focus and have no keyboard-reachable proxy.
 *
 * `contained` holds indices that wrap or sit inside a visited element (a card
 * div with an onclick around a real link: the function is reachable through
 * the link). Roving-tabindex composites and radio groups keep one tab stop by
 * design, so an unvisited member whose group was reached is not a defect.
 * `beforeIndex` limits reporting to elements before a detected trap: past the
 * trap, "unreachable" and "blocked by the trap" cannot be told apart, and the
 * trap finding already owns that blockage.
 */
export function unreachableCandidates(
  cands: Candidate[],
  visited: Set<number>,
  contained: Set<number>,
  beforeIndex: number | null = null,
): Candidate[] {
  const reachedComposites = new Set<string>()
  const reachedRadioGroups = new Set<string>()
  for (const i of visited) {
    const c = cands[i]
    if (!c) continue
    if (c.composite) reachedComposites.add(c.composite)
    if (c.type === 'radio' && c.name) reachedRadioGroups.add(c.name)
  }
  const out: Candidate[] = []
  for (const c of cands) {
    if (visited.has(c.i) || contained.has(c.i)) continue
    if (beforeIndex !== null && c.i >= beforeIndex) continue
    if (c.type === 'radio' && reachedRadioGroups.has(c.name)) continue
    if (c.composite && reachedComposites.has(c.composite)) continue
    out.push(c)
  }
  return out
}

export function nextFocusableAfter(cands: Candidate[], after: number, visited: Set<number>): number | null {
  for (const c of cands) {
    if (c.i > after && c.focusable && !visited.has(c.i)) return c.i
  }
  return null
}

/** True for a tabindex attribute that is a positive integer. */
export function isPositiveTabindex(value: string | null): boolean {
  if (!value) return false
  const trimmed = value.trim().replace(/^\+/, '')
  return /^\d+$/.test(trimmed) && Number(trimmed) > 0
}
