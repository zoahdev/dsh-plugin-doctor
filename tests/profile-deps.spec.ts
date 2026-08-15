import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checkNativeModules, checkProfileDeps } from '../src/index.js'

function tempBase(): string {
  return mkdtempSync(path.join(tmpdir(), 'dsh-doctor-deps-'))
}

describe('checkProfileDeps', () => {
  it('passes when the runtime @deepseek-ai scope is present in the shared tree', () => {
    const base = tempBase()
    const profile = path.join(base, 'profiles', 'web')
    try {
      mkdirSync(profile, { recursive: true })
      writeFileSync(path.join(profile, 'package.json'), '{"name":"web"}')
      mkdirSync(path.join(base, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-tools'), { recursive: true })
      expect(checkProfileDeps(profile).status).toBe('PASS')
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('fails when a booted profile has no runtime scope (pruned tree)', () => {
    const base = tempBase()
    const profile = path.join(base, 'profiles', 'web')
    try {
      mkdirSync(profile, { recursive: true })
      writeFileSync(path.join(profile, 'package.json'), '{"name":"web"}')
      const result = checkProfileDeps(profile)
      expect(result.status).toBe('FAIL')
      expect(result.detail).toContain('2081')
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('passes when there is no profile manifest yet', () => {
    const dir = tempBase()
    try {
      expect(checkProfileDeps(dir).status).toBe('PASS')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('checkNativeModules', () => {
  it('passes when koffi and node-pty are present', () => {
    const base = tempBase()
    const profile = path.join(base, 'profiles', 'web')
    try {
      mkdirSync(profile, { recursive: true })
      for (const pkg of ['koffi', 'node-pty']) {
        mkdirSync(path.join(base, 'profiles', 'node_modules', pkg), { recursive: true })
      }
      expect(checkNativeModules(profile).status).toBe('PASS')
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('warns when native modules are missing', () => {
    const dir = tempBase()
    try {
      const result = checkNativeModules(dir)
      expect(result.status).toBe('WARN')
      expect(result.detail).toContain('allow-scripts')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
