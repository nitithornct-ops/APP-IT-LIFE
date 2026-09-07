/**
 * ตำแหน่งและลำดับของบล็อกในเอกสารแบบฟอร์ม
 *
 * การ "ลากย้าย" ที่นี่ใช้ position:relative แล้วเยื้องด้วย left/top ไม่ใช่ absolute เพราะบล็อกที่เยื้อง
 * แบบนี้ยังกินที่เดิมในสายเนื้อหา ตัวจัดหน้ากระดาษ A4 (formPagination.ts) จึงยังนับความสูงได้ถูก
 * และบล็อกยังอยู่แผ่นเดิมกับเนื้อหารอบตัวตอนพิมพ์ ถ้าใช้ absolute บล็อกจะหลุดออกจากสายเนื้อหา
 * เนื้อหาที่เหลือจะเลื่อนขึ้นมาแทนที่ และตำแหน่งบนกระดาษที่พิมพ์ออกมาจะไม่ตรงกับที่เห็นบนจอ
 *
 * อีกด้านคือความปลอดภัย relative ทำได้แค่เยื้องจากที่เดิม สร้างแผ่นทับทั้งหน้าจอไม่ได้
 * ตัวกรอง HTML ทั้งสองฝั่งจึงยอมให้ค่าชุดนี้ผ่านได้ (ดู utils/formHtml.ts)
 *
 * ส่วนการ "ขยับลำดับ" คือการสลับที่กับบล็อกข้างเคียงจริง ๆ ในสายเนื้อหา ซึ่งเป็นสิ่งที่ผู้ใช้ต้องการ
 * เมื่ออยากให้หัวข้อหนึ่งมาก่อนอีกหัวข้อ ไม่ใช่แค่เลื่อนภาพให้ดูเหมือนสลับที่
 */

/**
 * ระยะเยื้องสูงสุดที่ลากได้ ต้องอยู่ในช่วงที่ sanitizeFormHtml ยอมรับ (จำนวนเต็มไม่เกินสี่หลัก)
 * ไม่งั้นค่าที่ลากไว้จะหายตอนบันทึกโดยที่ผู้ใช้ไม่รู้ตัว
 */
export const MAX_OFFSET_PX = 2000;

export interface BlockOffset {
  left: number;
  top: number;
}

const NO_OFFSET: BlockOffset = { left: 0, top: 0 };

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(MAX_OFFSET_PX, Math.max(-MAX_OFFSET_PX, value)));
}

/** ระยะเยื้องที่บล็อกถูกลากไว้ — อ่านจาก inline style เท่านั้น ตำแหน่งจาก stylesheet ไม่นับ */
export function readOffset(element: HTMLElement): BlockOffset {
  if (element.style.position !== 'relative') return NO_OFFSET;
  return {
    left: clamp(Number.parseFloat(element.style.left)),
    top: clamp(Number.parseFloat(element.style.top)),
  };
}

export function hasOffset(element: HTMLElement): boolean {
  const offset = readOffset(element);
  return offset.left !== 0 || offset.top !== 0;
}

/** ล้างตำแหน่งที่ลากไว้ ให้บล็อกกลับไปอยู่ที่ของมันตามสายเนื้อหา */
export function clearOffset(element: HTMLElement): void {
  for (const property of ['position', 'left', 'top', 'z-index']) element.style.removeProperty(property);
  if (element.getAttribute('style')?.trim() === '') element.removeAttribute('style');
}

/**
 * ตั้งระยะเยื้องใหม่ คืนค่าที่ใช้จริงหลังตัดให้อยู่ในช่วงที่ยอมรับ
 * เยื้องเป็นศูนย์ทั้งสองแกน = ไม่ได้ย้าย จึงล้างสไตล์ทิ้งเลยเพื่อไม่ให้เอกสารบวมด้วยค่าที่ไม่มีผล
 */
export function applyOffset(element: HTMLElement, offset: BlockOffset): BlockOffset {
  const next = { left: clamp(offset.left), top: clamp(offset.top) };
  if (next.left === 0 && next.top === 0) {
    clearOffset(element);
    return next;
  }
  element.style.position = 'relative';
  element.style.left = `${next.left}px`;
  element.style.top = `${next.top}px`;
  return next;
}

export function moveOffsetBy(element: HTMLElement, deltaX: number, deltaY: number): BlockOffset {
  const current = readOffset(element);
  return applyOffset(element, { left: current.left + deltaX, top: current.top + deltaY });
}

/**
 * บล็อกที่ย้ายได้คือลูกโดยตรงของพื้นที่เอกสาร ซึ่งเป็นระดับเดียวกับที่ตัวจัดหน้ากระดาษมองเห็น
 * การจำกัดไว้ระดับนี้ทำให้ "ย้ายขึ้น/ลง" ให้ผลที่ผู้ใช้เดาได้ และไม่ไปสลับแถวในตารางโดยไม่ตั้งใจ
 */
export function blockFromNode(node: Node | null, root: HTMLElement): HTMLElement | null {
  if (!node || node === root || !root.contains(node)) return null;
  let current: Node | null = node;
  while (current && current.parentNode !== root) current = current.parentNode;
  return current instanceof HTMLElement ? current : null;
}

/** สลับบล็อกกับตัวก่อนหน้า (-1) หรือตัวถัดไป (1) คืน true เมื่อย้ายได้จริง */
export function reorderBlock(element: HTMLElement, direction: -1 | 1): boolean {
  const neighbour = direction < 0 ? element.previousElementSibling : element.nextElementSibling;
  if (!neighbour) return false;
  if (direction < 0) neighbour.before(element);
  else neighbour.after(element);
  return true;
}

export function canReorderBlock(element: HTMLElement, direction: -1 | 1): boolean {
  return Boolean(direction < 0 ? element.previousElementSibling : element.nextElementSibling);
}
