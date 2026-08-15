import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { parsePatch, readManifest } from '../src/index.js'

describe('readManifest', () => {
  it('returns null for a missing manifest', () => {
    expect(readManifest('/nonexistent-dir')).toBeNull()
  })

  it('summarizes a valid bundle manifest', () => {
    const view = readManifest(fileURLToPath(new URL('..', import.meta.url)))
    expect(view?.dshBundle).toBe(false) // doctor itself is not a bundle
    expect(view?.name).toBe('dsh-plugin-doctor')
  })
})

describe('parsePatch', () => {
  it('extracts plugin ids from a valid patch', () => {
    const entries = parsePatch(`
- insert:
    - id: github-intelligence
      name: dsh-github-intelligence
      config:
        cacheTtlMs: 60000
`)
    expect(entries).toEqual([{ id: 'github-intelligence', name: 'dsh-github-intelligence' }])
  })

  it('throws on non-list YAML', () => {
    expect(() => parsePatch('id: not-a-list')).toThrow('list')
  })

  it('ignores non-insert operations', () => {
    const entries = parsePatch(`
- replace:
    - id: other
- insert:
    - id: real
      name: pkg
`)
    expect(entries).toEqual([{ id: 'real', name: 'pkg' }])
  })
})
