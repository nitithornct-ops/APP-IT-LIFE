import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequesterSignoffCard } from './RequesterSignoffCard';

afterEach(cleanup);

describe('RequesterSignoffCard', () => {
  it('appears only after the repair is resolved and submits the requester signature', async () => {
    const onSign = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<RequesterSignoffCard status="กำลังดำเนินการ" onSign={onSign} />);
    expect(screen.queryByTestId('requester-signoff-card')).not.toBeInTheDocument();

    rerender(<RequesterSignoffCard status="เสร็จสิ้น" onSign={onSign} />);
    const signature = new File(['png'], 'requester.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('ไฟล์ลายเซ็นผู้แจ้ง PNG'), { target: { files: [signature] } });
    fireEvent.click(screen.getByText(/ข้าพเจ้าได้ตรวจสอบแล้ว/));
    fireEvent.click(screen.getByRole('button', { name: 'ลงลายเซ็นและยืนยันปิดงาน' }));

    await waitFor(() => expect(onSign).toHaveBeenCalledWith(signature));
  });

  it('shows the signed evidence in ticket history', () => {
    render(<RequesterSignoffCard status="ปิดงาน" signatureUrl="https://signed.test/requester.png" signedAt="2026-08-26T02:30:00.000Z" onSign={vi.fn()} />);
    expect(screen.getByTestId('requester-signoff-history')).toBeVisible();
    expect(screen.getByAltText('ลายเซ็นผู้แจ้งตรวจรับงาน')).toHaveAttribute('src', 'https://signed.test/requester.png');
  });
});
