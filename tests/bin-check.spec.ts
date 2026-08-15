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
})
