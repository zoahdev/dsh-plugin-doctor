import type { PluginAuditComparison, PluginAuditReport, PluginEcosystemAuditReport } from './audit-types.js';
/** Render the audit report for a human reviewer. */
export declare function formatAuditReport(report: PluginAuditReport, comparison?: PluginAuditComparison): string;
/** Render a compact ecosystem summary followed by one line per plugin. */
export declare function formatEcosystemAuditReport(report: PluginEcosystemAuditReport): string;
/** Render a self-contained Markdown ecosystem report. */
export declare function formatEcosystemAuditMarkdown(report: PluginEcosystemAuditReport): string;
