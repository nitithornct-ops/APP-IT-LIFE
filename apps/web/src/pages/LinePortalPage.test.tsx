import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinePortalPage } from './LinePortalPage';

const { lineApiFetchMock, clearLineSessionTokenMock } = vi.hoisted(() => ({
  lineApiFetchMock: vi.fn(),
  clearLineSessionTokenMock: vi.fn(),
}));

vi.mock('../services/lineApiClient', () => ({
  lineApiFetch: lineApiFetchMock,
  clearLineSessionToken: clearLineSessionTokenMock,
  getLineSessionToken: () => 'active-line-session',
}));

const PROFILE = {
  displayName: 'Nitithorn',
  pictureUrl: '',
  fullName: 'นิธิธร ชูเกียรติ',
  department: 'ฝ่ายบัญชีและการเงิน',
  linkStatus: 'Active',
  friendStatus: 'Friend',
  linkedToSystemAccount: true,
  employeeCode: 'EMP-0031',
};

const OPEN_TICKET = {
  id: 'ticket-open',
  ticket_no: 'TK-2608-0142',
  title: 'โน้ตบุ๊กเปิดไม่ติด หน้าจอดำ',
  priority: 'สูง',
  status: 'กำลังดำเนินการ',
  created_at: '2026-08-29T02:12:00.000Z',
  updated_at: '2026-08-29T06:40:00.000Z',
  response_due_at: null,
  due_at: null,
  resolved_at: null,
  closed_at: null,
  rating: null,
  location: 'อาคาร A ชั้น 3',
  assignee_name_snapshot: 'วีระ ทองดี',
  asset_name_snapshot: 'โน้ตบุ๊ก IT-NB-0142',
  category: { name: 'คอมพิวเตอร์ / โน้ตบุ๊ก' },
};

const CLOSED_TICKET = {
  ...OPEN_TICKET,
  id: 'ticket-closed',
  ticket_no: 'TK-2608-0097',
  title: 'ตั้งอีเมลบนเครื่องใหม่',
  status: 'ปิดงาน',
  closed_at: '2026-08-21T03:02:00.000Z',
  assignee_name_snapshot: null,
  asset_name_snapshot: null,
};

const AWAITING_TICKET = {
  ...OPEN_TICKET,
  id: 'ticket-awaiting',
  ticket_no: 'TK-2608-0121',
  title: 'ระบบ ERP เข้าใช้งานไม่ได้',
  status: 'เสร็จสิ้น',
};

const DETAIL = {
  ticket: {
    ...OPEN_TICKET,
    description: 'กดปุ่มเปิดแล้วไฟสถานะติด แต่หน้าจอไม่ขึ้นภาพ',
    resolution: null,
    requester_name_snapshot: PROFILE.fullName,
    department_name_snapshot: PROFILE.department,
    requester_phone: null,
    source_channel: 'line',
    rating_details: null,
    rating_criteria_snapshot: null,
    signature_url: null,
    requester_signature_url: null,
    requester_signature_uploaded_at: null,
  },
  ratingCriteria: [],
  worklogs: [
    {
      id: 'log-1', entry_type: 'timeline', action: 'เปิด Ticket', detail: 'สร้างผ่าน LINE',
      status_from: null, status_to: 'ใหม่', created_at: '2026-08-29T02:12:00.000Z',
      actor_line_user_id: 'line-1', actor_label: null, actor: null,
    },
    {
      id: 'log-2', entry_type: 'comment', action: 'ข้อความสนทนา', detail: 'ขออนุญาตนำเครื่องไปเปลี่ยนสายจอที่ศูนย์บริการ',
      status_from: null, status_to: null, created_at: '2026-08-29T06:40:00.000Z',
      actor_line_user_id: null, actor_label: null, actor: { full_name: 'วีระ ทองดี' },
    },
  ],
  attachments: [],
};

const NOTIFICATIONS = [
  {
    id: 'note-1',
    ticket_id: 'ticket-awaiting',
    ticket_no: 'TK-2608-0121',
    ticket_title: 'ระบบ ERP เข้าใช้งานไม่ได้',
    action: 'บันทึกการดำเนินงาน',
    detail: 'ทีม IT แจ้งว่าดำเนินการเสร็จสิ้น รอท่านยืนยันปิดงาน',
    status_to: 'เสร็จสิ้น',
    created_at: '2026-08-29T07:00:00.000Z',
  },
];

beforeEach(() => {
  localStorage.clear();
  lineApiFetchMock.mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/api/v1/line/bootstrap') {
      return Promise.resolve({ configured: true, enabled: true, message: '', authenticated: true, profile: PROFILE });
    }
    if (path === '/api/v1/line/tickets') return Promise.resolve([OPEN_TICKET, AWAITING_TICKET, CLOSED_TICKET]);
    if (path === '/api/v1/line/notifications') return Promise.resolve(NOTIFICATIONS);
    if (path === '/api/v1/line/ticket-categories') {
      return Promise.resolve([
        { id: 'cat-1', name: 'คอมพิวเตอร์ / โน้ตบุ๊ก', default_priority: 'ปานกลาง', response_sla_hours: 4, resolution_sla_hours: 24, sla_hours: 24 },
      ]);
    }
    if (path === '/api/v1/line/tickets/ticket-open') return Promise.resolve(DETAIL);
    if (path === '/api/v1/line/tickets/ticket-open/messages' && init?.method === 'POST') {
      return Promise.resolve({ id: 'log-3' });
    }
    return Promise.reject(new Error(`Unexpected LINE API path: ${path}`));
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPortal() {
  return render(<MemoryRouter><LinePortalPage /></MemoryRouter>);
}

describe('LinePortalPage', () => {
  it('เปิดหน้าแรกพร้อมสรุปสถานะและ Ticket ที่ต้องติดตาม', async () => {
    renderPortal();

    expect(await screen.findByText('สวัสดี คุณนิธิธร ชูเกียรติ')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'กำลังดำเนินการ 1 รายการ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'รอท่านยืนยัน 1 รายการ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ปิดงานแล้ว 1 รายการ' })).toBeInTheDocument();

    // ใบที่รอผู้แจ้งยืนยันต้องมาก่อนใบที่ทีม IT ยังทำอยู่ ส่วนใบที่ปิดแล้วไม่อยู่ในรายการติดตาม
    const followUp = screen.getByRole('heading', { name: 'Ticket ที่ต้องติดตาม' }).closest('section')!;
    const ticketNumbers = within(followUp).getAllByText(/^TK-/).map((node) => node.textContent);
    expect(ticketNumbers).toEqual(['TK-2608-0121', 'TK-2608-0142']);
  });

  it('กรองรายการในแท็บงานของฉันตามสถานะที่เลือก', async () => {
    renderPortal();
    await screen.findByText('สวัสดี คุณนิธิธร ชูเกียรติ');

    fireEvent.click(screen.getByRole('button', { name: 'งานของฉัน' }));
    expect(await screen.findByText('แสดง 3 รายการ · เรียงจากใหม่ไปเก่า')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'ปิดแล้ว' }));
    expect(screen.getByText('TK-2608-0097')).toBeInTheDocument();
    expect(screen.queryByText('TK-2608-0142')).not.toBeInTheDocument();
    expect(screen.getByText('แสดง 1 รายการ · เรียงจากใหม่ไปเก่า')).toBeInTheDocument();
  });

  it('ล้างป้ายจำนวนแจ้งเตือนเมื่อเปิดแท็บ และจำเวลาที่อ่านไว้', async () => {
    renderPortal();
    await screen.findByText('สวัสดี คุณนิธิธร ชูเกียรติ');

    const bell = screen.getByRole('button', { name: 'การแจ้งเตือน 1 รายการที่ยังไม่ได้อ่าน' });
    fireEvent.click(bell);

    expect(await screen.findByText('ทีม IT แจ้งว่าดำเนินการเสร็จสิ้น รอท่านยืนยันปิดงาน')).toBeInTheDocument();
    expect(localStorage.getItem('line_portal_notifications_read_at')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'หน้าแรก' }));
    expect(await screen.findByRole('button', { name: 'การแจ้งเตือน' })).toBeInTheDocument();
  });

  it('เปิดรายละเอียด Ticket แล้วส่งข้อความถึงทีม IT ได้', async () => {
    renderPortal();
    await screen.findByText('สวัสดี คุณนิธิธร ชูเกียรติ');

    fireEvent.click(screen.getByText('โน้ตบุ๊กเปิดไม่ติด หน้าจอดำ'));

    expect(await screen.findByRole('heading', { name: 'โน้ตบุ๊กเปิดไม่ติด หน้าจอดำ' })).toBeInTheDocument();
    expect(screen.getByText('ขั้นที่ 3 จาก 5 · กำลังแก้ไข')).toBeInTheDocument();
    expect(screen.getByText('วีระ ทองดี · ทีม IT')).toBeInTheDocument();
    // ข้อความสนทนาอยู่ในกล่องคุย ไม่ปนกับไทม์ไลน์ความคืบหน้า
    expect(screen.getByText('ขออนุญาตนำเครื่องไปเปลี่ยนสายจอที่ศูนย์บริการ')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('พิมพ์ข้อความถึงทีม IT'), { target: { value: 'รับทราบครับ ขอบคุณครับ' } });
    fireEvent.click(screen.getByRole('button', { name: 'ส่งข้อความ' }));

    await waitFor(() => {
      expect(lineApiFetchMock).toHaveBeenCalledWith(
        '/api/v1/line/tickets/ticket-open/messages',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ message: 'รับทราบครับ ขอบคุณครับ' }) }),
      );
    });
  });

  it('ขอให้เข้าสู่ระบบด้วย LINE เมื่อยังไม่มี session', async () => {
    lineApiFetchMock.mockImplementation((path: string) => {
      if (path === '/api/v1/line/bootstrap') {
        return Promise.resolve({ configured: true, enabled: true, message: '', authenticated: false, profile: null });
      }
      return Promise.reject(new Error(`Unexpected LINE API path: ${path}`));
    });

    renderPortal();

    expect(await screen.findByRole('button', { name: 'เข้าสู่ระบบด้วย LINE' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'เมนูหลักของพอร์ทัล' })).not.toBeInTheDocument();
  });
});
