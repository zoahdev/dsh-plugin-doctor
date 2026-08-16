export type AuditSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical'
export type AuditConfidence = 'low' | 'medium' | 'high'

export interface AuditEvidence {
  path: string
  line: number
  excerpt: string
}

export interface AuditFinding {
  fingerprint: string
  ruleId: string
  category: 'provenance' | 'install' | 'dependency' | 'configuration' | 'code' | 'data-access'
  severity: AuditSeverity
  confidence: AuditConfidence
  title: string
  explanation: string
  evidence: AuditEvidence[]
  recommendation?: string
}

export interface CapabilityObservation {
  kind:
    | 'filesystem'
    | 'network'
    | 'process'
    | 'environment'
    | 'credentials'
    | 'dynamic-code'
    | 'native-code'
    | 'persistence'
    | 'browser-storage'
    | 'session-data'
    | 'clipboard'
    | 'dynamic-module-loading'
  confidence: AuditConfidence
  evidence: AuditEvidence[]
}

export interface LifecycleScriptObservation {
  packageName: string
  packageVersion?: string
  script: string
  command: string
  direct: boolean
  evidence: AuditEvidence
}

export interface DependencyObservation {
  name: string
  section: 'dependencies' | 'optionalDependencies' | 'peerDependencies'
  spec: string
  sourceType: 'exact' | 'range' | 'tag' | 'git' | 'url' | 'file' | 'workspace' | 'unknown'
  installedVersion?: string
  installedPath?: string
  lifecycleScripts: string[]
}

export interface ConfigurationChange {
  operation: 'insert' | 'modify' | 'remove' | 'unknown'
  entryId?: string
  moduleName?: string
  changedKeys: string[]
  securitySensitive: boolean
  evidence: AuditEvidence
}

export interface AuditProvenance {
  repository?: string
  localGitRemote?: string
  localGitCommit?: string
  publishedGitHead?: string
  resolvedUrl?: string
  registryIntegrity?: string
  packageManager?: string
}

export interface AuditCoverage {
  scanMode: 'published-files' | 'working-tree'
  declaredPublishedPaths: string[]
  discoveredFiles: number
  scannedFiles: number
  scannedBytes: number
  skippedFiles: number
  skippedByReason: Record<string, number>
  skippedExamples: Array<{ path: string; reason: string }>
  declaredRuntimeDependencies: number
  inspectedInstalledDependencies: number
  unresolvedInstalledDependencies: number
}

export interface PluginAuditReport {
  schema: 'dsh-plugin-audit/v1'
  generatedAt: string
  subject: {
    path: string
    name?: string
    version?: string
    license?: string
    contentSha256: string
  }
  provenance: AuditProvenance
  lifecycleScripts: LifecycleScriptObservation[]
  dependencies: DependencyObservation[]
  configurationChanges: ConfigurationChange[]
  capabilities: CapabilityObservation[]
  findings: AuditFinding[]
  coverage: AuditCoverage
  summary: {
    highestSeverity: AuditSeverity
    reviewRequired: boolean
    bySeverity: Record<AuditSeverity, number>
    byCategory: Record<AuditFinding['category'], number>
    exitCode: 0 | 1 | 2
  }
  limitations: string[]
}

export interface PluginAuditComparison {
  schema: 'dsh-plugin-audit-diff/v1'
  baseline: { name?: string; version?: string; contentSha256: string }
  current: { name?: string; version?: string; contentSha256: string }
  versionChanged: boolean
  contentChanged: boolean
  findings: {
    added: AuditFinding[]
    removed: AuditFinding[]
  }
  capabilities: {
    added: CapabilityObservation[]
    removed: CapabilityObservation[]
  }
  configurationChanges: {
    added: ConfigurationChange[]
    removed: ConfigurationChange[]
  }
  summary: {
    newHighOrCritical: number
    newReviewRequired: boolean
  }
}

export interface PluginEcosystemAuditReport {
  schema: 'dsh-plugin-ecosystem-audit/v1'
  generatedAt: string
  plugins: PluginAuditReport[]
  summary: {
    totalPlugins: number
    reviewRequired: number
    byHighestSeverity: Record<AuditSeverity, number>
    findingsByRule: Array<{ ruleId: string; count: number; highestSeverity: AuditSeverity }>
    capabilities: Array<{ kind: CapabilityObservation['kind']; plugins: number }>
    coverage: {
      discoveredFiles: number
      scannedFiles: number
      scannedBytes: number
      skippedFiles: number
      declaredRuntimeDependencies: number
      inspectedInstalledDependencies: number
      unresolvedInstalledDependencies: number
    }
  }
}
