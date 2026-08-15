import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { apply } from '../src/plugin.js'

function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
}

function makeCtx() {
  const registered: Array<{ name: string; execute: (args: Record<string, unknown>, exec: { signal: AbortSignal }) => Promise<unknown> }> = []
  return {
    ctx: {
      tools: {
        register: (definition: { name: string; execute: (args: Record<string, unknown>, exec: { signal: AbortSignal }) => Promise<unknown> }) => {
          registered.push(definition)
          return () => {}
        },
      },
    } as never,
    registered,
  }
}

describe('plugin shell', () => {
  it('registers exactly one tool', () => {
    const { ctx, registered } = makeCtx()
    apply(ctx, { timeoutMs: 5_000 })
    expect(registered).toHaveLength(1)
    expect(registered[0]?.name).toBe('plugin_check')
  })

  it('runs the real doctor logic on a good fixture', async () => {
    const { ctx, registered } = makeCtx()
    apply(ctx, { timeoutMs: 5_000 })
    const result = await registered[0]!.execute({ dir: fixture('good-plugin') }, { signal: new AbortController().signal })
    expect(result).toMatchObject({ ok: true })
    const checks = (result as { checks: Array<{ name: string; status: string }> }).checks
    expect(checks.find((c) => c.name === 'manifest')?.status).toBe('PASS')
    expect(checks.find((c) => c.name === 'patch')?.status).toBe('PASS')
  })
})
