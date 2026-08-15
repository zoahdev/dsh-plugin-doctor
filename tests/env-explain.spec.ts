import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { explainEnvKey, type EnvLayerEntry } from '../src/env-explain.js'

const SAVED: Record<string, string | undefined> = {}

function setLaunch(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-doctor-envexplain-'))
}

afterEach(() => {
  for (const [key, value] of Object.entries(SAVED)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('explainEnvKey', () => {
  it('selects the launch environment when present and never exposes the value', () => {
    const key = 'DSH_TEST_EXPLAIN_LAUNCH'
    SAVED[key] = process.env[key]
    setLaunch(key, 'super-secret-value')
    const report = explainEnvKey(key)
    expect(report.resolved).toBe(true)
    expect(report.source).toBe('launch environment')
    expect(report.value).toBe('[redacted]')
    expect(JSON.stringify(report)).not.toContain('super-secret-value')
    expect(report.layers[0]).toMatchObject({ layer: 'launch environment', state: 'selected' })
  })

  it('selects project .env when the launch layer is absent', () => {
    const key = 'DSH_TEST_EXPLAIN_PROJECT'
    SAVED[key] = process.env[key]
    setLaunch(key, undefined)
    const root = tempRoot()
    try {
      writeFileSync(join(root, '.env'), `${key}=project-value\n`)
      const report = explainEnvKey(key, { cwd: root })
      expect(report.resolved).toBe(true)
      expect(report.source).toBe('project .env')
      expect(JSON.stringify(report)).not.toContain('project-value')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not let an empty project value mask a valid user credential (#981)', () => {
    const key = 'DSH_TEST_EXPLAIN_EMPTY_MASK'
    SAVED[key] = process.env[key]
    setLaunch(key, undefined)
    const root = tempRoot()
    const home = tempRoot()
    try {
      writeFileSync(join(root, '.env'), `${key}=\n`)
      writeFileSync(join(home, '.env'), `${key}=real-user-credential\n`)
      const report = explainEnvKey(key, { cwd: root, home })
      expect(report.resolved).toBe(true)
      expect(report.source).toBe('user .env')
      const project = report.layers.find((entry: EnvLayerEntry) => entry.layer === 'project .env')
      expect(project?.state).toBe('empty')
      expect(JSON.stringify(report)).not.toContain('real-user-credential')
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('reports absent when no layer declares the key', () => {
    const key = 'DSH_TEST_EXPLAIN_ABSENT'
    SAVED[key] = process.env[key]
    setLaunch(key, undefined)
    const root = tempRoot()
    const home = tempRoot()
    try {
      const report = explainEnvKey(key, { cwd: root, home })
      expect(report.resolved).toBe(false)
      expect(report.source).toBeNull()
      expect(report.layers.every((entry: EnvLayerEntry) => entry.state === 'absent')).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('marks an empty-only resolution as unresolved with the skip recorded', () => {
    const key = 'DSH_TEST_EXPLAIN_EMPTY_ONLY'
    SAVED[key] = process.env[key]
    setLaunch(key, undefined)
    const root = tempRoot()
    try {
      writeFileSync(join(root, '.env'), `${key}=\n`)
      const report = explainEnvKey(key, { cwd: root })
      expect(report.resolved).toBe(false)
      expect(report.layers.some((entry: EnvLayerEntry) => entry.state === 'empty')).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
