import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeMigration, applyDataQuality, applySchemaReadiness, renderMarkdownReport, type DataQualityProfile, type SourceProfile } from './analyzer.js';
import { parseLegacySchema } from './legacySchema.js';
import { migrationManifest } from './manifest.js';
import { buildReconciliationReport } from './reconciliation.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = join(packageRoot, '..', '..');
const configPath = join(repositoryRoot, 'legacy-gas', 'Config.gs');
const profilePath = join(repositoryRoot, 'docs', 'migration', 'phase7-source-profile.json');
const jsonOutput = join(repositoryRoot, 'docs', 'migration', 'phase7-dry-run-report.json');
const markdownOutput = join(repositoryRoot, 'docs', 'migration', 'phase7-dry-run-report.md');
const reconciliationOutput = join(repositoryRoot, 'docs', 'migration', 'phase7-reconciliation-report.json');
const dataQualityPath = join(repositoryRoot, 'docs', 'migration', 'phase7-data-quality-profile.json');
const schemaReadinessPath = join(repositoryRoot, 'supabase', 'migrations', '20260828100000_migration_readiness.sql');

const [configSource, profileSource, dataQualitySource, schemaReadinessSql] = await Promise.all([
  readFile(configPath, 'utf8'),
  readFile(profilePath, 'utf8'),
  readFile(dataQualityPath, 'utf8'),
  readFile(schemaReadinessPath, 'utf8'),
]);
const profile = JSON.parse(profileSource) as SourceProfile;
const dataQuality = JSON.parse(dataQualitySource) as DataQualityProfile;
const report = applySchemaReadiness(
  applyDataQuality(
    analyzeMigration(profile, parseLegacySchema(configSource), migrationManifest),
    dataQuality,
  ),
  schemaReadinessSql,
);
const reconciliation = buildReconciliationReport(profile, migrationManifest, dataQuality);

await Promise.all([
  writeFile(jsonOutput, `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
  writeFile(markdownOutput, renderMarkdownReport(report), 'utf8'),
  writeFile(reconciliationOutput, `${JSON.stringify(reconciliation, null, 2)}\n`, 'utf8'),
]);

console.log(`Phase 7 dry run: ${report.decisionGate.status}`);
console.log(`Sheets: ${report.summary.sheetCount}; rows: ${report.summary.totalRows}; blockers: ${report.decisionGate.blockers.length}`);
console.log(`Reports: ${jsonOutput}; ${markdownOutput}; ${reconciliationOutput}`);
if (report.decisionGate.status === 'BLOCKED') process.exitCode = 2;
