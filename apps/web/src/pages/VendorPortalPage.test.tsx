import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VendorPortalPage } from './VendorPortalPage';

const vendorPortalApiFetchMock = vi.fn();

vi.mock('../services/vendorPortalApiClient', async () => {
  const actual = await vi.importActual<typeof import('../services/vendorPortalApiClient')>('../services/vendorPortalApiClient');
  return { ...actual, vendorPortalApiFetch: (...args: unknown[]) => vendorPortalApiFetchMock(...args) };
});

beforeEach(() => {
  localStorage.clear();
  vendorPortalApiFetchMock.mockReset();
});

afterEach(cleanup);

describe('VendorPortalPage', () => {
  it('requires company code, contact email and password', () => {
    render(<VendorPortalPage />);
    expect(screen.getByRole('heading', { name: 'Outsource Portal' })).toBeVisible();
    expect(screen.getByLabelText('รหัสบริษัท')).toBeRequired();
    expect(screen.getByLabelText('อีเมลผู้ติดต่อ')).toBeRequired();
    expect(screen.getByLabelText('รหัสผ่าน')).toHaveAttribute('type', 'password');
  });

  it('shows only the assigned outsource list returned by the isolated portal API', async () => {
    localStorage.setItem('vendor_portal_session_token', 'a'.repeat(64));
    vendorPortalApiFetchMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/me')) return { accountId: 'account-1', vendorId: 'vendor-1', vendorCode: 'VND-001', vendorName: 'บริษัท ทดสอบ จำกัด', email: 'vendor@test.local', fullName: 'สมชาย บริษัท', position: 'ช่าง' };
      if (path.endsWith('/tickets')) return [{ id: 'ticket-1', ticket_no: 'TCK-001', title: 'เครื่องพิมพ์เสีย', description: 'พิมพ์ไม่ได้', priority: 'สูง', status: 'ส่งต่อ Outsource', location: 'สำนักงาน', created_at: '2026-08-28T00:00:00Z', outsource_issue_no: null, outsource_sent_at: '2026-08-28T01:00:00Z', ticket_categories: { name: 'Printer' }, latest_submission: null }];
      if (path.endsWith('/tickets/ticket-1')) return { ticket: { id: 'ticket-1', ticket_no: 'TCK-001', title: 'เครื่องพิมพ์เสีย', description: 'พิมพ์ไม่ได้', priority: 'สูง', status: 'ส่งต่อ Outsource', location: 'สำนักงาน', created_at: '2026-08-28T00:00:00Z', outsource_issue_no: null, outsource_sent_at: '2026-08-28T01:00:00Z', ticket_categories: { name: 'Printer' } }, submission: null };
      throw new Error(`Unexpected path ${path}`);
    });
    render(<VendorPortalPage />);
    await screen.findByText('บริษัท ทดสอบ จำกัด');
    expect(screen.getByText('เครื่องพิมพ์เสีย')).toBeVisible();
    expect(screen.getByText('1 งาน')).toBeVisible();
    fireEvent.click(screen.getByText('เครื่องพิมพ์เสีย'));
    await screen.findByText('ส่วนที่ 3: การแก้ไขปัญหาโดยผู้รับจ้าง');
    expect(screen.getByText(/บริษัทแก้ไขได้เฉพาะข้อมูลในส่วนนี้/)).toBeVisible();
    await waitFor(() => expect(vendorPortalApiFetchMock).toHaveBeenCalledWith('/api/v1/vendor-portal/tickets/ticket-1'));
  });
});

