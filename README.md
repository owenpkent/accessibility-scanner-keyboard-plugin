# Keyboard probe plugin for github/accessibility-scanner

A plugin for [GitHub's accessibility scanner](https://github.com/github/accessibility-scanner)
that walks the real Tab order of each page and reports the keyboard failures a
rule engine inspecting the DOM at rest cannot see. It is a TypeScript port of
the keyboard probe in accessibility-tooling, an ACR toolkit, with the same rules, the
same thresholds, and the same refusal to treat a clean walk as a pass.

| Rule | Criterion | Asserts |
|---|---|---|
| `keyboard-trap` | 2.1.2 No Keyboard Trap | failure: Tab cycles inside a subset of the page and Escape does not release it |
| `keyboard-unreachable` | 2.1.1 Keyboard | failure: a visible interactive element never receives focus during a complete walk |
| `focus-not-visible` | 2.4.7 Focus Visible | failure: screenshots of an element focused and unfocused are pixel-identical (text-entry elements are flagged for review instead, since the caret may be the only indicator and screenshots do not capture it) |
| `focus-order-vs-dom` | 2.4.3 Focus Order | review only: the Tab order jumps backwards through the DOM, usually a positive `tabindex` |

Review-only findings carry a `needs review:` prefix in the issue title, the
convention the scanner's own reflow plugin uses.

## What a finding does and does not mean

A detected failure is real evidence: the trap was walked into and Escape was
pressed, the control was never focused across a complete walk, the pixels did
not change. A clean walk proves nothing. The page may trap focus under a key
the probe never presses, a control may be reachable only through a shortcut
the probe does not know, and an indicator that is present may still be too
faint to see. Treat silence from this plugin as "not detected", never as
"conforms".

Two limits are logged rather than reported, because the scanner has no
info-level finding:

- **Iframes are not entered.** Their contents are not walked. The log line
  says how many frames were skipped.
- **Closed shadow roots are invisible.** Open shadow roots are walked through
  the composed tree and their controls are named with `>>>` selectors.

## Use

### As an npm plugin

Once the package is on the scanner's npm allowlist:

```yaml
- uses: github/accessibility-scanner@v3
  with:
    scans: |
      ["axe", {"name": "keyboard-scan", "package": "@okent/accessibility-scanner-keyboard-plugin", "version": "0.1.2"}]
```

### As a local plugin

Copy this folder to `.github/scanner-plugins/keyboard-scan/` in the repository
that runs the workflow, check the repository out before the scanner step, and
list the plugin by name. The scanner bundles `index.ts` with esbuild at run
time. There are no runtime dependencies to install; Playwright comes from the
scanner.

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: github/accessibility-scanner@v3
    with:
      scans: '["axe", "keyboard-scan"]'
```

### Configuration

Optional, at `.github/scanner-plugins/keyboard-scan/config.json`:

```json
{
  "stepDelayMs": 60,
  "maxShots": 40,
  "maxUnreachable": 8
}
```

`stepDelayMs` is the wait after each Tab press before focus is read; raise it
for pages with slow focus handlers. `maxShots` caps the per-page focus
screenshots, which bound the run time of the visibility check. `maxUnreachable`
caps individual unreachable-element findings per page; the rest are folded
into one summary finding.

## How it works

1. Enumerate candidate controls in the composed tree, scoped to the open modal
   if one is visible, skipping anything hidden, inert, disabled or
   `aria-hidden`.
2. Blur, then press Tab repeatedly, recording which candidate holds focus after
   each press and screenshotting each newly focused element with a 12px
   margin.
3. When the sequence repeats with a full period twice, press Escape. If focus
   leaves the cycle the container was dismissible and the walk continues. If
   Escape closed the container, the page has changed under the walk and it
   stops. Otherwise it is a trap, reported once by its common ancestor, and
   the walk continues from the next focusable element with that jump marked
   so it is not counted as an order divergence.
4. After a complete walk, report candidates that were never focused, except
   those reachable through a focused ancestor or descendant, radio-group
   members whose group was reached, and roving-tabindex composite members whose
   composite was reached. Nothing past a trap is judged.
5. Report backwards jumps in the first-visit order, excluding jumps the probe
   made itself.
6. Blur and re-screenshot each captured element unfocused. Identical bytes mean
   focus produced no visible change.

## Development

```
npm install
npx playwright install chromium
npm test          # unit tests for the walk analysis, plus an end-to-end run
                  # against test/fixtures/demo.html
npm run build
```

The end-to-end test asserts that every keyboard defect planted in the
fixture is found and that its control cases stay silent. The
fixture's header comment lists what is planted.

## License

MIT.
