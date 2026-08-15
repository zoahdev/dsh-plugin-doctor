#!/usr/bin/env node

import { parseArgs } from 'node:util'
import { checkEnvironment, formatEnvReport } from './env.js'
import {
  checkEntryPoints,
  checkLargeFiles,
  checkManifestBom,
  checkProfileShadowing,
  doctor,
  formatReport,
} from './index.js'

const { values, positionals } = parseArgs({
  options: {
    build: { type: 'boolean', default: false },
    full: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    timeout: { type: 'string', default: '120000' },
    profile: { type: 'string', default: '' },
    port: { type: 'string', default: '3080' },
    env: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  allowPositionals: true,
})

if (values.help) {
  console.log(`dsh-plugin-doctor — health checks for DeepSeek Harness plugins

Usage: dsh-plugin-doctor [options] [plugin-directory]

Options:
  --build       run pnpm run build
  --full        also pack, install into a temp dsh profile, and verify config
  --json        output machine-readable JSON
  --timeout N   command timeout in ms (default 120000)
  --profile P   check a dsh profile (host-shadowing @deepseek-ai copies + manifest BOM)
  --env         run environment diagnostics (node/pnpm/dsh PATH, web port)
  --port N      web port to probe with --env (default 3080)
  preflight P   run the full pre-publish pipeline on plugin directory P (build + pack + fresh-profile install)
  check P       alias of preflight — matches the proposed 'dsh plugin check' surface (RFC #1846)
  --help        show this help
`)
  process.exit(0)
}

if (values.env) {
  const port = Number(values.port ?? 3080)
  const checks = await checkEnvironment(Number.isInteger(port) && port > 0 ? port : 3080, Number(values.timeout ?? 120000))
  const report = { ok: checks.every((check) => check.status !== 'FAIL'), checks }
  if (values.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(formatEnvReport(checks))
  }
  process.exit(report.ok ? 0 : 1)
}

if (values.profile !== undefined && values.profile !== '') {
  const checks = [
    checkProfileShadowing(values.profile),
    checkManifestBom(values.profile),
    checkLargeFiles(values.profile),
    checkEntryPoints(values.profile),
  ]
  const status = checks.some((c) => c.status === 'FAIL') ? 2 : checks.some((c) => c.status === 'WARN') ? 1 : 0
  const envelope = {
    schema: 'dsh-doctor/v1',
    generatedAt: new Date().toISOString(),
    profile: values.profile,
    exitCode: status,
    summary: {
      pass: checks.filter((c) => c.status === 'PASS').length,
      warn: checks.filter((c) => c.status === 'WARN').length,
      fail: checks.filter((c) => c.status === 'FAIL').length,
    },
    // Legacy compatibility fields.
    ok: status !== 2,
    checks: checks.map((c) => ({ ...c, status: c.status.toLowerCase() })),
  }
  const display = { ok: status !== 2, checks }
  if (values.json) {
    console.log(JSON.stringify(envelope, null, 2))
  } else {
    console.log(formatReport(display))
  }
  process.exit(status)
}

if (positionals[0] === 'preflight' || positionals[0] === 'check') {
  // `preflight` = the full pre-publish pipeline (build + pack + fresh-profile
  // install + composed-config verification). Named to match the activation
  // preflight proposal in discussion #1774.
  const dir = positionals[1] ?? '.'
  const report = await doctor(dir, {
    build: true,
    full: true,
    timeoutMs: Number(values.timeout ?? 120000),
  })
  if (values.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(formatReport(report))
  }
  process.exit(report.ok ? 0 : 1)
}

const dir = positionals[0] ?? '.'
const report = await doctor(dir, {
  build: values.build,
  full: values.full,
  timeoutMs: Number(values.timeout ?? 120000),
})

if (values.json) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(formatReport(report))
}
process.exit(report.ok ? 0 : 1)
