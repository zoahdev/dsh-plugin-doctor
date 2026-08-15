/**
 * dsh-plugin-doctor plugin shell.
 *
 * Exposes the same health checks as a model-callable dsh tool (`plugin_check`),
 * so a user can ask the agent "check if this plugin can be published" without
 * leaving DeepSeek Harness. The CLI entry (lib/index.js) stays untouched.
 * @module dsh-plugin-doctor/plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { doctor } from './index.js'

export const name = 'dsh-plugin-doctor'

/** Services required by this plugin. */
export const inject = ['tools']

/** Plugin configuration supplied through cordis.yml. */
export interface Config {
  /** Timeout for external commands (build/pack/install) in milliseconds. */
  timeoutMs?: number
}

/** Schemastery schema. */
export const Config: Schema<Config> = Schema.object({
  timeoutMs: Schema.number().default(120_000),
})

/**
 * Register the plugin_check tool.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'plugin_check',
    description:
      'Run health checks on a DeepSeek Harness plugin bundle directory: manifest structure, '
      + 'patch validity, entry points, files allowlist, and optionally the real build (build=true) '
      + 'and a full pack + fresh-profile install verification (full=true). Returns PASS/WARN/FAIL '
      + 'per check and an overall ok flag.',
    parameters: {
      dir: { type: 'string', required: true, description: 'Absolute path to the plugin bundle directory to check.' },
      build: { type: 'boolean', description: 'Also run `pnpm run build` (requires the project to be installed).' },
      full: { type: 'boolean', description: 'Also run `pnpm pack`, install into a fresh DSH profile, and verify the plugin id in the composed config.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          checks: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                status: { type: 'string', required: true },
                detail: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.checks.map((check) => `[${check.status}] ${check.name}: ${check.detail}`).join('\n')
          + `\n${value.ok ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'}`,
      }],
    },
    async execute(args, exec) {
      if (args.dir.trim() === '') throw new Error('plugin_check: `dir` must be a non-empty string')
      return await doctor(args.dir, {
        build: args.build === true,
        full: args.full === true,
        timeoutMs: config.timeoutMs ?? 120_000,
      })
    },
    presentCall: (args) => ({ card: 'generic', title: `plugin_check: ${args.dir}`, kind: 'search', rawInput: args }),
  }))
}
