import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RowActions } from './RowActions';

const permissions = new Set<string>();

vi.mock('../../stores/authContext', () => ({
  useAuth: () => ({ hasPermission: (key: string) => permissions.has(key), isMeLoading: false }),
}));

function renderActions(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

afterEach(() => {
  cleanup();
  permissions.clear();
  vi.restoreAllMocks();
});

describe('RowActions', () => {
  it('names every button after the row it belongs to, so a screen reader user knows which record they are on', () => {
    renderActions(
      <RowActions
        recordLabel="TCK-20260818-0001"
        actions={[{ kind: 'view', to: '/tickets/1' }, { kind: 'edit', onClick: () => undefined }]}
      />,
    );

    expect(screen.getByRole('link', { name: 'ดู TCK-20260818-0001' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'แก้ไข TCK-20260818-0001' })).toBeVisible();
  });

  it('hides an action the signed-in user has no permission for', () => {
    renderActions(
      <RowActions
        recordLabel="AST-001"
        actions={[{ kind: 'view', to: '/assets/1' }, { kind: 'edit', onClick: () => undefined, permission: 'asset.update' }]}
      />,
    );

    expect(screen.getByRole('link', { name: 'ดู AST-001' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'แก้ไข AST-001' })).not.toBeInTheDocument();
  });

  it('shows the action once the permission is granted', () => {
    permissions.add('asset.update');
    renderActions(<RowActions recordLabel="AST-001" actions={[{ kind: 'edit', onClick: () => undefined, permission: 'asset.update' }]} />);

    expect(screen.getByRole('button', { name: 'แก้ไข AST-001' })).toBeVisible();
  });

  /** จุดสำคัญของทั้งคอมโพเนนต์ — ปุ่มที่ทำลายข้อมูลต้องผ่านกล่องยืนยันเสมอ ไม่มีทางลัด */
  it('never destroys anything on the first click — delete waits for the confirmation box', () => {
    const onConfirm = vi.fn();
    renderActions(<RowActions recordLabel="หมวดหมู่ทดสอบ" actions={[{ kind: 'delete', onConfirm }]} />);

    fireEvent.click(screen.getByRole('button', { name: 'ลบ หมวดหมู่ทดสอบ' }));
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'ลบข้อมูล' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('leaves the record untouched when the confirmation is dismissed', () => {
    const onConfirm = vi.fn();
    renderActions(<RowActions recordLabel="หมวดหมู่ทดสอบ" actions={[{ kind: 'delete', onConfirm }]} />);

    fireEvent.click(screen.getByRole('button', { name: 'ลบ หมวดหมู่ทดสอบ' }));
    fireEvent.click(screen.getByRole('button', { name: 'ไม่ใช่ตอนนี้' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  /**
   * เอกสารงานยกเลิกได้แต่ลบไม่ได้ ข้อความในกล่องยืนยันจึงต้องบอกให้ตรงว่าข้อมูลยังอยู่ ไม่ใช่หายไป
   * ไม่งั้นผู้ใช้จะไม่กล้ายกเลิกงานที่ควรยกเลิก
   */
  it('tells the user a cancelled record is kept, and a deleted one is not', () => {
    const { unmount } = renderActions(<RowActions recordLabel="TCK-1" actions={[{ kind: 'cancel', onConfirm: () => undefined }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิก TCK-1' }));
    expect(screen.getByText(/ยังคงอยู่ในระบบเพื่อการตรวจสอบย้อนหลัง/)).toBeVisible();
    unmount();

    renderActions(<RowActions recordLabel="CAT-1" actions={[{ kind: 'delete', onConfirm: () => undefined }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'ลบ CAT-1' }));
    expect(screen.getByText(/กู้คืนไม่ได้/)).toBeVisible();
  });

  it('drops actions that do not apply to this row instead of showing them greyed out forever', () => {
    renderActions(
      <RowActions
        recordLabel="TCK-2"
        actions={[{ kind: 'view', to: '/tickets/2' }, { kind: 'cancel', onConfirm: () => undefined, hidden: true }]}
      />,
    );

    expect(screen.getByRole('link', { name: 'ดู TCK-2' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'ยกเลิก TCK-2' })).not.toBeInTheDocument();
  });

  it('shows a dash rather than an empty cell when the row has nothing available', () => {
    renderActions(<RowActions recordLabel="TCK-3" actions={[{ kind: 'edit', onClick: () => undefined, hidden: true }]} />);
    expect(screen.getByText('—')).toBeVisible();
  });
});
