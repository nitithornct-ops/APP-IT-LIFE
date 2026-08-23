import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../stores/themeContext';
import type { DashboardSummary } from '../types/dashboard';
import { WarRoomPage } from './WarRoomPage';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('../services/apiClient', () => ({ apiFetch: mocks.apiFetch }));

const summary: DashboardSummary = {
  mode: 'operations',
  metrics: [
    { label: 'งานเปิด', value: 12, note: 'ทุกคิว', tone: 'primary', path: '/tickets' },
    { label: 'เกินกำหนด', value: 2, note: 'ต้องจัดการ', tone: 'danger' },
    { label: 'บริการปกติ', value: 10, note: 'จาก 12 บริการ', tone: 'teal' },
    { label: 'เสี่ยง SLA', value: 3, note: 'ภายใน 2 ชั่วโมง', tone: 'amber' },
  ],
  cards: [{ key: 'tickets', label: 'Ticket', path: '/tickets', total: 12, warning: 3, overdue: 2, truncated: false, scanned: 12, tone: 'danger' }],
  upcoming: [{ id: 'TK-26-0839', source: 'Ticket', title: 'Wi-Fi ชั้น 5 หลุดบ่อย', status: 'กำลังดำเนินการ', dueAt: '2026-08-22T15:00:00.000Z', daysRemaining: -1, tone: 'danger', path: '/tickets/1' }],
  breakdowns: [],
  executiveAnalytics: null,
  alertCount: 2,
  leadDays: 7,
  generatedAt: '2026-08-22T10:00:00.000Z',
};

afterEach(() => {
  cleanup();
  mocks.apiFetch.mockReset();
});

describe('WarRoomPage', () => {
  it('แสดง KPI คิวเร่งด่วน สุขภาพบริการ และสรุปที่ทำต่อได้จากข้อมูลจริง', async () => {
    mocks.apiFetch.mockResolvedValue(summary);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <ThemeProvider><MemoryRouter><WarRoomPage /></MemoryRouter></ThemeProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'War Room' })).toBeVisible();
    expect((await screen.findAllByText('Wi-Fi ชั้น 5 หลุดบ่อย'))[0]).toBeVisible();
    expect(screen.getByText('สุขภาพบริการ')).toBeVisible();
    expect(screen.getByText(/มี 2 จุดที่ต้องติดตาม/)).toBeVisible();
    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/dashboard/summary?leadDays=7');
  });
});
