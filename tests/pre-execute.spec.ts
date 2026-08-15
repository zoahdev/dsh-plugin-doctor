import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checkPreExecuteSideEffects } from '../src/index.js'

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'dsh-doctor-pre-execute-'))
}

describe('checkPreExecuteSideEffects', () => {
  it('passes when no pre-execute listener exists', () => {
    const dir = tempDir()
    try {
      mkdirSync(path.join(dir, 'src'))
      writeFileSync(path.join(dir, 'src', 'index.ts'), 'export function apply(ctx) { ctx.tools.register(tool) }')
      const result = checkPreExecuteSideEffects(dir)
      expect(result.status).toBe('PASS')
      expect(result.detail).toContain('no pre-execute listener')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails when a pre-execute listener runs host-level side effects', () => {
    const dir = tempDir()
    try {
      mkdirSync(path.join(dir, 'src'))
      writeFileSync(path.join(dir, 'src', 'index.ts'), [
        "import { spawnSync } from 'node:child_process'",
        "ctx.tools.on('pre-execute', () => {",
        "  spawnSync('node', ['-e', '/* work */'])",
        "  return { kind: 'ask' }",
        '})',
      ].join('\n'))
      const result = checkPreExecuteSideEffects(dir)
      expect(result.status).toBe('FAIL')
      expect(result.detail).toContain('1863')
      expect(result.detail).toContain('index.ts')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('passes (with note) when pre-execute has no obvious side-effect APIs', () => {
    const dir = tempDir()
    try {
      writeFileSync(path.join(dir, 'index.js'), [
        "ctx.tools.on('pre-execute', (args) => ({ kind: 'ask', reason: args.name }))",
      ].join('\n'))
      const result = checkPreExecuteSideEffects(dir)
      expect(result.status).toBe('PASS')
      expect(result.detail).toContain('heuristic')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
