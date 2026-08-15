import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checkLargeFiles } from '../src/index.js'

function tempProfile(): string {
  return mkdtempSync(path.join(tmpdir(), 'dsh-doctor-large-'))
}

describe('checkLargeFiles', () => {
  it('passes when no file exceeds the threshold', () => {
    const dir = tempProfile()
    try {
      writeFileSync(path.join(dir, 'small.json'), '{"a":1}')
      const result = checkLargeFiles(dir, 1024)
      expect(result.status).toBe('PASS')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('warns with relative paths when files exceed the threshold', () => {
    const dir = tempProfile()
    try {
      mkdirSync(path.join(dir, 'sessions'))
      writeFileSync(path.join(dir, 'sessions', 'huge.jsonl'), 'x'.repeat(2048))
      const result = checkLargeFiles(dir, 1024)
      expect(result.status).toBe('WARN')
      expect(result.detail).toContain('1859')
      expect(result.detail).toMatch(/sessions[\\/]huge\.jsonl/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('skips dependency trees', () => {
    const dir = tempProfile()
    try {
      mkdirSync(path.join(dir, 'node_modules', '@deepseek-ai'), { recursive: true })
      writeFileSync(path.join(dir, 'node_modules', '@deepseek-ai', 'big.js'), 'x'.repeat(4096))
      const result = checkLargeFiles(dir, 1024)
      expect(result.status).toBe('PASS')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
