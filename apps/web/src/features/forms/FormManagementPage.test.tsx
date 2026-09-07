import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormManagementPage } from './FormManagementPage';
import type { FormTemplate, IssueForm } from '../../types/forms';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('../../services/apiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/apiClient')>();
  return { ...original, apiFetch: apiFetchMock };
});
vi.mock('../../stores/authContext', () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));

const template = {
  id: 'template-1', template_code: 'IT-ERP-ISSUE', name: 'แบบฟอร์มการแจ้งปัญหา IT Support', description: 'ใช้กับงานแจ้งซ่อม',
  category: 'IT Support', status: 'Published', current_version: 2, content_html: '<h1>แม่แบบหลัก</h1>',
  page_settings: { size: 'A4' }, published_at: null, created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-19T02:00:00.000Z',
} as FormTemplate;

const issue = {
  id: 'issue-1', form_no: 'FRM-001', title: 'ERP ปิดงบไม่ได้', status: 'Sent to Vendor',
  template_id: 'template-1', template_version: 2, ticket_id: 'ticket-9', vendor_id: null,
  content_html: '<p>งาน</p>', form_data: {}, vendor_response: {}, vendor_due_at: null, vendor_sent_at: null,
  vendor_responded_at: null, closed_at: null, created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-20T02:00:00.000Z',
  template: { id: 'template-1', template_code: 'IT-ERP-ISSUE', name: 'แบบฟอร์มการแจ้งปัญหา IT Support' },
  ticket: { id: 'ticket-9', ticket_no: 'TCK-009', title: 'ปิดงบประจำเดือนไม่ได้' },
} as IssueForm;

function renderPage(initialPath = '/forms') {
  apiFetchMock.mockImplementation((url: string) => {
    if (url.startsWith('/api/v1/forms/templates')) return Promise.resolve([template]);
    if (url.startsWith('/api/v1/forms/issues')) return Promise.resolve([issue]);
    if (url.startsWith('/api/v1/forms/references')) return Promise.resolve({ vendors: [], tickets: [] });
    return Promise.resolve({ logoUrl: '' });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}><FormManagementPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => { cleanup(); apiFetchMock.mockReset(); });

describe('Form Studio เป็นแบบฟอร์มหลักที่ผูกกับ Ticket', () => {
  /**
   * เดิมเลข Ticket ในตารางเป็นข้อความเฉย ๆ ผู้ใช้ต้องคัดลอกไปค้นเองทุกครั้งที่อยากดูงานต้นเรื่อง
   */
  it('ลิงก์ทุกรายการไปที่ Ticket และแบบฟอร์มที่พิมพ์ได้ของ Ticket ใบนั้น', async () => {
    renderPage();

    const ticketLink = await screen.findByRole('link', { name: /TCK-009/ });
    expect(ticketLink).toHaveAttribute('href', '/tickets/ticket-9');
    expect(screen.getByRole('link', { name: 'แบบฟอร์ม' })).toHaveAttribute('href', '/tickets/ticket-9/form');
  });

  it('เปิดแม่แบบของรายการนั้นได้จากชื่อ Template ในตาราง', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'แบบฟอร์มการแจ้งปัญหา IT Support' }));

    expect(await screen.findByTestId('form-studio-editor')).toBeVisible();
    expect(screen.getByText('IT-ERP-ISSUE · v2')).toBeVisible();
  });

  /** ลิงก์ที่ยิงมาจากหน้าแบบฟอร์มของ Ticket ต้องเปิดแม่แบบใบนั้นให้เลย ไม่ใช่แค่พามาถึงหน้ารายการ */
  it('เปิดแม่แบบที่ระบุมาในลิงก์จากหน้าแบบฟอร์มของ Ticket', async () => {
    renderPage('/forms?template=template-1');

    expect(await screen.findByTestId('form-studio-editor')).toBeVisible();
    expect(screen.getByText('IT-ERP-ISSUE · v2')).toBeVisible();
  });

  it('เปิดแบบฟอร์มงานที่ระบุมาในลิงก์ได้เช่นกัน', async () => {
    renderPage('/forms?issue=issue-1');

    expect(await screen.findByTestId('form-studio-editor')).toBeVisible();
    expect(screen.getByText(/FRM-001 · Template v2/)).toBeVisible();
  });
});
