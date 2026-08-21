/**
 * ตัวกลางของงาน "ทำหลายรายการพร้อมกัน" — เจ้าของรูปแบบผลลัพธ์เพียงจุดเดียว
 *
 * ทุก endpoint ที่ลงท้ายด้วย /bulk ต้องผ่านที่นี่ เพราะหน้าเว็บอ่านผลลัพธ์ด้วยโครงสร้างเดียวกัน
 * ถ้าปล่อยให้แต่ละ endpoint วนเองและประกอบ { succeeded, failed } เอง รูปแบบจะค่อย ๆ ห่างกัน
 * จนหน้าเว็บต้องเขียนโค้ดแยกต่อโมดูล ซึ่งเป็นทางเดียวกับที่ state machine ของ Ticket เคยเกือบไป
 */

export interface BulkFailure {
  id: string;
  code: string;
  message: string;
}

export interface BulkOutcome<T> {
  succeeded: T[];
  failed: BulkFailure[];
}

/** ความผิดพลาดของรายการเดียว — โยนจาก handler เพื่อข้ามเฉพาะรายการนั้น ไม่ล้มทั้งชุด */
export class BulkItemError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'BulkItemError';
  }
}

/**
 * ทำทีละรายการ "ตามลำดับ ไม่ขนาน" เพื่อให้ audit log กับ worklog เรียงตามที่เกิดจริง —
 * งาน ISMS ต้องตรวจย้อนได้ว่าใครทำอะไรกับรายการไหนเมื่อไร ซึ่ง log รายชุดรายการเดียวตอบไม่ได้
 *
 * ข้อผิดพลาดที่ไม่คาดคิดก็ถูกรายงานเป็น "รายการที่ไม่สำเร็จ" เช่นกัน ไม่โยนออกไปเป็น 500 เพราะ
 * รายการก่อนหน้าถูกเขียนลงฐานข้อมูลไปแล้ว การตอบ 500 จะทำให้ผู้เรียกไม่รู้ว่าอะไรถูกเขียนไปบ้าง
 *
 * id ซ้ำถูกตัดทิ้ง ไม่งั้นรายการเดียวจะถูกเขียน log สองรอบ
 */
export async function runBulk<T>(
  ids: readonly string[],
  handler: (id: string) => Promise<T>,
): Promise<BulkOutcome<T>> {
  const succeeded: T[] = [];
  const failed: BulkFailure[] = [];

  for (const id of [...new Set(ids)]) {
    try {
      succeeded.push(await handler(id));
    } catch (error) {
      if (error instanceof BulkItemError) {
        failed.push({ id, code: error.code, message: error.message });
      } else {
        failed.push({ id, code: 'BULK_ITEM_FAILED', message: 'ดำเนินการกับรายการนี้ไม่สำเร็จ' });
      }
    }
  }

  return { succeeded, failed };
}
