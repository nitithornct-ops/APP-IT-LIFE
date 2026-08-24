import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ReportDataset } from '../../types/reports';
import { CsatAnalyticsPanel } from './CsatAnalyticsPanel';

afterEach(cleanup);

const csat: NonNullable<ReportDataset['csat']> = {
  average: 4.25,
  responseCount: 4,
  distribution: [
    { score: 5, count: 2, percentage: 50 },
    { score: 4, count: 1, percentage: 25 },
    { score: 3, count: 0, percentage: 0 },
    { score: 2, count: 1, percentage: 25 },
    { score: 1, count: 0, percentage: 0 },
  ],
  weeklyTrend: Array.from({ length: 12 }, (_, index) => ({ label: `W${index + 1}`, average: index === 11 ? 4.25 : null, responses: index === 11 ? 4 : 0 })),
  categories: [{ label: 'อุปกรณ์คอมพิวเตอร์', average: 4.5, responses: 2 }],
  technicians: [{ label: 'ช่าง ก', average: 4.75, responses: 3 }],
  followUpCount: 1,
  followUps: [{ id: 'ticket-id', code: 'TCK-2026-0001', title: 'อินเทอร์เน็ตช้า', rating: 2, feedback: 'ต้องติดตามหลายครั้ง', submittedAt: '2026-08-20T04:00:00.000Z', owner: 'ช่าง ข' }],
  mentions: [{ label: 'รวดเร็ว', count: 2 }],
};

describe('CsatAnalyticsPanel', () => {
  it('renders actual score summaries and links low ratings back to their tickets', () => {
    render(<MemoryRouter><CsatAnalyticsPanel data={csat} /></MemoryRouter>);

    expect(screen.getByText('ความพึงพอใจจาก Ticket จริง')).toBeInTheDocument();
    expect(screen.getByText('4.25')).toBeInTheDocument();
    expect(screen.getByText('คิวต้องตามแก้')).toBeInTheDocument();
    expect(screen.getByText('ต้องติดตามหลายครั้ง')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'เปิด Ticket' })).toHaveAttribute('href', '/tickets/ticket-id');
    expect(screen.getByText('รวดเร็ว')).toBeInTheDocument();
    expect(screen.getByText('ช่าง ก')).toBeInTheDocument();
  });
});
