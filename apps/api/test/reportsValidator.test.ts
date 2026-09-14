import { describe, expect, it } from 'vitest';
import { reportExportSchema, reportPdfExportSchema, reportRangeQuerySchema } from '../src/validators/reports';
import { csvCell, nextScheduleAt } from '../src/routes/reports';

describe('report validators', () => {
  it('defaults the report range to 30 days', () => {
    expect(reportRangeQuerySchema.parse({}).rangeDays).toBe(30);
  });

  it('coerces a valid query range', () => {
    expect(reportRangeQuerySchema.parse({ rangeDays: '90' }).rangeDays).toBe(90);
  });

  it('parses the comparePrevious query flag without treating "false" as true', () => {
    expect(reportRangeQuerySchema.parse({ comparePrevious: 'false' }).comparePrevious).toBe(false);
    expect(reportRangeQuerySchema.parse({ comparePrevious: 'true' }).comparePrevious).toBe(true);
  });

  it('rejects negative and excessively broad export ranges', () => {
    expect(reportExportSchema.safeParse({ rangeDays: -1 }).success).toBe(false);
    expect(reportExportSchema.safeParse({ rangeDays: 3651 }).success).toBe(false);
  });

  it('ไม่เก็บสำเนาลง Drive จนกว่าจะสั่งมาในคำขอ', () => {
    expect(reportPdfExportSchema.parse({ rangeDays: 30 }).saveToDrive).toBe(false);
    expect(reportPdfExportSchema.parse({ rangeDays: 30, saveToDrive: true }).saveToDrive).toBe(true);
    expect(reportPdfExportSchema.safeParse({ rangeDays: 30, saveToDrive: 'yes' }).success).toBe(false);
  });

  it('neutralizes spreadsheet formulas in CSV exports', () => {
    expect(csvCell('=HYPERLINK("https://unsafe.test")')).toBe('"\'=HYPERLINK(""https://unsafe.test"")"');
    expect(csvCell('normal')).toBe('"normal"');
  });

  it('calculates scheduled times in the configured timezone', () => {
    expect(nextScheduleAt({ frequency: 'monthly', dayOfMonth: 1, runHour: 8, timezone: 'Asia/Bangkok' }, new Date('2026-09-13T00:00:00.000Z'))).toBe('2026-10-01T01:00:00.000Z');
    expect(nextScheduleAt({ frequency: 'weekly', dayOfWeek: 0, runHour: 8, timezone: 'Asia/Bangkok' }, new Date('2026-09-13T00:00:00.000Z'))).toBe('2026-09-13T01:00:00.000Z');
    expect(nextScheduleAt({ frequency: 'weekly', dayOfWeek: 0, runHour: 8, timezone: 'Asia/Bangkok' }, new Date('2026-09-13T02:00:00.000Z'))).toBe('2026-09-20T01:00:00.000Z');
  });
});
