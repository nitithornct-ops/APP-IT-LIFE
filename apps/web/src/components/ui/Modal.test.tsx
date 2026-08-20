import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormModal, Modal } from './Modal';

afterEach(cleanup);

describe('Modal', () => {
  it('renders an accessible popup without using a full-screen content panel', () => {
    render(
      <Modal title="ดำเนินการทรัพย์สิน" onClose={() => undefined} testId="asset-action-dialog">
        <p>เนื้อหาแบบฟอร์ม</p>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog', { name: 'ดำเนินการทรัพย์สิน' });
    expect(dialog).toBeVisible();
    expect(dialog).toHaveClass('max-w-2xl');
    expect(dialog).not.toHaveClass('inset-0');
    expect(document.body).toHaveStyle({ overflow: 'hidden' });
  });

  it('adds a consistent content gutter to form modals while base modals remain edge-to-edge', () => {
    const { rerender } = render(
      <Modal title="Base" onClose={() => undefined}>
        <p>Base content</p>
      </Modal>,
    );

    expect(screen.getByRole('dialog', { name: 'Base' }).querySelector('[data-modal-content]')).not.toHaveClass('px-5');

    rerender(
      <FormModal title="Form" onClose={() => undefined}>
        <label>Name<input /></label>
      </FormModal>,
    );

    const content = screen.getByRole('dialog', { name: 'Form' }).querySelector('[data-modal-content]');
    expect(content).toHaveClass('px-5', 'py-5', 'sm:px-6', 'sm:py-6');
  });

  it('allows full-bleed form content when a module explicitly requests it', () => {
    render(
      <FormModal title="Full bleed" contentPadding="none" onClose={() => undefined}>
        <div>Table content</div>
      </FormModal>,
    );

    expect(screen.getByRole('dialog', { name: 'Full bleed' }).querySelector('[data-modal-content]')).not.toHaveClass('px-5');
  });

  it('closes from Escape and the close button', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal title="เพิ่มทรัพย์สิน" onClose={onClose}>
        <p>แบบฟอร์ม</p>
      </Modal>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <Modal title="เพิ่มทรัพย์สิน" onClose={onClose}>
        <p>แบบฟอร์ม</p>
      </Modal>,
    );
    fireEvent.click(within(screen.getByRole('dialog', { name: 'เพิ่มทรัพย์สิน' })).getByRole('button', { name: 'ปิดหน้าต่าง' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('keeps the popup open while an action is being submitted', () => {
    const onClose = vi.fn();
    render(
      <Modal title="ส่งทรัพย์สินซ่อม" closeDisabled onClose={onClose}>
        <p>แบบฟอร์ม</p>
      </Modal>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(within(screen.getByRole('dialog', { name: 'ส่งทรัพย์สินซ่อม' })).getByRole('button', { name: 'ปิดหน้าต่าง' })).toBeDisabled();
  });

  it('only closes the topmost popup when modals are nested', () => {
    const closeParent = vi.fn();
    const closeChild = vi.fn();
    render(
      <Modal title="Parent" onClose={closeParent}>
        <Modal title="Child" onClose={closeChild}><p>Nested content</p></Modal>
      </Modal>,
    );

    const parentLayer = screen.getByRole('dialog', { name: 'Parent' }).parentElement;
    const childLayer = screen.getByRole('dialog', { name: 'Child' }).parentElement;
    expect(Number(childLayer?.style.zIndex)).toBeGreaterThan(Number(parentLayer?.style.zIndex));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeChild).toHaveBeenCalledTimes(1);
    expect(closeParent).not.toHaveBeenCalled();
  });

  it('does not close the parent when the child unmounts during the Escape event', () => {
    const closeParent = vi.fn();

    function NestedModals() {
      const [showChild, setShowChild] = useState(true);
      return (
        <Modal title="Parent" onClose={closeParent}>
          {showChild && <Modal title="Child" onClose={() => setShowChild(false)}><p>Nested content</p></Modal>}
        </Modal>
      );
    }

    render(<NestedModals />);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Child' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Parent' })).toBeVisible();
    expect(closeParent).not.toHaveBeenCalled();
  });

  it('asks before discarding changed form data', () => {
    const onClose = vi.fn();
    render(
      <FormModal title="แก้ไขข้อมูล" onClose={onClose}>
        <label>ชื่อ<input defaultValue="เดิม" /></label>
      </FormModal>,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'ชื่อ' }), { target: { value: 'ข้อมูลใหม่' } });
    fireEvent.click(screen.getByRole('button', { name: 'ปิดหน้าต่าง' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'ออกโดยไม่บันทึก?' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'ออกโดยไม่บันทึก' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * z-index ของ modal เคยคิดจากตัวนับที่โตขึ้นเรื่อย ๆ ตลอด session (50 + ลำดับที่เปิดมาแล้วทั้งหมด)
   * เปิด/ปิดเกิน ~21 ครั้งแล้ว modal จะแซงชั้นของ Toast (z-index 70) ทำให้ข้อความแจ้งเตือน
   * "บันทึกสำเร็จ/ไม่สำเร็จ" ถูกบังหายไปทั้งที่ระบบส่งออกมาแล้ว
   * (พบตอน Pre-production QA audit 2026-08-13)
   */
  describe('stacking order', () => {
    const backdropOf = (title: string) =>
      screen.getByRole('dialog', { name: title }).closest('.global-modal-backdrop') as HTMLElement;

    it('gives a lone modal the same layer every time, however many were opened before', () => {
      const layers = new Set<string>();
      for (let round = 0; round < 25; round += 1) {
        const view = render(<Modal title={`รอบ ${round}`} onClose={() => {}}>เนื้อหา</Modal>);
        layers.add(backdropOf(`รอบ ${round}`).style.zIndex);
        view.unmount();
      }
      // เดิมค่านี้ไต่ขึ้นทุกครั้งที่เปิด (51, 52, 53, ...) จนแซงชั้นของ Toast
      expect(layers.size).toBe(1);
    });

    it('stays below the toast layer even after many open/close cycles', () => {
      const TOAST_Z = 200;
      for (let round = 0; round < 30; round += 1) {
        const view = render(<Modal title={`รอบ ${round}`} onClose={() => {}}>เนื้อหา</Modal>);
        expect(Number(backdropOf(`รอบ ${round}`).style.zIndex)).toBeLessThan(TOAST_Z);
        view.unmount();
      }
    });

    it('raises a nested modal above the one that opened it', () => {
      render(
        <Modal title="ชั้นล่าง" onClose={() => {}}>
          <Modal title="ชั้นบน" onClose={() => {}}>เนื้อหา</Modal>
        </Modal>,
      );
      expect(Number(backdropOf('ชั้นบน').style.zIndex)).toBeGreaterThan(Number(backdropOf('ชั้นล่าง').style.zIndex));
    });
  });
});
