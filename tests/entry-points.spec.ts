import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checkEntryPoints } from '../src/index.js'

function tempProfile(): string {
  return mkdtempSync(path.join(tmpdir(), 'dsh-doctor-entrypoints-'))
}

function writePlugin(dir: string, name: string, manifest: object): string {
  const pkgDir = path.join(dir, 'node_modules', name)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify(manifest))
  return pkgDir
}

describe('checkEntryPoints', () => {
  it('passes when the profile has no node_modules', () => {
    const dir = tempProfile()
    try {
      expect(checkEntryPoints(dir).status).toBe('PASS')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('passes when every installed plugin entry point resolves', () => {
    const dir = tempProfile()
    try {
      const pkgDir = writePlugin(dir, 'good-plugin', { main: 'lib/index.js' })
      mkdirSync(path.join(pkgDir, 'lib'), { recursive: true })
      writeFileSync(path.join(pkgDir, 'lib', 'index.js'), 'export {}')
      const result = checkEntryPoints(dir)
      expect(result.status).toBe('PASS')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails when an installed plugin main points at a missing build artifact', () => {
    const dir = tempProfile()
    try {
      writePlugin(dir, 'dsh-browser', { main: 'lib/index.js' })
      const result = checkEntryPoints(dir)
      expect(result.status).toBe('FAIL')
      expect(result.detail).toContain('dsh-browser')
      expect(result.detail).toContain('1965')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails for a scoped package whose exports map target is missing', () => {
    const dir = tempProfile()
    try {
      writePlugin(dir, '@yokesky/dsh-usage-lens', {
        exports: { '.': { default: './lib/client.js' } },
      })
      const result = checkEntryPoints(dir)
      expect(result.status).toBe('FAIL')
      expect(result.detail).toContain('dsh-usage-lens')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
