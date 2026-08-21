import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BulkResultSummary } from './BulkAction';

afterEach(cleanup);

describe('BulkResultSummary', () => {
  it('บอกเหตุผลของทุกรายการที่ไม่สำเร็จ ไม่ใช่แค่จำนวน', () => {
    render(
      <BulkResultSummary
        itemLabel="รายการ"
        onDismiss={() => undefined}
        result={{
          succeeded: [{ id: 'a' }],
          failed: [
            { id: 'b', code: 'ASSET_RETIRED', message: 'IT-002: ถูกจำหน่าย/สูญหายแล้ว' },
            { id: 'c', code: 'PERMISSION_DENIED', message: 'IT-003: ไม่มีสิทธิ์' },
          ],
        }}
      />,
    );

    expect(screen.getByText(/สำเร็จ 1 รายการ · ไม่สำเร็จ 2 รายการ/)).toBeTruthy();
    expect(screen.getByText('IT-002: ถูกจำหน่าย/สูญหายแล้ว')).toBeTruthy();
    expect(screen.getByText('IT-003: ไม่มีสิทธิ์')).toBeTruthy();
  });

  it('ไม่ขึ้นส่วนของรายการที่ไม่สำเร็จเมื่อผ่านทั้งหมด', () => {
    render(
      <BulkResultSummary
        itemLabel="ใบงาน"
        onDismiss={() => undefined}
        result={{ succeeded: [{ id: 'a' }, { id: 'b' }], failed: [] }}
      />,
    );

    expect(screen.getByText('สำเร็จ 2 ใบงาน')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('ประกาศผลผ่าน role="status" เพื่อให้ screen reader อ่านโดยไม่ต้องย้าย focus', () => {
    const onDismiss = vi.fn();
    render(<BulkResultSummary itemLabel="รายการ" onDismiss={onDismiss} result={{ succeeded: [], failed: [] }} />);

    expect(screen.getByRole('status')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ปิด' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
