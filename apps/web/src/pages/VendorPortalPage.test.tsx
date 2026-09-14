import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VendorPortalPage } from './VendorPortalPage';

const vendorPortalApiFetchMock = vi.fn();

vi.mock('../services/vendorPortalApiClient', async () => {
  const actual = await vi.importActual<typeof import('../services/vendorPortalApiClient')>('../services/vendorPortalApiClient');
  return { ...actual, vendorPortalApiFetch: (...args: unknown[]) => vendorPortalApiFetchMock(...args) };
});

beforeEach(() => {
  sessionStorage.clear();
  vendorPortalApiFetchMock.mockReset();
});

afterEach(cleanup);

describe('VendorPortalPage', () => {
  it('requires company code, username and password', () => {
    render(<VendorPortalPage />);
    expect(screen.getByRole('heading', { name: 'Outsource Portal' })).toBeVisible();
    expect(screen.getAllByRole('textbox').some((element) => element.hasAttribute('required'))).toBe(true);
    expect(screen.getAllByDisplayValue('').length).toBeGreaterThan(0);
  });

  it('shows only the assigned outsource list returned by the isolated portal API', async () => {
    vendorPortalApiFetchMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/me')) return { accountId: 'account-1', vendorId: 'vendor-1', vendorCode: 'VND-001', vendorName: 'Test Vendor', username: 'vendor.contact', email: 'vendor@test.local', fullName: 'Vendor User', position: 'Technician', mustChangePassword: false };
      if (path.endsWith('/tickets')) return [{ id: 'ticket-1', ticket_no: 'TCK-001', title: 'Printer issue', description: 'Not printing', priority: 'High', status: 'ส่งต่อ Outsource', location: 'HQ', created_at: '2026-08-28T00:00:00Z', outsource_issue_no: null, outsource_sent_at: '2026-08-28T01:00:00Z', ticket_categories: { name: 'Printer' }, latest_submission: null }];
      if (path.endsWith('/tickets/ticket-1')) return { ticket: { id: 'ticket-1', ticket_no: 'TCK-001', title: 'Printer issue', description: 'Not printing', priority: 'High', status: 'ส่งต่อ Outsource', location: 'HQ', created_at: '2026-08-28T00:00:00Z', outsource_issue_no: null, outsource_sent_at: '2026-08-28T01:00:00Z', ticket_categories: { name: 'Printer' } }, submission: null };
      throw new Error(`Unexpected path ${path}`);
    });
    render(<VendorPortalPage />);
    await screen.findByText('Test Vendor');
    expect(screen.getByText('Printer issue')).toBeVisible();
    fireEvent.click(screen.getByText('Printer issue'));
    await waitFor(() => expect(vendorPortalApiFetchMock).toHaveBeenCalledWith('/api/v1/vendor-portal/tickets/ticket-1'));
  });

  it('does not render the retired temporary-password screen', async () => {
    vendorPortalApiFetchMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/me')) return { accountId: 'account-1', vendorId: 'vendor-1', vendorCode: 'VND-001', vendorName: 'Vendor', username: 'vendor.contact', email: 'vendor@test.local', fullName: 'Vendor User', position: null, mustChangePassword: true };
      if (path.endsWith('/tickets')) return [];
      throw new Error(`Unexpected path ${path}`);
    });
    render(<VendorPortalPage />);
    expect(await screen.findByText('Vendor')).toBeVisible();
    expect(screen.queryByText(/temporary-password/i)).toBeNull();
  });
});
