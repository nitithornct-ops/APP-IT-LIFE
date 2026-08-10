import { describe, expect, it } from 'vitest';
import { reportExportSchema, reportRangeQuerySchema } from '../src/validators/reports';
import { csvCell } from '../src/routes/reports';

describe('report validators', () => {
  it('defaults the report range to 30 days', () => {
    expect(reportRangeQuerySchema.parse({}).rangeDays).toBe(30);
  });

  it('coerces a valid query range', () => {
    expect(reportRangeQuerySchema.parse({ rangeDays: '90' }).rangeDays).toBe(90);
  });

  it('rejects negative and excessively broad export ranges', () => {
    expect(reportExportSchema.safeParse({ rangeDays: -1 }).success).toBe(false);
    expect(reportExportSchema.safeParse({ rangeDays: 3651 }).success).toBe(false);
  });

  it('neutralizes spreadsheet formulas in CSV exports', () => {
    expect(csvCell('=HYPERLINK("https://unsafe.test")')).toBe('"\'=HYPERLINK(""https://unsafe.test"")"');
    expect(csvCell('normal')).toBe('"normal"');
  });
});
