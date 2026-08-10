import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildImportPlan } from './importPlan.js';
import { executeImportPlan } from './executor.js';
import { migrationManifest } from './manifest.js';
import { loadLegacyWorkbook, loadSettingsAllowlist } from './workbookLoader.js';
import { createSupabaseAuthAdmin } from './supabaseAdmin.js';
import { connectPgQueryable } from './pgQueryable.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const reportPath = join(repositoryRoot, 'docs', 'migration', 'phase7-rehearsal-report.json');

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required. See docs/migration/phase7-migration-runbook.md § "Running the rehearsal".`);
  }
  return value;
}

async function main() {
  const workbookPath = requireEnv('LEGACY_WORKBOOK_PATH');
  const allowlistPath = process.env.SETTINGS_ALLOWLIST_PATH;
  const dbUrl = requireEnv('SUPABASE_DB_URL');
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  console.log(`Loading legacy workbook from ${workbookPath}...`);
  const workbook = await loadLegacyWorkbook(workbookPath);
  const settingsAllowlist = allowlistPath ? await loadSettingsAllowlist(allowlistPath) : undefined;
  if (!settingsAllowlist) {
    console.log('No SETTINGS_ALLOWLIST_PATH supplied — every Settings row will be archived rather than activated.');
  }

  const plan = buildImportPlan(workbook, migrationManifest, { settingsAllowlist });
  console.log(`Plan: ${plan.authInvites.length} auth invite(s), ${Object.values(plan.phases).flat().length} SQL operation(s), `
    + `${plan.archived.length} archived, ${plan.skipped.length} skipped, ${plan.deferred.length} deferred.`);
  if (plan.unverifiedSheets.length > 0) {
    console.log(`Generic (unverified) column mapping used for: ${plan.unverifiedSheets.join(', ')} — review before trusting this data.`);
  }
  for (const warning of plan.warnings) console.log(`  warning: ${warning}`);

  console.log(`Connecting to ${dbUrl.replace(/:[^:@]*@/, ':***@')}...`);
  const { queryable, close } = await connectPgQueryable(dbUrl);
  const authAdmin = createSupabaseAuthAdmin(supabaseUrl, serviceRoleKey);
  try {
    const result = await executeImportPlan(plan, queryable, authAdmin);
    console.log(`Done: ${result.inserted} row(s) written, ${result.authInvited} auth invite(s) sent, `
      + `${result.failed.length} SQL failure(s), ${result.authFailed.length} auth failure(s).`);

    const report = {
      generatedAt: new Date().toISOString(),
      plan: {
        authInvites: plan.authInvites.length,
        sqlOperations: Object.values(plan.phases).flat().length,
        archived: plan.archived.length,
        skipped: plan.skipped.length,
        deferred: plan.deferred.length,
        unverifiedSheets: plan.unverifiedSheets,
        warnings: plan.warnings,
        attachmentCandidates: plan.attachmentCandidates,
      },
      result,
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`Report written to ${reportPath}`);

    if (result.failed.length > 0 || result.authFailed.length > 0) process.exitCode = 1;
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
