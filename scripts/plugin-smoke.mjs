#!/usr/bin/env node
/**
 * Packaged plugin-shell smoke test.
 *
 * Packs the REAL pnpm tarball, installs it into a fresh host project,
 * imports the installed lib/plugin.js bundle, registers plugin_check through
 * apply()/ctx.tools.register, executes the real handler on a fixture, and
 * asserts the canonical result. A missing module, an API mismatch, or a
 * handler failure fails this script — this is NOT a src-level unit test.
 */

import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixture = path.resolve(root, 'tests', 'fixtures', 'good-plugin')

function runPnpm(args, cwd) {
  if (process.platform === 'win32') {
    return spawnSync(`pnpm ${args.join(' ')}`, { cwd, stdio: 'inherit', shell: true })
  }
  return spawnSync('pnpm', args, { cwd, stdio: 'inherit' })
}

console.log('[plugin-smoke] packing the real tarball...')
const pack = process.platform === 'win32'
  ? spawnSync('pnpm pack --silent', { cwd: root, encoding: 'utf8', shell: true })
  : spawnSync('pnpm', ['pack', '--silent'], { cwd: root, encoding: 'utf8' })
if (pack.status !== 0) {
  console.error('[plugin-smoke] pnpm pack failed')
  process.stderr.write(String(pack.stderr ?? ''))
  process.exit(1)
}
const tgzName = String(pack.stdout ?? '').trim().split(/\r?\n/).pop()
if (!tgzName || !existsSync(path.join(root, tgzName))) {
  console.error(`[plugin-smoke] could not locate packed tarball (got: ${String(tgzName)})`)
  process.exit(1)
}
const tgz = path.join(root, tgzName)

const host = mkdtempSync(path.join(tmpdir(), 'dsh-doctor-host-'))
try {
  writeFileSync(
    path.join(host, 'package.json'),
    JSON.stringify(
      {
        name: 'dsh-plugin-doctor-smoke-host',
        private: true,
        version: '1.0.0',
        dependencies: {
          '@deepseek-ai/cordis': '^4.0.1',
          '@deepseek-ai/dsh-tools': '0.1.0-rc.6',
          '@deepseek-ai/schemastery': '^3.18.1',
          'dsh-plugin-doctor': `file:${tgz.replaceAll('\\', '/')}`,
        },
      },
      null,
      2,
    ),
  )

  console.log('[plugin-smoke] installing packed tarball into a fresh host project...')
  const install = runPnpm(['install'], host)
  if (install.status !== 0) {
    console.error('[plugin-smoke] pnpm install failed')
    process.exit(1)
  }

  const pluginEntry = path.join(host, 'node_modules', 'dsh-plugin-doctor', 'lib', 'plugin.js')
  if (!existsSync(pluginEntry)) {
    throw new Error('packed plugin entry lib/plugin.js missing after install')
  }
  if (!existsSync(path.join(host, 'node_modules', 'dsh-plugin-doctor', 'cordis.patch.yml'))) {
    throw new Error('packed plugin is missing cordis.patch.yml')
  }

  console.log('[plugin-smoke] loading packed plugin shell bundle...')
  const plugin = await import(pathToFileURL(pluginEntry).href)
  if (plugin.name !== 'dsh-plugin-doctor') {
    throw new Error(`unexpected plugin name: ${plugin.name}`)
  }
  if (plugin.inject?.includes('tools') !== true) {
    throw new Error('plugin shell does not declare the tools service')
  }

  const registered = []
  const ctx = {
    tools: {
      register: (definition) => {
        registered.push(definition)
        return () => {}
      },
    },
  }

  console.log('[plugin-smoke] calling apply(ctx, config) through the real registration path...')
  plugin.apply(ctx, { timeoutMs: 120_000 })

  const tool = registered.find((definition) => definition.name === 'plugin_check')
  if (tool === undefined) {
    throw new Error('plugin_check was not registered via apply/ctx.tools.register')
  }
  if (tool.parameters?.properties?.dir === undefined) {
    throw new Error('plugin_check schema missing the dir parameter')
  }

  console.log('[plugin-smoke] executing the real plugin_check handler on a fixture...')
  const result = await tool.execute(
    { dir: fixture.replaceAll('\\', '/') },
    { signal: new AbortController().signal },
  )
  if (result?.ok !== true) {
    throw new Error(`plugin_check did not pass the good fixture: ${JSON.stringify(result)}`)
  }
  const checks = result.checks
  if (checks.find((check) => check.name === 'manifest')?.status !== 'PASS') {
    throw new Error('manifest check did not PASS')
  }
  if (checks.find((check) => check.name === 'patch')?.status !== 'PASS') {
    throw new Error('patch check did not PASS')
  }

  console.log('[plugin-smoke] rendering through the real output.render...')
  const blocks = tool.output.render({ dir: fixture }, result)
  const text = blocks.map((block) => block.text ?? '').join('\n')
  if (!text.includes('ALL CHECKS PASSED')) {
    throw new Error(`render output missing pass summary: ${JSON.stringify(text)}`)
  }

  console.log('PASS [plugin-smoke] packed plugin loaded, plugin_check registered, handler executed, result asserted')
  console.log('PASS [plugin-smoke] result:', JSON.stringify(result))
} finally {
  rmSync(host, { recursive: true, force: true })
}
