// End-to-end: run the plugin the way the scanner would, against the parent
// repository's planted fixture, and check that every planted keyboard defect
// is found and the control cases stay silent. The fixture's comment block
// lists what is planted and why.

import * as path from 'node:path'
import {pathToFileURL} from 'node:url'
import {chromium, type Browser} from 'playwright'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import keyboardScan, {name, type FindingInput} from '../index.js'

const FIXTURE = path.resolve(__dirname, 'fixtures', 'demo.html')

let browser: Browser
let findings: FindingInput[] = []

beforeAll(async () => {
  browser = await chromium.launch()
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, reducedMotion: 'reduce'})
  const page = await context.newPage()
  await page.goto(pathToFileURL(FIXTURE).href, {waitUntil: 'networkidle'})
  findings = []
  await keyboardScan({
    page,
    addFinding: async f => {
      findings.push(f)
    },
  })
  await context.close()
})

afterAll(async () => {
  await browser?.close()
})

const byRule = (rule: string) => findings.filter(f => f.ruleId === rule)

describe('planted fixture', () => {
  it('exports the name the scans input matches on', () => {
    expect(name).toBe('keyboard-scan')
  })

  it('finds the Tab handler loop in the tag editor as a trap', () => {
    const traps = byRule('keyboard-trap')
    expect(traps).toHaveLength(1)
    expect(traps[0]!.solutionLong).toContain('tag-editor')
    expect(traps[0]!.problemShort).not.toMatch(/^needs review/)
    expect(traps[0]!.problemUrl).toContain('no-keyboard-trap')
  })

  it('finds the click-only chip as unreachable', () => {
    const unreachable = byRule('keyboard-unreachable')
    expect(unreachable.some(f => f.html?.includes('class="chip"'))).toBe(true)
  })

  it('finds the link whose outline was removed', () => {
    const invisible = byRule('focus-not-visible')
    const quiet = invisible.filter(f => f.html?.includes('quiet-focus'))
    expect(quiet).toHaveLength(1)
    expect(quiet[0]!.problemShort).not.toMatch(/^needs review/)
  })

  it('flags the positive tabindex for review, never as a failure', () => {
    const order = byRule('focus-order-vs-dom')
    expect(order).toHaveLength(1)
    expect(order[0]!.problemShort).toMatch(/^needs review: /)
    expect(order[0]!.solutionLong).toContain('priority-cta')
  })

  it('shapes every finding the way the scanner expects', () => {
    expect(findings.length).toBeGreaterThan(0)
    for (const f of findings) {
      expect(f.scannerType).toBe('keyboard-scan')
      expect(f.category).toBe('wcag')
      expect(f.url).toMatch(/^file:/)
      expect(f.problemShort).toBeTruthy()
      expect(f.problemUrl).toMatch(/^https:\/\/www\.w3\.org\/WAI\/WCAG22\/Understanding\//)
      expect(f.solutionShort).toBeTruthy()
    }
  })

  it('stays silent on controls that are reachable and visibly focusable', () => {
    // The correctly built controls on the page: the real <dialog> trigger, the
    // notice dismiss button, the labelled tag inputs. None may be reported as
    // unreachable, and only the planted link may lack a focus indicator.
    const unreachable = byRule('keyboard-unreachable').map(f => f.html ?? '')
    for (const id of ['open-dialog', 'dismiss-notice', 'tag-one', 'tag-two', 'search']) {
      expect(unreachable.some(h => h.includes(`id="${id}"`))).toBe(false)
    }
    const invisibleViolations = byRule('focus-not-visible').filter(f => !f.problemShort.startsWith('needs review'))
    expect(invisibleViolations.every(f => f.html?.includes('quiet-focus'))).toBe(true)
  })
})
