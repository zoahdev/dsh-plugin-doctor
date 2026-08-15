/**
 * Environment diagnostics for the `dsh-plugin-doctor --env` command.
 *
 * Implements the "dsh doctor" idea from
 * https://github.com/deepseek-ai/deepseek-harness/discussions/1719:
 * Node/pnpm availability, `dsh` on PATH, and Web UI port availability.
 * @module dsh-plugin-doctor/env
 */

import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'

export interface EnvCheckResult {
  name: string
  status: 'PASS' | 'WARN' | 'FAIL'
  detail: string
}

function runQuick(command: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    let output = ''
    let settled = false
    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      resolve({ ok, output: output.trim() })
    }
    // On Windows, pnpm/dsh ship as .cmd shims and need cmd.exe to launch;
    // node.exe runs directly. cmd.exe with an explicit args array avoids the
    // deprecation that `shell: true` + args triggers.
    const child = process.platform === 'win32'
      ? spawn('cmd.exe', ['/d', '/s', '/c', `${command} ${args.join(' ')}`], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      : spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString() })
    const timer = setTimeout(() => {
      child.kill()
      finish(false)
    }, timeoutMs)
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      finish(false)
      if (output === '') output = `${command}: ${error.code ?? error.message}`
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      finish(code === 0)
    })
  })
}

function isPortFree(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port, timeout: timeoutMs })
    const done = (free: boolean): void => {
      socket.destroy()
      resolve(free)
    }
    socket.once('connect', () => done(false))
    socket.once('timeout', () => done(true))
    socket.once('error', (error: NodeJS.ErrnoException) => done(error.code === 'ECONNREFUSED'))
  })
}

/**
 * Run environment diagnostics.
 * @param port - Web UI port to probe (default 3080).
 * @param timeoutMs - per-command timeout in milliseconds.
 */
export async function checkEnvironment(port = 3080, timeoutMs = 10_000): Promise<EnvCheckResult[]> {
  const checks: EnvCheckResult[] = []

  const node = await runQuick('node', ['--version'], timeoutMs)
  checks.push({
    name: 'node',
    status: node.ok ? 'PASS' : 'FAIL',
    detail: node.ok ? `node ${node.output}` : `node not runnable: ${node.output || 'spawn failed'}`,
  })

  const pnpm = await runQuick('pnpm', ['--version'], timeoutMs)
  checks.push({
    name: 'pnpm',
    status: pnpm.ok ? 'PASS' : 'WARN',
    detail: pnpm.ok ? `pnpm ${pnpm.output}` : `pnpm not found on PATH (required for plugin build/install checks)`,
  })

  const dsh = await runQuick('dsh', ['--help'], timeoutMs)
  checks.push({
    name: 'dsh-path',
    status: dsh.ok ? 'PASS' : 'WARN',
    detail: dsh.ok
      ? 'dsh executable found on PATH'
      : 'dsh not found on PATH (install @deepseek-ai/dsh or use `pnpm dlx @deepseek-ai/dsh`)',
  })

  const free = await isPortFree(port, 1_500)
  checks.push({
    name: `port-${port}`,
    status: free ? 'PASS' : 'FAIL',
    detail: free ? `port ${port} is free` : `port ${port} is already in use (another dsh web instance running?)`,
  })

  return checks
}

/** Render environment checks into a human-readable report. */
export function formatEnvReport(checks: EnvCheckResult[]): string {
  const lines = checks.map((check) => `[${check.status}] ${check.name}: ${check.detail}`)
  const ok = checks.every((check) => check.status !== 'FAIL')
  lines.push(ok ? '✅ ENVIRONMENT OK' : '❌ ENVIRONMENT ISSUES FOUND')
  return lines.join('\n')
}
