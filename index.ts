// Keyboard probe plugin for github/accessibility-scanner.
//
// The scanner's engines inspect the DOM at rest. The failures that lock
// keyboard users out are behavioural: focus enters a widget and never leaves,
// a click-only control never receives focus at all, the focus indicator was
// styled away. This plugin drives the keyboard for real and reports exactly
// those, as a port of the keyboard probe in owenpkent/accessibility-tooling.
//
//   keyboard-trap        Tab cycles inside a subset of the page and Escape
//                        does not release it                     -> 2.1.2
//   keyboard-unreachable a visible interactive element is never focusable
//                                                                -> 2.1.1
//   focus-not-visible    focused and unfocused screenshots of an element are
//                        pixel-identical                          -> 2.4.7
//                        (text-entry elements are flagged for review instead)
//   focus-order-vs-dom   the Tab order jumps backwards through the DOM
//                                                                -> 2.4.3, review
//
// A detected failure is real evidence. A clean walk proves nothing: the page
// may still trap focus under a key the probe never pressed, and a present
// indicator may still be too faint to see.

import type {Page} from 'playwright'
import {loadConfig} from './src/config.js'
import {probePage, type ProbeFinding} from './src/probe.js'
import {RULES} from './src/rules.js'

export const name = 'keyboard-scan'

/** The scanner's Finding input, as its plugin docs define it. */
export type FindingInput = {
  scannerType: string
  category?: 'wcag' | 'best-practice' | 'experimental'
  ruleId?: string
  url: string
  html?: string
  problemShort: string
  problemUrl: string
  solutionShort: string
  solutionLong?: string
}

export type PluginParams = {
  page: Page
  addFinding: (finding: FindingInput) => Promise<void>
}

/** Shape one probe result into the scanner's Finding. Exported for tests. */
export function toFinding(f: ProbeFinding, url: string): FindingInput {
  const rule = RULES[f.ruleId]
  // The scanner has no confidence field. Its own reflow plugin marks a
  // review-only finding with this prefix, so the issue title says so too.
  const prefix = f.confidence === 'review' ? 'needs review: ' : ''
  const occurrences = f.occurrences > 1 ? ` (${f.occurrences} occurrences)` : ''
  return {
    scannerType: name,
    category: 'wcag',
    ruleId: f.ruleId,
    url,
    html: f.html,
    problemShort: `${prefix}${rule.problemShort}${occurrences}`,
    problemUrl: rule.problemUrl,
    solutionShort: rule.solutionShort,
    solutionLong: `WCAG 2.2 ${rule.wcagSc}. Selector: \`${f.selector}\`\n\n${f.detail}`,
  }
}

export default async function keyboardScan({page, addFinding}: PluginParams): Promise<void> {
  const cfg = loadConfig()
  const url = page.url()
  const {findings, notes} = await probePage(page, cfg)
  if (notes.shadowRootsTraversed) {
    console.info(`[keyboard-scan] ${url}: ${notes.shadowRootsTraversed} open shadow root(s) traversed`)
  }
  if (notes.framesNotWalked) {
    // Silence about a page says nothing about its frames; say so where the
    // run log is read, since the scanner has no info-level finding.
    console.warn(
      `[keyboard-scan] ${url}: ${notes.framesNotWalked} iframe(s) NOT walked; ` +
        `Tab order, traps and focus indicators inside them were not checked`,
    )
  }
  if (notes.dismissed) {
    console.warn(
      `[keyboard-scan] ${url}: Escape closed a container mid-walk, so the walk stopped there; ` +
        `reachability and focus visibility were not judged on this page`,
    )
  } else if (!notes.walkComplete && !notes.trapsFound) {
    console.warn(`[keyboard-scan] ${url}: the walk did not complete; reachability was not judged`)
  }
  for (const f of findings) {
    await addFinding(toFinding(f, url))
  }
  console.info(
    `[keyboard-scan] ${url}: ${notes.candidates} candidate(s), ` +
      `${findings.filter(f => f.confidence === 'violation').length} violation(s), ` +
      `${findings.filter(f => f.confidence === 'review').length} flagged for review`,
  )
}
