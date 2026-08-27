import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TicketFormPage } from './TicketFormPage';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('../../services/apiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/apiClient')>();
  return { ...original, apiFetch: apiFetchMock };
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/tickets/ticket-1/form']}><Routes><Route path="/tickets/:id/form" element={<TicketFormPage />} /></Routes></MemoryRouter></QueryClientProvider>);
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); apiFetchMock.mockReset(); });

describe('TicketFormPage', () => {
  it('renders the Form Studio template and its five-section flow for the Ticket', async () => {
    apiFetchMock.mockResolvedValue({
      ticketId: 'ticket-1', ticketNo: 'TCK-001', ticketStatus: 'ส่งต่อ Outsource',
      template: { id: 'template-1', code: 'IT-ERP-ISSUE', name: 'แบบฟอร์มการแจ้งปัญหา IT Support และระบบ ERP', version: 2, source: 'issue', updatedAt: '2026-08-19T02:00:00.000Z' },
      issueForm: { id: 'form-1', formNo: 'FRM-001', status: 'Sent to Vendor' },
      pageSettings: { size: 'A4', orientation: 'portrait', marginMm: 20 },
      contentHtml: '<h1>แบบฟอร์มการแจ้งปัญหา IT Support และระบบ ERP</h1><h2>ส่วนที่ 1: ข้อมูลผู้แจ้ง</h2><p>TCK-001 · สมชาย ใจดี</p><p>☐ คอมพิวเตอร์ ☐ เครื่องพิมพ์</p><p>หมายเหตุ —</p><h2>ส่วนที่ 2: การประเมินโดย IT</h2><p>เจ้าหน้าที่ IT</p><h2>ส่วนที่ 3: การแก้ไขโดย Vendor</h2><p>รอตอบกลับ</p><h2>ส่วนที่ 4: Manday / Credit</h2><h2>ส่วนที่ 5: ปิดงาน</h2><img src="https://signed.test/ticket-1.png" alt="ลายเซ็นรับรอง Ticket">',
      checkmarks: [1],
      textValues: {},
      canEditCheckmarks: true,
      flow: [
        { section: 1, title: 'ข้อมูลผู้แจ้ง', state: 'complete', detail: 'ข้อมูลจาก Ticket' },
        { section: 2, title: 'IT ประเมินและดำเนินการ', state: 'complete', detail: 'ส่งต่อ Vendor/Outsource แล้ว' },
        { section: 3, title: 'Vendor แก้ไข', state: 'current', detail: 'รอ Vendor ตอบกลับ' },
        { section: 4, title: 'Manday / Credit', state: 'current', detail: 'บันทึกพร้อมผลตอบกลับ Vendor' },
        { section: 5, title: 'ตรวจรับและปิดงาน', state: 'pending', detail: 'ดำเนินการหลังแก้ไขเสร็จ' },
      ],
    });
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    renderPage();
    const form = await screen.findByTestId('ticket-form-page');
    expect(form).toHaveTextContent('TCK-001');
    expect(form).toHaveTextContent('สมชาย ใจดี');
    expect(screen.getByText(/IT-ERP-ISSUE/)).toHaveTextContent('แบบฟอร์มการแจ้งปัญหา IT Support และระบบ ERP');
    expect(screen.getAllByText('รอ Vendor ตอบกลับ')).toHaveLength(1);
    expect(screen.getByText('ส่วนที่ 5: ปิดงาน')).toBeInTheDocument();
    expect(screen.getByAltText('ลายเซ็นรับรอง Ticket')).toHaveAttribute('src', 'https://signed.test/ticket-1.png');
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).toHaveAttribute('aria-checked', 'false');
    expect(checkboxes[1]).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(checkboxes[0]!);
    expect(screen.getAllByRole('checkbox')[0]).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/tickets/ticket-1/form-checkmarks', {
      method: 'PATCH',
      body: JSON.stringify({ templateId: 'template-1', templateVersion: 2, indices: [0, 1], textValues: {} }),
    }));
    const textField = screen.getByRole('textbox', { name: 'กรอกข้อความช่องที่ 1' });
    textField.textContent = 'ข้อความเพิ่มเติม';
    fireEvent.blur(textField);
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/tickets/ticket-1/form-checkmarks', {
      method: 'PATCH',
      body: JSON.stringify({ templateId: 'template-1', templateVersion: 2, indices: [0, 1], textValues: { 0: 'ข้อความเพิ่มเติม' } }),
    }));
    fireEvent.click(screen.getByRole('button', { name: 'พิมพ์ / บันทึก PDF' }));
    await waitFor(() => expect(print).toHaveBeenCalledOnce());
  });
});
