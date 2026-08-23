import { describe, expect, it } from 'vitest';
import { buildCsatAnalytics, type CsatEntryInput } from '../src/routes/reports';

function entry(overrides: Partial<CsatEntryInput>): CsatEntryInput {
  return {
    id: crypto.randomUUID(),
    code: 'TCK-2026-0001',
    title: 'ทดสอบระบบ',
    category: 'อุปกรณ์คอมพิวเตอร์',
    owner: 'ช่าง ก',
    createdAt: '2026-08-18T03:00:00.000Z',
    ...overrides,
  };
}

describe('buildCsatAnalytics', () => {
  it('summarizes real ratings into distribution, trends and follow-up queues', () => {
    const result = buildCsatAnalytics([
      entry({ id: 'five', rating: 5, feedback: 'รวดเร็ว สุภาพ', feedbackAt: '2026-08-18T04:00:00.000Z' }),
      entry({ id: 'four', rating: 4, feedback: 'รวดเร็ว แก้ไขตรงจุด', feedbackAt: '2026-08-19T04:00:00.000Z' }),
      entry({ id: 'two', code: 'TCK-2026-0002', category: 'ระบบเครือข่าย', owner: 'ช่าง ข', rating: 2, feedback: 'ล่าช้า ต้องติดตาม', feedbackAt: '2026-08-20T04:00:00.000Z' }),
      entry({ id: 'unrated' }),
    ], new Date('2026-08-23T12:00:00.000Z'));

    expect(result.average).toBe(3.67);
    expect(result.responseCount).toBe(3);
    expect(result.distribution.find((item) => item.score === 5)).toMatchObject({ count: 1, percentage: 33.3 });
    expect(result.weeklyTrend.at(-1)).toMatchObject({ average: 3.67, responses: 3 });
    expect(result.categories[0]).toMatchObject({ label: 'อุปกรณ์คอมพิวเตอร์', average: 4.5, responses: 2 });
    expect(result.technicians[0]).toMatchObject({ label: 'ช่าง ก', average: 4.5, responses: 2 });
    expect(result.followUpCount).toBe(1);
    expect(result.followUps[0]).toMatchObject({ id: 'two', rating: 2 });
    expect(result.mentions[0]).toMatchObject({ label: 'รวดเร็ว', count: 2 });
  });

  it('returns honest empty states when no ticket has a rating', () => {
    const result = buildCsatAnalytics([entry({ id: 'unrated' })], new Date('2026-08-23T12:00:00.000Z'));

    expect(result.average).toBeNull();
    expect(result.responseCount).toBe(0);
    expect(result.followUps).toEqual([]);
    expect(result.mentions).toEqual([]);
    expect(result.distribution.every((item) => item.count === 0 && item.percentage === 0)).toBe(true);
  });
});
