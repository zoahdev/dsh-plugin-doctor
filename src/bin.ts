#!/usr/bin/env node

import { parseArgs } from 'node:util'
import { doctor, formatReport } from './index.js'

const { values, positionals } = parseArgs({
  options: {
    build: { type: 'boolean', default: false },
    full: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    timeout: { type: 'string', default: '120000' },
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
  --help        show this help
`)
  process.exit(0)
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
