import { describe, expect, it } from 'vitest'
import { checkSupplyChainSecurity } from '../src/index.ts'

describe('checkSupplyChainSecurity', () => {
  it('returns a well-shaped result and degrades gracefully when the CLI is absent', () => {
    const result = checkSupplyChainSecurity(process.cwd())
    expect(result.name).toBe('supply-chain-security')
    expect(['PASS', 'WARN', 'FAIL']).toContain(result.status)
    expect(typeof result.detail).toBe('string')
  })
})
