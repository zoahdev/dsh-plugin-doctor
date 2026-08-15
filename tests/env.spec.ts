import { describe, expect, it } from 'vitest'
import { createServer } from 'node:net'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checkEnvironment, checkWinBash } from '../src/env.js'

function listen(port: number): Promise<{ close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      resolve({
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

describe('checkEnvironment', () => {
  it('reports node/pnpm/dsh statuses and a free port as PASS', async () => {
    const checks = await checkEnvironment(30_001, 5_000)
    const byName = Object.fromEntries(checks.map((c) => [c.name, c.status]))
    expect(byName.node).toBe('PASS')
    expect(['PASS', 'WARN']).toContain(byName.pnpm)
    expect(['PASS', 'WARN']).toContain(byName['dsh-path'])
    expect(byName['port-30001']).toBe('PASS')
  })

  it('flags an occupied web port as FAIL', async () => {
    const server = await listen(30_002)
    try {
      const checks = await checkEnvironment(30_002, 5_000)
      const port = checks.find((c) => c.name === 'port-30002')
      expect(port?.status).toBe('FAIL')
      expect(port?.detail).toContain('in use')
    } finally {
      await server.close()
    }
  })
})

describe('checkWinBash', () => {
  it('is n/a on non-Windows platforms', () => {
    if (process.platform === 'win32') return
    const result = checkWinBash()
    expect(result.status).toBe('PASS')
    expect(result.detail).toContain('n/a')
  })

  it('resolves bash.exe from PATH on Windows', () => {
    if (process.platform !== 'win32') return
    const dir = mkdtempSync(path.join(tmpdir(), 'dsh-doctor-bash-'))
    const oldPath = process.env.PATH
    try {
      writeFileSync(path.join(dir, 'bash.exe'), '')
      process.env.PATH = `${dir};${oldPath ?? ''}`
      const result = checkWinBash()
      expect(result.status).toBe('PASS')
      expect(result.detail).toContain('bash.exe')
    } finally {
      if (oldPath === undefined) delete process.env.PATH
      else process.env.PATH = oldPath
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails with an actionable message when bash is missing on Windows', () => {
    if (process.platform !== 'win32') return
    const oldPath = process.env.PATH
    const oldPf = process.env.ProgramFiles
    const oldPfx = process.env['ProgramFiles(x86)']
    const oldLocal = process.env.LOCALAPPDATA
    const isolated = mkdtempSync(path.join(tmpdir(), 'dsh-doctor-no-bash-'))
    try {
      process.env.PATH = isolated
      process.env.ProgramFiles = isolated
      process.env['ProgramFiles(x86)'] = isolated
      process.env.LOCALAPPDATA = isolated
      const result = checkWinBash()
      expect(result.status).toBe('FAIL')
      expect(result.detail).toContain('1856')
    } finally {
      if (oldPath === undefined) delete process.env.PATH
      else process.env.PATH = oldPath
      if (oldPf === undefined) delete process.env.ProgramFiles
      else process.env.ProgramFiles = oldPf
      if (oldPfx === undefined) delete process.env['ProgramFiles(x86)']
      else process.env['ProgramFiles(x86)'] = oldPfx
      if (oldLocal === undefined) delete process.env.LOCALAPPDATA
      else process.env.LOCALAPPDATA = oldLocal
      rmSync(isolated, { recursive: true, force: true })
    }
  })
})
