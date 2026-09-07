import { describe, expect, it } from 'vitest';
import { sanitizeFormHtml } from '../../utils/formHtml';
import {
  MAX_OFFSET_PX,
  applyOffset,
  blockFromNode,
  canReorderBlock,
  clearOffset,
  hasOffset,
  moveOffsetBy,
  readOffset,
  reorderBlock,
} from './blockLayout';

function documentWith(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

describe('การย้ายบล็อกในเอกสารแบบฟอร์ม', () => {
  it('เยื้องบล็อกด้วย position:relative เพื่อให้บล็อกยังกินที่เดิมในสายเนื้อหา', () => {
    const root = documentWith('<p>ข้อความ</p>');
    const block = root.firstElementChild as HTMLElement;

    applyOffset(block, { left: 40, top: -18 });

    expect(block.style.position).toBe('relative');
    expect(block.style.left).toBe('40px');
    expect(block.style.top).toBe('-18px');
    expect(readOffset(block)).toEqual({ left: 40, top: -18 });
    expect(hasOffset(block)).toBe(true);
  });

  it('สะสมระยะจากการลากหลายครั้งต่อจากตำแหน่งเดิม ไม่ใช่เริ่มนับใหม่ทุกครั้ง', () => {
    const root = documentWith('<h2>หัวข้อ</h2>');
    const block = root.firstElementChild as HTMLElement;

    moveOffsetBy(block, 30, 10);
    const settled = moveOffsetBy(block, -12, 5);

    expect(settled).toEqual({ left: 18, top: 15 });
  });

  /** ค่าที่เกินช่วงนี้จะถูก sanitizeFormHtml ตัดทิ้งตอนบันทึก ต้องกันไว้ตั้งแต่ตอนลาก */
  it('ตัดระยะที่ไกลเกินไปให้อยู่ในช่วงที่บันทึกได้จริง', () => {
    const root = documentWith('<p>ไกลมาก</p>');
    const block = root.firstElementChild as HTMLElement;

    const settled = applyOffset(block, { left: 999999, top: -999999 });

    expect(settled).toEqual({ left: MAX_OFFSET_PX, top: -MAX_OFFSET_PX });
    expect(sanitizeFormHtml(root.innerHTML)).toContain(`left:${MAX_OFFSET_PX}px`);
  });

  it('ล้างสไตล์ทิ้งเมื่อบล็อกกลับมาอยู่ที่เดิม เพื่อไม่ให้เอกสารบวมด้วยค่าที่ไม่มีผล', () => {
    const root = documentWith('<p>ข้อความ</p>');
    const block = root.firstElementChild as HTMLElement;

    applyOffset(block, { left: 40, top: 20 });
    applyOffset(block, { left: 0, top: 0 });

    expect(block.hasAttribute('style')).toBe(false);
    expect(hasOffset(block)).toBe(false);
  });

  it('คืนตำแหน่งเดิมได้โดยไม่ทำลายการจัดแนวข้อความที่ตั้งไว้', () => {
    const root = documentWith('<p style="text-align:center;position:relative;left:60px;top:12px">ข้อความ</p>');
    const block = root.firstElementChild as HTMLElement;

    clearOffset(block);

    expect(block.style.textAlign).toBe('center');
    expect(readOffset(block)).toEqual({ left: 0, top: 0 });
  });

  it('ไม่นับตำแหน่งที่มาจาก stylesheet ว่าเป็นระยะที่ผู้ใช้ลากไว้', () => {
    const root = documentWith('<div class="form-page-break"></div>');
    const block = root.firstElementChild as HTMLElement;
    expect(readOffset(block)).toEqual({ left: 0, top: 0 });
  });
});

describe('การหาบล็อกและสลับลำดับ', () => {
  it('เลื่อนจากจุดที่คลิกขึ้นไปหาบล็อกระดับบนสุดของเอกสาร', () => {
    const root = documentWith('<h2>หัวข้อ</h2><table><tbody><tr><td>ในตาราง</td></tr></tbody></table>');
    const cellText = root.querySelector('td')!.firstChild!;

    expect(blockFromNode(cellText, root)?.tagName).toBe('TABLE');
    expect(blockFromNode(root, root)).toBeNull();
    expect(blockFromNode(document.createElement('p'), root)).toBeNull();
  });

  it('สลับบล็อกกับเพื่อนบ้านจริง ๆ ในสายเนื้อหา', () => {
    const root = documentWith('<p id="a">หนึ่ง</p><p id="b">สอง</p><p id="c">สาม</p>');
    const middle = root.querySelector('#b') as HTMLElement;

    expect(reorderBlock(middle, -1)).toBe(true);
    expect([...root.children].map((child) => child.id)).toEqual(['b', 'a', 'c']);

    expect(reorderBlock(middle, 1)).toBe(true);
    expect([...root.children].map((child) => child.id)).toEqual(['a', 'b', 'c']);
  });

  it('บอกได้ว่าบล็อกหัวและท้ายไปต่อทางไหนไม่ได้ เพื่อให้ปุ่มปิดตัวเองถูก', () => {
    const root = documentWith('<p id="a">หนึ่ง</p><p id="b">สอง</p>');
    const first = root.querySelector('#a') as HTMLElement;
    const last = root.querySelector('#b') as HTMLElement;

    expect(canReorderBlock(first, -1)).toBe(false);
    expect(canReorderBlock(first, 1)).toBe(true);
    expect(reorderBlock(last, 1)).toBe(false);
    expect([...root.children].map((child) => child.id)).toEqual(['a', 'b']);
  });
});
