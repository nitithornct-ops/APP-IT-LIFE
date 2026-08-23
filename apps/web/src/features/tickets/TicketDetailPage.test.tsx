import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TicketDetail } from '../../types/tickets';
import { UpdateWorkPanel } from './TicketDetailPage';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../../services/apiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/apiClient')>();
  return { ...original, apiFetch: apiFetchMock };
});

function makeTicket(overrides: Partial<TicketDetail> = {}): TicketDetail {
  return {
    id: 'ticket-1',
    ticket_no: 'TCK-001',
    title: 'ติดตั้งเครื่องพิมพ์',
    requester_id: 'requester-1',
    requester_name_snapshot: 'ผู้แจ้ง',
    department_name_snapshot: 'IT',
    guest_name: null,
    guest_department: null,
    source_channel: 'web',
    category_id: null,
    priority: 'ปานกลาง',
    status: 'กำลังดำเนินการ',
    assignee_id: 'staff-1',
    assignee_name_snapshot: 'เจ้าหน้าที่ IT',
    is_security: false,
    incident_id: null,
    due_at: null,
    created_at: '2026-08-21T00:00:00.000Z',
    outsource_name: null,
    ticket_categories: null,
    requester: null,
    assignee: null,
    requester_phone: null,
    location: null,
    response_sla_hours: 4,
    resolution_sla_hours: 24,
    response_due_at: null,
    description: 'เชื่อมต่อเครื่องพิมพ์ไม่ได้',
    acknowledged_at: null,
    resolved_at: null,
    resolution: null,
    closed_at: null,
    rating: null,
    rating_details: null,
    rating_criteria_snapshot: null,
    feedback: null,
    feedback_at: null,
    signature_storage_path: null,
    signature_url: null,
    signature_source: null,
    signature_uploaded_by: null,
    signature_uploaded_at: null,
    outsource_vendor_id: null,
    outsource_issue_no: null,
    outsource_sent_at: null,
    notes: null,
    reopen_count: 0,
    attachments: [],
    worklogs: [],
    ...overrides,
  };
}

function renderWorkPanel(ticket: TicketDetail) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <UpdateWorkPanel ticket={ticket} staff={[{ id: 'staff-1', full_name: 'เจ้าหน้าที่ 1', email: 'staff-1@example.com' }, { id: 'staff-2', full_name: 'เจ้าหน้าที่ 2', email: 'staff-2@example.com' }]} vendors={[]} />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe('Ticket work panel', () => {
  it('resets its fields from the refreshed Ticket instead of retaining a stale status', async () => {
    const ticket = makeTicket();
    const { rerender } = renderWorkPanel(ticket);
    const status = screen.getByLabelText('สถานะ');

    fireEvent.change(status, { target: { value: 'รออะไหล่' } });
    expect(status).toHaveValue('รออะไหล่');

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <UpdateWorkPanel ticket={makeTicket({ status: 'เสร็จสิ้น', assignee_id: 'staff-2', resolution: 'ติดตั้งไดรเวอร์แล้ว' })} staff={[{ id: 'staff-1', full_name: 'เจ้าหน้าที่ 1', email: 'staff-1@example.com' }, { id: 'staff-2', full_name: 'เจ้าหน้าที่ 2', email: 'staff-2@example.com' }]} vendors={[]} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(status).toHaveValue('เสร็จสิ้น'));
    expect(screen.getByLabelText('ผู้รับผิดชอบ')).toHaveValue('staff-2');
    expect(screen.getByLabelText('ผลการแก้ไข (จำเป็นก่อนปิดงาน)')).toHaveValue('ติดตั้งไดรเวอร์แล้ว');
  });

  it('shows state-specific requirements before calling the API', async () => {
    renderWorkPanel(makeTicket({ status: 'เสร็จสิ้น' }));
    fireEvent.change(screen.getByLabelText('สถานะ'), { target: { value: 'ปิดงาน' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(await screen.findByText('กรุณาระบุผลการแก้ไขก่อนปิดงาน')).toBeVisible();
    expect(apiFetchMock).not.toHaveBeenCalled();

    cleanup();
    renderWorkPanel(makeTicket());
    fireEvent.change(screen.getByLabelText('สถานะ'), { target: { value: 'ยกเลิก' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(await screen.findByText('กรุณาระบุเหตุผลการยกเลิก')).toBeVisible();
    expect(apiFetchMock).not.toHaveBeenCalled();

    cleanup();
    renderWorkPanel(makeTicket());
    fireEvent.change(screen.getByLabelText('สถานะ'), { target: { value: 'ส่งต่อ Outsource' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(await screen.findByText('กรุณาระบุชื่อผู้ให้บริการภายนอก')).toBeVisible();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});
