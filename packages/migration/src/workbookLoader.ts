import { readFile } from 'node:fs/promises';
import type { LegacyWorkbook } from './importPlan.js';

/**
 * The contract for supplying real legacy data later: a JSON file shaped exactly like
 * LegacyWorkbook — `{ "SheetName": [ { "Header1": value, ... }, ... ], ... }` — one entry
 * per legacy sheet, using the sheet's real column headers as keys (see
 * docs/migration/phase7-source-profile.json for the confirmed header list per sheet).
 * No raw legacy data is stored in this repo, so this file is never checked in; supply your
 * own path via LEGACY_WORKBOOK_PATH.
 */
export async function loadLegacyWorkbook(path: string): Promise<LegacyWorkbook> {
  const raw = await readFile(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${path}: not valid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path}: expected a JSON object of the form { "SheetName": [ {...row}, ... ] }`);
  }
  for (const [sheet, rows] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(rows)) throw new Error(`${path}: sheet "${sheet}" must be an array of row objects`);
    for (const row of rows) {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        throw new Error(`${path}: sheet "${sheet}" has a row that is not a plain object`);
      }
    }
  }
  return parsed as LegacyWorkbook;
}

/** Real setting-key allowlist — a JSON array of key strings, e.g. ["MAINTENANCE_MODE", ...]. */
export async function loadSettingsAllowlist(path: string): Promise<Set<string>> {
  const raw = await readFile(path, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new Error(`${path}: expected a JSON array of setting key strings`);
  }
  return new Set(parsed);
}
