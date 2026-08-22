import path from 'node:path';
const SEVERITY_ORDER = {
    info: 0,
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
};
/** Render the audit report for a human reviewer. */
export function formatAuditReport(report, comparison) {
    const subject = `${report.subject.name ?? path.basename(report.subject.path)}@${report.subject.version ?? '?'}`;
    const lines = [
        `Plugin audit: ${subject}`,
        `content sha256: ${report.subject.contentSha256}`,
        `highest severity: ${report.summary.highestSeverity}`,
        `coverage: ${report.coverage.scannedFiles}/${report.coverage.discoveredFiles} files, ${report.coverage.scannedBytes} bytes; skipped ${report.coverage.skippedFiles}`,
        `capabilities: ${report.capabilities.map(item => item.kind).join(', ') || 'none observed'}`,
        '',
    ];
    for (const item of report.findings) {
        lines.push(`[${item.severity.toUpperCase()}] ${item.ruleId}: ${item.title}`);
        lines.push(`  ${item.explanation}`);
        for (const evidence of item.evidence)
            lines.push(`  - ${evidence.path}:${evidence.line} ${evidence.excerpt}`);
    }
    if (comparison !== undefined) {
        lines.push('');
        lines.push(`Upgrade comparison: ${comparison.findings.added.length} finding(s) added, ${comparison.findings.removed.length} removed`);
        lines.push(`New high/critical findings: ${comparison.summary.newHighOrCritical}`);
    }
    lines.push('');
    lines.push('Static inspection only: a clean report is not a security guarantee.');
    return lines.join('\n');
}
/** Render a compact ecosystem summary followed by one line per plugin. */
export function formatEcosystemAuditReport(report) {
    const lines = [
        `Plugin ecosystem audit: ${report.summary.totalPlugins} plugin(s)`,
        `review required: ${report.summary.reviewRequired}`,
        `highest severity counts: ${Object.entries(report.summary.byHighestSeverity).map(([severity, count]) => `${severity}=${count}`).join(', ')}`,
        `coverage: ${report.summary.coverage.scannedFiles}/${report.summary.coverage.discoveredFiles} files, ${report.summary.coverage.scannedBytes} bytes; skipped ${report.summary.coverage.skippedFiles}`,
        '',
    ];
    for (const plugin of report.plugins) {
        lines.push(`[${plugin.summary.highestSeverity.toUpperCase()}] ${plugin.subject.name ?? plugin.subject.path}@${plugin.subject.version ?? '?'} — ${plugin.findings.length} finding(s), ${plugin.capabilities.length} capability class(es)`);
    }
    lines.push('');
    lines.push('Static inspection only: aggregate counts inherit every limitation recorded in each plugin report.');
    return lines.join('\n');
}
function markdownCell(value) {
    return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
/** Render a self-contained Markdown ecosystem report. */
export function formatEcosystemAuditMarkdown(report) {
    const lines = [
        '# DeepSeek Harness plugin ecosystem audit',
        '',
        `Generated: ${report.generatedAt}`,
        '',
        '## Summary',
        '',
        `- Plugins inspected: ${report.summary.totalPlugins}`,
        `- Plugins requiring focused review: ${report.summary.reviewRequired}`,
        `- Files scanned: ${report.summary.coverage.scannedFiles} of ${report.summary.coverage.discoveredFiles}`,
        `- Bytes scanned: ${report.summary.coverage.scannedBytes}`,
        `- Files skipped: ${report.summary.coverage.skippedFiles}`,
        `- Runtime dependencies declared: ${report.summary.coverage.declaredRuntimeDependencies}`,
        `- Installed dependencies inspected: ${report.summary.coverage.inspectedInstalledDependencies}`,
        `- Installed dependencies unresolved: ${report.summary.coverage.unresolvedInstalledDependencies}`,
        '',
        '| Highest severity | Plugins |',
        '|---|---:|',
        ...['critical', 'high', 'medium', 'low', 'info'].map(severity => `| ${severity} | ${report.summary.byHighestSeverity[severity]} |`),
        '',
        '## Most common findings',
        '',
        '| Rule | Plugins | Highest severity |',
        '|---|---:|---|',
        ...report.summary.findingsByRule.map(item => `| ${markdownCell(item.ruleId)} | ${item.count} | ${item.highestSeverity} |`),
        '',
        '## Observed capability classes',
        '',
        '| Capability | Plugins |',
        '|---|---:|',
        ...report.summary.capabilities.map(item => `| ${markdownCell(item.kind)} | ${item.plugins} |`),
        '',
        '## Plugins',
        '',
        '| Plugin | Version | Highest severity | Review required | Findings | Capability classes | Scan coverage |',
        '|---|---|---|---|---:|---:|---:|',
        ...report.plugins.map(plugin => `| ${markdownCell(plugin.subject.name ?? plugin.subject.path)} | ${markdownCell(plugin.subject.version ?? '?')} | ${plugin.summary.highestSeverity} | ${plugin.summary.reviewRequired ? 'yes' : 'no'} | ${plugin.findings.length} | ${plugin.capabilities.length} | ${plugin.coverage.scannedFiles}/${plugin.coverage.discoveredFiles} |`),
        '',
        '## Detailed findings',
        '',
    ];
    for (const plugin of report.plugins) {
        const materialFindings = plugin.findings.filter(item => SEVERITY_ORDER[item.severity] >= SEVERITY_ORDER.medium);
        if (materialFindings.length === 0)
            continue;
        lines.push(`<details><summary>${markdownCell(plugin.subject.name ?? plugin.subject.path)}@${markdownCell(plugin.subject.version ?? '?')} — ${materialFindings.length} material finding(s)</summary>`);
        lines.push('');
        for (const item of materialFindings) {
            lines.push(`### ${item.severity.toUpperCase()}: ${markdownCell(item.ruleId)}`);
            lines.push('');
            lines.push(item.title);
            lines.push('');
            lines.push(item.explanation);
            lines.push('');
            lines.push(`Confidence: ${item.confidence}`);
            lines.push('');
            for (const evidence of item.evidence) {
                lines.push(`- ${markdownCell(evidence.path)}:${evidence.line} — ${markdownCell(evidence.excerpt)}`);
            }
            if (item.recommendation !== undefined) {
                lines.push('');
                lines.push(`Recommendation: ${item.recommendation}`);
            }
            lines.push('');
        }
        lines.push('</details>');
        lines.push('');
    }
    lines.push('## Interpretation limits', '', '- This is static inspection. A clean report is not proof that a plugin is safe.', '- Capability observations show what code can touch, not whether that access is malicious.', '- Large generated bundles lower the confidence of same-file capability combinations.', '- Registry signatures, npm provenance, vulnerability databases, ownership history, and runtime behavior require separate online or isolated checks.', '- Each embedded plugin report records its own skipped files and unresolved dependencies.', '');
    return lines.join('\n');
}
