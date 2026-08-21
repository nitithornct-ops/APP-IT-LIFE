import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AuditTable } from './AuditLogsPage';
import type { AuditLogItem } from '../../types/admin';

afterEach(cleanup);

function log(overrides: Partial<AuditLogItem> = {}): AuditLogItem {
  return {
    id: 'log-1',
    actor_id: 'u-1',
    actor_email: 'admin@example.com',
    actor_role: null,
    action: 'UPDATE',
    module: 'ticket',
    target_table: 'tickets',
    target_id: 'tck-1',
    result: 'success',
    request_id: 'req-1',
    created_at: '2026-08-21T03:00:00.000Z',
    detail: {
      changes: { status: { from: 'กำลังดำเนินการ', to: 'เสร็จสิ้น' } },
      changedFields: ['status'],
    },
    ...overrides,
  } as AuditLogItem;
}

describe('AuditTable', () => {
  it('สรุปสิ่งที่เปลี่ยนในตาราง แทนที่จะทิ้ง JSON ดิบไว้ให้อ่านเอง', () => {
    render(<AuditTable items={[log()]} />);

    expect(screen.getByText('แก้ไข 1 ฟิลด์: สถานะ')).toBeTruthy();
    expect(screen.queryByText(/"changes"/)).toBeNull();
  });

  it('กางดูแล้วเห็นทั้งค่าเดิมและค่าใหม่ ซึ่งเป็นคำถามหลักของผู้ตรวจสอบ', () => {
    render(<AuditTable items={[log()]} />);

    fireEvent.click(screen.getByRole('button', { name: 'ดูรายละเอียด UPDATE ticket' }));

    // ค้นภายในหน้าต่างเท่านั้น เพราะ Target ID ปรากฏในแถวของตารางด้วย
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('กำลังดำเนินการ')).toBeTruthy();
    expect(dialog.getByText('เสร็จสิ้น')).toBeTruthy();
    expect(dialog.getByText('tck-1')).toBeTruthy();
  });

  it('ไม่ขึ้นปุ่มกางดูเมื่อรายการนั้นไม่มีรายละเอียด', () => {
    render(<AuditTable items={[log({ detail: null })]} />);

    expect(screen.queryByRole('button', { name: /ดูรายละเอียด/ })).toBeNull();
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('แสดงบริบทของรายการที่ไม่ใช่การแก้ไข เช่น การส่งออกข้อมูล', () => {
    render(<AuditTable items={[log({ action: 'EXPORT', detail: { rowCount: 240 } })]} />);

    expect(screen.getByText('rowCount: 240')).toBeTruthy();
  });
});
