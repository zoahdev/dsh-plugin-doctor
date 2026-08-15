#!/usr/bin/env node
/**
 * dsh-doctor/v1 contract acceptance check (cross-implementation).
 *
 * Builds fixture profiles (clean / UTF-8 BOM / host-shadowing), runs one or
 * two doctor implementations with `--profile <dir> --json`, and asserts the
 * shared contract from discussion #1719:
 *
 *   - envelope: schema "dsh-doctor/v1", exitCode, summary, checks
 *   - status vocabulary: pass | warn | fail (lowercase)
 *   - exit codes: 0 all pass / 1 warn / 2 fail
 *
 * Usage:
 *   node scripts/doctor-contract-check.mjs \
 *     --impl1 "node lib/bin.js" \
 *     [--impl2 "pnpm dlx @moonquake2004/dsh-doctor"]   # optional
 *
 * impl1 is always required to pass; impl2 is reported when provided.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--impl1') { args.impl1 = argv[i + 1]; i += 1 }
    if (argv[i] === '--impl2') { args.impl2 = argv[i + 1]; i += 1 }
  }
  return args
}

function run(command, cwd) {
  const parts = command.split(/\s+/).filter(Boolean).map((t) => t.replace(/^"|"$/g, ''))
  const file = parts[0]
  const args = parts.slice(1)
  // Only .cmd/.bat shims (pnpm, npm, dsh) need cmd.exe on Windows; node and
  // direct executables run fine with a plain argv array.
  const needsShell = process.platform === 'win32' && (/\.[cm]?[bd]at$/i.test(file) || ['pnpm', 'npm', 'npx', 'dsh'].includes(file))
  const result = spawnSync(needsShell ? 'cmd.exe' : file,
    needsShell ? ['/d', '/s', '/c', command] : args,
    { cwd, encoding: 'utf8', timeout: 120_000 })
  return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function fixture(name, { bom = false, shadow = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), `dsh-doctor-contract-${name}-`))
  const manifest = '{"dependencies":{}}'
  writeFileSync(
    path.join(dir, 'package.json'),
    bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(manifest)]) : manifest,
  )
  if (shadow) {
    mkdirSync(path.join(dir, 'node_modules', '@deepseek-ai', 'dsh-tools'), { recursive: true })
    writeFileSync(path.join(dir, 'node_modules', '@deepseek-ai', 'dsh-tools', 'package.json'), '{"version":"0.1.0-rc.6"}')
  }
  return dir
}

function assertEnvelope(json, label) {
  const errors = []
  if (json.schema !== 'dsh-doctor/v1') errors.push('missing schema dsh-doctor/v1')
  if (!Number.isInteger(json.exitCode) || json.exitCode < 0 || json.exitCode > 2) errors.push('invalid exitCode')
  if (!json.summary || !['pass', 'warn', 'fail'].every((k) => Number.isInteger(json.summary[k]))) errors.push('invalid summary')
  if (!Array.isArray(json.checks) || !json.checks.every((c) => ['pass', 'warn', 'fail'].includes(c.status))) {
    errors.push('checks must use lowercase pass|warn|fail statuses')
  }
  return { ok: errors.length === 0, errors, label }
}

const { impl1, impl2 } = parseArgs(process.argv.slice(2))
if (!impl1) {
  console.error('usage: node scripts/doctor-contract-check.mjs --impl1 "node lib/bin.js" [--impl2 ...]')
  process.exit(1)
}

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scenarios = [
  { name: 'clean', opts: {}, expect: 0, expectFail: [] },
  { name: 'bom', opts: { bom: true }, expect: 2, expectFail: ['manifest-bom'] },
  { name: 'shadow', opts: { shadow: true }, expect: 2, expectFail: ['profile-shadow'] },
]

let failures = 0
for (const impl of [{ label: 'impl1', command: impl1 }, impl2 ? { label: 'impl2', command: impl2 } : null].filter(Boolean)) {
  for (const scenario of scenarios) {
    const dir = fixture(scenario.name, scenario.opts)
    try {
      const result = run(`${impl.command} --profile "${dir}" --json`, cwd)
      let json = null
      try { json = JSON.parse(result.stdout) } catch { json = null }
      const envelope = json ? assertEnvelope(json, impl.label) : { ok: false, errors: ['output is not JSON'], label: impl.label }
      const exitOk = result.code === scenario.expect
      const checksOk = scenario.expectFail.every((name) => json?.checks?.some((c) => c.name === name && c.status === 'fail'))
      const pass = envelope.ok && exitOk && checksOk
      if (!pass) failures += 1
      console.log(`${pass ? 'PASS' : 'FAIL'} [${impl.label}] ${scenario.name}: exit=${result.code} (expect ${scenario.expect}) envelope=${envelope.ok} checks=${checksOk}${envelope.errors.length ? ' errors=' + envelope.errors.join(';') : ''}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

if (impl2) {
  console.log('NOTE: impl2 results above are informational; impl1 is the gate for this repo.')
}
console.log(failures === 0 ? 'CONTRACT OK' : `CONTRACT FAILURES: ${failures}`)
process.exit(failures === 0 ? 0 : 1)
