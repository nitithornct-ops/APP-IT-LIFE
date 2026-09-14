import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DashboardSummary } from '../types/dashboard';
import { HomePage } from './HomePage';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), downloadCsv: vi.fn() }));

vi.mock('../services/apiClient', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('../utils/csv', () => ({ downloadCsv: mocks.downloadCsv }));
vi.mock('../stores/authContext', () => ({
  useAuth: () => ({
    me: { profile: { full_name: 'ผู้บริหาร ทดสอบ' } },
    hasPermission: (permission: string) => permission === 'dashboard.view',
  }),
}));

const summary: DashboardSummary = {
  mode: 'executive',
  metrics: [
    { key: 'critical-incidents', label: 'เหตุการณ์สำคัญที่เปิดอยู่', value: 2, note: 'Incident ระดับสูง/วิกฤต', tone: 'danger', path: '/incidents' },
    { key: 'control-health', label: 'สุขภาพมาตรการควบคุม', value: '86%', note: 'จากข้อมูลที่เข้าถึงได้', tone: 'amber' },
    { key: 'overdue-items', label: 'รายการเกินกำหนด', value: 4, note: 'รวมทุกโมดูล', tone: 'danger' },
    { key: 'open-service-requests', label: 'คำขอบริการที่เปิดอยู่', value: 8, note: '1 รายการเกินกำหนด', tone: 'primary', path: '/service-requests' },
  ],
  cards: [
    { key: 'tickets', label: 'Ticket', path: '/tickets', total: 12, warning: 3, overdue: 1, truncated: false, scanned: 12, tone: 'danger' },
    { key: 'incidents', label: 'Incident', path: '/incidents', total: 5, warning: 0, overdue: 0, truncated: false, scanned: 5, tone: 'teal' },
  ],
  upcoming: [
    { id: 'ticket-1', source: 'Ticket', title: 'แก้ไขระบบเครือข่าย', status: 'กำลังดำเนินการ', dueAt: '2026-08-20T00:00:00.000Z', daysRemaining: -1, tone: 'danger', path: '/tickets/ticket-1' },
  ],
  breakdowns: [
    { key: 'ticket-priority', label: 'Ticket ตามความสำคัญ', items: [{ label: 'สูง', value: 7 }, { label: 'ปกติ', value: 5 }] },
  ],
  executiveAnalytics: null,
  decisions: [
    { id: 'incident-1', source: 'Incident', title: 'INC-001 · ข้อมูลรั่วไหล', reason: 'Incident ระดับสูง/วิกฤต ต้องกำกับการตอบสนอง', path: '/incidents/incident-1' },
  ],
  trend: { label: 'รายการที่สร้าง', current: 12, previous: 9, delta: 3, percent: 33, sampled: false },
  alertCount: 3,
  leadDays: 30,
  generatedAt: '2026-08-21T10:00:00.000Z',
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  mocks.apiFetch.mockReset();
  mocks.downloadCsv.mockReset();
});

describe('HomePage executive overview', () => {
  it('แสดง narrative dashboard พร้อม KPI, operational control, breakdown และกำหนดการ', async () => {
    mocks.apiFetch.mockResolvedValue(summary);
    renderPage();

    expect(await screen.findByRole('heading', { level: 1, name: 'วันนี้มี 3 เรื่อง ที่ควรจัดการก่อนงานอื่น' })).toBeVisible();
    expect(await screen.findByText('สุขภาพงานควบคุมเชิงปฏิบัติการ')).toBeVisible();
    expect(screen.getByText(/ภาพรวมการกำกับดูแลและความเสี่ยง/)).toBeVisible();
    expect(screen.getByRole('region', { name: 'ตัวชี้วัดสำคัญ' })).toBeVisible();
    expect(screen.getByText('สัดส่วนงานสำคัญ')).toBeVisible();
    expect(screen.getByText('กำหนดการที่ต้องติดตาม')).toBeVisible();
    expect(screen.getByText('แก้ไขระบบเครือข่าย')).toBeVisible();
    expect(screen.getByText('เกิน 1 วัน')).toBeVisible();
    expect(screen.getByTestId('dashboard-trend')).toBeVisible();
    expect(screen.getByTestId('dashboard-decisions')).toBeVisible();
    expect(screen.getByText('เรื่องที่ต้องตัดสินใจ')).toBeVisible();
  });

  it('ปักหมุดเฉพาะ KPI ที่เลือกและส่งช่วง Dashboard ไปยังรายการต้นทาง', async () => {
    mocks.apiFetch.mockResolvedValue(summary);
    renderPage();
    await screen.findByText('สุขภาพงานควบคุมเชิงปฏิบัติการ');

    expect(screen.getByRole('link', { name: 'คำขอบริการที่เปิดอยู่: 8' })).toHaveAttribute('href', '/service-requests?fromDashboard=1&dashboardRange=30');

    fireEvent.click(screen.getByRole('button', { name: 'จัดการ KPI' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /คำขอบริการที่เปิดอยู่/ }));

    expect(screen.queryByRole('link', { name: 'คำขอบริการที่เปิดอยู่: 8' })).not.toBeInTheDocument();
    expect(localStorage.getItem('itlife-dashboard-kpis:anonymous:executive')).toContain('critical-incidents');
  });

  it('เปลี่ยนช่วงติดตามแล้วโหลด summary ด้วยค่าใหม่', async () => {
    mocks.apiFetch.mockResolvedValue(summary);
    renderPage();
    await screen.findByText('สุขภาพงานควบคุมเชิงปฏิบัติการ');

    fireEvent.click(screen.getByRole('button', { name: '7 วัน' }));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/dashboard/summary?leadDays=7'));
  });

  it('ส่งออกกำหนดการที่ผู้ใช้เห็นเป็น CSV', async () => {
    mocks.apiFetch.mockResolvedValue(summary);
    renderPage();
    const exportButton = await screen.findByRole('button', { name: 'ส่งออกรายงาน' });
    await waitFor(() => expect(exportButton).toBeEnabled());

    fireEvent.click(exportButton);

    expect(mocks.downloadCsv).toHaveBeenCalledOnce();
    expect(mocks.downloadCsv.mock.calls[0][0][0]).toEqual(['แหล่งข้อมูล', 'รายการ', 'สถานะ', 'ครบกำหนด', 'คงเหลือ']);
    expect(mocks.downloadCsv.mock.calls[0][1]).toBe('dashboard-follow-up-2026-08-21.csv');
  });
});
