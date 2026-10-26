import type {Page} from 'playwright'
import {RULES, type RuleId} from './rules.js'
import type {ProbeConfig} from './config.js'
import {
  detectCycle,
  isPositiveTabindex,
  nextFocusableAfter,
  orderDivergences,
  unreachableCandidates,
  type Candidate,
} from './walk.js'
import * as S from './scripts.js'

/** One probe result before it is shaped into the scanner's Finding. */
export type ProbeFinding = {
  ruleId: RuleId
  confidence: 'violation' | 'review'
  selector: string
  html: string
  detail: string
  occurrences: number
}

/** Facts about the walk that are not findings but that a reader must know. */
export type ProbeNotes = {
  shadowRootsTraversed: number
  framesNotWalked: number
  candidates: number
  walkComplete: boolean
  trapsFound: number
  dismissed: boolean
  /** Selector of the modal the walk was scoped to, or null when it covered the page. */
  modalScope: string | null
}

// Padding around an element's box when screenshotting it, so outlines and
// shadows drawn outside the border box are inside the frame. An indicator
// offset further out than this is invisible to the comparison, which errs
// toward missing a defect rather than inventing one.
const SHOT_PAD = 12

// Node Playwright evaluates a string as an expression and does not call it
// with an argument, so wrap the arrow-function source in a call with the
// argument inlined. Arguments here are small: indices and index lists.
function evalScript<T = unknown>(page: Page, script: string, arg?: unknown): Promise<T> {
  const call = arg === undefined ? `(${script})()` : `(${script})(${JSON.stringify(arg)})`
  return page.evaluate(call) as Promise<T>
}

type Shot = {clip: {x: number; y: number; width: number; height: number}; sx: number; sy: number; png: Buffer}

/**
 * Screenshot the focused element's neighbourhood, viewport-relative.
 *
 * Returns null when the element is offscreen: comparing frames that show
 * other content would manufacture false verdicts, and a missed comparison
 * only costs a detection, never invents one.
 */
async function captureFocused(page: Page, idx: number): Promise<Shot | null> {
  const r = await evalScript<{x: number; y: number; w: number; h: number; sx: number; sy: number; vw: number; vh: number}>(
    page,
    S.RECT,
    idx,
  )
  const x = Math.max(r.x - SHOT_PAD, 0)
  const y = Math.max(r.y - SHOT_PAD, 0)
  const w = Math.min(r.x + r.w + SHOT_PAD, r.vw) - x
  const h = Math.min(r.y + r.h + SHOT_PAD, r.vh) - y
  if (w < 4 || h < 4) return null
  const clip = {x, y, width: w, height: h}
  try {
    const png = await page.screenshot({clip, animations: 'disabled'})
    return {clip, sx: r.sx, sy: r.sy, png}
  } catch {
    return null
  }
}

function sameMembers(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const sa = new Set(a)
  return b.every(v => sa.has(v))
}

/**
 * Walk the real Tab order of the page as it currently stands and report what
 * a rule engine inspecting the DOM at rest cannot see. The page is left with
 * focus wherever the walk ended; callers that run other scans afterwards
 * should not depend on focus position.
 */
export async function probePage(page: Page, cfg: ProbeConfig): Promise<{findings: ProbeFinding[]; notes: ProbeNotes}> {
  const findings: ProbeFinding[] = []
  const cands = await evalScript<Candidate[]>(page, S.ENUMERATE)
  const shadowRootsTraversed = await evalScript<number>(page, S.SHADOW_COUNT)
  const framesNotWalked = await evalScript<number>(page, S.FRAME_COUNT)
  const notes: ProbeNotes = {
    shadowRootsTraversed,
    framesNotWalked,
    candidates: cands.length,
    walkComplete: false,
    trapsFound: 0,
    dismissed: false,
    modalScope: await evalScript<string | null>(page, S.SCOPE),
  }
  if (!cands.length) {
    // Nothing interactive to walk is a complete walk with nothing to judge,
    // not an interrupted one.
    notes.walkComplete = true
    return {findings, notes}
  }
  const n = cands.length

  await evalScript(page, S.BLUR)
  await evalScript(page, S.FOCUS_LOG_START)

  const visited = new Set<number>()
  const firstVisit: number[] = []
  const barriers = new Set<number>()
  let seq: number[] = []
  const shots = new Map<number, Shot>()
  // Elements that took focus and gave it straight back (onfocus="blur()").
  const removedOnFocus: number[] = []
  const traps: number[][] = []
  const escapedCycles: number[][] = []
  const trapCycles: number[][] = []
  let dismissed = false
  let walkComplete = false
  let stray = 0
  let wraps = 0
  const maxSteps = 2 * n + 15
  let step = 0

  const noteVisit = async (idx: number) => {
    if (idx >= 0 && !visited.has(idx)) {
      visited.add(idx)
      firstVisit.push(idx)
      if (shots.size < cfg.maxShots) {
        const shot = await captureFocused(page, idx)
        if (shot) shots.set(idx, shot)
      }
    }
  }

  // Move focus past an iframe or a trap and record the landing element as
  // visited. Without this the next Tab leaves `nxt` without it ever being
  // counted, so it is reported unreachable and skips its focus indicator check.
  const stepTo = async (nxt: number) => {
    await evalScript(page, S.FOCUS, nxt)
    barriers.add(firstVisit.length)
    await noteVisit(nxt)
    seq = []
  }

  while (step < maxSteps) {
    step++
    await evalScript(page, S.FOCUS_LOG_RESET)
    await page.keyboard.press('Tab')
    await page.waitForTimeout(cfg.stepDelayMs)
    const info = await evalScript<{idx: number; wrapped: boolean; removed: number}>(page, S.ACTIVE)
    if (info.removed >= 0) {
      // Focus is on the body but an element received it during this press, so
      // this is not a wrap. Count the element as visited (it is reachable) and
      // record it; there is nothing to screenshot, since focus never stays.
      if (!visited.has(info.removed)) {
        visited.add(info.removed)
        firstVisit.push(info.removed)
        removedOnFocus.push(info.removed)
      }
      seq = []
      continue
    }
    if (info.wrapped) {
      // The walk does not necessarily start at the top of the page. One more
      // pass picks up whatever came before the starting point; a second wrap
      // means everything reachable has been seen.
      wraps++
      const unvisitedFocusable = cands.some(c => c.focusable && !visited.has(c.i))
      if (wraps >= 2 || !unvisitedFocusable) {
        walkComplete = true
        break
      }
      barriers.add(firstVisit.length)
      seq = []
      continue
    }
    const idx = info.idx
    seq.push(idx)
    if (idx < 0) {
      // Focus is somewhere the enumeration cannot see. Tolerate a stretch of
      // it; give up honestly rather than loop forever.
      stray++
      if (stray > 25) break
      continue
    }
    stray = 0
    await noteVisit(idx)

    const cyc = detectCycle(seq)
    if (!cyc || escapedCycles.some(e => sameMembers(e, cyc))) continue
    if (trapCycles.some(e => sameMembers(e, cyc))) {
      // A second pass has walked back into a trap already reported. It is the
      // same defect, so step past it rather than report it twice.
      const again = nextFocusableAfter(cands, Math.max(...cyc), visited)
      if (again === null) break
      await stepTo(again)
      continue
    }
    if (new Set(cyc).size >= n) {
      // The whole page cycling is wrap behaviour, not a trap.
      walkComplete = true
      break
    }
    if (cyc.every(i => cands[i]!.tag === 'iframe' || cands[i]!.tag === 'frame')) {
      // Focus is progressing inside an embedded document; from out here it
      // looks stationary. Step past it and keep walking.
      const nxt = nextFocusableAfter(cands, Math.max(...cyc), visited)
      if (nxt === null) {
        walkComplete = true
        break
      }
      await stepTo(nxt)
      continue
    }

    // Candidate trap. The one exit a probe can honestly press is Escape: if
    // that releases focus, this is a dismissible container behaving itself.
    await page.keyboard.press('Escape')
    await page.waitForTimeout(120)
    await page.keyboard.press('Tab')
    await page.waitForTimeout(cfg.stepDelayMs)
    const info2 = await evalScript<{idx: number; wrapped: boolean}>(page, S.ACTIVE)
    if (info2.wrapped || !cyc.includes(info2.idx)) {
      const stillVisible = await evalScript<boolean>(page, S.ALL_VISIBLE, cyc)
      if (!stillVisible) {
        // Escape closed the container. The page has mutated under the walk,
        // so stop here; stale geometry is not evidence.
        dismissed = true
        break
      }
      escapedCycles.push(cyc)
      seq = []
      if (!info2.wrapped) {
        barriers.add(firstVisit.length)
        await noteVisit(info2.idx)
      }
      continue
    }

    traps.push(cyc)
    trapCycles.push(cyc)
    const anc = await evalScript<{selector: string; html: string}>(page, S.COMMON_ANCESTOR, cyc)
    const members = cyc.map(i => `\`${cands[i]!.selector}\``).join(', ')
    findings.push({
      ruleId: 'keyboard-trap',
      confidence: 'violation',
      selector: anc.selector,
      html: anc.html,
      detail:
        `Tab cycles between ${members} and never leaves. Escape was pressed and did not ` +
        `release focus. Keyboard and switch users cannot reach anything after this point; ` +
        `the rest of this walk was continued by moving focus programmatically, which a user cannot do.`,
      occurrences: 1,
    })
    const nxt = nextFocusableAfter(cands, Math.max(...cyc), visited)
    if (nxt === null) break
    await stepTo(nxt)
  }
  notes.walkComplete = walkComplete
  notes.trapsFound = traps.length
  notes.dismissed = dismissed

  // -- reachability ----------------------------------------------------------
  if ((walkComplete || traps.length) && !dismissed) {
    const before = traps.length ? Math.min(...traps.map(t => Math.min(...t))) : null
    const unvisited = cands.filter(c => !visited.has(c.i)).map(c => c.i)
    const contained = new Set<number>(
      unvisited.length
        ? await evalScript<number[]>(page, S.CONTAINED, [unvisited, [...visited].sort((a, b) => a - b)])
        : [],
    )
    const missed = unreachableCandidates(cands, visited, contained, before)
    for (const c of missed.slice(0, cfg.maxUnreachable)) {
      const why =
        c.tabindex === '-1'
          ? 'it has tabindex="-1" and no focusable alternative'
          : !c.focusable
            ? 'it is not focusable at all'
            : 'the browser never moved focus to it during a complete walk'
      findings.push({
        ruleId: 'keyboard-unreachable',
        confidence: 'violation',
        selector: c.selector,
        html: c.html,
        detail:
          `This <${c.tag}> looks interactive but never received focus while tabbing through ` +
          `the page: ${why}. Its function is unavailable to keyboard and switch users.`,
        occurrences: 1,
      })
    }
    if (missed.length > cfg.maxUnreachable) {
      const rest = missed.slice(cfg.maxUnreachable)
      findings.push({
        ruleId: 'keyboard-unreachable',
        confidence: 'violation',
        selector: rest[0]!.selector,
        html: rest[0]!.html,
        detail:
          `${rest.length} further element(s) were never reachable by keyboard on this page. ` +
          `First few: ${rest
            .slice(0, 5)
            .map(c => `\`${c.selector}\``)
            .join('; ')}`,
        occurrences: rest.length,
      })
    }
  }

  // -- focus removed on focus ------------------------------------------------
  if (removedOnFocus.length) {
    const list = removedOnFocus
      .slice(0, 5)
      .map(i => `\`${cands[i]!.selector}\``)
      .join('; ')
    const first = cands[removedOnFocus[0]!]!
    findings.push({
      ruleId: 'keyboard-focus-removed',
      confidence: 'violation',
      selector: first.selector,
      html: first.html,
      detail:
        `${removedOnFocus.length} element(s) received focus during Tab and gave it up at once, so focus ` +
        `landed on the page body and no focus indicator can ever show (2.4.7). The Tab sequence also ` +
        `loses its place, which undermines 2.4.3. First few: ${list}`,
      occurrences: removedOnFocus.length,
    })
  }

  // -- focus order -----------------------------------------------------------
  const jumps = orderDivergences(firstVisit, barriers)
  if (jumps.length) {
    const positive = cands.filter(c => isPositiveTabindex(c.tabindex))
    const lines = jumps
      .slice(0, 8)
      .map(
        ([a, b]) =>
          `- focus moved to \`${cands[b]!.selector}\` (DOM position ${b}) after ` +
          `\`${cands[a]!.selector}\` (DOM position ${a})`,
      )
    if (positive.length) {
      lines.push(
        'Elements with a positive tabindex, the usual cause: ' +
          positive
            .slice(0, 5)
            .map(c => `\`${c.selector}\``)
            .join(', '),
      )
    }
    const first = jumps[0]![1]
    findings.push({
      ruleId: 'focus-order-vs-dom',
      confidence: 'review',
      selector: cands[first]!.selector,
      html: cands[first]!.html,
      detail:
        'The Tab order jumps backwards through the document:\n' +
        lines.join('\n') +
        '\nWhether this order still preserves meaning and operability is a human judgement; ' +
        'review it against the visual layout.',
      occurrences: jumps.length,
    })
  }

  // -- focus visibility ------------------------------------------------------
  if (shots.size && !dismissed) {
    await evalScript(page, S.BLUR)
    await page.waitForTimeout(150)
    for (const idx of [...shots.keys()].sort((a, b) => a - b)) {
      const shot = shots.get(idx)!
      await evalScript(page, S.SCROLL_TO, [shot.sx, shot.sy])
      await page.waitForTimeout(30)
      let after: Buffer
      try {
        after = await page.screenshot({clip: shot.clip, animations: 'disabled'})
      } catch {
        continue
      }
      if (!after.equals(shot.png)) continue
      const c = cands[idx]!
      findings.push({
        ruleId: 'focus-not-visible',
        // The caret, which screenshots do not capture, may be a text field's
        // only indicator; ask rather than assert.
        confidence: c.editable ? 'review' : 'violation',
        selector: c.selector,
        html: c.html,
        detail:
          'Screenshots of this element focused and unfocused are pixel-identical (including a ' +
          'margin around it), so keyboard focus produces no visible change at all.' +
          (c.editable
            ? ' This is a text-entry element, so the caret, which screenshots do not capture, ' +
              'may be its only indicator; review by hand.'
            : ' A sighted keyboard user has no way to tell where they are on the page.'),
        occurrences: 1,
      })
    }
  }

  return {findings, notes}
}

/** The criterion a rule supplies evidence for, for callers shaping output. */
export function criterionFor(ruleId: RuleId): string {
  return RULES[ruleId].wcagSc
}
