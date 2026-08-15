import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checkProfileShadowing } from '../src/index.js'

function tempProfile(): string {
  return mkdtempSync(path.join(tmpdir(), 'dsh-doctor-shadow-'))
}

describe('checkProfileShadowing', () => {
  it('passes when the profile has no @deepseek-ai scope', () => {
    const dir = tempProfile()
    try {
      const result = checkProfileShadowing(dir)
      expect(result.status).toBe('PASS')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('passes when the profile has only symlinked @deepseek-ai packages', () => {
    const dir = tempProfile()
    const target = tempProfile()
    try {
      const scope = path.join(dir, 'node_modules', '@deepseek-ai')
      mkdirSync(scope, { recursive: true })
      mkdirSync(path.join(target, 'dsh-tools'), { recursive: true })
      symlinkSync(path.join(target, 'dsh-tools'), path.join(scope, 'dsh-tools'), 'junction')
      const result = checkProfileShadowing(dir)
      expect(result.status).toBe('PASS')
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(target, { recursive: true, force: true })
    }
  })

  it('fails when a real-directory @deepseek-ai copy shadows the host', () => {
    const dir = tempProfile()
    try {
      const scope = path.join(dir, 'node_modules', '@deepseek-ai')
      mkdirSync(path.join(scope, 'dsh-tools'), { recursive: true })
      writeFileSync(path.join(scope, 'dsh-tools', 'package.json'), '{"version":"0.1.0-rc.6"}')
      const result = checkProfileShadowing(dir)
      expect(result.status).toBe('FAIL')
      expect(result.detail).toContain('dsh-tools')
      expect(result.detail).toContain('1697')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
