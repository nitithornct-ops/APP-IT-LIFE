import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  getLineSessionTokenMock.mockReturnValue('active-line-session');
  publicTicketApiFetchMock.mockResolvedValue({
    enabled: true,
    categories: [],
    priorities: [],
    privacy: { version: 'test', summary: '', dpoContact: '' },
  });
  lineApiFetchMock.mockImplementation((path: string) => {
    if (path === '/api/v1/line/bootstrap') {
      return Promise.resolve({ authenticated: true, profile: { fullName: 'สมชาย ใจดี', linkStatus: 'Active' } });
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
  vi.clearAllMocks();
});

describe('PublicTicketPortalPage LINE status list', () => {
  it('shows the logged-in LINE user tickets as a table', async () => {
    render(<MemoryRouter><PublicTicketPortalPage /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: 'ติดตามสถานะ' }));

    expect(await screen.findByRole('table')).toBeVisible();
    expect(screen.getByText('รายการแจ้งซ่อมของฉัน')).toBeVisible();
    expect(screen.getByText('TCK-2026-0001')).toBeVisible();
    expect(screen.getByText('เครื่องพิมพ์ใช้งานไม่ได้')).toBeVisible();
    expect(screen.getByText('อุปกรณ์สำนักงาน')).toBeVisible();
    expect(screen.getByText('กำลังดำเนินการ')).toBeVisible();
    expect(lineApiFetchMock).toHaveBeenCalledWith('/api/v1/line/tickets');
  });
});

describe('PublicTicketPortalPage guest status search', () => {
  it('requires the Ticket number and tracking token instead of name and phone', async () => {
    getLineSessionTokenMock.mockReturnValue(null);
    publicTicketApiFetchMock.mockImplementation((path: string) => {
      if (path === '/api/v1/public/tickets/form-data') {
        return Promise.resolve({ enabled: true, categories: [], priorities: [], privacy: { version: 'test', summary: '', dpoContact: '' } });
      }
      if (path === '/api/v1/public/tickets/TCK-2026-0099?token=ABCD-EFGH-JKLM') {
        return Promise.resolve({
          ticket: {
            id: 'guest-ticket-1', ticket_no: 'TCK-2026-0099', title: 'คอมพิวเตอร์เปิดไม่ติด', description: 'ไม่มีไฟเข้า',
            status: 'เสร็จสิ้น', priority: 'ปานกลาง', resolution: null, created_at: '2026-08-19T03:00:00.000Z',
            resolved_at: '2026-08-19T06:00:00.000Z', closed_at: null, category: { name: 'คอมพิวเตอร์' },
          },
          worklogs: [], attachments: [],
        });
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
    expect(screen.getByText(/สถานะ: ซ่อมเสร็จ \(รอยืนยัน\)/)).toBeVisible();
    expect(publicTicketApiFetchMock).toHaveBeenCalledWith('/api/v1/public/tickets/TCK-2026-0099?token=ABCD-EFGH-JKLM');
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

    fireEvent.change(screen.getByLabelText(/ชื่อผู้แจ้ง/), { target: { value: 'สมชาย ใจดี' } });
    fireEvent.change(screen.getByLabelText(/เบอร์โทร/), { target: { value: '0812345678' } });
    fireEvent.change(screen.getByLabelText(/ประเภทปัญหา/), { target: { value: '11111111-1111-4111-8111-111111111111' } });
    fireEvent.change(screen.getByLabelText(/สรุปปัญหาสั้น/), { target: { value: 'เปิดเครื่องไม่ติด' } });
    fireEvent.change(screen.getByLabelText(/รายละเอียดเพิ่มเติม/), { target: { value: 'กดปุ่มแล้วเครื่องไม่มีไฟ' } });
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'problem.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('เลือกไฟล์'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'ส่งแจ้งซ่อม' }));

    expect(await screen.findByText('แนบไฟล์สำเร็จ 1 ไฟล์')).toBeVisible();
    await waitFor(() => expect(publicTicketApiFetchMock).toHaveBeenCalledTimes(3));
    const [, uploadInit] = publicTicketApiFetchMock.mock.calls[2] as [string, RequestInit];
    expect(uploadInit.headers).toEqual({ 'x-tracking-token': 'ABCD-EFGH-JKLM' });
    expect(uploadInit.body).toBeInstanceOf(FormData);
    expect((uploadInit.body as FormData).get('file')).toBe(file);
  });
});
