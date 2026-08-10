import { knownTargetTables, type ManifestEntry } from './manifest.js';

export interface SourceSheetProfile {
  name: string;
  sourceRows: number;
  headers: string[];
}

export interface SourceProfile {
  phase: string;
  mode: string;
  capturedAt: string;
  source: {
    id: string;
    title: string;
    createdAt: string;
    timeZone: string;
    locale: string;
    immutableSnapshot: boolean;
  };
  summary: { sheetCount: number; totalRows: number; populatedSheets: number; emptySheets: number };
  sheets: SourceSheetProfile[];
}

export type HeaderStatus = 'exact' | 'reordered' | 'additive' | 'drift';

export interface SheetAnalysis {
  sheet: string;
  sourceRows: number;
  mode: ManifestEntry['mode'];
  legacyKey: string[];
  targetTables: string[];
  targetTablesReady: boolean;
  headerStatus: HeaderStatus;
  missingHeaders: string[];
  extraHeaders: string[];
  sensitiveColumnsExcluded: string[];
  note?: string;
}

export interface DryRunReport {
  phase: 'Phase 7 Data Migration';
  mode: 'READ_ONLY_DRY_RUN';
  generatedAt: string;
  safety: {
    writesToSupabase: false;
    rawRowsIncluded: false;
    piiIncluded: false;
    secretsIncluded: false;
    mappingStrategy: 'HEADER_NAME';
  };
  source: SourceProfile['source'];
  summary: SourceProfile['summary'] & {
    manifestEntries: number;
    exactHeaders: number;
    reorderedHeaders: number;
    additiveHeaders: number;
    driftedHeaders: number;
    targetSchemaGaps: number;
  };
  decisionGate: {
    status: 'READY_FOR_DATA_QUALITY_DRY_RUN' | 'READY_FOR_SCHEMA_PREPARATION' | 'READY_FOR_IMPORT_REHEARSAL' | 'BLOCKED';
    blockers: string[];
    warnings: string[];
  };
  manifestCoverage: { missing: string[]; extra: string[] };
  dataQuality?: {
    rowsChecked: number;
    blankKeyRows: number;
    duplicateKeyGroups: number;
    invalidEmails: number;
    invalidDates: number;
    invalidJsonValues: number;
    softDeletedRows: number;
    orphanForeignKeys: number;
    directAttachmentReferenceCells: number;
    unmappedRoles: number;
    unsupportedSettings: number;
    suspectedSecretSettings: number;
  };
  schemaReadiness?: { requiredTargets: number; preparedTargets: number; missingTargets: string[] };
  sheets: SheetAnalysis[];
}

export interface DataQualityProfile {
  summary: {
    rowsRead: number;
    blankKeyRows: number;
    duplicateKeyGroups: number;
    invalidEmails: number;
    invalidDates: number;
    invalidJsonValues: number;
    softDeletedRows: number;
    orphanForeignKeys: number;
    directAttachmentReferenceCells: number;
    unmappedRoles: number;
  };
  settingsAllowlist: { allowlistedRows: number; unsupportedCount: number; sensitiveLikeCount: number };
  transformMetrics?: { RetentionLog?: { uniqueRunCount: number } };
  sheets: Array<{ sheet: string; invalidJsonCount: number; softDeletedCount: number }>;
}

export function analyzeMigration(
  profile: SourceProfile,
  legacySchema: Record<string, string[]>,
  manifest: ManifestEntry[],
  generatedAt = new Date().toISOString(),
): DryRunReport {
  const manifestBySheet = new Map(manifest.map((entry) => [entry.sheet, entry]));
  const profileNames = new Set(profile.sheets.map((sheet) => sheet.name));
  const missing = profile.sheets.filter((sheet) => !manifestBySheet.has(sheet.name)).map((sheet) => sheet.name);
  const extra = manifest.filter((entry) => !profileNames.has(entry.sheet)).map((entry) => entry.sheet);
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (missing.length > 0) blockers.push(`Manifest does not cover: ${missing.join(', ')}`);
  if (extra.length > 0) blockers.push(`Manifest has sheets absent from snapshot: ${extra.join(', ')}`);

  const sheets: SheetAnalysis[] = [];
  for (const sourceSheet of profile.sheets) {
    const entry = manifestBySheet.get(sourceSheet.name);
    if (!entry) continue;
    const expected = legacySchema[sourceSheet.name] ?? [];
    const expectedSet = new Set(expected);
    const actualSet = new Set(sourceSheet.headers);
    const missingHeaders = expected.filter((header) => !actualSet.has(header));
    const extraHeaders = sourceSheet.headers.filter((header) => !expectedSet.has(header));
    const sameOrder = expected.length === sourceSheet.headers.length
      && expected.every((header, index) => header === sourceSheet.headers[index]);
    const headerStatus: HeaderStatus = missingHeaders.length > 0
      ? 'drift'
      : extraHeaders.length > 0 ? 'additive'
      : sameOrder ? 'exact' : 'reordered';
    const targetTablesReady = entry.targetTables.every((table) => knownTargetTables.has(table));
    const legacyKey = entry.legacyKey ?? (expected[0] ? [expected[0]] : sourceSheet.headers[0] ? [sourceSheet.headers[0]] : []);

    if (headerStatus === 'drift') {
      warnings.push(`${sourceSheet.name}: header drift detected; review name-based mapping.`);
    }
    if (headerStatus === 'additive') {
      warnings.push(`${sourceSheet.name}: snapshot has additive columns; map or explicitly archive them.`);
    }
    if (!targetTablesReady && sourceSheet.sourceRows > 0) {
      blockers.push(`${sourceSheet.name}: ${sourceSheet.sourceRows} row(s), but target schema is missing.`);
    }
    if ((entry.mode === 'archive' || entry.mode === 'deferred' || entry.mode === 'skip_ephemeral')
      && sourceSheet.sourceRows > 0) {
      warnings.push(`${sourceSheet.name}: ${sourceSheet.sourceRows} row(s) will use mode ${entry.mode}.`);
    }
    const missingLegacyKeys = legacyKey.filter((column) => !actualSet.has(column));
    if (missingLegacyKeys.length > 0 && sourceSheet.sourceRows > 0) {
      blockers.push(`${sourceSheet.name}: populated sheet is missing legacy key column(s) ${missingLegacyKeys.join(', ')}.`);
    }

    sheets.push({
      sheet: sourceSheet.name,
      sourceRows: sourceSheet.sourceRows,
      mode: entry.mode,
      legacyKey,
      targetTables: entry.targetTables,
      targetTablesReady,
      headerStatus,
      missingHeaders,
      extraHeaders,
      sensitiveColumnsExcluded: entry.sensitiveColumns ?? [],
      ...(entry.note ? { note: entry.note } : {}),
    });
  }

  const exactHeaders = sheets.filter((sheet) => sheet.headerStatus === 'exact').length;
  const reorderedHeaders = sheets.filter((sheet) => sheet.headerStatus === 'reordered').length;
  const additiveHeaders = sheets.filter((sheet) => sheet.headerStatus === 'additive').length;
  const driftedHeaders = sheets.filter((sheet) => sheet.headerStatus === 'drift').length;
  const targetSchemaGaps = sheets.filter((sheet) => !sheet.targetTablesReady).length;

  return {
    phase: 'Phase 7 Data Migration',
    mode: 'READ_ONLY_DRY_RUN',
    generatedAt,
    safety: {
      writesToSupabase: false,
      rawRowsIncluded: false,
      piiIncluded: false,
      secretsIncluded: false,
      mappingStrategy: 'HEADER_NAME',
    },
    source: profile.source,
    summary: {
      ...profile.summary,
      manifestEntries: manifest.length,
      exactHeaders,
      reorderedHeaders,
      additiveHeaders,
      driftedHeaders,
      targetSchemaGaps,
    },
    decisionGate: {
      status: blockers.length > 0 ? 'BLOCKED' : 'READY_FOR_DATA_QUALITY_DRY_RUN',
      blockers,
      warnings,
    },
    manifestCoverage: { missing, extra },
    sheets,
  };
}

export function applyDataQuality(report: DryRunReport, profile: DataQualityProfile): DryRunReport {
  const blockingInvalidJson = profile.sheets
    .filter((sheet) => report.sheets.find((item) => item.sheet === sheet.sheet)?.mode === 'transform')
    .reduce((sum, sheet) => sum + sheet.invalidJsonCount, 0);
  const criticalCount = profile.summary.blankKeyRows + profile.summary.duplicateKeyGroups
    + profile.summary.invalidEmails + profile.summary.invalidDates + profile.summary.orphanForeignKeys
    + profile.summary.unmappedRoles + profile.settingsAllowlist.sensitiveLikeCount + blockingInvalidJson;

  report.dataQuality = {
    rowsChecked: profile.summary.rowsRead,
    blankKeyRows: profile.summary.blankKeyRows,
    duplicateKeyGroups: profile.summary.duplicateKeyGroups,
    invalidEmails: profile.summary.invalidEmails,
    invalidDates: profile.summary.invalidDates,
    invalidJsonValues: profile.summary.invalidJsonValues,
    softDeletedRows: profile.summary.softDeletedRows,
    orphanForeignKeys: profile.summary.orphanForeignKeys,
    directAttachmentReferenceCells: profile.summary.directAttachmentReferenceCells,
    unmappedRoles: profile.summary.unmappedRoles,
    unsupportedSettings: profile.settingsAllowlist.unsupportedCount,
    suspectedSecretSettings: profile.settingsAllowlist.sensitiveLikeCount,
  };
  if (criticalCount > 0) {
    report.decisionGate.blockers.push(`Data-quality checks found ${criticalCount} blocking issue(s).`);
    report.decisionGate.status = 'BLOCKED';
  } else if (report.decisionGate.blockers.length === 0) {
    report.decisionGate.status = 'READY_FOR_SCHEMA_PREPARATION';
  }
  if (profile.summary.invalidJsonValues > blockingInvalidJson) {
    report.decisionGate.warnings.push(`${profile.summary.invalidJsonValues - blockingInvalidJson} invalid JSON value(s) are confined to deferred/archive sheets.`);
  }
  if (profile.summary.softDeletedRows > 0) {
    report.decisionGate.warnings.push(`${profile.summary.softDeletedRows} soft-deleted row(s) must be archived, not activated.`);
  }
  if (profile.settingsAllowlist.unsupportedCount > 0) {
    report.decisionGate.warnings.push(`${profile.settingsAllowlist.unsupportedCount} unsupported setting row(s) must be archived, not activated.`);
  }
  if (profile.summary.directAttachmentReferenceCells > 0) {
    report.decisionGate.warnings.push(`${profile.summary.directAttachmentReferenceCells} direct attachment reference(s) require the legacy-link migration path.`);
  }
  return report;
}

export function applySchemaReadiness(report: DryRunReport, migrationSql: string): DryRunReport {
  const arrayBody = migrationSql.match(/target_tables text\[\] := array\[([\s\S]*?)\];/)?.[1] ?? '';
  const prepared = new Set([...arrayBody.matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]!));
  const required = new Set(
    report.sheets
      .filter((sheet) => sheet.mode === 'transform')
      .flatMap((sheet) => sheet.targetTables)
      .filter((table) => table !== 'system_settings'),
  );
  const missingTargets = [...required].filter((table) => !prepared.has(table));
  report.schemaReadiness = {
    requiredTargets: required.size,
    preparedTargets: required.size - missingTargets.length,
    missingTargets,
  };
  if (missingTargets.length > 0) {
    report.decisionGate.blockers.push(`Legacy identity columns are not prepared for: ${missingTargets.join(', ')}`);
    report.decisionGate.status = 'BLOCKED';
  } else if (report.decisionGate.blockers.length === 0) {
    report.decisionGate.status = 'READY_FOR_IMPORT_REHEARSAL';
  }
  return report;
}

export function renderMarkdownReport(report: DryRunReport): string {
  const rows = report.sheets.map((sheet) =>
    `| ${sheet.sheet} | ${sheet.sourceRows} | ${sheet.mode} | ${sheet.legacyKey.join(' + ') || '—'} | ${sheet.targetTables.join(', ') || '—'} | ${sheet.headerStatus} | ${sheet.targetTablesReady ? 'yes' : 'no'} |`,
  );
  const bullets = (items: string[]) => items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : '- None';

  const dataQuality = report.dataQuality ? `
## Data quality

| Check | Count |
|---|---:|
| Rows checked | ${report.dataQuality.rowsChecked} |
| Blank keys / duplicate groups | ${report.dataQuality.blankKeyRows} / ${report.dataQuality.duplicateKeyGroups} |
| Invalid email / date / JSON | ${report.dataQuality.invalidEmails} / ${report.dataQuality.invalidDates} / ${report.dataQuality.invalidJsonValues} |
| Orphan foreign keys / unmapped roles | ${report.dataQuality.orphanForeignKeys} / ${report.dataQuality.unmappedRoles} |
| Soft-deleted rows | ${report.dataQuality.softDeletedRows} |
| Unsupported / suspected-secret settings | ${report.dataQuality.unsupportedSettings} / ${report.dataQuality.suspectedSecretSettings} |
| Direct attachment references | ${report.dataQuality.directAttachmentReferenceCells} |
` : '';
  const schemaReadiness = report.schemaReadiness ? `
## Schema readiness

Legacy identity targets prepared: ${report.schemaReadiness.preparedTargets}/${report.schemaReadiness.requiredTargets}  
Missing targets: ${report.schemaReadiness.missingTargets.join(', ') || 'None'}
` : '';

  return `# Phase 7 — Migration Dry-Run Report

Generated: ${report.generatedAt}

Source: ${report.source.title} (${report.source.createdAt})  
Mode: **read-only** — no Supabase writes, raw rows, PII, or secrets are included.  
Mapping strategy: **header name**, never column position.

## Summary

| Metric | Count |
|---|---:|
| Sheets | ${report.summary.sheetCount} |
| Source rows | ${report.summary.totalRows} |
| Populated / empty sheets | ${report.summary.populatedSheets} / ${report.summary.emptySheets} |
| Manifest entries | ${report.summary.manifestEntries} |
| Exact / reordered / additive / drifted headers | ${report.summary.exactHeaders} / ${report.summary.reorderedHeaders} / ${report.summary.additiveHeaders} / ${report.summary.driftedHeaders} |
| Target schema gaps | ${report.summary.targetSchemaGaps} |

## Decision gate: ${report.decisionGate.status}

### Blockers

${bullets(report.decisionGate.blockers)}

### Warnings

${bullets(report.decisionGate.warnings)}
${dataQuality}
${schemaReadiness}

## Sheet manifest

| Legacy sheet | Rows | Mode | Legacy key | Target table(s) | Headers | Target ready |
|---|---:|---|---|---|---|---|
${rows.join('\n')}
`;
}
