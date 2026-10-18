import * as fs from 'node:fs'
import * as path from 'node:path'

export type ProbeConfig = {
  /** ms to wait after each Tab press before reading focus. */
  stepDelayMs: number
  /** Cap on per-element focus screenshots per page. */
  maxShots: number
  /** Cap on individual unreachable-element findings per page. */
  maxUnreachable: number
}

export const DEFAULTS: ProbeConfig = {
  stepDelayMs: 60,
  maxShots: 40,
  maxUnreachable: 8,
}

/**
 * Optional overrides from `.github/scanner-plugins/keyboard-scan/config.json`
 * in the repository the workflow runs from, which is where the scanner's own
 * plugins read theirs. A missing or malformed file falls back to the defaults;
 * unknown keys and non-numeric values are ignored and logged.
 */
export function loadConfig(cwd: string = process.cwd()): ProbeConfig {
  const file = path.join(cwd, '.github', 'scanner-plugins', 'keyboard-scan', 'config.json')
  const out: ProbeConfig = {...DEFAULTS}
  if (!fs.existsSync(file)) return out
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    console.warn(`[keyboard-scan] ignoring malformed ${file}: ${e}`)
    return out
  }
  if (typeof parsed !== 'object' || parsed === null) return out
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!(key in DEFAULTS)) {
      console.warn(`[keyboard-scan] ignoring unknown config key ${key}`)
      continue
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      console.warn(`[keyboard-scan] ignoring non-numeric config value for ${key}`)
      continue
    }
    out[key as keyof ProbeConfig] = value
  }
  return out
}
