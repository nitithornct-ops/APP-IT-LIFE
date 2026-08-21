import type { ReactNode } from 'react';
import { Button } from '../ui/Button';
import { FormModal } from '../ui/Modal';

/**
 * ชิ้นส่วนร่วมของงาน "ดำเนินการกับหลายรายการ" — กล่องกรอก และกล่องสรุปผล
 *
 * ทุก endpoint /bulk คืนผลรูปแบบเดียวกันจาก runBulk ฝั่ง api หน้าเว็บจึงอ่านผลด้วยโค้ดชุดเดียว
 * ถ้าปล่อยให้แต่ละหน้าวาดกล่องสรุปผลเอง ข้อความ "สำเร็จ/ไม่สำเร็จ" จะค่อย ๆ ไม่เหมือนกัน
 * ผู้ใช้ที่ทำงานข้ามโมดูลจะต้องเรียนรู้ใหม่ทุกหน้า
 */

export interface BulkFailure {
  id: string;
  code: string;
  message: string;
}

export interface BulkResult<T = { id: string }> {
  succeeded: T[];
  failed: BulkFailure[];
}

/** หน้าตาของช่องกรอกในแผงนี้ — รวมไว้จุดเดียวเพื่อให้ทุกโมดูลเหมือนกัน */
export const bulkFieldClass = 'mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white';
export const bulkTextareaClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white';

interface BulkActionModalProps {
  /** จำนวนรายการที่เลือกไว้ ใช้ประกอบหัวเรื่องให้ผู้ใช้เห็นชัดว่ากำลังจะกระทบกี่รายการ */
  count: number;
  itemLabel: string;
  isPending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: () => void;
  children: ReactNode;
}

export function BulkActionModal({ count, itemLabel, isPending, error, onClose, onSubmit, children }: BulkActionModalProps) {
  return (
    <FormModal
      title={`ดำเนินการ ${count.toLocaleString('th-TH')} ${itemLabel}`}
      description="ระบบจะตรวจสิทธิ์และเงื่อนไขของแต่ละรายการแยกกัน รายการที่ทำไม่ได้จะรายงานกลับพร้อมเหตุผล"
      closeDisabled={isPending}
      onClose={onClose}
    >
      <div className="space-y-4 p-1">
        {children}

        {error && <p className="text-sm font-semibold text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={isPending} onClick={onClose}>ยกเลิก</Button>
          <Button type="button" isLoading={isPending} onClick={onSubmit}>ดำเนินการ</Button>
        </div>
      </div>
    </FormModal>
  );
}

/**
 * สรุปผลรายรายการหลังดำเนินการเสร็จ
 * แสดงเหตุผลของรายการที่ไม่สำเร็จครบทุกรายการ เพราะผู้ใช้ต้องรู้ว่าต้องกลับไปแก้อะไรบ้าง
 */
export function BulkResultSummary({ result, itemLabel, onDismiss }: { result: BulkResult<unknown>; itemLabel: string; onDismiss: () => void }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-800" role="status">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-bold text-slate-800 dark:text-slate-100">
            สำเร็จ {result.succeeded.length.toLocaleString('th-TH')} {itemLabel}
            {result.failed.length > 0 && ` · ไม่สำเร็จ ${result.failed.length.toLocaleString('th-TH')} ${itemLabel}`}
          </p>
          {result.failed.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-red-600 dark:text-red-300">
              {result.failed.map((item) => <li key={item.id}>{item.message}</li>)}
            </ul>
          )}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>ปิด</Button>
      </div>
    </div>
  );
}
