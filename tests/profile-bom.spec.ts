import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checkManifestBom } from '../src/index.js'

function tempProfile(): string {
  return mkdtempSync(path.join(tmpdir(), 'dsh-doctor-bom-'))
}

describe('checkManifestBom', () => {
  it('passes when the profile manifest has no BOM', () => {
    const dir = tempProfile()
    try {
      writeFileSync(path.join(dir, 'package.json'), '{"dependencies":{}}')
      const result = checkManifestBom(dir)
      expect(result.status).toBe('PASS')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('warns when the manifest is missing', () => {
    const dir = tempProfile()
    try {
      const result = checkManifestBom(dir)
      expect(result.status).toBe('WARN')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails when the profile manifest starts with a UTF-8 BOM', () => {
    const dir = tempProfile()
    try {
      const bom = Buffer.from([0xef, 0xbb, 0xbf])
      writeFileSync(path.join(dir, 'package.json'), Buffer.concat([bom, Buffer.from('{"dependencies":{}}')]))
      const result = checkManifestBom(dir)
      expect(result.status).toBe('FAIL')
      expect(result.detail).toContain('1842')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
