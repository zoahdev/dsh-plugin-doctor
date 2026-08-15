#!/usr/bin/env node
/**
 * Real-registry agent-visibility check.
 *
 * Mounts the REAL Cordis context + REAL dsh-tools ToolRuntime + a real scoped
 * agent context, applies the packed plugin through the real registration path,
 * and asserts the plugin's tool is visible in the agent's registry view
 * (`ctx.tools.schemas(scope)`). This is the mechanism agents actually use, so
 * it catches the dual-instance shadowing class (discussions #1697/#1782)
 * instead of just proving "it loads".
 */

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import { apply, name } from '../lib/plugin.js'

const ctx = new Context()
await ctx.plugin(SystemPrompt, { persona: '' })
await ctx.plugin(ToolRuntime)

apply(ctx, { timeoutMs: 5_000 })

const agent = createScope(ctx, 'agent-visibility')
const schemas = ctx.tools.schemas(scopeOf(agent.ctx))
const names = schemas.map((schema) => schema.name)
if (!names.includes('plugin_check')) {
  throw new Error(`plugin_check is NOT visible to a real agent scope (plugin ${name}). Registered names: ${names.join(', ')}`)
}
console.log(`PASS [visibility] plugin ${name}: plugin_check visible to a real agent scope (${schemas.length} tools total)`)
