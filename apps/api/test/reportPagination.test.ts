import { describe, expect, it } from 'vitest';
import { loadReportPages } from '../src/utils/completeRows';

describe('report source pagination', () => {
  it('retrieves all rows even when the server returns smaller pages', async () => {
    const rows = Array.from({ length: 2503 }, (_, i) => ({ id: String(i), department: i === 2502 ? 'target' : 'other' }));
    const result = await loadReportPages('tickets', async (start, end) => ({
      data: rows.slice(start, Math.min(end + 1, start + 123)), count: rows.length, error: null,
    }));
    expect(result).toHaveLength(2503);
    expect(result.filter((row) => row.department === 'target')).toEqual([rows[2502]]);
  });

  it('fails instead of presenting truncated data when the limit is exceeded', async () => {
    await expect(loadReportPages('tickets', async () => ({ data: [], count: 5001, error: null }))).rejects.toThrow('5000');
  });

  it('fails if the server stops returning rows or the count changes', async () => {
    await expect(loadReportPages('tickets', async () => ({ data: [], count: 1, error: null }))).rejects.toThrow('ไม่ครบ');
    await expect(loadReportPages('tickets', async (start) => start === 0
      ? { data: [{ id: '1' }], count: 2, error: null }
      : { data: [{ id: '2' }], count: 3, error: null })).rejects.toThrow('เปลี่ยน');
  });

  it('rejects duplicate rows across pages', async () => {
    await expect(loadReportPages('tickets', async () => ({ data: [{ id: '1' }], count: 2, error: null }))).rejects.toThrow('เปลี่ยน');
  });
});
