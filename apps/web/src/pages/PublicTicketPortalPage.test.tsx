import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicTicketPortalPage } from './PublicTicketPortalPage';

const { getLineSessionTokenMock, lineApiFetchMock, publicTicketApiFetchMock } = vi.hoisted(() => ({
  getLineSessionTokenMock: vi.fn(),
  lineApiFetchMock: vi.fn(),
  publicTicketApiFetchMock: vi.fn(),
}));

vi.mock('../services/lineApiClient', () => ({
  getLineSessionToken: getLineSessionTokenMock,
  lineApiFetch: lineApiFetchMock,
}));

vi.mock('../services/publicTicketApiClient', () => ({
  publicTicketApiFetch: publicTicketApiFetchMock,
}));

beforeEach(() => {
  sessionStorage.clear();
  window.turnstile = {
    render: vi.fn((_container, options) => {
      options.callback('test-public-ticket-token');
      return 'public-ticket-widget';
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  };
  getLineSessionTokenMock.mockReturnValue('active-line-session');
  publicTicketApiFetchMock.mockResolvedValue({
    enabled: true,
    categories: [],
    priorities: [],
    privacy: { version: 'test', summary: '', dpoContact: '' },
  });
  lineApiFetchMock.mockImplementation((path: string) => {
    if (path === '/api/v1/line/bootstrap') {
      return Promise.resolve({ authenticated: true, profile: { fullName: 'สมชาย ใจดี', department: 'บัญชี', linkStatus: 'Active' } });
    }
    if (path === '/api/v1/line/tickets') {
      return Promise.resolve([
        {
          id: 'ticket-1',
          ticket_no: 'TCK-2026-0001',
          title: 'เครื่องพิมพ์ใช้งานไม่ได้',
          priority: 'ปานกลาง',
          status: 'กำลังดำเนินการ',
          created_at: '2026-08-13T03:00:00.000Z',
          category: { name: 'อุปกรณ์สำนักงาน' },
        },
      ]);
    }
    return Promise.reject(new Error(`Unexpected LINE API path: ${path}`));
  });
});

afterEach(() => {
  cleanup();
  delete window.turnstile;
  vi.clearAllMocks();
});

describe('PublicTicketPortalPage LINE status list', () => {
  it('shows LINE tickets without waiting for an employee-link approval status', async () => {
    render(<MemoryRouter><PublicTicketPortalPage /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: 'ติดตามสถานะ' }));

    expect(await screen.findByRole('list', { name: 'รายการแจ้งซ่อม' })).toBeVisible();
    expect(screen.getByText('รายการแจ้งซ่อมของฉัน')).toBeVisible();
    expect(screen.getByText('TCK-2026-0001')).toBeVisible();
    expect(screen.getByText('เครื่องพิมพ์ใช้งานไม่ได้')).toBeVisible();
    expect(screen.getByText('อุปกรณ์สำนักงาน')).toBeVisible();
    expect(screen.getByText('กำลังดำเนินการ')).toBeVisible();
    expect(screen.getByTestId('public-ticket-code-search')).toBeVisible();
    expect(lineApiFetchMock).toHaveBeenCalledWith('/api/v1/line/tickets');
  });
});

describe('PublicTicketPortalPage LINE report flow', () => {
  it('asks for a manually entered name when LINE has not completed the requester profile', async () => {
    lineApiFetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/v1/line/bootstrap') {
        return Promise.resolve({ authenticated: true, profile: { fullName: '', department: '', linkStatus: 'Active' } });
      }
      if (path === '/api/v1/line/profile' && init?.method === 'PATCH') {
        return Promise.resolve({ fullName: 'สมหญิง รักดี', department: '', linkStatus: 'Active' });
      }
      return Promise.reject(new Error(`Unexpected LINE API path: ${path}`));
    });

    render(<MemoryRouter><PublicTicketPortalPage /></MemoryRouter>);

    expect(await screen.findByText(/ระบบจะไม่ใช้ชื่อโปรไฟล์ LINE/)).toBeVisible();
    const nameInput = screen.getByLabelText('ชื่อ–นามสกุล *');
    expect(nameInput).toHaveValue('');

    fireEvent.change(nameInput, { target: { value: 'สมหญิง รักดี' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกและดำเนินการต่อ' }));

    await waitFor(() => expect(lineApiFetchMock).toHaveBeenCalledWith('/api/v1/line/profile', {
      method: 'PATCH',
      body: JSON.stringify({ fullName: 'สมหญิง รักดี' }),
    }));
    expect(await screen.findByDisplayValue('สมหญิง รักดี')).toBeVisible();
  });

  it('uses the shared report form and creates a Ticket under the active LINE account', async () => {
    publicTicketApiFetchMock.mockResolvedValue({
      enabled: true,
      categories: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Computer', response_sla_hours: 4, resolution_sla_hours: 24, sla_hours: 24 }],
      priorities: ['ปานกลาง'],
      privacy: { version: 'test', summary: 'privacy', dpoContact: 'IT' },
    });
    lineApiFetchMock.mockImplementation((path: string) => {
      if (path === '/api/v1/line/bootstrap') {
        return Promise.resolve({ authenticated: true, profile: { fullName: 'สมชาย ใจดี', department: 'บัญชี', linkStatus: 'Active' } });
      }
      if (path === '/api/v1/line/tickets') {
        return Promise.resolve({ id: 'line-ticket-1', ticket_no: 'TCK-2026-0200' });
      }
      return Promise.reject(new Error(`Unexpected LINE API path: ${path}`));
    });

    render(<MemoryRouter><PublicTicketPortalPage /></MemoryRouter>);

    expect(await screen.findByText('เข้าสู่ระบบ LINE แล้ว')).toBeVisible();
    expect(screen.getByLabelText(/ชื่อ–นามสกุล/)).toHaveValue('สมชาย ใจดี');
    expect(screen.queryByRole('link', { name: 'LINE Login' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/เบอร์โทร/), { target: { value: '0812345678' } });
    fireEvent.change(screen.getByLabelText(/ประเภทงานที่ขอรับบริการ/), { target: { value: '11111111-1111-4111-8111-111111111111' } });
    fireEvent.change(screen.getByLabelText(/สรุปปัญหาสั้น/), { target: { value: 'เปิดเครื่องไม่ติด' } });
    fireEvent.change(screen.getByLabelText(/รายละเอียดเพิ่มเติม/), { target: { value: 'กดปุ่มแล้วเครื่องไม่มีไฟ' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'ส่งแจ้งซ่อม' }));

    expect(await screen.findByText('TCK-2026-0200')).toBeVisible();
    expect(screen.getByText(/Ticket ผูกกับบัญชี LINE แล้ว/)).toBeVisible();
    expect(screen.queryByTestId('public-tracking-code')).not.toBeInTheDocument();
    const createCall = lineApiFetchMock.mock.calls.find(([path]) => path === '/api/v1/line/tickets');
    expect(createCall?.[1]?.method).toBe('POST');
    expect(JSON.parse(createCall?.[1]?.body as string)).toMatchObject({
      requesterPhone: '0812345678',
      categoryId: '11111111-1111-4111-8111-111111111111',
      title: 'เปิดเครื่องไม่ติด',
      description: 'กดปุ่มแล้วเครื่องไม่มีไฟ',
      privacyConsent: true,
      department: 'บัญชี',
    });
    expect(JSON.parse(createCall?.[1]?.body as string).incidentAt).toEqual(expect.any(String));
  });

  it('restores text fields saved before leaving for LINE Login', async () => {
    getLineSessionTokenMock.mockReturnValue(null);
    sessionStorage.setItem('public_ticket_draft', JSON.stringify({
      guestName: 'ผู้แจ้งเดิม',
      requesterPhone: '0899999999',
      title: 'อินเทอร์เน็ตช้า',
      description: 'ใช้งานเว็บไซต์ภายในไม่ได้',
      privacyConsent: false,
    }));

    render(<MemoryRouter><PublicTicketPortalPage /></MemoryRouter>);

    expect(await screen.findByDisplayValue('ผู้แจ้งเดิม')).toBeVisible();
    expect(screen.getByDisplayValue('0899999999')).toBeVisible();
    expect(screen.getByDisplayValue('อินเทอร์เน็ตช้า')).toBeVisible();
    expect(screen.getByDisplayValue('ใช้งานเว็บไซต์ภายในไม่ได้')).toBeVisible();
  });
});

describe('PublicTicketPortalPage report validation', () => {
  it('submits a guest Ticket without a phone number', async () => {
    getLineSessionTokenMock.mockReturnValue(null);
    publicTicketApiFetchMock.mockImplementation((path: string) => {
      if (path === '/api/v1/public/tickets/form-data') {
        return Promise.resolve({
          enabled: true,
          categories: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Computer', response_sla_hours: 4, resolution_sla_hours: 24, sla_hours: 24 }],
          priorities: ['ปานกลาง'],
          privacy: { version: 'test', summary: 'privacy', dpoContact: 'IT' },
        });
      }
      if (path === '/api/v1/public/tickets') {
        return Promise.resolve({ id: 'guest-ticket-no-phone', ticketNo: 'TCK-2026-0101', trackingToken: 'ABCD-EFGH-JKLM' });
      }
      return Promise.reject(new Error(`Unexpected public API path: ${path}`));
    });

    render(<MemoryRouter><PublicTicketPortalPage /></MemoryRouter>);

    expect(await screen.findByText('ข้อมูลผู้แจ้งและติดต่อกลับ')).toBeVisible();
    const phoneInput = screen.getByLabelText(/เบอร์โทร/);
    expect(phoneInput).not.toBeRequired();
    expect(phoneInput).toHaveValue('');
    fireEvent.change(screen.getByLabelText(/ชื่อ–นามสกุล/), { target: { value: 'สมชาย ใจดี' } });
    fireEvent.change(screen.getByLabelText(/ประเภทงานที่ขอรับบริการ/), { target: { value: '11111111-1111-4111-8111-111111111111' } });
    fireEvent.change(screen.getByLabelText(/สรุปปัญหาสั้น/), { target: { value: 'เปิดเครื่องไม่ติด' } });
    fireEvent.change(screen.getByLabelText(/รายละเอียดเพิ่มเติม/), { target: { value: 'กดปุ่มแล้วเครื่องไม่มีไฟ' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'ส่งแจ้งซ่อม' }));

    expect(await screen.findByText('TCK-2026-0101')).toBeVisible();
    const createCall = publicTicketApiFetchMock.mock.calls.find(([path]) => path === '/api/v1/public/tickets');
    const payload = JSON.parse(createCall?.[1]?.body as string) as Record<string, unknown>;
    expect(payload).not.toHaveProperty('requesterPhone');
  });

  it('blocks the shared report form when the requester phone is too short', async () => {
    getLineSessionTokenMock.mockReturnValue(null);
    publicTicketApiFetchMock.mockResolvedValue({
      enabled: true,
      categories: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Computer', response_sla_hours: 4, resolution_sla_hours: 24, sla_hours: 24 }],
      priorities: ['ปานกลาง'],
      privacy: { version: 'test', summary: 'privacy', dpoContact: 'IT' },
    });

    render(<MemoryRouter><PublicTicketPortalPage /></MemoryRouter>);

    expect(await screen.findByText('ข้อมูลผู้แจ้งและติดต่อกลับ')).toBeVisible();
    fireEvent.change(screen.getByLabelText(/ชื่อ–นามสกุล/), { target: { value: 'สมชาย ใจดี' } });
    fireEvent.change(screen.getByLabelText(/เบอร์โทร/), { target: { value: '1234567' } });
    fireEvent.change(screen.getByLabelText(/ประเภทงานที่ขอรับบริการ/), { target: { value: '11111111-1111-4111-8111-111111111111' } });
    fireEvent.change(screen.getByLabelText(/สรุปปัญหาสั้น/), { target: { value: 'เปิดเครื่องไม่ติด' } });
    fireEvent.change(screen.getByLabelText(/รายละเอียดเพิ่มเติม/), { target: { value: 'กดปุ่มแล้วเครื่องไม่มีไฟ' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'ส่งแจ้งซ่อม' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('กรุณากรอกเบอร์โทรอย่างน้อย 8 ตัวอักษร');
    expect(publicTicketApiFetchMock).not.toHaveBeenCalledWith('/api/v1/public/tickets', expect.anything());
  });
});

describe('PublicTicketPortalPage guest status search', () => {
  it('requires the Ticket number and tracking token instead of name and phone', async () => {
    getLineSessionTokenMock.mockReturnValue(null);
    let signedOff = false;
    publicTicketApiFetchMock.mockImplementation((path: string) => {
      if (path === '/api/v1/public/tickets/form-data') {
        return Promise.resolve({ enabled: true, categories: [], priorities: [], privacy: { version: 'test', summary: '', dpoContact: '' } });
      }
      if (path === '/api/v1/public/tickets/TCK-2026-0099' || path === '/api/v1/public/tickets/guest-ticket-1') {
        return Promise.resolve({
          ticket: {
            id: 'guest-ticket-1', ticket_no: 'TCK-2026-0099', title: 'คอมพิวเตอร์เปิดไม่ติด', description: 'ไม่มีไฟเข้า',
            status: signedOff ? 'ปิดงาน' : 'เสร็จสิ้น', priority: 'ปานกลาง', resolution: 'เปลี่ยน Power Supply แล้ว', created_at: '2026-08-19T03:00:00.000Z',
            resolved_at: '2026-08-19T06:00:00.000Z', closed_at: signedOff ? '2026-08-19T07:00:00.000Z' : null,
            guest_name: 'สมชาย ใจดี', rating: signedOff ? 5 : null, rating_details: signedOff ? { workQuality: 5 } : null,
            rating_criteria_snapshot: signedOff ? [{ key: 'workQuality', label: 'คุณภาพงานซ่อม', score: 5 }] : null,
            feedback: null, feedback_at: signedOff ? '2026-08-19T07:00:00.000Z' : null,
            requester_signature_url: signedOff ? 'https://signed.test/requester.png' : null,
            requester_signature_uploaded_at: signedOff ? '2026-08-19T07:00:00.000Z' : null,
            category: { name: 'คอมพิวเตอร์' },
          },
          ratingCriteria: [{ id: 'criterion-1', key: 'workQuality', label: 'คุณภาพงานซ่อม', description: null, sort_order: 1, status: 'active' }],
          worklogs: signedOff ? [{ action: 'ผู้แจ้งประเมิน ตรวจรับ และลงนาม', detail: 'ผู้แจ้งประเมิน 5/5 คะแนน', status_from: 'เสร็จสิ้น', status_to: 'ปิดงาน', created_at: '2026-08-19T07:00:00.000Z' }] : [], attachments: [],
        });
      }
      if (path === '/api/v1/public/tickets/guest-ticket-1/signoff') {
        signedOff = true;
        return Promise.resolve({ status: 'ปิดงาน', signatureUrl: 'https://signed.test/requester.png' });
      }
      return Promise.reject(new Error(`Unexpected public API path: ${path}`));
    });

    render(<MemoryRouter><PublicTicketPortalPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'ติดตามสถานะ' }));
    expect(screen.queryByLabelText('ชื่อ–นามสกุลผู้แจ้ง')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('เลข Ticket'), { target: { value: 'TCK-2026-0099' } });
    fireEvent.change(screen.getByLabelText('รหัสติดตาม'), { target: { value: 'ABCD-EFGH-JKLM' } });
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจสอบสถานะ' }));

    expect(await screen.findByText('TCK-2026-0099')).toBeVisible();
    expect(screen.getByText('คอมพิวเตอร์เปิดไม่ติด')).toBeVisible();
    expect(screen.getByTestId('public-current-status')).toHaveTextContent('ซ่อมเสร็จ (รอยืนยัน)');
    const flow = screen.getByRole('list', { name: 'ลำดับสถานะงาน' });
    expect(within(flow).getByText('รอตรวจรับ').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(within(flow).getByText('ปิดงาน').closest('li')).not.toHaveAttribute('aria-current');
    expect(publicTicketApiFetchMock).toHaveBeenCalledWith('/api/v1/public/tickets/TCK-2026-0099', {
      headers: { 'x-tracking-token': 'ABCD-EFGH-JKLM' },
    });

    const signature = new File(['png'], 'requester.png', { type: 'image/png' });
    fireEvent.click(screen.getByRole('radio', { name: 'คุณภาพงานซ่อม 5 คะแนน ยอดเยี่ยม' }));
    fireEvent.change(screen.getByLabelText('ไฟล์ลายเซ็นผู้แจ้ง PNG'), { target: { files: [signature] } });
    fireEvent.click(screen.getByText(/ข้าพเจ้าได้ตรวจสอบแล้ว/));
    fireEvent.click(screen.getByRole('button', { name: 'ส่งแบบประเมิน ลงลายเซ็น และปิดงาน' }));

    expect(await screen.findByAltText('ลายเซ็นผู้แจ้งตรวจรับงาน')).toBeVisible();
    expect(screen.getByTestId('public-current-status')).toHaveTextContent('ปิดงานแล้ว');
    const closedFlow = screen.getByRole('list', { name: 'ลำดับสถานะงาน' });
    expect(within(closedFlow).getByText('ปิดงาน').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('heading', { name: 'ประวัติการดำเนินงาน' })).toBeVisible();
    expect(screen.getAllByText(/ผู้แจ้งประเมิน ตรวจรับ และลงนาม/).length).toBeGreaterThanOrEqual(2);
    const signoffCall = publicTicketApiFetchMock.mock.calls.find(([path]) => path.endsWith('/signoff'));
    expect(signoffCall?.[1]?.headers).toEqual({ 'x-tracking-token': 'ABCD-EFGH-JKLM' });
    expect(signoffCall?.[1]?.body).toBeInstanceOf(FormData);
  });

  it('shows a cancelled branch at the last normal flow step reached', async () => {
    getLineSessionTokenMock.mockReturnValue(null);
    publicTicketApiFetchMock.mockImplementation((path: string) => {
      if (path === '/api/v1/public/tickets/form-data') {
        return Promise.resolve({ enabled: true, categories: [], priorities: [], privacy: { version: 'test', summary: '', dpoContact: '' } });
      }
      if (path === '/api/v1/public/tickets/TCK-2026-0102') {
        return Promise.resolve({
          ticket: {
            id: 'guest-ticket-cancelled', ticket_no: 'TCK-2026-0102', title: 'จอภาพไม่มีสัญญาณ', description: 'หน้าจอขึ้น No signal',
            status: 'ยกเลิก', priority: 'ปานกลาง', resolution: null, created_at: '2026-08-20T02:00:00.000Z',
            resolved_at: null, closed_at: null, guest_name: 'สมชาย ใจดี', rating: null, rating_details: null,
            rating_criteria_snapshot: null, feedback: null, feedback_at: null, requester_signature_url: null,
            requester_signature_uploaded_at: null, category: { name: 'คอมพิวเตอร์' },
          },
          ratingCriteria: [],
          worklogs: [
            { action: 'เปิด Ticket', detail: null, status_from: null, status_to: 'ใหม่', created_at: '2026-08-20T02:00:00.000Z' },
            { action: 'เริ่มดำเนินการ', detail: 'ตรวจสอบสายสัญญาณแล้ว', status_from: 'รับเรื่องแล้ว', status_to: 'กำลังดำเนินการ', created_at: '2026-08-20T03:00:00.000Z' },
            { action: 'ยกเลิก Ticket', detail: 'ผู้แจ้งยืนยันว่าไม่ต้องดำเนินการต่อ', status_from: 'กำลังดำเนินการ', status_to: 'ยกเลิก', created_at: '2026-08-20T04:00:00.000Z' },
          ],
          attachments: [],
        });
      }
      return Promise.reject(new Error(`Unexpected public API path: ${path}`));
    });

    render(<MemoryRouter><PublicTicketPortalPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'ติดตามสถานะ' }));
    fireEvent.change(screen.getByLabelText('เลข Ticket'), { target: { value: 'TCK-2026-0102' } });
    fireEvent.change(screen.getByLabelText('รหัสติดตาม'), { target: { value: 'ABCD-EFGH-JKLM' } });
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจสอบสถานะ' }));

    expect(await screen.findByTestId('public-current-status')).toHaveTextContent('ยกเลิก');
    const flow = screen.getByRole('list', { name: 'ลำดับสถานะงาน' });
    expect(within(flow).getByText('กำลังแก้ไข').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText(/Flow ปกติหยุดที่ขั้น “กำลังแก้ไข”/)).toBeVisible();
    expect(screen.getByText('ผู้แจ้งยืนยันว่าไม่ต้องดำเนินการต่อ')).toBeVisible();
  });
});

describe('PublicTicketPortalPage guest attachment upload', () => {
  it('keeps contact details in the problem card and uploads selected files after creating the Ticket', async () => {
    getLineSessionTokenMock.mockReturnValue(null);
    publicTicketApiFetchMock.mockImplementation((path: string) => {
      if (path === '/api/v1/public/tickets/form-data') {
        return Promise.resolve({
          enabled: true,
          categories: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Computer', response_sla_hours: 4, resolution_sla_hours: 24, sla_hours: 24 }],
          priorities: ['ปานกลาง'],
          privacy: { version: 'test', summary: 'privacy', dpoContact: 'IT' },
        });
      }
      if (path === '/api/v1/public/tickets') {
        return Promise.resolve({ id: 'ticket-upload-1', ticketNo: 'TCK-2026-0100', trackingToken: 'ABCD-EFGH-JKLM' });
      }
      if (path === '/api/v1/public/tickets/ticket-upload-1/attachments') {
        return Promise.resolve({ id: 'attachment-1' });
      }
      return Promise.reject(new Error(`Unexpected public API path: ${path}`));
    });

    render(<MemoryRouter><PublicTicketPortalPage /></MemoryRouter>);
    expect(await screen.findByText('ข้อมูลผู้แจ้งและติดต่อกลับ')).toBeVisible();
    expect(screen.getAllByRole('link', { name: 'LINE Login' })).toHaveLength(1);

    fireEvent.change(screen.getByLabelText(/ชื่อ–นามสกุล/), { target: { value: 'สมชาย ใจดี' } });
    fireEvent.change(screen.getByLabelText(/เบอร์โทร/), { target: { value: '0812345678' } });
    fireEvent.change(screen.getByLabelText(/ประเภทงานที่ขอรับบริการ/), { target: { value: '11111111-1111-4111-8111-111111111111' } });
    fireEvent.change(screen.getByLabelText(/สรุปปัญหาสั้น/), { target: { value: 'เปิดเครื่องไม่ติด' } });
    fireEvent.change(screen.getByLabelText(/รายละเอียดเพิ่มเติม/), { target: { value: 'กดปุ่มแล้วเครื่องไม่มีไฟ' } });
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'problem.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('เลือกไฟล์'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'ส่งแจ้งซ่อม' }));

    expect(await screen.findByText('แนบไฟล์สำเร็จ 1 ไฟล์')).toBeVisible();
    await waitFor(() => expect(publicTicketApiFetchMock).toHaveBeenCalledTimes(3));
    const [, uploadInit] = publicTicketApiFetchMock.mock.calls.find(([path]) => path.endsWith('/attachments')) as [string, RequestInit];
    expect(uploadInit.headers).toEqual({ 'x-tracking-token': 'ABCD-EFGH-JKLM' });
    expect(uploadInit.body).toBeInstanceOf(FormData);
    expect((uploadInit.body as FormData).get('file')).toBe(file);
    expect(screen.queryByText('ลายเซ็นผู้แจ้ง')).not.toBeInTheDocument();
  });
});
