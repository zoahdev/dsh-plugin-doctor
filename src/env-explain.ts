/**
 * Secret-safe environment provenance (`dsh env explain <KEY>`).
 *
 * Implements the proposal from
 * https://github.com/deepseek-ai/deepseek-harness/discussions/1953:
 * explain which layer won for one environment key WITHOUT exposing the
 * value, its length, a prefix, a suffix, or any hash. Only key name, source
 * layer, resolution state, and non-sensitive reasons are returned.
 *
 * Layer precedence (matching the #981 framing): launch environment >
 * project .env > user .env. An explicitly empty project value is reported as
 * `empty` and does NOT mask a valid lower layer - the lower layer wins and
 * the skip is recorded.
 *
 * @module dsh-plugin-doctor/env-explain
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export type EnvLayerState =
  | 'selected'
  | 'absent'
  | 'empty'
  | 'non-regular-path'
  | 'unreadable'
  | 'lower-precedence'
  | 'rejected-protected'

export interface EnvLayerEntry {
  layer: 'project .env' | 'user .env' | 'launch environment'
  state: EnvLayerState
  reason: string
}

export interface EnvExplainReport {
  key: string
  resolved: boolean
  source: string | null
  layers: EnvLayerEntry[]
  /** Constant placeholder; never derived from the real value. */
  value: '[redacted]'
}

/** Parse a minimal .env file: KEY=VALUE lines, comments, blank lines, quotes. */
function parseDotEnv(content: string): Map<string, string> {
  const entries = new Map<string, string>()
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const equal = line.indexOf('=')
    if (equal <= 0) continue
    const key = line.slice(0, equal).trim()
    if (key === '') continue
    let value = line.slice(equal + 1).trim()
    if (value.length >= 2) {
      const first = value[0]
      const last = value[value.length - 1]
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1)
      }
    }
    entries.set(key, value)
  }
  return entries
}

/** Load one .env file, distinguishing unreadable / non-regular / missing. */
function loadDotEnv(path: string): { state: 'absent' | 'non-regular-path' | 'unreadable' | 'parsed'; entries: Map<string, string> } {
  if (!existsSync(path)) return { state: 'absent', entries: new Map() }
  try {
    if (!statSync(path).isFile()) return { state: 'non-regular-path', entries: new Map() }
    return { state: 'parsed', entries: parseDotEnv(readFileSync(path, 'utf8')) }
  } catch {
    return { state: 'unreadable', entries: new Map() }
  }
}

/**
 * Explain one environment key across the supported layers.
 * @param key - environment variable name (case-sensitive on POSIX; the
 *   Windows environment is case-insensitive and the report follows it).
 * @param options - optional cwd (project .env root) and home (user .env root).
 * @returns the secret-safe provenance report.
 */
export function explainEnvKey(
  key: string,
  options: { cwd?: string; home?: string } = {},
): EnvExplainReport {
  const cwd = resolve(options.cwd ?? process.cwd())
  const home = options.home ?? homedir()
  const layers: EnvLayerEntry[] = []

  const project = loadDotEnv(join(cwd, '.env'))
  const user = loadDotEnv(join(home, '.env'))
  const launchValue = Object.prototype.hasOwnProperty.call(process.env, key)
    ? process.env[key]
    : undefined

  const projectValue = project.state === 'parsed' ? project.entries.get(key) : undefined
  const userValue = user.state === 'parsed' ? user.entries.get(key) : undefined

  // Launch environment wins.
  if (launchValue !== undefined) {
    layers.push({
      layer: 'launch environment',
      state: launchValue === '' ? 'empty' : 'selected',
      reason: launchValue === ''
        ? 'present but empty; authoritative (the launch layer cannot be overridden from below)'
        : 'selected (highest precedence)',
    })
  } else {
    layers.push({ layer: 'launch environment', state: 'absent', reason: 'not present in the launch environment' })
  }

  // Project .env (higher than user, lower than launch).
  if (project.state !== 'parsed') {
    layers.push({ layer: 'project .env', state: project.state, reason: dotEnvReason(project.state, join(cwd, '.env')) })
  } else if (projectValue === undefined) {
    layers.push({ layer: 'project .env', state: 'absent', reason: 'key not declared in project .env' })
  } else if (projectValue === '') {
    layers.push({
      layer: 'project .env',
      state: 'empty',
      reason: 'declared empty; resolution continues to lower layers and the skip is recorded (#981)',
    })
  } else {
    layers.push({
      layer: 'project .env',
      state: launchValue === undefined ? 'selected' : 'lower-precedence',
      reason: launchValue === undefined
        ? 'selected'
        : launchValue === ''
          ? 'present but shadowed by an empty authoritative launch value'
          : 'present but shadowed by the launch environment',
    })
  }

  // User .env (lowest).
  if (user.state !== 'parsed') {
    layers.push({ layer: 'user .env', state: user.state, reason: dotEnvReason(user.state, join(home, '.env')) })
  } else if (userValue === undefined) {
    layers.push({ layer: 'user .env', state: 'absent', reason: 'key not declared in user .env' })
  } else if (userValue === '') {
    layers.push({
      layer: 'user .env',
      state: 'empty',
      reason: 'declared empty; no lower layer remains',
    })
  } else {
    layers.push({
      layer: 'user .env',
      state: launchValue === undefined && projectValue !== '' && projectValue !== undefined
        ? 'lower-precedence'
        : launchValue === undefined
          ? 'selected'
          : 'lower-precedence',
      reason: launchValue === undefined && projectValue !== '' && projectValue !== undefined
        ? 'present but lower precedence (project .env wins)'
        : launchValue === undefined
          ? 'selected (no higher layer has a value)'
          : 'present but lower precedence',
    })
  }

  const winner: EnvLayerEntry | undefined = layers.find(entry => entry.state === 'selected')
  return {
    key,
    resolved: winner !== undefined,
    source: winner?.layer ?? null,
    layers,
    value: '[redacted]',
  }
}

function dotEnvReason(state: 'absent' | 'non-regular-path' | 'unreadable', path: string): string {
  switch (state) {
    case 'absent':
      return `no .env file at ${path}`
    case 'non-regular-path':
      return `.env at ${path} is not a regular file`
    case 'unreadable':
      return `.env at ${path} exists but could not be read`
  }
}

/** Plain-text renderer for the CLI (always redacted). */
export function formatEnvExplain(report: EnvExplainReport): string {
  const lines = [
    `key: ${report.key}`,
    `resolved: ${report.resolved ? 'yes' : 'no'}`,
    `source: ${report.source ?? '(none)'}`,
    'layers:',
    ...report.layers.map(entry => `  ${entry.layer}: ${entry.state} (${entry.reason})`),
    'value: [redacted]',
  ]
  return lines.join('\n')
}
