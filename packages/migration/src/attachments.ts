export type LegacyRow = Record<string, unknown>;
export type LegacyWorkbook = Record<string, LegacyRow[]>;

export interface AttachmentCandidate {
  path: 'registry' | 'direct';
  sourceSheet: string;
  sourceRow: number;
  sourceColumn: string;
  locator: string;
}

export interface AttachmentExportSummary {
  registryCandidates: number;
  directCandidates: number;
  unresolvedRegistryRows: number;
  candidates: Array<Omit<AttachmentCandidate, 'locator'>>;
  locatorsIncluded: false;
}

const directColumns = new Set([
  'FileID', 'FileURL', 'AttachmentURL', 'EvidenceLink', 'EvidenceLinksJSON', 'AttachmentIDsJSON',
]);

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

/**
 * Collect file locators for a secure, ephemeral exporter process.
 * Never persist this return value in reports because locators can contain access-bearing URLs.
 */
export function collectAttachmentCandidates(workbook: LegacyWorkbook): {
  candidates: AttachmentCandidate[];
  unresolvedRegistryRows: number;
} {
  const candidates: AttachmentCandidate[] = [];
  let unresolvedRegistryRows = 0;

  for (const [index, row] of (workbook.AttachmentRegistry ?? []).entries()) {
    const locator = text(row.FileID) || text(row.FileURL);
    if (!locator) {
      unresolvedRegistryRows += 1;
      continue;
    }
    candidates.push({
      path: 'registry', sourceSheet: 'AttachmentRegistry', sourceRow: index + 2,
      sourceColumn: text(row.FileID) ? 'FileID' : 'FileURL', locator,
    });
  }

  for (const [sheet, rows] of Object.entries(workbook)) {
    if (sheet === 'AttachmentRegistry' || sheet === 'AttachmentLinks') continue;
    for (const [index, row] of rows.entries()) {
      // A TaskAttachments row linked to the registry must use the registry path once.
      const registryBacked = sheet === 'TaskAttachments' && Boolean(text(row.RegistryAttachmentID));
      if (registryBacked) continue;
      for (const [column, value] of Object.entries(row)) {
        if (!directColumns.has(column)) continue;
        for (const locator of expandLocator(value, column.endsWith('JSON'))) {
          candidates.push({ path: 'direct', sourceSheet: sheet, sourceRow: index + 2, sourceColumn: column, locator });
        }
      }
    }
  }

  const seen = new Set<string>();
  return {
    candidates: candidates.filter((candidate) => {
      const key = [candidate.path, candidate.sourceSheet, candidate.sourceRow, candidate.sourceColumn, candidate.locator].join('\u001f');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    unresolvedRegistryRows,
  };
}

export function summarizeAttachmentCandidates(
  result: ReturnType<typeof collectAttachmentCandidates>,
): AttachmentExportSummary {
  return {
    registryCandidates: result.candidates.filter((candidate) => candidate.path === 'registry').length,
    directCandidates: result.candidates.filter((candidate) => candidate.path === 'direct').length,
    unresolvedRegistryRows: result.unresolvedRegistryRows,
    candidates: result.candidates.map(({ locator: _locator, ...candidate }) => candidate),
    locatorsIncluded: false,
  };
}

function expandLocator(value: unknown, parseJson: boolean): string[] {
  const direct = text(value);
  if (!direct) return [];
  if (!parseJson) return [direct];
  try {
    const parsed: unknown = JSON.parse(direct);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items.flatMap((item) => {
      if (typeof item === 'string') return item.trim() ? [item.trim()] : [];
      if (item && typeof item === 'object') {
        const object = item as Record<string, unknown>;
        const locator = text(object.fileId) || text(object.fileID) || text(object.url) || text(object.fileUrl);
        return locator ? [locator] : [];
      }
      return [];
    });
  } catch {
    // Keep the original cell as one unresolved direct locator. Data-quality reporting
    // separately flags invalid JSON so the rehearsal can stop or archive it explicitly.
    return [direct];
  }
}
