import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldCloseTicket } from '../../types/fieldWork';
import { FieldCloseTicketPage } from './FieldCloseTicketPage';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), navigate: vi.fn(), permissions: ['inventory.manage'] }));

vi.mock('../../services/apiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/apiClient')>();
  return { ...original, apiFetch: mocks.apiFetch };
});
vi.mock('../../stores/authContext', () => ({
  useAuth: () => ({ hasPermission: (permission: string) => mocks.permissions.includes(permission) }),
}));
vi.mock('react-router-dom', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-router-dom')>();
  return { ...original, useNavigate: () => mocks.navigate, useParams: () => ({ id: 'ticket-1' }) };
});

const TICKET: FieldCloseTicket = {
  id: 'ticket-1',
  ticket_no: 'TCK-001',
  title: 'จอไม่แสดงภาพ',
  status: 'กำลังดำเนินการ',
  field_outcomes: [
    { status: 'เสร็จสิ้น', label: 'ซ่อมเสร็จ รอผู้ใช้ยืนยัน', description: 'ส่งให้ผู้แจ้งตรวจรับ', requiresResolution: true, tone: 'success' },
    { status: 'รออะไหล่', label: 'รออะไหล่', description: 'หยุดนับ SLA ไว้ก่อน', requiresResolution: false, tone: 'warning' },
  ],
};

beforeEach(() => {
  mocks.permissions = ['inventory.manage'];
  mocks.apiFetch.mockImplementation((path: string) => {
    if (path.startsWith('/api/v1/tickets/ticket-1') && !path.includes('inventory')) return Promise.resolve(TICKET);
    if (path.startsWith('/api/v1/inventory-items?')) {
      return Promise.resolve({ items: [{ id: 'item-1', item_name: 'สาย HDMI', unit: 'เส้น', stock_qty: 5 }], total: 1, page: 1, pageSize: 10 });
    }
    return Promise.resolve({});
  });
});

afterEach(() => {
  cleanup();
  mocks.apiFetch.mockReset();
  mocks.navigate.mockReset();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <FieldCloseTicketPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('FieldCloseTicketPage', () => {
  it('offers only the outcomes the workflow engine allows for the current status', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('radio', { name: /ซ่อมเสร็จ รอผู้ใช้ยืนยัน/ })).toBeInTheDocument());
    expect(screen.getByRole('radio', { name: /รออะไหล่/ })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /ยกระดับ/ })).not.toBeInTheDocument();
  });

  it('refuses to close without the work note the API also requires', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('radio', { name: /ซ่อมเสร็จ รอผู้ใช้ยืนยัน/ })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('radio', { name: /ซ่อมเสร็จ รอผู้ใช้ยืนยัน/ }));
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกและแจ้งผู้ใช้' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('กรุณาบันทึกสิ่งที่ทำไปก่อนปิดงาน'));
    expect(mocks.apiFetch).not.toHaveBeenCalledWith('/api/v1/tickets/ticket-1', expect.objectContaining({ method: 'PATCH' }));
  });

  it('deducts the parts against this ticket before it changes the status', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('radio', { name: /ซ่อมเสร็จ รอผู้ใช้ยืนยัน/ })).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('ค้นหาอะไหล่จากคลัง'), { target: { value: 'สาย' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /สาย HDMI/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /สาย HDMI/ }));

    fireEvent.click(screen.getByRole('radio', { name: /ซ่อมเสร็จ รอผู้ใช้ยืนยัน/ }));
    fireEvent.change(screen.getByLabelText(/สิ่งที่ทำไป/), { target: { value: 'เปลี่ยนสายและทดสอบภาพแล้ว' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกและแจ้งผู้ใช้' }));

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/tickets/ticket-1'));

    const calls = mocks.apiFetch.mock.calls;
    const stockIndex = calls.findIndex((call) => String(call[0]).includes('/inventory-items/item-1/transactions'));
    const patchIndex = calls.findIndex((call) => call[1]?.method === 'PATCH');
    expect(stockIndex).toBeGreaterThanOrEqual(0);
    // ตัดสต็อกต้องเกิดก่อนเปลี่ยนสถานะเสมอ
    expect(stockIndex).toBeLessThan(patchIndex);

    expect(JSON.parse(String(calls[stockIndex][1].body))).toMatchObject({
      transactionType: 'OUT', qty: 1, ticketId: 'ticket-1',
    });
    expect(JSON.parse(String(calls[patchIndex][1].body))).toMatchObject({
      status: 'เสร็จสิ้น', resolution: 'เปลี่ยนสายและทดสอบภาพแล้ว',
    });
  });

  it('tells the technician which steps already saved when a later step fails', async () => {
    mocks.apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method === 'PATCH') return Promise.reject(new Error('เปลี่ยนสถานะไม่สำเร็จ'));
      if (path.startsWith('/api/v1/tickets/ticket-1')) return Promise.resolve(TICKET);
      if (path.startsWith('/api/v1/inventory-items?')) {
        return Promise.resolve({ items: [{ id: 'item-1', item_name: 'สาย HDMI', unit: 'เส้น', stock_qty: 5 }], total: 1, page: 1, pageSize: 10 });
      }
      return Promise.resolve({});
    });
    renderPage();
    await waitFor(() => expect(screen.getByRole('radio', { name: /รออะไหล่/ })).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('ค้นหาอะไหล่จากคลัง'), { target: { value: 'สาย' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /สาย HDMI/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /สาย HDMI/ }));
    fireEvent.click(screen.getByRole('radio', { name: /รออะไหล่/ }));
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกและแจ้งผู้ใช้' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('เปลี่ยนสถานะไม่สำเร็จ'));
    expect(screen.getByRole('alert')).toHaveTextContent('รายการที่ทำสำเร็จไปแล้วด้านบนถูกบันทึกไว้แล้ว');
    expect(screen.getByText(/ตัดสต็อก สาย HDMI 1 เส้น/)).toBeInTheDocument();
  });

  it('says parts cannot be deducted without the inventory permission', async () => {
    mocks.permissions = [];
    renderPage();
    await waitFor(() => expect(screen.getByText(/inventory.manage/)).toBeInTheDocument());
    expect(screen.queryByLabelText('ค้นหาอะไหล่จากคลัง')).not.toBeInTheDocument();
  });

  it('explains that a finished ticket has no field action left', async () => {
    mocks.apiFetch.mockResolvedValue({ ...TICKET, status: 'ปิดงาน', field_outcomes: [] });
    renderPage();
    await waitFor(() => expect(screen.getByText(/บันทึกผลหน้างานต่อไม่ได้แล้ว/)).toBeInTheDocument());
  });
});
