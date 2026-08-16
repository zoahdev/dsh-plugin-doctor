/** Evidence-first, offline inspection for DeepSeek Harness plugins. */
import type { PluginAuditComparison, PluginAuditReport, PluginEcosystemAuditReport } from './audit-types.js';
export type { AuditConfidence, AuditCoverage, AuditEvidence, AuditFinding, AuditProvenance, AuditSeverity, CapabilityObservation, ConfigurationChange, DependencyObservation, LifecycleScriptObservation, PluginAuditComparison, PluginAuditReport, PluginEcosystemAuditReport, } from './audit-types.js';
/** Inspect one unpacked plugin directory without executing plugin code. */
export declare function auditPlugin(directory: string): PluginAuditReport;
/** Compare two audit reports using stable finding and observation identities. */
export declare function comparePluginAudits(baseline: PluginAuditReport, current: PluginAuditReport): PluginAuditComparison;
/** Audit multiple plugin directories and aggregate ecosystem-level counts. */
export declare function auditPluginEcosystem(directories: string[]): PluginEcosystemAuditReport;
/** Aggregate already-produced local audit reports. */
export declare function aggregatePluginAudits(reports: PluginAuditReport[]): PluginEcosystemAuditReport;
export { formatAuditReport, formatEcosystemAuditMarkdown, formatEcosystemAuditReport, } from './audit-format.js';
