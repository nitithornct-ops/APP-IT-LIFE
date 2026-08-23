import { describe, expect, it } from 'vitest';
import { buildExecutiveServiceAnalytics } from '../src/services/dashboardAnalyticsService';

describe('Executive service analytics', () => {
  it('builds a Bangkok-time heatmap, backlog age and real KPI aggregates', () => {
    const analytics = buildExecutiveServiceAnalytics({
      periodDays: 30,
      now: new Date('2026-08-23T10:00:00.000Z'), // Sunday 17:00 Bangkok
      tickets: [
        { id: 'monday-1', status: 'ใหม่', created_at: '2026-08-17T01:30:00.000Z', ticket_categories: { name: 'Hardware' } },
        { id: 'monday-2', status: 'กำลังดำเนินการ', created_at: '2026-08-17T01:45:00.000Z', ticket_categories: [{ name: 'Hardware' }] },
        { id: 'old-open', status: 'รออะไหล่', created_at: '2026-08-10T02:00:00.000Z', ticket_categories: { name: 'Network' } },
        {
          id: 'closed', status: 'ปิดงาน', created_at: '2026-08-20T02:00:00.000Z', acknowledged_at: '2026-08-20T02:30:00.000Z',
          resolved_at: '2026-08-20T07:00:00.000Z', due_at: '2026-08-20T08:00:00.000Z', rating: 5,
          feedback_at: '2026-08-20T08:00:00.000Z', assignee_name_snapshot: 'ช่าง ก', ticket_categories: { name: 'Software' },
        },
      ],
    });

    const monday = analytics.heatmap.days.find((day) => day.key === '2026-08-17');
    expect(monday).toMatchObject({ label: 'จ.', total: 2 });
    expect(monday?.values[0]).toBe(2);
    expect(analytics.heatmap.peak).toEqual({ dayLabel: 'จ.', hour: 8, count: 2 });
    expect(analytics.openByStatus).toEqual(expect.arrayContaining([{ label: 'ใหม่', value: 1 }, { label: 'รออะไหล่', value: 1 }]));
    expect(analytics.backlogAge.find((bucket) => bucket.key === 'over7')?.value).toBe(1);
    expect(analytics.kpis).toMatchObject({ received: 4, slaClosedPercent: 100, averageResponseMinutes: 30, averageResolutionHours: 5, csatAverage: 5, csatResponses: 1 });
    expect(analytics.categories[0]).toEqual({ label: 'Hardware', value: 2 });
  });

  it('ranks technicians by resolved volume and calculates SLA and rating', () => {
    const analytics = buildExecutiveServiceAnalytics({
      periodDays: 7,
      now: new Date('2026-08-23T10:00:00.000Z'),
      tickets: [
        { status: 'ปิดงาน', created_at: '2026-08-20T01:00:00.000Z', resolved_at: '2026-08-20T03:00:00.000Z', due_at: '2026-08-20T04:00:00.000Z', assignee_name_snapshot: 'ช่าง ก', rating: 5 },
        { status: 'เสร็จสิ้น', created_at: '2026-08-21T01:00:00.000Z', resolved_at: '2026-08-21T05:00:00.000Z', due_at: '2026-08-21T04:00:00.000Z', assignee_name_snapshot: 'ช่าง ก', rating: 3 },
        { status: 'ปิดงาน', created_at: '2026-08-20T01:00:00.000Z', resolved_at: '2026-08-20T02:00:00.000Z', due_at: null, assignee_name_snapshot: 'ช่าง ข' },
      ],
    });

    expect(analytics.technicians[0]).toEqual({ name: 'ช่าง ก', closed: 2, slaPercent: 50, averageRating: 4 });
    expect(analytics.technicians[1]).toEqual({ name: 'ช่าง ข', closed: 1, slaPercent: null, averageRating: null });
  });
});
