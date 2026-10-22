import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  it('บันทึกข้อมูลล่าสุดสำเร็จก่อนออกเอกสาร และยังดาวน์โหลดซ้ำได้เมื่อ PDF ล้มเหลว', async () => {
    renderPage('/forms?issue=issue-1');
    const title = await screen.findByLabelText('ชื่อเอกสาร');
    await waitFor(() => expect(screen.getByRole('button', { name: 'บันทึก' })).toBeDisabled());
    const order: string[] = [];
    let finishSave!: () => void;
    apiFetchMock.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/v1/forms/issues/issue-1' && options?.method === 'PATCH') {
        order.push('save');
        expect(JSON.parse(options.body as string).title).toBe('แก้ไขล่าสุด');
        return new Promise((resolve) => { finishSave = () => resolve({ ...issue, title: 'แก้ไขล่าสุด' }); });
      }
      if (url.endsWith('/issue')) { order.push('issue'); return Promise.resolve({ issued_at: '2026-10-22T03:00:00Z' }); }
      if (url.endsWith('/exports/pdf')) { order.push('pdf'); return Promise.reject(new Error('PDF unavailable')); }
      if (url === '/api/v1/forms/issues') return Promise.resolve([issue]);
      return Promise.resolve([]);
    });
    fireEvent.change(title, { target: { value: 'แก้ไขล่าสุด' } });
    fireEvent.click(screen.getByRole('button', { name: 'ออกเอกสารและ Export PDF' }));
    await waitFor(() => expect(order).toEqual(['save']));
    expect(title).toBeDisabled();
    finishSave();
    await waitFor(() => expect(order).toEqual(['save', 'issue', 'pdf']));
    expect(await screen.findByText('PDF unavailable')).toBeVisible();
    expect(screen.getByText('ออกเอกสารแล้ว')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Export PDF' })).toBeEnabled();
  });

  it('ไม่ออกเอกสารหากบันทึกไม่สำเร็จ', async () => {
    renderPage('/forms?issue=issue-1');
    const title = await screen.findByLabelText('ชื่อเอกสาร');
    await waitFor(() => expect(screen.getByRole('button', { name: 'บันทึก' })).toBeDisabled());
    apiFetchMock.mockImplementation((url: string, options?: RequestInit) => {
      if (options?.method === 'PATCH') return Promise.reject(new Error('Save failed'));
      return Promise.resolve(url === '/api/v1/forms/issues' ? [issue] : []);
    });
    fireEvent.change(title, { target: { value: 'ข้อมูลที่ยังไม่บันทึก' } });
    fireEvent.click(screen.getByRole('button', { name: 'ออกเอกสารและ Export PDF' }));
    expect(await screen.findByText('Save failed')).toBeVisible();
    expect(apiFetchMock.mock.calls.some(([url]) => url.endsWith('/issue'))).toBe(false);
    expect(screen.getByText('ยังไม่บันทึก')).toBeVisible();
  });
  it('เริ่มที่แม่แบบหลักของ Ticket พร้อมปุ่ม Word และไม่มีคำสั่งลบแม่แบบหลัก', async () => {
    renderPage();
    expect(await screen.findByText('แบบฟอร์มหลัก · งานแจ้งซ่อม / Ticket ทั้งหมด')).toBeVisible();
    expect(screen.getByRole('button', { name: 'ดาวน์โหลดแม่แบบ Word' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /ลบ/ })).not.toBeInTheDocument();
  });

  it('ให้เลือกโมดูลตอนสร้างแบบฟอร์มหลักเพื่อใช้ร่วมกันทั้งโมดูล', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'สร้างแบบฟอร์มหลัก' }));

    expect(screen.getByLabelText('ใช้เป็นแบบฟอร์มของโมดูล')).toBeVisible();
    expect(within(screen.getByRole('dialog')).getByRole('option', { name: 'Ticket / งานแจ้งซ่อม' })).toBeVisible();
    expect(within(screen.getByRole('dialog')).getByRole('option', { name: 'ยืม / คืน Asset' })).toBeVisible();
  });
  /**
   * เดิมเลข Ticket ในตารางเป็นข้อความเฉย ๆ ผู้ใช้ต้องคัดลอกไปค้นเองทุกครั้งที่อยากดูงานต้นเรื่อง
   */
  it('ลิงก์ทุกรายการไปที่ Ticket และแบบฟอร์มที่พิมพ์ได้ของ Ticket ใบนั้น', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'แบบฟอร์มงาน' }));

    const ticketLink = await screen.findByRole('link', { name: /TCK-009/ });
    expect(ticketLink).toHaveAttribute('href', '/tickets/ticket-9');
    expect(screen.getByRole('link', { name: 'แบบฟอร์ม' })).toHaveAttribute('href', '/tickets/ticket-9/form');
  });

  it('เปิดแม่แบบของรายการนั้นได้จากชื่อ Template ในตาราง', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'แบบฟอร์มงาน' }));

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
