// Regression tests for walk bugs found in review of the first release. Each
// page here is the minimal reproduction; all of them assert on findings the
// scanner would file, not on probe internals.

import {chromium, type Browser} from 'playwright'
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'
import keyboardScan, {type FindingInput} from '../index.js'

let browser: Browser

beforeAll(async () => {
  browser = await chromium.launch()
})

afterAll(async () => {
  await browser?.close()
})

async function scan(html: string): Promise<{findings: FindingInput[]; warn: string[]; info: string[]}> {
  const page = await browser.newPage()
  const warn: string[] = []
  const info: string[] = []
  const w = vi.spyOn(console, 'warn').mockImplementation((m: unknown) => void warn.push(String(m)))
  const i = vi.spyOn(console, 'info').mockImplementation((m: unknown) => void info.push(String(m)))
  try {
    await page.setContent(html)
    await page.waitForTimeout(200)
    const findings: FindingInput[] = []
    await keyboardScan({
      page,
      addFinding: async f => {
        findings.push(f)
      },
    })
    return {findings, warn, info}
  } finally {
    w.mockRestore()
    i.mockRestore()
    await page.close()
  }
}

const rule = (fs: FindingInput[], id: string) => fs.filter(f => f.ruleId === id)

describe('element after an iframe or a trap', () => {
  it('is visited, not reported unreachable, after an iframe', async () => {
    const {findings} = await scan(
      `<button>A</button><iframe srcdoc="<button>i1</button><button>i2</button><button>i3</button><button>i4</button>"></iframe>` +
        `<button id="b">B</button><button>C</button>`,
    )
    expect(rule(findings, 'keyboard-unreachable')).toEqual([])
  })

  it('is visited after a trap, and the trap is reported once', async () => {
    const {findings} = await scan(TRAP_PAGE)
    expect(rule(findings, 'keyboard-unreachable')).toEqual([])
    expect(rule(findings, 'keyboard-trap')).toHaveLength(1)
  })
})

const TRAP_PAGE = `<button id="a">A</button>
<div id="trap"><input id="t1"><input id="t2"></div>
<button id="after1">After one</button><button id="after2">After two</button>
<script>
document.getElementById('trap').addEventListener('keydown', e => {
  if (e.key === 'Tab') { e.preventDefault(); const t1=document.getElementById('t1'), t2=document.getElementById('t2'); (document.activeElement===t1?t2:t1).focus(); }
});
</script>`

describe('modal scoping', () => {
  it('does not scope the walk to a non-modal role=dialog', async () => {
    const {findings, info} = await scan(
      `<div role="dialog" aria-label="Cookies" style="position:fixed;bottom:0"><button>Accept</button></div>` +
        `<button>A</button><div onclick="">Click only</div><button>B</button>`,
    )
    expect(rule(findings, 'keyboard-unreachable').length).toBeGreaterThan(0)
    expect(info.join('\n')).toContain('4 candidate(s)')
  })

  it('scopes to an aria-modal dialog and says so', async () => {
    const {warn} = await scan(
      `<button>Outside</button><div role="dialog" aria-modal="true" style="position:fixed;top:0">` +
        `<button>In one</button><button>In two</button></div>`,
    )
    expect(warn.join('\n')).toContain('walk scoped to modal')
  })
})

describe('pages with no interactive controls', () => {
  it('log no incomplete-walk warning', async () => {
    const {findings, warn} = await scan('<p>no controls</p>')
    expect(findings).toEqual([])
    expect(warn.filter(m => m.includes('did not complete'))).toEqual([])
  })
})

describe('elements that blur themselves on focus', () => {
  const PAGE =
    `<a href="#a" onfocus="blur();">One</a><a href="#b" onfocus="blur();">Two</a>` +
    `<a href="#c" onfocus="blur();">Three</a><select id="menu"><option>x</option></select>` +
    `<a href="#d" id="foot">Footer</a><button id="go">Go</button>`

  it('reports them as focus removed, not unreachable, and does not stop the walk', async () => {
    const {findings} = await scan(PAGE)
    const removed = rule(findings, 'keyboard-focus-removed')
    expect(removed).toHaveLength(1)
    expect(removed[0]!.problemShort).toContain('(3 occurrences)')
    expect(removed[0]!.solutionLong).toContain('2.4.7')
    expect(rule(findings, 'keyboard-unreachable')).toEqual([])
  })
})
