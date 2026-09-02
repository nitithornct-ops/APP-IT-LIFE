import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TicketDetail, TicketWorklog } from '../../types/tickets';
import { TicketConversationPanel } from './TicketConversationPanel';
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
    requester_position_snapshot: null,
    location: null,
    incident_at: null,
    erp_module: null,
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
    signature_uploaded_by: null,
    signature_uploaded_at: null,
    requester_signature_storage_path: null,
    requester_signature_url: null,
    requester_signature_uploaded_by: null,
    requester_signature_uploaded_at: null,
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
  it('keeps the Outsource sidebar fields in one explicit grid column', () => {
    renderWorkPanel(makeTicket());
    fireEvent.change(screen.getByLabelText('สถานะ'), { target: { value: 'ส่งต่อ Outsource' } });

    const form = screen.getByTestId('ticket-work-panel').querySelector('form');
    expect(screen.getByLabelText('เลือกจากทะเบียน Vendor')).toBeVisible();
    expect(screen.getByLabelText('ชื่อผู้ให้บริการภายนอก (กรณีไม่มีในทะเบียน)')).toBeVisible();
    expect(screen.getByLabelText('เลขแจ้งปัญหา (ถ้ามี)')).toBeVisible();
    expect(form).toHaveClass('grid-cols-1');
    expect(form).not.toHaveClass('sm:grid-cols-2');
    expect(form?.querySelectorAll('[class~="sm:col-span-2"]')).toHaveLength(0);
  });

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
    expect(screen.getByLabelText('ผลการแก้ไข (จำเป็นก่อนส่งให้ผู้แจ้งตรวจรับ)')).toHaveValue('ติดตั้งไดรเวอร์แล้ว');
  });

  it('shows state-specific requirements before calling the API', async () => {
    renderWorkPanel(makeTicket({ status: 'เสร็จสิ้น' }));
    expect(screen.queryByRole('option', { name: 'ปิดงาน' })).not.toBeInTheDocument();
    expect(screen.getByText(/ผู้แจ้งประเมิน ตรวจรับ และลงลายเซ็นเพื่อปิดงาน/)).toBeVisible();

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

function makeWorklog(overrides: Partial<TicketWorklog> = {}): TicketWorklog {
  return {
    id: 'log-1',
    ticket_id: 'ticket-1',
    action: 'ข้อความสนทนา',
    detail: 'ข้อความทดสอบ',
    status_from: null,
    status_to: null,
    minutes_spent: null,
    is_public: true,
    entry_type: 'comment',
    actor_id: null,
    actor_line_user_id: null,
    actor_label: null,
    actor: null,
    created_at: '2026-09-01T03:00:00.000Z',
    ...overrides,
  };
}

function renderConversation(ticket: TicketDetail, viewerId = 'staff-1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TicketConversationPanel ticket={ticket} viewerId={viewerId} canComment canInternalNote={false} />
    </QueryClientProvider>,
  );
}

describe('Ticket conversation panel', () => {
  it('shows only the chat entries, so status events stay on the work timeline', () => {
    renderConversation(makeTicket({
      worklogs: [
        makeWorklog({ id: 'log-1', detail: 'เครื่องยังเปิดไม่ติดครับ' }),
        makeWorklog({ id: 'log-2', entry_type: 'timeline', action: 'รับเรื่องแล้ว', detail: 'กำลังเข้าตรวจสอบ', actor_id: 'staff-1' }),
        makeWorklog({ id: 'log-3', detail: 'กำลังเข้าไปดูให้ครับ', actor_id: 'staff-1', actor: { full_name: 'ช่างเอ', email: 'a@example.com' } }),
      ],
    }));

    expect(screen.getByText('เครื่องยังเปิดไม่ติดครับ')).toBeVisible();
    expect(screen.getByText('กำลังเข้าไปดูให้ครับ')).toBeVisible();
    expect(screen.queryByText('กำลังเข้าตรวจสอบ')).toBeNull();
    expect(screen.getByText('2 ข้อความ')).toBeVisible();
  });

  it('names each side so the requester and the technician are never confused', () => {
    renderConversation(makeTicket({
      requester_name_snapshot: 'สมชาย ใจดี',
      worklogs: [
        makeWorklog({ id: 'log-1', detail: 'เครื่องยังเปิดไม่ติดครับ' }),
        makeWorklog({ id: 'log-2', detail: 'กำลังเข้าไปดูให้ครับ', actor_id: 'staff-1', actor: { full_name: 'ช่างเอ', email: 'a@example.com' } }),
      ],
    }));

    expect(screen.getByText(/สมชาย ใจดี · ผู้แจ้ง/)).toBeVisible();
    expect(screen.getByText(/^คุณ ·/)).toBeVisible();
  });

  it('sends the typed message to the ticket conversation endpoint', async () => {
    apiFetchMock.mockResolvedValue({});
    renderConversation(makeTicket());

    fireEvent.change(screen.getByLabelText('ข้อความสนทนา'), { target: { value: 'อีกครึ่งชั่วโมงเข้าไปดูครับ' } });
    fireEvent.click(screen.getByRole('button', { name: /ส่ง/ }));

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/tickets/ticket-1/conversation', {
      method: 'POST',
      body: JSON.stringify({ message: 'อีกครึ่งชั่วโมงเข้าไปดูครับ', visibility: 'public' }),
    }));
  });

  it('blocks a new public message once the Ticket is closed', () => {
    renderConversation(makeTicket({ status: 'ปิดงาน' }));

    expect(screen.getByLabelText('ข้อความสนทนา')).toBeDisabled();
    expect(screen.getByText('Ticket ที่ปิดหรือยกเลิกแล้วเพิ่มได้เฉพาะบันทึกภายใน')).toBeVisible();
  });
});
