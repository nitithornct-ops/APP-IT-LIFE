import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequesterSignoffCard } from './RequesterSignoffCard';

afterEach(cleanup);

describe('RequesterSignoffCard', () => {
  const criteria = [{ id: 'criterion-1', key: 'workQuality', label: 'คุณภาพงานซ่อม', description: null, sort_order: 1, status: 'active' as const }];

  it('appears only after the repair is resolved and submits the requester signature', async () => {
    const onSign = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<RequesterSignoffCard status="กำลังดำเนินการ" criteria={criteria} onSign={onSign} />);
    expect(screen.queryByTestId('requester-signoff-card')).not.toBeInTheDocument();

    rerender(<RequesterSignoffCard status="เสร็จสิ้น" requesterName="สมชาย ใจดี" criteria={criteria} onSign={onSign} />);
    const signature = new File(['png'], 'requester.png', { type: 'image/png' });
    fireEvent.click(screen.getByRole('radio', { name: 'คุณภาพงานซ่อม 5 คะแนน ยอดเยี่ยม' }));
    fireEvent.change(screen.getByLabelText('ไฟล์ลายเซ็นผู้แจ้ง PNG'), { target: { files: [signature] } });
    fireEvent.click(screen.getByText(/ข้าพเจ้าได้ตรวจสอบแล้ว/));
    fireEvent.click(screen.getByRole('button', { name: 'ส่งแบบประเมิน ลงลายเซ็น และปิดงาน' }));

    await waitFor(() => expect(onSign).toHaveBeenCalledWith(signature, { workQuality: 5 }, undefined));
    expect(screen.getByText('สมชาย ใจดี')).toBeVisible();
  });

  it('shows the signed evidence in ticket history', () => {
    render(<RequesterSignoffCard status="ปิดงาน" signatureUrl="https://signed.test/requester.png" signedAt="2026-08-26T02:30:00.000Z" requesterName="สมชาย ใจดี" criteria={criteria} rating={5} onSign={vi.fn()} />);
    expect(screen.getByTestId('requester-signoff-history')).toBeVisible();
    expect(screen.getByAltText('ลายเซ็นผู้แจ้งตรวจรับงาน')).toHaveAttribute('src', 'https://signed.test/requester.png');
    expect(screen.getByText('ผลประเมินรวม 5/5 คะแนน')).toBeVisible();
  });
});
