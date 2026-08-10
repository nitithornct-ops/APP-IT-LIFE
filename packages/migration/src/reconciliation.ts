import type { DataQualityProfile, SourceProfile } from './analyzer.js';
import type { ManifestEntry } from './manifest.js';

interface ReconciliationDataQuality extends DataQualityProfile {
  settingsAllowlist: DataQualityProfile['settingsAllowlist'] & { allowlistedRows: number };
  transformMetrics?: { RetentionLog?: { uniqueRunCount: number } };
  sheets: Array<{ sheet: string; invalidJsonCount: number; softDeletedCount: number }>;
}

export interface SheetReconciliation {
  sheet: string;
  sourceRows: number;
  mode: ManifestEntry['mode'];
  importCandidateRows: number;
  archiveRows: number;
  skippedRows: number;
  deferredRows: number;
  expectedTargetRows: Record<string, number>;
  rule: string;
}

export interface ReconciliationReport {
  phase: 'Phase 7 Data Migration';
  mode: 'READ_ONLY_RECONCILIATION_PLAN';
  generatedAt: string;
  sourceTitle: string;
  safety: { writesToSupabase: false; rawValuesIncluded: false };
  summary: {
    sourceRows: number;
    importCandidateRows: number;
    archiveRows: number;
    skippedRows: number;
    deferredRows: number;
    expectedTargetRowOperations: number;
  };
  sheets: SheetReconciliation[];
}

export function buildReconciliationReport(
  profile: SourceProfile,
  manifest: ManifestEntry[],
  dataQuality: ReconciliationDataQuality,
  generatedAt = new Date().toISOString(),
): ReconciliationReport {
  const manifestBySheet = new Map(manifest.map((entry) => [entry.sheet, entry]));
  const qualityBySheet = new Map(dataQuality.sheets.map((sheet) => [sheet.sheet, sheet]));
  const sheets = profile.sheets.map((source): SheetReconciliation => {
    const entry = manifestBySheet.get(source.name);
    if (!entry) throw new Error(`Missing manifest entry for ${source.name}`);
    const softDeleted = qualityBySheet.get(source.name)?.softDeletedCount ?? 0;
    let importCandidateRows = entry.mode === 'transform' ? Math.max(0, source.sourceRows - softDeleted) : 0;
    let archiveRows = entry.mode === 'archive' ? source.sourceRows : softDeleted;
    const skippedRows = entry.mode === 'skip_ephemeral' ? source.sourceRows : 0;
    const deferredRows = entry.mode === 'deferred' ? source.sourceRows : 0;
    let rule = entry.note ?? 'Transform by header name and preserve the legacy identity.';

    if (source.name === 'Settings') {
      importCandidateRows = dataQuality.settingsAllowlist.allowlistedRows;
      archiveRows = dataQuality.settingsAllowlist.unsupportedCount;
      rule = 'Upsert only allowlisted keys; never activate unsupported settings.';
    }

    const expectedTargetRows = Object.fromEntries(entry.targetTables.map((table) => [table, importCandidateRows]));
    if (source.name === 'RetentionLog') {
      const runCount = dataQuality.transformMetrics?.RetentionLog?.uniqueRunCount ?? 0;
      expectedTargetRows.governance_retention_runs = runCount;
      rule = 'Aggregate source detail rows by RunID and retain per-sheet/action details in JSON.';
    }
    if (source.name === 'Users') {
      rule = 'Create/invite Supabase Auth users; never migrate PasswordHash or PasswordSalt; map the legacy role.';
    }
    if (source.name === 'LineUsers') {
      rule = 'Import LINE identity registry only; do not migrate LineSessions.';
    }

    return {
      sheet: source.name,
      sourceRows: source.sourceRows,
      mode: entry.mode,
      importCandidateRows,
      archiveRows,
      skippedRows,
      deferredRows,
      expectedTargetRows,
      rule,
    };
  });

  return {
    phase: 'Phase 7 Data Migration',
    mode: 'READ_ONLY_RECONCILIATION_PLAN',
    generatedAt,
    sourceTitle: profile.source.title,
    safety: { writesToSupabase: false, rawValuesIncluded: false },
    summary: {
      sourceRows: profile.summary.totalRows,
      importCandidateRows: sheets.reduce((sum, sheet) => sum + sheet.importCandidateRows, 0),
      archiveRows: sheets.reduce((sum, sheet) => sum + sheet.archiveRows, 0),
      skippedRows: sheets.reduce((sum, sheet) => sum + sheet.skippedRows, 0),
      deferredRows: sheets.reduce((sum, sheet) => sum + sheet.deferredRows, 0),
      expectedTargetRowOperations: sheets.reduce(
        (sum, sheet) => sum + Object.values(sheet.expectedTargetRows).reduce((inner, count) => inner + count, 0),
        0,
      ),
    },
    sheets,
  };
}
