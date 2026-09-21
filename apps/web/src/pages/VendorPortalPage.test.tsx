import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VendorPortalPage } from './VendorPortalPage';

const vendorPortalApiFetchMock = vi.fn();
const { signInWithPasswordMock, listFactorsMock } = vi.hoisted(() => ({
  signInWithPasswordMock: vi.fn(),
  listFactorsMock: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: (...args: unknown[]) => signInWithPasswordMock(...args),
      signOut: vi.fn(),
      mfa: {
        listFactors: (...args: unknown[]) => listFactorsMock(...args),
        challengeAndVerify: vi.fn(),
      },
    },
  },
}));

vi.mock('../services/vendorPortalApiClient', async () => {
  const actual = await vi.importActual<typeof import('../services/vendorPortalApiClient')>('../services/vendorPortalApiClient');
  return { ...actual, vendorPortalApiFetch: (...args: unknown[]) => vendorPortalApiFetchMock(...args) };
});

beforeEach(() => {
  sessionStorage.clear();
  vendorPortalApiFetchMock.mockReset();
  signInWithPasswordMock.mockReset();
  listFactorsMock.mockReset();
  window.turnstile = {
    render: vi.fn((_container, options) => {
      options.callback('vendor-captcha-token');
      return 'vendor-test-widget';
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  };
});

afterEach(cleanup);

describe('VendorPortalPage', () => {
  it('requires company code, username and password', () => {
    render(<VendorPortalPage />);
    expect(screen.getByRole('heading', { name: 'Outsource Portal' })).toBeVisible();
    expect(screen.getAllByRole('textbox').some((element) => element.hasAttribute('required'))).toBe(true);
    expect(screen.getAllByDisplayValue('').length).toBeGreaterThan(0);
  });

  it('passes a Turnstile token to Supabase before showing the MFA step', async () => {
    vendorPortalApiFetchMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/login/resolve')) return { email: 'vendor@test.local' };
      return undefined;
    });
    signInWithPasswordMock.mockResolvedValue({ error: null });
    listFactorsMock.mockResolvedValue({ data: { totp: [{ id: 'factor-1', status: 'verified' }] }, error: null });

    render(<VendorPortalPage />);
    fireEvent.change(screen.getByLabelText('รหัสบริษัท'), { target: { value: 'VND-001' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'vendor.contact' } });
    fireEvent.change(screen.getByLabelText('รหัสผ่าน'), { target: { value: 'secret-password' } });
    const submit = screen.getByRole('button', { name: 'เข้าสู่ระบบบริษัท' });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await screen.findByRole('heading', { name: 'ยืนยันตัวตนด้วย MFA' });
    expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: 'vendor@test.local',
      password: 'secret-password',
      options: { captchaToken: 'vendor-captcha-token' },
    });
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
