import { describe, expect, it } from 'vitest'
import { createServer } from 'node:net'
import { checkEnvironment } from '../src/env.js'

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
