import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeMigration, applyDataQuality, applySchemaReadiness, type DataQualityProfile, type SourceProfile } from './analyzer.js';
import { parseLegacySchema } from './legacySchema.js';
import { migrationManifest } from './manifest.js';
import { buildReconciliationReport } from './reconciliation.js';
import { collectAttachmentCandidates, summarizeAttachmentCandidates } from './attachments.js';

const repositoryRoot = join(import.meta.dirname, '..', '..', '..');
const configSource = readFileSync(join(repositoryRoot, 'legacy-gas', 'Config.gs'), 'utf8');
const profile = JSON.parse(
  readFileSync(join(repositoryRoot, 'docs', 'migration', 'phase7-source-profile.json'), 'utf8'),
) as SourceProfile;
const dataQuality = JSON.parse(
  readFileSync(join(repositoryRoot, 'docs', 'migration', 'phase7-data-quality-profile.json'), 'utf8'),
) as DataQualityProfile;

describe('Phase 7 migration dry run', () => {
  it('parses all legacy sheets without executing Apps Script', () => {
    const schema = parseLegacySchema(configSource);
    expect(Object.keys(schema)).toHaveLength(93);
    expect(schema.Users?.[0]).toBe('UserID');
    expect(schema.Tickets).toContain('TicketID');
  });

  it('covers every snapshot sheet exactly once', () => {
    const profileNames = [...profile.sheets.map((sheet) => sheet.name)].sort();
    const manifestNames = [...migrationManifest.map((entry) => entry.sheet)].sort();
    expect(new Set(manifestNames).size).toBe(93);
    expect(manifestNames).toEqual(profileNames);
  });

  it('treats reordered columns as safe name-based mapping', () => {
    const report = analyzeMigration(profile, parseLegacySchema(configSource), migrationManifest, '2026-08-10T00:00:00.000Z');
    const users = report.sheets.find((sheet) => sheet.sheet === 'Users');
    expect(users?.headerStatus).toBe('reordered');
    expect(users?.missingHeaders).toEqual([]);
    expect(users?.extraHeaders).toEqual([]);
    expect(users?.legacyKey).toEqual(['UserID']);
    expect(report.safety.mappingStrategy).toBe('HEADER_NAME');
  });

  it('uses a compound natural key for retention run detail rows', () => {
    const report = analyzeMigration(profile, parseLegacySchema(configSource), migrationManifest);
    const retention = report.sheets.find((sheet) => sheet.sheet === 'RetentionLog');
    expect(retention?.legacyKey).toEqual(['RunID', 'SheetName', 'Action']);
  });

  it('blocks a populated sheet when its target table is absent', () => {
    const changedProfile = structuredClone(profile);
    const pmWorkOrders = changedProfile.sheets.find((sheet) => sheet.name === 'PMWorkOrders');
    if (!pmWorkOrders) throw new Error('PMWorkOrders profile is missing');
    pmWorkOrders.sourceRows = 1;
    const report = analyzeMigration(changedProfile, parseLegacySchema(configSource), migrationManifest);
    expect(report.decisionGate.status).toBe('BLOCKED');
    expect(report.decisionGate.blockers.some((item) => item.startsWith('PMWorkOrders:'))).toBe(true);
  });

  it('does not include raw rows, PII, or secret values in reports', () => {
    const report = applyDataQuality(analyzeMigration(profile, parseLegacySchema(configSource), migrationManifest), dataQuality);
    expect(report.safety).toMatchObject({ rawRowsIncluded: false, piiIncluded: false, secretsIncluded: false });
    expect(JSON.stringify(report)).not.toContain('PasswordHashValue');
    expect(JSON.stringify(report)).not.toContain('PasswordSaltValue');
  });

  it('passes the source data-quality decision gate without activating deferred data', () => {
    const report = applyDataQuality(analyzeMigration(profile, parseLegacySchema(configSource), migrationManifest), dataQuality);
    expect(report.decisionGate.status).toBe('READY_FOR_SCHEMA_PREPARATION');
    expect(report.dataQuality).toMatchObject({ rowsChecked: 1932, orphanForeignKeys: 0, suspectedSecretSettings: 0 });
  });

  it('prepares legacy identity columns for every transformed UUID target', () => {
    const sql = readFileSync(
      join(repositoryRoot, 'supabase', 'migrations', '20260828100000_migration_readiness.sql'),
      'utf8',
    );
    const arrayBody = sql.match(/target_tables text\[\] := array\[([\s\S]*?)\];/)?.[1] ?? '';
    const preparedTables = new Set([...arrayBody.matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]));
    const requiredTables = new Set(
      migrationManifest
        .filter((entry) => entry.mode === 'transform')
        .flatMap((entry) => entry.targetTables)
        .filter((table) => table !== 'system_settings'),
    );
    expect([...requiredTables].filter((table) => !preparedTables.has(table))).toEqual([]);
    expect(sql).toContain('Legacy LineSessions are not migrated');
    const report = applySchemaReadiness(
      applyDataQuality(analyzeMigration(profile, parseLegacySchema(configSource), migrationManifest), dataQuality),
      sql,
    );
    expect(report.decisionGate.status).toBe('READY_FOR_IMPORT_REHEARSAL');
    expect(report.schemaReadiness?.missingTargets).toEqual([]);
  });

  it('builds a value-free reconciliation plan for grouped, archived, and skipped data', () => {
    const reconciliation = buildReconciliationReport(profile, migrationManifest, dataQuality);
    const retention = reconciliation.sheets.find((sheet) => sheet.sheet === 'RetentionLog');
    const notificationLog = reconciliation.sheets.find((sheet) => sheet.sheet === 'NotificationLog');
    const lineSessions = reconciliation.sheets.find((sheet) => sheet.sheet === 'LineSessions');
    expect(retention?.expectedTargetRows).toEqual({ governance_retention_runs: 37 });
    expect(notificationLog).toMatchObject({ archiveRows: 97, importCandidateRows: 0 });
    expect(lineSessions).toMatchObject({ skippedRows: 4, importCandidateRows: 0 });
    expect(reconciliation.safety.rawValuesIncluded).toBe(false);
  });

  it('handles registry and direct-link attachments without leaking locators into summaries', () => {
    const collected = collectAttachmentCandidates({
      AttachmentRegistry: [{ AttachmentID: 'A-1', FileID: 'drive-file-1' }, { AttachmentID: 'A-2' }],
      AttachmentLinks: [{ AttachmentID: 'A-1', RecordID: 'T-1' }],
      TaskAttachments: [
        { AttachmentID: 'TA-1', RegistryAttachmentID: 'A-1', FileURL: 'registry-backed-url' },
        { AttachmentID: 'TA-2', FileURL: 'direct-task-url' },
      ],
      Tickets: [{ TicketID: 'T-1', EvidenceLink: 'direct-ticket-url' }],
      PMWorkOrders: [{ WorkOrderID: 'WO-1', EvidenceLinksJSON: '["one", {"fileId":"two"}]' }],
    });
    const summary = summarizeAttachmentCandidates(collected);
    expect(summary).toMatchObject({ registryCandidates: 1, directCandidates: 4, unresolvedRegistryRows: 1 });
    expect(JSON.stringify(summary)).not.toContain('drive-file-1');
    expect(JSON.stringify(summary)).not.toContain('direct-ticket-url');
  });
});
