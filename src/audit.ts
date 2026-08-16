/** Evidence-first, offline inspection for DeepSeek Harness plugins. */

import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs'
import path from 'node:path'
import { load as parseYaml } from 'js-yaml'
import type {
  AuditConfidence,
  AuditCoverage,
  AuditEvidence,
  AuditFinding,
  AuditProvenance,
  AuditSeverity,
  CapabilityObservation,
  ConfigurationChange,
  DependencyObservation,
  LifecycleScriptObservation,
  PluginAuditComparison,
  PluginAuditReport,
  PluginEcosystemAuditReport,
} from './audit-types.js'

export type {
  AuditConfidence,
  AuditCoverage,
  AuditEvidence,
  AuditFinding,
  AuditProvenance,
  AuditSeverity,
  CapabilityObservation,
  ConfigurationChange,
  DependencyObservation,
  LifecycleScriptObservation,
  PluginAuditComparison,
  PluginAuditReport,
  PluginEcosystemAuditReport,
} from './audit-types.js'

interface PackageManifest {
  name?: unknown
  version?: unknown
  license?: unknown
  repository?: unknown
  packageManager?: unknown
  gitHead?: unknown
  _resolved?: unknown
  _integrity?: unknown
  scripts?: unknown
  dependencies?: unknown
  optionalDependencies?: unknown
  peerDependencies?: unknown
  dsh?: unknown
}

interface TextFile {
  absolutePath: string
  relativePath: string
  text: string
  bytes: number
}

interface PatternRule {
  kind: CapabilityObservation['kind']
  confidence: AuditConfidence
  pattern: RegExp
}

const TEXT_EXTENSIONS = new Set([
  '.bat', '.cjs', '.cmd', '.cts', '.html', '.js', '.jsx', '.json', '.mjs', '.mts', '.ps1', '.py', '.sh', '.svelte', '.ts', '.tsx', '.vbs', '.vue', '.yaml', '.yml',
])
const EXCLUDED_DIRECTORIES = new Set(['.git', '.hg', '.svn', 'node_modules', 'coverage', '.DS_Store'])
const WORKING_TREE_NON_RUNTIME_DIRECTORIES = new Set([
  'test', 'tests', '__tests__', 'fixtures', '__fixtures__',
  'sample', 'samples', 'example', 'examples', 'demo', 'demos',
  'scripts',
])
const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024
const MAX_SCAN_DEPTH = 16
const MAX_EVIDENCE_PER_RULE = 20

const LIFECYCLE_SCRIPTS = new Set([
  'preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly',
])

const CAPABILITY_RULES: PatternRule[] = [
  {
    kind: 'process',
    confidence: 'high',
    pattern: /node:child_process|from\s+['"]child_process['"]|require\(\s*['"]child_process['"]\s*\)|\bBun\.spawn\b|\bDeno\.Command\b|\b(?:spawn|spawnSync|execFile|execFileSync|execSync|fork)\s*\(/i,
  },
  {
    kind: 'network',
    confidence: 'high',
    pattern: /\bfetch\s*\(|node:(?:http|https|net|tls|dgram)|from\s+['"](?:axios|got|undici|ws)['"]|require\(\s*['"](?:axios|got|undici|ws)['"]\s*\)|\bWebSocket\s*\(/i,
  },
  {
    kind: 'filesystem',
    confidence: 'high',
    pattern: /node:fs(?:\/promises)?|from\s+['"]fs(?:\/promises)?['"]|require\(\s*['"]fs(?:\/promises)?['"]\s*\)|\b(?:readFile|writeFile|appendFile|createReadStream|createWriteStream|readdir|rm|unlink|rename)(?:Sync)?\s*\(/i,
  },
  {
    kind: 'environment',
    confidence: 'high',
    pattern: /\bprocess\.env\b|\bos\.homedir\s*\(|\bprocess\.cwd\s*\(/i,
  },
  {
    kind: 'credentials',
    confidence: 'medium',
    pattern: /process\.env(?:\.[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)|\[['"][^'"]*(?:key|secret|token|password|credential)[^'"]*['"]\])|(?:^|[/\\])\.env\b|id_(?:rsa|ed25519)|\.netrc|\.pgpass|\.aws[/\\]credentials/i,
  },
  {
    kind: 'dynamic-code',
    confidence: 'high',
    pattern: /(?<![\w$.])eval\s*\(|\bnew\s+Function\s*\(\s*(?!['"`]\s*['"`]\s*\))|\bFunction\s*\(\s*(?!['"`]\s*['"`]\s*\))['"`]|\bvm\.(?:runInNewContext|runInThisContext|compileFunction)\s*\(/i,
  },
  {
    kind: 'native-code',
    confidence: 'medium',
    pattern: /\.node['"`]|\b(?:node-gyp|prebuild-install|node-pre-gyp)\b|(?:from\s+|require\(\s*)['"](?:koffi|ffi-napi|bindings)['"]/i,
  },
  {
    kind: 'persistence',
    confidence: 'medium',
    pattern: /\bschtasks(?:\.exe)?\s+\/create\b|\blaunchctl\s+(?:load|bootstrap|enable)\b|\bsystemctl\s+(?:enable|start)\b|\bcrontab\s+(?:-|[^;\n]*\s-e\b)|(?:writeFile|appendFile|createWriteStream)(?:Sync)?\s*\([^\n]{0,240}(?:authorized_keys|\.(?:bashrc|zshrc|profile)\b|CurrentVersion[/\\]Run)|(?:authorized_keys|\.(?:bashrc|zshrc|profile)\b|CurrentVersion[/\\]Run)[^\n]{0,240}(?:>>|\btee\b|writeFile|appendFile|createWriteStream)/i,
  },
  {
    kind: 'browser-storage',
    confidence: 'high',
    pattern: /\b(?:localStorage|sessionStorage|indexedDB|document\.cookie)\b/i,
  },
  {
    kind: 'session-data',
    confidence: 'medium',
    pattern: /\.dsh[/\\](?:sessions|storages)|session\.jsonl|\bctx\.sessions\b|\bsessionPersistence\b/i,
  },
  {
    kind: 'clipboard',
    confidence: 'medium',
    pattern: /\b(?:navigator|electron)\.clipboard\b|(?:from\s+|require\(\s*)['"]clipboardy['"]|\b(?:pbpaste|pbcopy|Get-Clipboard|Set-Clipboard)\b/i,
  },
  {
    kind: 'dynamic-module-loading',
    confidence: 'medium',
    pattern: /\bimport\s*\(\s*(?!['"`])|\brequire\s*\(\s*(?!['"])/i,
  },
]

const SEVERITY_ORDER: Record<AuditSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function repositoryValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (isRecord(value)) return stringValue(value.url)
  return undefined
}

function redactExcerpt(input: string): string {
  return input
    .replace(/((?:api[_-]?key|token|secret|password|credential)\s*[:=]\s*)(['"`]?)[^\s,'"`;]+/gi, '$1$2[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{10,}\b/g, '[redacted-token]')
    .replace(/-----BEGIN [^-]+ PRIVATE KEY-----/g, '[redacted-private-key-header]')
    .slice(0, 240)
}

function evidenceAt(relativePath: string, text: string, index: number): AuditEvidence {
  const before = text.slice(0, index)
  const line = before.split('\n').length
  const lineStart = text.lastIndexOf('\n', index - 1) + 1
  const nextNewline = text.indexOf('\n', index)
  const lineEnd = nextNewline === -1 ? text.length : nextNewline
  return {
    path: relativePath,
    line,
    excerpt: redactExcerpt(text.slice(lineStart, lineEnd).trim()),
  }
}

function evidenceForNeedle(relativePath: string, text: string, needle: string): AuditEvidence {
  const index = text.indexOf(needle)
  return evidenceAt(relativePath, text, index === -1 ? 0 : index)
}

interface TextRange {
  start: number
  end: number
}

function ignoredDynamicCodeRanges(text: string): TextRange[] {
  const ranges: TextRange[] = []
  let state: 'code' | 'single' | 'double' | 'template' | 'line-comment' | 'block-comment' | 'regex' = 'code'
  let start = 0
  let escaped = false
  let regexClass = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? ''
    const next = text[index + 1] ?? ''
    if (state === 'code') {
      if (char === "'") { state = 'single'; start = index; escaped = false; continue }
      if (char === '"') { state = 'double'; start = index; escaped = false; continue }
      if (char === '`') { state = 'template'; start = index; escaped = false; continue }
      if (char === '/' && next === '/') { state = 'line-comment'; start = index; index += 1; continue }
      if (char === '/' && next === '*') { state = 'block-comment'; start = index; index += 1; continue }
      if (char === '/' && next !== '/' && next !== '*') {
        const before = text.slice(Math.max(0, index - 48), index)
        if (/(?:^|[=([{,:;!?&|])\s*$|(?:\breturn|\bthrow|\bcase|=>)\s*$/.test(before)) {
          state = 'regex'
          start = index
          escaped = false
          regexClass = false
        }
      }
      continue
    }
    if (state === 'line-comment') {
      if (char === '\n') { ranges.push({ start, end: index }); state = 'code' }
      continue
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') { ranges.push({ start, end: index + 2 }); state = 'code'; index += 1 }
      continue
    }
    if (state === 'regex') {
      if (escaped) { escaped = false; continue }
      if (char === '\\') { escaped = true; continue }
      if (char === '[') { regexClass = true; continue }
      if (char === ']' && regexClass) { regexClass = false; continue }
      if (char === '/' && !regexClass) {
        let end = index + 1
        while (/[a-z]/i.test(text[end] ?? '')) end += 1
        ranges.push({ start, end })
        state = 'code'
        index = end - 1
      }
      continue
    }
    if (escaped) { escaped = false; continue }
    if (char === '\\') { escaped = true; continue }
    if ((state === 'single' && char === "'") || (state === 'double' && char === '"') || (state === 'template' && char === '`')) {
      ranges.push({ start, end: index + 1 })
      state = 'code'
    }
  }
  if (state !== 'code') ranges.push({ start, end: text.length })
  return ranges
}

function findEvidence(relativePath: string, text: string, pattern: RegExp, ignoredRanges: TextRange[] = []): AuditEvidence[] {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  const matcher = new RegExp(pattern.source, flags)
  const evidence: AuditEvidence[] = []
  let match: RegExpExecArray | null
  while ((match = matcher.exec(text)) !== null && evidence.length < MAX_EVIDENCE_PER_RULE) {
    if (ignoredRanges.some(range => match !== null && match.index >= range.start && match.index < range.end)) {
      if (match[0].length === 0) matcher.lastIndex += 1
      continue
    }
    const item = evidenceAt(relativePath, text, match.index)
    const trimmed = item.excerpt.trim()
    const nonExecutableRuleText = /\bpattern\s*:\s*\//.test(trimmed)
      || /^\/\//.test(trimmed)
      || /^\/\*/.test(trimmed)
      || /^\*/.test(trimmed)
      || /^\/.+\/[a-z]*,?$/.test(trimmed)
      || /^const\s+[A-Z0-9_]+\s*=\s*\//.test(trimmed)
    if (!nonExecutableRuleText) evidence.push(item)
    if (match[0].length === 0) matcher.lastIndex += 1
  }
  return Array.from(new Map(evidence.map(item => [`${item.path}:${item.line}:${item.excerpt}`, item])).values())
}

function fingerprint(ruleId: string, evidence: AuditEvidence[]): string {
  const normalized = evidence.map(item => `${item.path}:${item.excerpt}`).sort().join('|')
  return createHash('sha256').update(`${ruleId}\0${normalized}`).digest('hex').slice(0, 24)
}

function finding(
  ruleId: string,
  category: AuditFinding['category'],
  severity: AuditSeverity,
  confidence: AuditConfidence,
  title: string,
  explanation: string,
  evidence: AuditEvidence[],
  recommendation?: string,
): AuditFinding {
  return {
    fingerprint: fingerprint(ruleId, evidence),
    ruleId,
    category,
    severity,
    confidence,
    title,
    explanation,
    evidence,
    ...(recommendation === undefined ? {} : { recommendation }),
  }
}

function addSkipped(
  coverage: AuditCoverage,
  relativePath: string,
  reason: string,
): void {
  coverage.skippedFiles += 1
  coverage.skippedByReason[reason] = (coverage.skippedByReason[reason] ?? 0) + 1
  if (coverage.skippedExamples.length < 40) coverage.skippedExamples.push({ path: relativePath, reason })
}

function discoverTextFiles(root: string, coverage: AuditCoverage, scanRoots: string[]): TextFile[] {
  const files = new Map<string, TextFile>()
  const seen = new Set<string>()
  const walk = (directory: string, depth: number): void => {
    if (depth > MAX_SCAN_DEPTH) {
      addSkipped(coverage, path.relative(root, directory), 'depth-limit')
      return
    }
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      addSkipped(coverage, path.relative(root, directory), 'unreadable-directory')
      return
    }
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name)
      if (seen.has(absolutePath)) continue
      seen.add(absolutePath)
      const relativePath = path.relative(root, absolutePath) || entry.name
      if (entry.isSymbolicLink()) {
        coverage.discoveredFiles += 1
        addSkipped(coverage, relativePath, 'symbolic-link')
        continue
      }
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.has(entry.name)) continue
        if (coverage.scanMode === 'working-tree' && WORKING_TREE_NON_RUNTIME_DIRECTORIES.has(entry.name)) {
          let count = 0
          try {
            count = readdirSync(absolutePath, { recursive: true }).length
          } catch {
            count = 1
          }
          coverage.discoveredFiles += count
          coverage.skippedFiles += count
          coverage.skippedByReason['working-tree-non-runtime'] = (coverage.skippedByReason['working-tree-non-runtime'] ?? 0) + count
          if (coverage.skippedExamples.length < 40) coverage.skippedExamples.push({ path: relativePath, reason: 'working-tree-non-runtime' })
          continue
        }
        walk(absolutePath, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      coverage.discoveredFiles += 1
      if (entry.name.endsWith('.d.ts')) {
        addSkipped(coverage, relativePath, 'type-declaration')
        continue
      }
      const extension = path.extname(entry.name).toLowerCase()
      if (!TEXT_EXTENSIONS.has(extension) && entry.name !== 'Dockerfile') {
        addSkipped(coverage, relativePath, 'non-text-extension')
        continue
      }
      let size: number
      try {
        size = statSync(absolutePath).size
      } catch {
        addSkipped(coverage, relativePath, 'unreadable-file')
        continue
      }
      if (size > MAX_TEXT_FILE_BYTES) {
        addSkipped(coverage, relativePath, 'file-size-limit')
        continue
      }
      try {
        const text = readFileSync(absolutePath, 'utf8')
        files.set(absolutePath, { absolutePath, relativePath, text, bytes: Buffer.byteLength(text) })
        coverage.scannedFiles += 1
        coverage.scannedBytes += Buffer.byteLength(text)
      } catch {
        addSkipped(coverage, relativePath, 'unreadable-file')
      }
    }
  }
  for (const scanRoot of scanRoots) {
    if (!existsSync(scanRoot)) {
      addSkipped(coverage, path.relative(root, scanRoot), 'declared-path-missing')
      continue
    }
    const stat = lstatSync(scanRoot)
    if (stat.isDirectory()) {
      walk(scanRoot, 0)
      continue
    }
    const relativePath = path.relative(root, scanRoot)
    if (seen.has(scanRoot)) continue
    seen.add(scanRoot)
    coverage.discoveredFiles += 1
    if (path.basename(scanRoot).endsWith('.d.ts')) {
      addSkipped(coverage, relativePath, 'type-declaration')
      continue
    }
    const extension = path.extname(scanRoot).toLowerCase()
    if (!TEXT_EXTENSIONS.has(extension) && path.basename(scanRoot) !== 'Dockerfile') {
      addSkipped(coverage, relativePath, 'non-text-extension')
      continue
    }
    const size = stat.size
    if (size > MAX_TEXT_FILE_BYTES) {
      addSkipped(coverage, relativePath, 'file-size-limit')
      continue
    }
    try {
      const text = readFileSync(scanRoot, 'utf8')
      files.set(scanRoot, { absolutePath: scanRoot, relativePath, text, bytes: Buffer.byteLength(text) })
      coverage.scannedFiles += 1
      coverage.scannedBytes += Buffer.byteLength(text)
    } catch {
      addSkipped(coverage, relativePath, 'unreadable-file')
    }
  }
  return Array.from(files.values()).sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

function contentDigest(files: TextFile[]): string {
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file.relativePath)
    hash.update('\0')
    hash.update(file.text)
    hash.update('\0')
  }
  return hash.digest('hex')
}

function readManifest(root: string): { manifest: PackageManifest | null; text: string } {
  const manifestPath = path.join(root, 'package.json')
  if (!existsSync(manifestPath)) return { manifest: null, text: '' }
  const text = readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '')
  try {
    return { manifest: JSON.parse(text) as PackageManifest, text }
  } catch {
    return { manifest: null, text }
  }
}

interface PublishedScanRoots {
  mode: AuditCoverage['scanMode']
  paths: string[]
  roots: string[]
  unsafePaths: string[]
}

function resolveInsideRoot(root: string, candidate: string): string | null {
  const resolved = path.resolve(root, candidate)
  const relative = path.relative(root, resolved)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)) ? resolved : null
}

function publishedScanRoots(root: string, manifest: PackageManifest | null): PublishedScanRoots {
  if (manifest === null || !Array.isArray((manifest as Record<string, unknown>).files)) {
    return { mode: 'working-tree', paths: [], roots: [root], unsafePaths: [] }
  }
  const declared = ((manifest as Record<string, unknown>).files as unknown[])
    .filter((item): item is string => typeof item === 'string' && item !== '')
  const simple = declared.filter(item => !/[*?\[\]{}!]/.test(item))
  const unsafePaths = simple.filter(item => resolveInsideRoot(root, item) === null)
  const roots = simple.flatMap(item => {
    const resolved = resolveInsideRoot(root, item)
    return resolved === null ? [] : [resolved]
  })
  roots.push(path.join(root, 'package.json'))
  const dsh = isRecord(manifest.dsh) ? manifest.dsh : undefined
  const bundle = dsh !== undefined && isRecord(dsh.bundle) ? dsh.bundle : undefined
  const patchFile = bundle === undefined ? undefined : stringValue(bundle.patch)
  if (patchFile !== undefined) {
    const resolvedPatch = resolveInsideRoot(root, patchFile)
    if (resolvedPatch === null) unsafePaths.push(patchFile)
    else roots.push(resolvedPatch)
  }
  const mainFile = stringValue((manifest as Record<string, unknown>).main)
  if (mainFile !== undefined) {
    const resolvedMain = resolveInsideRoot(root, mainFile)
    if (resolvedMain === null) unsafePaths.push(mainFile)
    else if (!existsSync(resolvedMain)) return { mode: 'working-tree', paths: declared, roots: Array.from(new Set([root, ...roots])), unsafePaths }
  }
  const hasExistingPublishedPath = roots.some(item => item !== path.join(root, 'package.json') && existsSync(item))
  if (!hasExistingPublishedPath) return { mode: 'working-tree', paths: declared, roots: Array.from(new Set([root, ...roots])), unsafePaths }
  return { mode: 'published-files', paths: declared, roots, unsafePaths }
}

function readLocalGit(root: string): { remote?: string; commit?: string } {
  const dotGit = path.join(root, '.git')
  if (!existsSync(dotGit)) return {}
  try {
    const stat = lstatSync(dotGit)
    if (!stat.isDirectory()) return {}
    const configPath = path.join(dotGit, 'config')
    const headPath = path.join(dotGit, 'HEAD')
    let remote: string | undefined
    if (existsSync(configPath)) {
      const config = readFileSync(configPath, 'utf8')
      const match = /\[remote\s+"origin"\][\s\S]*?\n\s*url\s*=\s*(.+)/.exec(config)
      remote = match?.[1]?.trim()
    }
    let commit: string | undefined
    if (existsSync(headPath)) {
      const head = readFileSync(headPath, 'utf8').trim()
      if (head.startsWith('ref: ')) {
        const refPath = path.join(dotGit, head.slice(5))
        if (existsSync(refPath)) commit = readFileSync(refPath, 'utf8').trim()
      } else if (/^[a-f0-9]{40}$/i.test(head)) {
        commit = head
      }
    }
    return { remote, commit }
  } catch {
    return {}
  }
}

function manifestScripts(manifest: PackageManifest | null): Record<string, string> {
  if (manifest === null || !isRecord(manifest.scripts)) return {}
  return Object.fromEntries(
    Object.entries(manifest.scripts).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

function dependencySourceType(spec: string): DependencyObservation['sourceType'] {
  if (/^(?:git\+|git:|github:|gitlab:|bitbucket:)/i.test(spec) || /^[\w.-]+\/[\w.-]+(?:#.*)?$/.test(spec)) return 'git'
  if (/^https?:/i.test(spec)) return 'url'
  if (/^(?:file:|link:)/i.test(spec)) return 'file'
  if (/^workspace:/i.test(spec)) return 'workspace'
  if (/^(?:latest|next|beta|canary|dev)$/i.test(spec) || spec === '*') return 'tag'
  if (/^(?:v)?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(spec)) return 'exact'
  if (/^[~^<>=]|\s+-\s+|\|\|/.test(spec)) return 'range'
  return 'unknown'
}

function packageJsonEvidence(text: string, key: string): AuditEvidence {
  return evidenceForNeedle('package.json', text, `"${key}"`)
}

function inspectDependencies(
  root: string,
  manifest: PackageManifest | null,
  manifestText: string,
  coverage: AuditCoverage,
  findings: AuditFinding[],
  lifecycleScripts: LifecycleScriptObservation[],
): DependencyObservation[] {
  const observations: DependencyObservation[] = []
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
    const values = manifest === null ? undefined : manifest[section]
    if (!isRecord(values)) continue
    for (const [name, rawSpec] of Object.entries(values)) {
      if (typeof rawSpec !== 'string') continue
      if (section !== 'peerDependencies') coverage.declaredRuntimeDependencies += 1
      const sourceType = dependencySourceType(rawSpec)
      const validDependencyName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(name)
      const dependencyPath = validDependencyName ? path.join(root, 'node_modules', ...name.split('/')) : ''
      let installedVersion: string | undefined
      const nestedLifecycle: string[] = []
      if (!validDependencyName) {
        findings.push(finding(
          'dependency-name-invalid',
          'dependency',
          'high',
          'high',
          `Dependency name ${name} is not a valid npm package name`,
          'Invalid dependency keys can be used to confuse local path inspection and do not identify a normal registry package.',
          [packageJsonEvidence(manifestText, name)],
          'Use a valid npm package name and keep local sources in the dependency value, not the key.',
        ))
      } else if (existsSync(path.join(dependencyPath, 'package.json'))) {
        try {
          const nestedText = readFileSync(path.join(dependencyPath, 'package.json'), 'utf8')
          const nested = JSON.parse(nestedText) as PackageManifest
          installedVersion = stringValue(nested.version)
          const scripts = manifestScripts(nested)
          for (const [script, command] of Object.entries(scripts)) {
            if (!LIFECYCLE_SCRIPTS.has(script)) continue
            nestedLifecycle.push(script)
            const evidence = evidenceForNeedle(path.join('node_modules', ...name.split('/'), 'package.json'), nestedText, `"${script}"`)
            lifecycleScripts.push({
              packageName: name,
              ...(installedVersion === undefined ? {} : { packageVersion: installedVersion }),
              script,
              command: redactExcerpt(command),
              direct: false,
              evidence,
            })
          }
          coverage.inspectedInstalledDependencies += 1
        } catch {
          coverage.unresolvedInstalledDependencies += 1
        }
      } else if (section !== 'peerDependencies' && validDependencyName) {
        coverage.unresolvedInstalledDependencies += 1
      }
      observations.push({
        name,
        section,
        spec: redactExcerpt(rawSpec),
        sourceType,
        ...(installedVersion === undefined ? {} : { installedVersion }),
        ...(validDependencyName && existsSync(dependencyPath) ? { installedPath: path.relative(root, dependencyPath) } : {}),
        lifecycleScripts: nestedLifecycle.sort(),
      })
      if (sourceType === 'git' || sourceType === 'url') {
        const evidence = packageJsonEvidence(manifestText, name)
        findings.push(finding(
          `dependency-${sourceType}-source`,
          'dependency',
          'medium',
          'high',
          `Dependency ${name} is installed from a ${sourceType === 'git' ? 'Git repository' : 'remote URL'}`,
          'Remote and Git dependency specifications are harder to reproduce and may change outside normal registry integrity checks.',
          [evidence],
          'Pin an immutable commit or registry version and record its integrity metadata.',
        ))
      } else if (sourceType === 'file') {
        const evidence = packageJsonEvidence(manifestText, name)
        findings.push(finding(
          'dependency-local-source',
          'dependency',
          'low',
          'high',
          `Dependency ${name} uses a local file or link`,
          'Local dependency sources are not reproducible on another machine and can hide code outside the reviewed package directory.',
          [evidence],
          'Publish or vendor the exact dependency content and record a digest.',
        ))
      } else if (sourceType === 'tag') {
        const evidence = packageJsonEvidence(manifestText, name)
        findings.push(finding(
          'dependency-floating-tag',
          'dependency',
          'low',
          'high',
          `Dependency ${name} uses a floating tag`,
          'Tags such as latest or next can resolve to different code at different installation times.',
          [evidence],
          'Use a bounded version range and commit a lockfile.',
        ))
      }
    }
  }
  return observations.sort((left, right) => left.name.localeCompare(right.name) || left.section.localeCompare(right.section))
}

function collectKeyPaths(value: unknown, prefix = ''): string[] {
  if (!isRecord(value)) return []
  const keys: string[] = []
  for (const [key, nested] of Object.entries(value)) {
    const full = prefix === '' ? key : `${prefix}.${key}`
    keys.push(full)
    keys.push(...collectKeyPaths(nested, full))
  }
  return keys
}

const SENSITIVE_CONFIGURATION = /(?:^|\.)(?:approval|sandbox|permission|credentials?|subprocess|shell|bash|pwsh|terminal|filesystem|fs|tools?|mcp|host|trustedHosts?|env|command|args|url|root|cwd|mode|policy|disabled)(?:\.|$)/i
const SENSITIVE_ENTRY = /(?:approval|sandbox|permission|credential|subprocess|shell|bash|pwsh|terminal|filesystem|(?:^|-)fs(?:-|$)|tools?|mcp|webserver|apiproxy)/i

function parseConfigurationChanges(patchPath: string, root: string, findings: AuditFinding[]): ConfigurationChange[] {
  if (!existsSync(patchPath)) return []
  const relativePath = path.relative(root, patchPath)
  const text = readFileSync(patchPath, 'utf8')
  const changes: ConfigurationChange[] = []
  let parsed: unknown
  try {
    parsed = parseYaml(text.replace(/!!js\s+/g, ''))
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const sandboxReplacementEvidence: AuditEvidence[] = []
  for (const operation of parsed) {
    if (!isRecord(operation) || !Array.isArray(operation.insert)) continue
    for (const row of operation.insert) {
      if (!isRecord(row)) continue
      const entryId = stringValue(row.id)
      const moduleName = stringValue(row.name)
      if (!/sandbox/i.test(`${entryId ?? ''} ${moduleName ?? ''}`)) continue
      sandboxReplacementEvidence.push(evidenceForNeedle(
        relativePath,
        text,
        entryId === undefined ? '- insert:' : `id: ${entryId}`,
      ))
    }
  }
  for (const operation of parsed) {
    if (!isRecord(operation)) continue
    if (Array.isArray(operation.insert)) {
      for (const row of operation.insert) {
        if (!isRecord(row)) continue
        const entryId = stringValue(row.id)
        const moduleName = stringValue(row.name)
        const changedKeys = collectKeyPaths(row).filter(key => key !== 'id' && key !== 'name')
        const securitySensitive = SENSITIVE_ENTRY.test(entryId ?? '')
          || SENSITIVE_ENTRY.test(moduleName ?? '')
          || changedKeys.some(key => SENSITIVE_CONFIGURATION.test(key))
        const needle = entryId === undefined ? '- insert:' : `id: ${entryId}`
        changes.push({
          operation: 'insert',
          ...(entryId === undefined ? {} : { entryId }),
          ...(moduleName === undefined ? {} : { moduleName }),
          changedKeys,
          securitySensitive,
          evidence: evidenceForNeedle(relativePath, text, needle),
        })
      }
      continue
    }
    const entryId = stringValue(operation.id)
    if (entryId !== undefined) {
      const changedKeys = collectKeyPaths(operation).filter(key => key !== 'id')
      const moduleName = stringValue(operation.name)
      const securitySensitive = SENSITIVE_ENTRY.test(entryId)
        || SENSITIVE_ENTRY.test(moduleName ?? '')
        || changedKeys.some(key => SENSITIVE_CONFIGURATION.test(key))
      const change: ConfigurationChange = {
        operation: operation.remove === true ? 'remove' : 'modify',
        entryId,
        ...(moduleName === undefined ? {} : { moduleName }),
        changedKeys,
        securitySensitive,
        evidence: evidenceForNeedle(relativePath, text, `id: ${entryId}`),
      }
      changes.push(change)
      const serialized = JSON.stringify(operation)
      if (/danger-full-access/i.test(serialized)) {
        const dangerEvidence = findEvidence(relativePath, text, /danger-full-access/i)
        const conditional = dangerEvidence.some(item => /\?|process\.|env\b|platform\b/i.test(item.excerpt))
        findings.push(finding(
          'config-danger-full-access',
          'configuration',
          'high',
          'high',
          conditional
            ? `Configuration ${entryId} can enable unrestricted host access`
            : `Configuration ${entryId} enables unrestricted host access`,
          conditional
            ? 'The runtime expression can select danger-full-access under some host conditions, removing normal workspace restrictions for that execution path.'
            : 'The patch contains danger-full-access, which removes normal workspace restrictions for the affected execution path.',
          dangerEvidence.length > 0 ? dangerEvidence : [change.evidence],
          'Require an explicit user decision and document why narrower access is insufficient.',
        ))
      }
      if (/"policy":"never"/i.test(serialized) || (/approval/i.test(entryId) && operation.disabled === true)) {
        findings.push(finding(
          'config-approval-disabled',
          'configuration',
          'high',
          'high',
          `Configuration ${entryId} removes an approval check`,
          'The patch sets approval policy to never or disables an approval-related entry.',
          [change.evidence],
          'Keep approval enabled by default and make any bypass an explicit installation-time choice.',
        ))
      }
      if (/sandbox/i.test(entryId) && operation.disabled === true) {
        const hasReplacement = sandboxReplacementEvidence.length > 0
        findings.push(finding(
          'config-sandbox-disabled',
          'configuration',
          hasReplacement ? 'medium' : 'high',
          'high',
          hasReplacement
            ? `Configuration ${entryId} replaces a sandbox entry`
            : `Configuration ${entryId} disables a sandbox entry`,
          hasReplacement
            ? 'The patch disables one sandbox entry and inserts another sandbox provider. The replacement may be intentional, but its protection must be compared with the original.'
            : 'Disabling a sandbox entry can move commands or file operations onto the unrestricted host.',
          hasReplacement ? [change.evidence, ...sandboxReplacementEvidence] : [change.evidence],
          hasReplacement
            ? 'Confirm that the replacement sandbox covers the original command, file, network, and isolation boundaries.'
            : 'Explain the replacement protection or keep the sandbox entry enabled.',
        ))
      }
      continue
    }
    const key = Object.keys(operation)[0]
    changes.push({
      operation: key === 'remove' ? 'remove' : 'unknown',
      changedKeys: collectKeyPaths(operation),
      securitySensitive: collectKeyPaths(operation).some(item => SENSITIVE_CONFIGURATION.test(item)),
      evidence: evidenceForNeedle(relativePath, text, key === undefined ? '' : `${key}:`),
    })
  }
  const expressions = findEvidence(relativePath, text, /!!js\b/g)
  if (expressions.length > 0) {
    findings.push(finding(
      'config-runtime-expression',
      'configuration',
      'info',
      'high',
      'Configuration contains runtime JavaScript expressions',
      'Runtime expressions make the effective configuration depend on the host environment and should be included in manual review.',
      expressions,
    ))
  }
  return changes
}

function capabilityKey(capability: CapabilityObservation): string {
  return `${capability.kind}\0${capability.evidence.map(item => `${item.path}:${item.excerpt}`).sort().join('|')}`
}

type NetworkDestination = 'external' | 'same-origin' | 'unknown'

interface NetworkDestinationEvidence {
  external: AuditEvidence[]
  sameOrigin: AuditEvidence[]
  unknown: AuditEvidence[]
}

const OUTBOUND_NETWORK_CALL = /\bfetch\s*\(|\b(?:axios|got)(?:\.(?:get|post|put|patch|delete|head|request))?\s*\(|\bundici\.(?:request|fetch)\s*\(|\b(?:https?|net)\.(?:request|get|connect)\s*\(|\b(?:new\s+)?WebSocket\s*\(/gi

function classifyNetworkLiteral(literal: string): NetworkDestination {
  if (/^(?:\/|\.\.?\/)/.test(literal)) return 'same-origin'
  if (!/^(?:https?|wss?):\/\//i.test(literal)) return 'unknown'
  if (/^(?:https?|wss?):\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)(?=[:/]|$)/i.test(literal)) return 'same-origin'
  try {
    const hostname = new URL(literal).hostname.toLowerCase()
    if (hostname === 'localhost' || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(hostname)) return 'same-origin'
  } catch {
    return 'unknown'
  }
  return 'external'
}

function networkDestinationSymbols(text: string): Map<string, NetworkDestination> {
  const symbols = new Map<string, NetworkDestination>()
  const literalAssignments = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])([^'"`]*)\2/g
  let assignment: RegExpExecArray | null
  while ((assignment = literalAssignments.exec(text)) !== null) {
    const destination = classifyNetworkLiteral(assignment[3] ?? '')
    if (destination !== 'unknown') symbols.set(assignment[1] ?? '', destination)
  }
  const sameOriginUrls = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+URL\s*\([^,]+,\s*(?:(?:globalThis|window|document)\.)?location\.origin\s*\)/g
  while ((assignment = sameOriginUrls.exec(text)) !== null) symbols.set(assignment[1] ?? '', 'same-origin')
  return symbols
}

function classifyNetworkArgument(
  fragment: string,
  symbols: Map<string, NetworkDestination>,
): NetworkDestination {
  const argument = fragment.trimStart()
  if (/^(?:(?:globalThis|window|document)\.)?location\.origin\b/.test(argument)) return 'same-origin'
  if (/^new\s+URL\s*\([^,]+,\s*(?:(?:globalThis|window|document)\.)?location\.origin\b/.test(argument)) return 'same-origin'
  const literal = /^(['"`])([^'"`]*)\1/.exec(argument)?.[2]
  if (literal !== undefined) {
    const direct = classifyNetworkLiteral(literal)
    if (direct !== 'unknown') return direct
    const interpolatedSymbol = /^\$\{([A-Za-z_$][\w$]*)\}/.exec(literal)?.[1]
    if (interpolatedSymbol !== undefined) return symbols.get(interpolatedSymbol) ?? 'unknown'
  }
  const symbol = /^([A-Za-z_$][\w$]*)(?:\.toString\s*\(\s*\))?/.exec(argument)?.[1]
  if (symbol !== undefined) return symbols.get(symbol) ?? 'unknown'
  return 'unknown'
}

function inspectNetworkDestinations(file: TextFile): NetworkDestinationEvidence {
  const result: NetworkDestinationEvidence = { external: [], sameOrigin: [], unknown: [] }
  const symbols = networkDestinationSymbols(file.text)
  const matcher = new RegExp(OUTBOUND_NETWORK_CALL.source, OUTBOUND_NETWORK_CALL.flags)
  let match: RegExpExecArray | null
  while ((match = matcher.exec(file.text)) !== null) {
    const destination = classifyNetworkArgument(file.text.slice(matcher.lastIndex, matcher.lastIndex + 400), symbols)
    const evidence = evidenceAt(file.relativePath, file.text, match.index)
    if (destination === 'same-origin') result.sameOrigin.push(evidence)
    else result[destination].push(evidence)
    if (match[0].length === 0) matcher.lastIndex += 1
  }
  const deduplicate = (items: AuditEvidence[]): AuditEvidence[] => Array.from(
    new Map(items.map(item => [`${item.path}:${item.line}:${item.excerpt}`, item])).values(),
  ).slice(0, MAX_EVIDENCE_PER_RULE)
  return {
    external: deduplicate(result.external),
    sameOrigin: deduplicate(result.sameOrigin),
    unknown: deduplicate(result.unknown),
  }
}

function lowerSeverity(severity: AuditSeverity): AuditSeverity {
  if (severity === 'critical') return 'high'
  if (severity === 'high') return 'medium'
  if (severity === 'medium') return 'low'
  return 'info'
}

function isLikelyBundled(file: TextFile): boolean {
  const lineCount = Math.max(1, file.text.split('\n').length)
  return file.bytes > 50_000 || file.bytes / lineCount > 300 || /sourceMappingURL=/.test(file.text)
}

function isAncillaryFile(file: TextFile): boolean {
  const normalized = file.relativePath.replace(/\\/g, '/')
  const segments = normalized.split('/').map(segment => segment.toLowerCase())
  if (segments.some(segment => ['scripts', 'script', 'evals', 'eval', 'recipes', 'recipe', 'benchmarks', 'benchmark', 'examples', 'example', 'demos', 'demo', 'vendor', 'third-party', 'third_party'].includes(segment))) return true
  const basename = path.posix.basename(normalized).toLowerCase()
  return /(?:^|[-_.])(?:verify|smoke|benchmark|bench|fixture|example|demo|test|spec)(?:[-_.]|$)/.test(basename)
}

function inspectCapabilities(files: TextFile[], findings: AuditFinding[]): CapabilityObservation[] {
  const capabilities: CapabilityObservation[] = []
  const capabilityFiles = files.filter(file => path.extname(file.relativePath).toLowerCase() !== '.json')
  const filesByPath = new Map(capabilityFiles.map(file => [file.relativePath, file]))
  const networkByFile = new Map(capabilityFiles.map(file => [file.relativePath, inspectNetworkDestinations(file)]))
  const dynamicIgnoredByFile = new Map(capabilityFiles.map(file => [file.relativePath, ignoredDynamicCodeRanges(file.text)]))
  const byFile = new Map<string, Set<CapabilityObservation['kind']>>()
  const evidenceByFileAndKind = new Map<string, AuditEvidence[]>()
  for (const rule of CAPABILITY_RULES) {
    const evidence: AuditEvidence[] = []
    for (const file of capabilityFiles) {
      if (file.relativePath === 'package.json' || file.relativePath.endsWith('.yaml') || file.relativePath.endsWith('.yml')) continue
      const matches = findEvidence(
        file.relativePath,
        file.text,
        rule.pattern,
        rule.kind === 'dynamic-code' ? dynamicIgnoredByFile.get(file.relativePath) ?? [] : [],
      )
      if (matches.length === 0) continue
      evidence.push(...matches)
      const kinds = byFile.get(file.relativePath) ?? new Set<CapabilityObservation['kind']>()
      kinds.add(rule.kind)
      byFile.set(file.relativePath, kinds)
      evidenceByFileAndKind.set(`${file.relativePath}\0${rule.kind}`, matches)
    }
    if (evidence.length > 0) {
      capabilities.push({ kind: rule.kind, confidence: rule.confidence, evidence: evidence.slice(0, MAX_EVIDENCE_PER_RULE) })
    }
  }
  for (const capability of capabilities) {
    if (capability.kind === 'dynamic-code') {
      const onlyBundledEvidence = capability.evidence.every(item => {
        const file = filesByPath.get(item.path)
        return file !== undefined && isLikelyBundled(file)
      })
      const onlyAncillaryEvidence = capability.evidence.every(item => {
        const file = filesByPath.get(item.path)
        return file !== undefined && isAncillaryFile(file)
      })
      const weakRuntimeEvidence = onlyBundledEvidence || onlyAncillaryEvidence
      findings.push(finding(
        'code-dynamic-execution',
        'code',
        weakRuntimeEvidence ? 'medium' : 'high',
        weakRuntimeEvidence ? 'low' : 'high',
        onlyAncillaryEvidence
          ? 'An ancillary published tool contains dynamic code execution'
          : onlyBundledEvidence
            ? 'A generated bundle contains dynamic code execution'
          : 'Plugin can execute dynamically constructed code',
        onlyAncillaryEvidence
          ? 'The match is confined to a published script, evaluation, recipe, example, or verification tool rather than an identified plugin runtime path.'
          : onlyBundledEvidence
            ? 'The generated bundle contains eval, Function, or vm execution, but minification prevents reliable attribution to a plugin code path.'
          : 'Static inspection cannot determine what eval, Function, or vm execution will run.',
        capability.evidence,
        'Remove dynamic execution or require focused manual review of every input reaching it.',
      ))
    } else if (capability.kind === 'persistence') {
      const weakRuntimeEvidence = capability.evidence.every(item => {
        const file = filesByPath.get(item.path)
        return file !== undefined && (isLikelyBundled(file) || isAncillaryFile(file))
      })
      findings.push(finding(
        'host-persistence-surface',
        'code',
        weakRuntimeEvidence ? 'medium' : 'high',
        weakRuntimeEvidence ? 'low' : 'medium',
        weakRuntimeEvidence ? 'A generated or ancillary file references host persistence mechanisms' : 'Plugin references host persistence mechanisms',
        weakRuntimeEvidence
          ? 'The match is not in a clearly attributable plugin runtime path and requires lower-confidence review.'
          : 'Startup tasks, shell profiles, service managers, and authorized_keys can make code survive beyond the current DSH process.',
        capability.evidence,
        'Confirm the behavior is essential, disclosed, reversible, and explicitly approved.',
      ))
    } else if (capability.kind === 'native-code') {
      findings.push(finding(
        'native-code-surface',
        'code',
        'medium',
        'medium',
        'Plugin may load or build native code',
        'Native modules add platform-specific binaries and code outside ordinary JavaScript inspection.',
        capability.evidence,
        'Record supported binaries, build provenance, checksums, and install-script behavior.',
      ))
    }
  }
  for (const [relativePath, kinds] of byFile) {
    const sourceFile = filesByPath.get(relativePath)
    const likelyBundled = sourceFile !== undefined && isLikelyBundled(sourceFile)
    const ancillary = sourceFile !== undefined && isAncillaryFile(sourceFile)
    const combinationConfidence: AuditConfidence = likelyBundled || ancillary ? 'low' : 'medium'
    const networkDestinations = networkByFile.get(relativePath) ?? { external: [], sameOrigin: [], unknown: [] }
    const networkDestination: 'external' | 'unknown' | null = networkDestinations.external.length > 0
      ? 'external'
      : networkDestinations.unknown.length > 0
        ? 'unknown'
        : null
    const outboundNetworkEvidence = networkDestination === 'external'
      ? networkDestinations.external
      : networkDestination === 'unknown'
        ? networkDestinations.unknown
        : []
    const combineEvidence = (...requested: CapabilityObservation['kind'][]): AuditEvidence[] => requested.flatMap(
      kind => kind === 'network' ? outboundNetworkEvidence : evidenceByFileAndKind.get(`${relativePath}\0${kind}`) ?? [],
    ).slice(0, MAX_EVIDENCE_PER_RULE)
    const dataCombination = (kind: 'credentials' | 'session-data'): {
      evidence: AuditEvidence[]
      confidence: AuditConfidence
      distant: boolean
    } => {
      const sensitive = evidenceByFileAndKind.get(`${relativePath}\0${kind}`) ?? []
      const minimumDistance = sensitive.reduce((minimum, left) => Math.min(
        minimum,
        ...outboundNetworkEvidence.map(right => Math.abs(left.line - right.line)),
      ), Number.POSITIVE_INFINITY)
      const distant = !likelyBundled && minimumDistance > 160
      return {
        evidence: [...sensitive, ...outboundNetworkEvidence].slice(0, MAX_EVIDENCE_PER_RULE),
        confidence: likelyBundled || distant || ancillary ? 'low' : 'medium',
        distant,
      }
    }
    if (kinds.has('credentials') && networkDestination !== null) {
      const combination = dataCombination('credentials')
      const external = networkDestination === 'external'
      const baseSeverity: AuditSeverity = external ? (likelyBundled ? 'medium' : 'high') : (likelyBundled ? 'low' : 'medium')
      findings.push(finding(
        'credential-and-network-combination',
        'data-access',
        ancillary ? lowerSeverity(lowerSeverity(baseSeverity)) : combination.distant ? lowerSeverity(baseSeverity) : baseSeverity,
        combination.confidence,
        external
          ? 'Credential access and external network access occur in the same file'
          : 'Credential access and a dynamic network destination occur in the same file',
        ancillary
          ? 'The two capabilities occur in an ancillary published script, evaluation, recipe, example, or verification tool rather than an identified plugin runtime path.'
          : combination.distant
          ? 'The two capabilities occur in distant sections of the file, so co-location is weak evidence and does not establish a data flow.'
          : external
          ? 'This combination can be legitimate, but it is also the minimum surface needed to transmit credentials off the machine.'
          : 'The destination could not be determined statically. This is a review signal, not proof that credentials leave the machine.',
        combination.evidence,
        'Trace the data flow manually and restrict destinations and credential names.',
      ))
    }
    if (kinds.has('session-data') && networkDestination !== null) {
      const combination = dataCombination('session-data')
      const external = networkDestination === 'external'
      const baseSeverity: AuditSeverity = external ? (likelyBundled ? 'medium' : 'high') : (likelyBundled ? 'low' : 'medium')
      findings.push(finding(
        'session-data-and-network-combination',
        'data-access',
        ancillary ? lowerSeverity(lowerSeverity(baseSeverity)) : combination.distant ? lowerSeverity(baseSeverity) : baseSeverity,
        combination.confidence,
        external
          ? 'Session data access and external network access occur in the same file'
          : 'Session data access and a dynamic network destination occur in the same file',
        ancillary
          ? 'The two capabilities occur in an ancillary published script, evaluation, recipe, example, or verification tool rather than an identified plugin runtime path.'
          : combination.distant
          ? 'The two capabilities occur in distant sections of the file, so co-location is weak evidence and does not establish a data flow.'
          : external
          ? 'The file has the surface required to transmit DSH conversation or storage data to an external destination.'
          : 'The destination could not be determined statically. The file needs review, but this does not prove session data leaves the machine.',
        combination.evidence,
        'Verify the exact transmitted fields, destination allowlist, consent, and retention policy.',
      ))
    }
    if (networkDestination !== null && kinds.has('dynamic-code')) {
      const evidence = combineEvidence('network', 'dynamic-code')
      const baseSeverity: AuditSeverity = networkDestination === 'external'
        ? (likelyBundled ? 'medium' : 'high')
        : (likelyBundled ? 'low' : 'medium')
      findings.push(finding(
        'download-and-dynamic-code-surface',
        'code',
        ancillary ? lowerSeverity(lowerSeverity(baseSeverity)) : baseSeverity,
        combinationConfidence,
        'Outbound network access and dynamic code execution occur in the same file',
        'The file has the surface required to retrieve content and execute it through eval, Function, or vm. Static inspection does not prove that the two paths are connected.',
        evidence,
        'Verify data flow, pin downloaded content by digest, and avoid executing mutable remote content.',
      ))
    } else if (networkDestination !== null && kinds.has('process')) {
      const evidence = combineEvidence('network', 'process')
      const baseSeverity: AuditSeverity = networkDestination === 'external' ? 'medium' : 'low'
      findings.push(finding(
        'network-and-process-surface',
        'code',
        ancillary ? lowerSeverity(baseSeverity) : baseSeverity,
        combinationConfidence,
        'Outbound network access and process execution occur in the same file',
        'The file can communicate over the network and start local processes. Static inspection does not prove that downloaded data reaches a command.',
        evidence,
        'Review the data flow, executable allowlist, arguments, and network destinations.',
      ))
    }
  }
  return capabilities.sort((left, right) => left.kind.localeCompare(right.kind))
}

function inspectOwnLifecycleScripts(
  manifest: PackageManifest | null,
  manifestText: string,
  findings: AuditFinding[],
): LifecycleScriptObservation[] {
  const observations: LifecycleScriptObservation[] = []
  const packageName = stringValue(manifest?.name) ?? '(root package)'
  const packageVersion = stringValue(manifest?.version)
  for (const [script, command] of Object.entries(manifestScripts(manifest))) {
    if (!LIFECYCLE_SCRIPTS.has(script)) continue
    const evidence = packageJsonEvidence(manifestText, script)
    observations.push({
      packageName,
      ...(packageVersion === undefined ? {} : { packageVersion }),
      script,
      command: redactExcerpt(command),
      direct: true,
      evidence,
    })
    const suspicious = /\b(?:curl|wget|powershell|pwsh|bash\s+-c|sh\s+-c|certutil|bitsadmin)\b|https?:\/\//i.test(command)
    findings.push(finding(
      suspicious ? 'install-script-network-or-shell' : 'install-lifecycle-script',
      'install',
      suspicious ? 'high' : 'medium',
      'high',
      suspicious ? `Lifecycle script ${script} uses a network or shell surface` : `Lifecycle script ${script} runs during installation or publication`,
      suspicious
        ? 'The package can run a shell or retrieve remote content before the plugin audit or runtime protections begin.'
        : 'Lifecycle scripts execute outside the DSH runtime and therefore bypass runtime plugin checks.',
      [evidence],
      suspicious
        ? 'Remove mutable remote execution, pin any downloaded artifact by digest, and make the step explicit.'
        : 'Document why the script is required and keep it deterministic and side-effect limited.',
    ))
  }
  return observations
}

function summarize(findings: AuditFinding[]): PluginAuditReport['summary'] {
  const bySeverity: Record<AuditSeverity, number> = { info: 0, low: 0, medium: 0, high: 0, critical: 0 }
  const byCategory: Record<AuditFinding['category'], number> = {
    provenance: 0,
    install: 0,
    dependency: 0,
    configuration: 0,
    code: 0,
    'data-access': 0,
  }
  let highestSeverity: AuditSeverity = 'info'
  for (const item of findings) {
    bySeverity[item.severity] += 1
    byCategory[item.category] += 1
    if (SEVERITY_ORDER[item.severity] > SEVERITY_ORDER[highestSeverity]) highestSeverity = item.severity
  }
  const exitCode: 0 | 1 | 2 = bySeverity.critical + bySeverity.high > 0
    ? 2
    : bySeverity.medium > 0
      ? 1
      : 0
  return {
    highestSeverity,
    reviewRequired: exitCode === 2,
    bySeverity,
    byCategory,
    exitCode,
  }
}

/** Inspect one unpacked plugin directory without executing plugin code. */
export function auditPlugin(directory: string): PluginAuditReport {
  const root = path.resolve(directory)
  const { manifest, text: manifestText } = readManifest(root)
  const scanScope = publishedScanRoots(root, manifest)
  const coverage: AuditCoverage = {
    scanMode: scanScope.mode,
    declaredPublishedPaths: scanScope.paths,
    discoveredFiles: 0,
    scannedFiles: 0,
    scannedBytes: 0,
    skippedFiles: 0,
    skippedByReason: {},
    skippedExamples: [],
    declaredRuntimeDependencies: 0,
    inspectedInstalledDependencies: 0,
    unresolvedInstalledDependencies: 0,
  }
  const findings: AuditFinding[] = []
  const files = existsSync(root) ? discoverTextFiles(root, coverage, scanScope.roots) : []
  if (scanScope.unsafePaths.length > 0) {
    const evidence = scanScope.unsafePaths.map(value => packageJsonEvidence(manifestText, value))
    findings.push(finding(
      'manifest-path-escape',
      'provenance',
      'high',
      'high',
      'Manifest paths escape the plugin directory',
      'The scanner refused package files, main entries, or bundle patches that resolve outside the inspected plugin root.',
      evidence,
      'Keep every published file, main entry, and DSH patch inside the package directory.',
    ))
  }
  if (!existsSync(root)) {
    findings.push(finding(
      'subject-missing',
      'provenance',
      'critical',
      'high',
      'Plugin directory does not exist',
      'No plugin contents could be inspected.',
      [{ path: '.', line: 1, excerpt: root }],
    ))
  } else if (manifest === null) {
    findings.push(finding(
      'manifest-missing-or-invalid',
      'provenance',
      'high',
      'high',
      'package.json is missing or invalid',
      'Package identity, scripts, dependencies, and DSH bundle metadata cannot be verified.',
      [{ path: 'package.json', line: 1, excerpt: manifestText === '' ? '(missing)' : redactExcerpt(manifestText.split('\n')[0] ?? '') }],
    ))
  }
  const lifecycleScripts = inspectOwnLifecycleScripts(manifest, manifestText, findings)
  const dependencies = inspectDependencies(root, manifest, manifestText, coverage, findings, lifecycleScripts)
  for (const observation of lifecycleScripts.filter(item => !item.direct)) {
    findings.push(finding(
      'dependency-lifecycle-script',
      'dependency',
      'medium',
      'high',
      `Installed dependency ${observation.packageName} has a ${observation.script} script`,
      'Dependency lifecycle scripts can execute during installation before DSH runtime checks begin.',
      [observation.evidence],
      'Review the exact command and verify the installed package source and integrity.',
    ))
  }
  let configurationChanges: ConfigurationChange[] = []
  const dsh = manifest !== null && isRecord(manifest.dsh) ? manifest.dsh : undefined
  const bundle = dsh !== undefined && isRecord(dsh.bundle) ? dsh.bundle : undefined
  const patchRelative = bundle === undefined ? undefined : stringValue(bundle.patch)
  if (patchRelative !== undefined) {
    const patchPath = resolveInsideRoot(root, patchRelative)
    if (patchPath !== null) configurationChanges = parseConfigurationChanges(patchPath, root, findings)
  }
  const capabilities = inspectCapabilities(files, findings)
  const localGit = readLocalGit(root)
  const provenance: AuditProvenance = {
    ...(repositoryValue(manifest?.repository) === undefined ? {} : { repository: redactExcerpt(repositoryValue(manifest?.repository) ?? '') }),
    ...(localGit.remote === undefined ? {} : { localGitRemote: redactExcerpt(localGit.remote) }),
    ...(localGit.commit === undefined ? {} : { localGitCommit: localGit.commit }),
    ...(stringValue(manifest?.gitHead) === undefined ? {} : { publishedGitHead: stringValue(manifest?.gitHead) }),
    ...(stringValue(manifest?._resolved) === undefined ? {} : { resolvedUrl: redactExcerpt(stringValue(manifest?._resolved) ?? '') }),
    ...(stringValue(manifest?._integrity) === undefined ? {} : { registryIntegrity: stringValue(manifest?._integrity) }),
    ...(stringValue(manifest?.packageManager) === undefined ? {} : { packageManager: stringValue(manifest?.packageManager) }),
  }
  if (provenance.repository === undefined && provenance.localGitRemote === undefined) {
    findings.push(finding(
      'provenance-source-missing',
      'provenance',
      'low',
      'high',
      'No source repository is declared',
      'The local package does not declare a repository and is not a readable Git checkout, so reviewers cannot link the contents to a source history.',
      [packageJsonEvidence(manifestText, 'name')],
      'Declare package.json repository metadata and publish from a traceable source revision.',
    ))
  }
  if (provenance.registryIntegrity === undefined) {
    findings.push(finding(
      'provenance-registry-integrity-unavailable',
      'provenance',
      'info',
      'high',
      'Registry integrity metadata is unavailable in this directory',
      'The scanner computed a local content digest, but it cannot prove that these files match an npm registry tarball without registry or lockfile metadata.',
      [packageJsonEvidence(manifestText, 'version')],
    ))
  }
  const deduplicatedFindings = Array.from(new Map(findings.map(item => [item.fingerprint, item])).values())
    .sort((left, right) => SEVERITY_ORDER[right.severity] - SEVERITY_ORDER[left.severity]
      || left.ruleId.localeCompare(right.ruleId)
      || left.fingerprint.localeCompare(right.fingerprint))
  const digest = contentDigest(files)
  return {
    schema: 'dsh-plugin-audit/v1',
    generatedAt: new Date().toISOString(),
    subject: {
      path: root,
      ...(stringValue(manifest?.name) === undefined ? {} : { name: stringValue(manifest?.name) }),
      ...(stringValue(manifest?.version) === undefined ? {} : { version: stringValue(manifest?.version) }),
      ...(stringValue(manifest?.license) === undefined ? {} : { license: stringValue(manifest?.license) }),
      contentSha256: digest,
    },
    provenance,
    lifecycleScripts: lifecycleScripts.sort((left, right) => left.packageName.localeCompare(right.packageName) || left.script.localeCompare(right.script)),
    dependencies,
    configurationChanges,
    capabilities,
    findings: deduplicatedFindings,
    coverage,
    summary: summarize(deduplicatedFindings),
    limitations: [
      'Static inspection does not prove that a clean plugin is safe and does not follow runtime-generated code or data flows.',
      'The offline core does not query vulnerability databases, npm provenance, signatures, or package ownership history.',
      'Dependency scripts are inspected only for dependency manifests available under the plugin directory; unresolved and transitive packages remain coverage gaps.',
      scanScope.mode === 'working-tree'
        ? 'Working-tree fallback omits tests, fixtures, examples, demos, and undeclared development scripts; explicitly declared published paths are still scanned.'
        : 'The declared published surface is scanned even when it contains tests, fixtures, examples, demos, or scripts.',
      'Ordinary JSON data is included in the content digest but excluded from executable capability pattern matching.',
      'Symbolic links, unsupported file types, and text files above the size limit are not scanned; coverage records every skipped class.',
      'A local content digest proves only that two scans saw the same inspected text files; it is not a publisher signature or registry integrity proof.',
    ],
  }
}

function configurationKey(change: ConfigurationChange): string {
  return [change.operation, change.entryId ?? '', change.moduleName ?? '', ...change.changedKeys].join('\0')
}

/** Compare two audit reports using stable finding and observation identities. */
export function comparePluginAudits(baseline: PluginAuditReport, current: PluginAuditReport): PluginAuditComparison {
  const baselineFindings = new Map(baseline.findings.map(item => [item.fingerprint, item]))
  const currentFindings = new Map(current.findings.map(item => [item.fingerprint, item]))
  const baselineCapabilities = new Map(baseline.capabilities.map(item => [capabilityKey(item), item]))
  const currentCapabilities = new Map(current.capabilities.map(item => [capabilityKey(item), item]))
  const baselineConfiguration = new Map(baseline.configurationChanges.map(item => [configurationKey(item), item]))
  const currentConfiguration = new Map(current.configurationChanges.map(item => [configurationKey(item), item]))
  const addedFindings = current.findings.filter(item => !baselineFindings.has(item.fingerprint))
  const removedFindings = baseline.findings.filter(item => !currentFindings.has(item.fingerprint))
  return {
    schema: 'dsh-plugin-audit-diff/v1',
    baseline: {
      ...(baseline.subject.name === undefined ? {} : { name: baseline.subject.name }),
      ...(baseline.subject.version === undefined ? {} : { version: baseline.subject.version }),
      contentSha256: baseline.subject.contentSha256,
    },
    current: {
      ...(current.subject.name === undefined ? {} : { name: current.subject.name }),
      ...(current.subject.version === undefined ? {} : { version: current.subject.version }),
      contentSha256: current.subject.contentSha256,
    },
    versionChanged: baseline.subject.version !== current.subject.version,
    contentChanged: baseline.subject.contentSha256 !== current.subject.contentSha256,
    findings: {
      added: addedFindings,
      removed: removedFindings,
    },
    capabilities: {
      added: current.capabilities.filter(item => !baselineCapabilities.has(capabilityKey(item))),
      removed: baseline.capabilities.filter(item => !currentCapabilities.has(capabilityKey(item))),
    },
    configurationChanges: {
      added: current.configurationChanges.filter(item => !baselineConfiguration.has(configurationKey(item))),
      removed: baseline.configurationChanges.filter(item => !currentConfiguration.has(configurationKey(item))),
    },
    summary: {
      newHighOrCritical: addedFindings.filter(item => item.severity === 'high' || item.severity === 'critical').length,
      newReviewRequired: addedFindings.some(item => item.severity === 'high' || item.severity === 'critical'),
    },
  }
}

/** Audit multiple plugin directories and aggregate ecosystem-level counts. */
export function auditPluginEcosystem(directories: string[]): PluginEcosystemAuditReport {
  return aggregatePluginAudits(directories.map(directory => auditPlugin(directory)))
}

/** Aggregate already-produced local audit reports. */
export function aggregatePluginAudits(reports: PluginAuditReport[]): PluginEcosystemAuditReport {
  const plugins = [...reports]
    .sort((left, right) => (left.subject.name ?? left.subject.path).localeCompare(right.subject.name ?? right.subject.path))
  const byHighestSeverity: Record<AuditSeverity, number> = { info: 0, low: 0, medium: 0, high: 0, critical: 0 }
  const ruleCounts = new Map<string, { count: number; highestSeverity: AuditSeverity }>()
  const capabilityCounts = new Map<CapabilityObservation['kind'], number>()
  const coverage = {
    discoveredFiles: 0,
    scannedFiles: 0,
    scannedBytes: 0,
    skippedFiles: 0,
    declaredRuntimeDependencies: 0,
    inspectedInstalledDependencies: 0,
    unresolvedInstalledDependencies: 0,
  }
  for (const plugin of plugins) {
    byHighestSeverity[plugin.summary.highestSeverity] += 1
    const pluginRules = new Map<string, AuditSeverity>()
    for (const item of plugin.findings) {
      const previous = pluginRules.get(item.ruleId)
      if (previous === undefined || SEVERITY_ORDER[item.severity] > SEVERITY_ORDER[previous]) {
        pluginRules.set(item.ruleId, item.severity)
      }
    }
    for (const [ruleId, severity] of pluginRules) {
      const current = ruleCounts.get(ruleId) ?? { count: 0, highestSeverity: severity }
      current.count += 1
      if (SEVERITY_ORDER[severity] > SEVERITY_ORDER[current.highestSeverity]) current.highestSeverity = severity
      ruleCounts.set(ruleId, current)
    }
    for (const kind of new Set(plugin.capabilities.map(item => item.kind))) {
      capabilityCounts.set(kind, (capabilityCounts.get(kind) ?? 0) + 1)
    }
    coverage.discoveredFiles += plugin.coverage.discoveredFiles
    coverage.scannedFiles += plugin.coverage.scannedFiles
    coverage.scannedBytes += plugin.coverage.scannedBytes
    coverage.skippedFiles += plugin.coverage.skippedFiles
    coverage.declaredRuntimeDependencies += plugin.coverage.declaredRuntimeDependencies
    coverage.inspectedInstalledDependencies += plugin.coverage.inspectedInstalledDependencies
    coverage.unresolvedInstalledDependencies += plugin.coverage.unresolvedInstalledDependencies
  }
  return {
    schema: 'dsh-plugin-ecosystem-audit/v1',
    generatedAt: new Date().toISOString(),
    plugins,
    summary: {
      totalPlugins: plugins.length,
      reviewRequired: plugins.filter(plugin => plugin.summary.reviewRequired).length,
      byHighestSeverity,
      findingsByRule: Array.from(ruleCounts, ([ruleId, value]) => ({ ruleId, ...value }))
        .sort((left, right) => right.count - left.count || SEVERITY_ORDER[right.highestSeverity] - SEVERITY_ORDER[left.highestSeverity] || left.ruleId.localeCompare(right.ruleId)),
      capabilities: Array.from(capabilityCounts, ([kind, pluginCount]) => ({ kind, plugins: pluginCount }))
        .sort((left, right) => right.plugins - left.plugins || left.kind.localeCompare(right.kind)),
      coverage,
    },
  }
}

export {
  formatAuditReport,
  formatEcosystemAuditMarkdown,
  formatEcosystemAuditReport,
} from './audit-format.js'
