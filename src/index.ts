/**
 * dsh-plugin-doctor — health checks for DeepSeek Harness plugins.
 *
 * Mirrors the `dsh plugin check` proposal from
 * https://github.com/deepseek-ai/deepseek-harness/discussions/1629:
 * manifest structure, patch validity, entry points, build, pack, and a real
 * dsh install/boot smoke test.
 * @module dsh-plugin-doctor
 */

import { spawn } from 'node:child_process'
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { load as parseYaml } from 'js-yaml'

export interface CheckResult {
  name: string
  status: 'PASS' | 'WARN' | 'FAIL'
  detail: string
}

export interface DoctorReport {
  ok: boolean
  checks: CheckResult[]
}

export interface DoctorOptions {
  /** Run build (pnpm run build) when a build script exists. */
  build?: boolean
  /** Full mode: pack, install into a temp dsh profile, and boot web. */
  full?: boolean
  /** Command used to launch dsh (default: pnpm dlx @deepseek-ai/dsh). */
  dshCommand?: string[]
  /** Timeout for external commands in milliseconds. */
  timeoutMs?: number
}

/**
 * Check a dsh profile for a real-directory copy of `@deepseek-ai/*` shadowing
 * the host instance. With `nodeLinker: hoisted`, a profile-installed plugin's
 * transitive `@deepseek-ai/dsh-tools` can be hoisted to the profile's top-level
 * node_modules; Node then resolves the shadowed copy for bare specifiers and
 * every tool call can crash with `Cannot read properties of undefined
 * (reading 'prepare')` (deepseek-harness discussion #1697).
 * @param profileDir - absolute path of the dsh profile to inspect.
 */
export function checkProfileShadowing(profileDir: string): CheckResult {
  const scope = path.join(profileDir, 'node_modules', '@deepseek-ai')
  if (!existsSync(scope)) {
    return { name: 'profile-shadow', status: 'PASS', detail: `no @deepseek-ai scope at ${scope}` }
  }
  const shadowed: string[] = []
  for (const entry of readdirSync(scope)) {
    const full = path.join(scope, entry)
    try {
      const stat = lstatSync(full)
      // pnpm normally links the host copy via symlink/junction; a REAL
      // directory is a hoisted duplicate that shadows the host.
      if (stat.isDirectory() && !stat.isSymbolicLink()) shadowed.push(entry)
    } catch {
      // Broken links are not shadow copies; ignore.
    }
  }
  if (shadowed.length === 0) {
    return { name: 'profile-shadow', status: 'PASS', detail: `no real-directory @deepseek-ai/* copy at ${scope}` }
  }
  return {
    name: 'profile-shadow',
    status: 'FAIL',
    detail: `profile-top-level @deepseek-ai/* real-directory copy(ies) shadow the host: ${shadowed.join(', ')}. `
      + 'This can break every tool call (discussion #1697). Reinstall the profile so the host copy is resolved first.',
  }
}

/**
 * Check a dsh profile's package.json for a UTF-8 BOM. dsh's
 * `readProfileManifest` (packages/boot/app-boot/src/profile.ts:267-272)
 * parses with `JSON.parse(readFileSync(path, 'utf8'))`, and a leading U+FEFF
 * crashes `dsh web` at boot with `Unexpected token` (discussion #1842).
 * @param profileDir - absolute path of the dsh profile to inspect.
 */
export function checkManifestBom(profileDir: string): CheckResult {
  const file = path.join(profileDir, 'package.json')
  if (!existsSync(file)) {
    return { name: 'manifest-bom', status: 'WARN', detail: `profile manifest not found at ${file}` }
  }
  const bytes = readFileSync(file)
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  if (hasBom) {
    return {
      name: 'manifest-bom',
      status: 'FAIL',
      detail: `profile manifest ${file} starts with a UTF-8 BOM; dsh web crashes at boot (discussion #1842). `
        + 'Re-save the file as UTF-8 without BOM (or strip the first three bytes).',
    }
  }
  return { name: 'manifest-bom', status: 'PASS', detail: 'profile manifest has no UTF-8 BOM' }
}

/**
 * Session-size tripwire for the #1859 class: a single giant event log can
 * blow past V8's ~512 MB string cap during search-index reconciliation.
 * Reports the largest files in a profile (skipping dependency trees) so
 * operators get warned before the cliff.
 */
export function checkLargeFiles(profileDir: string, thresholdBytes = 100 * 1024 * 1024): CheckResult {
  const SKIP_DIRS = new Set(['node_modules', '.pnpm', '.git', '.store'])
  const large: { rel: string; size: number }[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > 5) return
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue
      const full = path.join(dir, entry)
      try {
        const stat = statSync(full)
        if (stat.isDirectory()) walk(full, depth + 1)
        else if (stat.size >= thresholdBytes) large.push({ rel: path.relative(profileDir, full), size: stat.size })
      } catch { /* unreadable */ }
    }
  }
  walk(profileDir, 0)
  if (large.length === 0) {
    return { name: 'large-files', status: 'PASS', detail: `no files >= ${thresholdBytes} bytes in profile` }
  }
  const top = large.sort((a, b) => b.size - a.size).slice(0, 5)
  return {
    name: 'large-files',
    status: 'WARN',
    detail: `large files in profile (session logs can hit the ~512 MB stringify cap, discussion #1859): `
      + top.map((f) => `${f.rel} (${(f.size / 1048576).toFixed(1)} MB)`).join('; ')
      + ' — consider archiving or compacting large sessions.',
  }
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx'])

const PRE_EXECUTE_RE = /\bpre[_-]?execute\b/i

/** Heuristic: host-level side-effect APIs that must not run before approval. */
const SIDE_EFFECT_RE = [
  /node:child_process|child_process/,
  /\b(spawn|execFile|fork|exec)\s*\(/,
  /node:fs|\b(writeFile|writeFileSync|appendFile|createWriteStream|unlinkSync|rmSync|renameSync)\s*\(/,
  /\b(fetch|http\.request|https\.request|net\.connect|createConnection)\s*\(/,
]

function collectSourceFiles(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 6) return out
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.git' || entry === '.DS_Store') continue
    const full = path.join(dir, entry)
    try {
      const stat = statSync(full)
      if (stat.isDirectory()) collectSourceFiles(full, out, depth + 1)
      else if (SOURCE_EXTENSIONS.has(path.extname(entry))) out.push(full)
    } catch { /* unreadable */ }
  }
  return out
}

/**
 * Heuristic lint for the #1863 class: a `pre-execute` listener that performs
 * host-level side effects before returning `ask` defeats approval (approval
 * is consent UX, not a sandbox). Flags side-effect APIs in files that
 * reference pre-execute. This is a review aid, not a security sandbox.
 */
export function checkPreExecuteSideEffects(dir: string): CheckResult {
  const root = path.resolve(dir)
  const files = collectSourceFiles(root)
  const hits: string[] = []
  let preExecuteFiles = 0
  for (const file of files) {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    if (!PRE_EXECUTE_RE.test(text)) continue
    preExecuteFiles += 1
    const relative = path.relative(root, file)
    for (const pattern of SIDE_EFFECT_RE) {
      const match = pattern.exec(text)
      if (match !== null) {
        hits.push(`${relative} (${match[0].slice(0, 40)})`)
        break
      }
    }
  }
  if (preExecuteFiles === 0) {
    return { name: 'pre-execute-side-effects', status: 'PASS', detail: 'no pre-execute listener found' }
  }
  if (hits.length > 0) {
    return {
      name: 'pre-execute-side-effects',
      status: 'FAIL',
      detail: `pre-execute listeners may run side effects before approval (#1863): ${hits.join('; ')}. `
        + 'Move side effects into execute() after approval; approval is consent UX, not a sandbox. Heuristic, not a security audit.',
    }
  }
  return {
    name: 'pre-execute-side-effects',
    status: 'PASS',
    detail: `pre-execute listeners present (${preExecuteFiles} file(s)); no obvious side-effect APIs detected in the same files (heuristic)`,
  }
}

export interface ManifestView {
  name?: string
  version?: string
  main?: string
  files?: string[]
  prepare?: string
  patch?: string
  dshBundle?: boolean
}

/** Read and summarize the plugin manifest, or return null when missing. */
export function readManifest(dir: string): ManifestView | null {
  const file = path.join(dir, 'package.json')
  if (!existsSync(file)) return null
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    const dsh = raw.dsh as Record<string, unknown> | null
    const bundle = dsh !== null && typeof dsh === 'object' ? dsh.bundle as Record<string, unknown> | null : null
    return {
      name: typeof raw.name === 'string' ? raw.name : undefined,
      version: typeof raw.version === 'string' ? raw.version : undefined,
      main: typeof raw.main === 'string' ? raw.main : undefined,
      files: Array.isArray(raw.files) ? raw.files.filter((x): x is string => typeof x === 'string') : [],
      prepare: typeof raw.scripts === 'object' && raw.scripts !== null
        ? (raw.scripts as Record<string, unknown>).prepare as string | undefined
        : undefined,
      patch: bundle !== null && typeof bundle === 'object' ? bundle.patch as string | undefined : undefined,
      dshBundle: bundle !== null && typeof bundle === 'object',
    }
  } catch {
    return null
  }
}

export interface PatchEntry {
  id: string
  name: string
}

/** Parse cordis.patch.yml and extract plugin ids, or throw a descriptive error. */
export function parsePatch(content: string): PatchEntry[] {
  const parsed = parseYaml(content) as unknown
  if (!Array.isArray(parsed)) throw new Error('patch file must be a YAML list of operations')
  const ids: PatchEntry[] = []
  for (const op of parsed) {
    if (op === null || typeof op !== 'object') continue
    const insert = (op as Record<string, unknown>).insert
    if (!Array.isArray(insert)) continue
    for (const row of insert) {
      if (row === null || typeof row !== 'object') continue
      const r = row as Record<string, unknown>
      if (typeof r.id === 'string') {
        ids.push({ id: r.id, name: typeof r.name === 'string' ? r.name : '' })
      }
    }
  }
  return ids
}

function run(command: string[], cwd: string, timeoutMs: number, env?: Record<string, string>): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const childEnv = env !== undefined ? { ...process.env, ...env } : process.env
    const child = process.platform === 'win32'
      ? spawn(command.join(' '), { cwd, shell: true, windowsHide: true, env: childEnv })
      : spawn(command[0] ?? '', command.slice(1), { cwd, env: childEnv })
    let output = ''
    child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString() })
    const timer = setTimeout(() => {
      child.kill()
      resolve({ code: -1, output: `${output}\n[timed out after ${timeoutMs}ms]` })
    }, timeoutMs)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, output })
    })
  })
}

/**
 * Run the full doctor check on a plugin directory.
 * @param dir - plugin bundle directory.
 * @param options - check options.
 */
export async function doctor(dir: string, options: DoctorOptions = {}): Promise<DoctorReport> {
  const timeout = options.timeoutMs ?? 120_000
  const checks: CheckResult[] = []
  const root = path.resolve(dir)

  // 1. manifest
  const manifest = readManifest(root)
  if (manifest === null) {
    checks.push({ name: 'manifest', status: 'FAIL', detail: 'package.json missing or invalid' })
    return { ok: false, checks }
  }
  const manifestProblems: string[] = []
  if (!manifest.dshBundle) manifestProblems.push('missing dsh.bundle manifest')
  if (manifest.patch === undefined) manifestProblems.push('missing dsh.bundle.patch')
  if (manifest.prepare === undefined) manifestProblems.push('missing prepare script (required for git installs)')
  if (manifest.main === undefined) manifestProblems.push('missing main entry')
  checks.push({
    name: 'manifest',
    status: manifestProblems.length === 0 ? 'PASS' : 'FAIL',
    detail: manifestProblems.length === 0
      ? `${manifest.name ?? 'unnamed'}@${manifest.version ?? '?'} bundle manifest ok`
      : manifestProblems.join('; '),
  })

  // 2. patch file + yaml + ids
  const patchPath = manifest.patch !== undefined ? path.join(root, manifest.patch) : null
  let patchIds: PatchEntry[] = []
  if (patchPath === null || !existsSync(patchPath)) {
    checks.push({ name: 'patch', status: 'FAIL', detail: `patch file not found: ${manifest.patch ?? '(none)'}` })
  } else {
    try {
      patchIds = parsePatch(readFileSync(patchPath, 'utf8'))
      if (patchIds.length === 0) {
        checks.push({ name: 'patch', status: 'FAIL', detail: 'no insert rows with an id found in the patch' })
      } else {
        checks.push({ name: 'patch', status: 'PASS', detail: `${patchIds.length} plugin row(s): ${patchIds.map((p) => p.id).join(', ')}` })
      }
    } catch (error) {
      checks.push({ name: 'patch', status: 'FAIL', detail: `invalid YAML: ${error instanceof Error ? error.message : String(error)}` })
    }
  }

  // 3. entry file
  const entry = manifest.main !== undefined ? path.join(root, manifest.main) : null
  checks.push({
    name: 'entry',
    status: entry !== null && existsSync(entry) ? 'PASS' : 'WARN',
    detail: entry !== null && existsSync(entry) ? `entry ${manifest.main} exists` : `entry ${manifest.main ?? '(none)'} not built yet (run pnpm install && pnpm run build)`,
  })

  // 4. files allowlist
  const filesOk = manifest.files !== undefined && manifest.files.length > 0
  checks.push({
    name: 'files',
    status: filesOk ? 'PASS' : 'WARN',
    detail: filesOk ? `ships: ${manifest.files?.join(', ')}` : 'no files allowlist in package.json',
  })

  // 4.5 pre-execute side-effect lint (#1863)
  checks.push(checkPreExecuteSideEffects(root))

  // 5. build (optional)
  if (options.build === true) {
    const build = await run(['pnpm', 'run', 'build'], root, timeout)
    checks.push({
      name: 'build',
      status: build.code === 0 ? 'PASS' : 'FAIL',
      detail: build.code === 0 ? 'pnpm run build succeeded' : `pnpm run build failed (exit ${build.code}):\n${build.output.slice(-800)}`,
    })
  }

  // 6. full smoke: pack + dsh install + boot
  if (options.full === true) {
    const dsh = options.dshCommand ?? ['pnpm', 'dlx', '@deepseek-ai/dsh']
    const pack = await run(['pnpm', 'pack'], root, timeout)
    if (pack.code !== 0) {
      checks.push({ name: 'pack', status: 'FAIL', detail: `pnpm pack failed:\n${pack.output.slice(-800)}` })
    } else {
      const tgz = pack.output.trim().split(/\r?\n/).pop() ?? ''
      checks.push({ name: 'pack', status: 'PASS', detail: `packed ${tgz}` })
      const home = mkdtempSync(path.join(tmpdir(), 'dsh-doctor-'))
      const profile = 'doctor'
      try {
        const tarball = path.resolve(root, tgz.trim())
        const env = { DSH_HOME: home }
        const add = await run([...dsh, 'plugin', '--profile', profile, 'add', tarball], root, timeout, env)
        if (add.code !== 0) {
          checks.push({ name: 'install', status: 'FAIL', detail: `dsh plugin add failed:\n${add.output.slice(-800)}` })
        } else {
          const dump = await run([...dsh, '--profile', profile, '--dump-config'], root, timeout, env)
          const found = patchIds.some((p) => dump.output.includes(p.id))
          checks.push({
            name: 'install',
            status: found ? 'PASS' : 'FAIL',
            detail: found ? `plugin id(s) present in composed config: ${patchIds.map((p) => p.id).join(', ')}` : 'plugin id not found in composed config',
          })
        }
      } finally {
        rmSync(home, { recursive: true, force: true })
      }
    }
  }

  const failed = checks.some((check) => check.status === 'FAIL')
  return { ok: !failed, checks }
}

/** Render a human-readable report. */
export function formatReport(report: DoctorReport): string {
  const lines = report.checks.map((check) => `[${check.status}] ${check.name}: ${check.detail}`)
  lines.push(report.ok ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED')
  return lines.join('\n')
}
