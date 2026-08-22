import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('dsh-plugin-doctor check command (RFC #1846 surface)', () => {
  it('is wired as a recognized subcommand and runs the pipeline', () => {
    const help = spawnSync(process.execPath, ['lib/bin.js', '--help'], { cwd: root, encoding: 'utf8' })
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('check P')

    // Run the alias against the unbuilt fixture: the pipeline must execute
    // (exit 1 = found issues), not fail as an unknown command.
    const fixture = path.join(root, 'tests', 'fixtures', 'good-plugin')
    const result = spawnSync(
      process.execPath,
      ['lib/bin.js', 'check', fixture, '--json', '--timeout', '60000'],
      { cwd: root, encoding: 'utf8', timeout: 120_000 },
    )
    expect(result.status).toBe(1)
    const report = JSON.parse(result.stdout)
    expect(report.ok).toBe(false)
    expect(Array.isArray(report.checks)).toBe(true)
    expect(report.checks.some((c: { name: string }) => c.name === 'entry')).toBe(true)
  })

  it('prints the evidence-first audit envelope', () => {
    const result = spawnSync(process.execPath, ['lib/bin.js', 'audit', '.', '--json'], { cwd: root, encoding: 'utf8' })
    expect([0, 1, 2]).toContain(result.status)
    const report = JSON.parse(result.stdout) as { schema: string; subject: { name?: string }; findings: unknown[] }
    expect(report.schema).toBe('dsh-plugin-audit/v1')
    expect(report.subject.name).toBe('dsh-plugin-doctor')
    expect(Array.isArray(report.findings)).toBe(true)
  })

  it('prints a batch ecosystem envelope', () => {
    const fixture = path.join(root, 'tests', 'fixtures', 'good-plugin')
    const result = spawnSync(process.execPath, ['lib/bin.js', 'audit-batch', '.', fixture, '--json'], { cwd: root, encoding: 'utf8' })
    expect([0, 1, 2]).toContain(result.status)
    const report = JSON.parse(result.stdout) as { schema: string; summary: { totalPlugins: number } }
    expect(report.schema).toBe('dsh-plugin-ecosystem-audit/v1')
    expect(report.summary.totalPlugins).toBe(2)
  })

  it('flushes batch JSON larger than the default stdout buffer chunk before exiting', () => {
    const fixture = path.join(root, 'tests', 'fixtures', 'good-plugin')
    const repeated = Array.from({ length: 40 }, () => fixture)
    const result = spawnSync(process.execPath, ['lib/bin.js', 'audit-batch', ...repeated, '--json'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 5 * 1024 * 1024,
    })
    expect([0, 1, 2]).toContain(result.status)
    expect(result.stdout.length).toBeGreaterThan(65_536)
    const report = JSON.parse(result.stdout) as { summary: { totalPlugins: number } }
    expect(report.summary.totalPlugins).toBe(40)
  })
})
