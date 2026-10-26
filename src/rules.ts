// The five rules, and what each one asserts. These mirror lib/probe_rules.py
// in the parent repository; the reason text is the same so a finding reads
// the same whichever harness produced it.
//
// The asymmetry is the whole design: a detected failure is real evidence of
// non-conformance, a clean walk is NOT evidence of conformance. Every one of
// these checks observes a mechanical fragment of a criterion whose full
// meaning needs a human.

export type RuleId = 'keyboard-trap' | 'keyboard-unreachable' | 'focus-not-visible' | 'keyboard-focus-removed' | 'focus-order-vs-dom'

export type Rule = {
  /** WCAG 2.2 success criterion the rule supplies evidence for. */
  wcagSc: string
  /** Lower-case fragment that completes "An accessibility scan flagged ... because ...". */
  problemShort: string
  /** The W3C Understanding page. */
  problemUrl: string
  /** Lower-case fragment that completes "To fix this, ...". */
  solutionShort: string
  /** Whether a finding under this rule asserts a failure or only asks for a look. */
  asserts: 'violation' | 'review'
}

const UNDERSTANDING = 'https://www.w3.org/WAI/WCAG22/Understanding/'

export const RULES: Record<RuleId, Rule> = {
  'keyboard-trap': {
    wcagSc: '2.1.2',
    problemShort: 'sequential focus enters a set of elements it cannot leave, and Escape does not release it',
    problemUrl: `${UNDERSTANDING}no-keyboard-trap`,
    solutionShort:
      'make sure focus can always be moved away with Tab or Shift+Tab, or document the exit; ' +
      'if a widget repurposes Tab, Escape should leave it',
    asserts: 'violation',
  },
  'keyboard-unreachable': {
    wcagSc: '2.1.1',
    problemShort: 'a visible interactive element can never receive keyboard focus',
    problemUrl: `${UNDERSTANDING}keyboard`,
    solutionShort:
      'make every control reachable with the keyboard: use a native button or link, or add ' +
      'tabindex="0" and key handling to the custom element',
    asserts: 'violation',
  },
  'focus-not-visible': {
    wcagSc: '2.4.7',
    problemShort: 'an element shows no visible change at all when it receives keyboard focus',
    problemUrl: `${UNDERSTANDING}focus-visible`,
    solutionShort:
      'restore a focus indicator (usually the removed outline) or provide a replacement with ' +
      'sufficient contrast',
    asserts: 'violation',
  },
  'keyboard-focus-removed': {
    wcagSc: '2.4.7',
    problemShort:
      'an element gives up keyboard focus the moment it receives it',
    problemUrl: `${UNDERSTANDING}focus-visible`,
    solutionShort:
      'stop removing focus from the element (delete the blur() call or script that moves focus away); ' +
      'a focus outline is the supported way to restyle it',
    asserts: 'violation',
  },
  'focus-order-vs-dom': {
    wcagSc: '2.4.3',
    problemShort: 'the sequential focus order diverges from the DOM order',
    problemUrl: `${UNDERSTANDING}focus-order`,
    solutionShort:
      'review the Tab order against the visual layout; remove positive tabindex values and ' +
      'reorder the DOM instead if the order does not preserve meaning',
    asserts: 'review',
  },
}
