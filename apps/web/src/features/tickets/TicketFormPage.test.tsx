import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TicketFormPage } from './TicketFormPage';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('../../services/apiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/apiClient')>();
  return { ...original, apiFetch: apiFetchMock };
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/tickets/ticket-1/form']}><Routes><Route path="/tickets/:id/form" element={<TicketFormPage />} /></Routes></MemoryRouter></QueryClientProvider>);
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); apiFetchMock.mockReset(); });

describe('TicketFormPage', () => {
  it('builds a printable form automatically from the Ticket and inherited signature', async () => {
    apiFetchMock.mockImplementation((path: string) => path.includes('/branding')
      ? Promise.resolve({ organizationName: 'LIFE IT', logoUrl: '' })
      : Promise.resolve({
        id: 'ticket-1', ticket_no: 'TCK-001', title: 'ติดตั้งเครื่องพิมพ์', description: 'เชื่อมต่อเครื่องพิมพ์ไม่ได้', resolution: 'ติดตั้งไดรเวอร์แล้ว',
        requester_name_snapshot: 'สมชาย ใจดี', department_name_snapshot: 'การเงิน', guest_name: null, guest_department: null, requester_phone: '02-000-0000', location: 'ชั้น 2',
        requester: { full_name: 'สมชาย ใจดี', email: 'user@example.com' }, assignee: { full_name: 'เจ้าหน้าที่ IT', email: 'it@example.com' }, assignee_name_snapshot: 'เจ้าหน้าที่ IT',
        ticket_categories: { name: 'Hardware' }, priority: 'ปานกลาง', status: 'ปิดงาน', source_channel: 'web', created_at: '2026-08-19T02:00:00.000Z', due_at: null,
        rating_criteria_snapshot: [{ key: 'speed', label: 'ความรวดเร็ว', score: 5 }], rating_details: { speed: 5 }, feedback: 'ดีมาก',
        signature_url: 'https://signed.test/default.png', signature_source: 'default', worklogs: [],
      }));
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    renderPage();
    expect(await screen.findByText('TCK-001')).toBeInTheDocument();
    expect(screen.getByText('สมชาย ใจดี')).toBeInTheDocument();
    expect(screen.getByText('ติดตั้งไดรเวอร์แล้ว')).toBeInTheDocument();
    expect(screen.getByText('ความรวดเร็ว')).toBeInTheDocument();
    expect(screen.getByAltText('ลายเซ็นรับรอง Ticket')).toHaveAttribute('src', 'https://signed.test/default.png');
    fireEvent.click(screen.getByRole('button', { name: 'พิมพ์ / บันทึก PDF' }));
    await waitFor(() => expect(print).toHaveBeenCalledOnce());
  });
});
