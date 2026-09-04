import { UserRound } from 'lucide-react';
import { formatThaiDate } from '../../utils/date';

export interface RequesterInfo {
  /** guest_name หรือ requester_name_snapshot แล้วแต่ช่องทางที่แจ้ง */
  name?: string | null;
  position?: string | null;
  department?: string | null;
  phone?: string | null;
  incidentAt?: string | null;
  erpModule?: string | null;
  location?: string | null;
  assetName?: string | null;
}

/**
 * ข้อมูลผู้แจ้งที่กรอกไว้ตอนเปิด Ticket — แสดงให้เจ้าของใบตรวจทานได้ทั้งพอร์ทัล LINE
 * และหน้าติดตามสถานะแบบ guest ใช้ snapshot เสมอ เอกสารย้อนหลังจึงไม่เปลี่ยนตามโปรไฟล์ปัจจุบัน
 */
export function RequesterInfoCard({ info }: { info: RequesterInfo }) {
  const rows: Array<{ label: string; value: string }> = [];
  const add = (label: string, value?: string | null) => {
    const trimmed = value?.trim();
    if (trimmed) rows.push({ label, value: trimmed });
  };

  add('ชื่อผู้แจ้ง', info.name);
  add('ตำแหน่ง', info.position);
  add('ส่วนงาน', info.department);
  add('เบอร์ติดต่อ', info.phone);
  add('วันที่พบปัญหา', info.incidentAt ? formatThaiDate(info.incidentAt, 'd MMM yyyy HH:mm') : null);
  add('ERP Module', info.erpModule);
  add('สถานที่', info.location);
  add('อุปกรณ์ที่เกี่ยวข้อง', info.assetName);

  if (rows.length === 0) return null;

  return (
    <section
      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
      aria-labelledby="requester-info-title"
      data-testid="requester-info"
    >
      <p id="requester-info-title" className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
        <UserRound className="h-4 w-4 text-primary-700 dark:text-primary-300" aria-hidden="true" />
        ข้อมูลผู้แจ้ง
      </p>
      <dl className="mt-3 divide-y divide-slate-100 dark:divide-slate-700">
        {rows.map((row) => (
          <div key={row.label} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
            <dt className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{row.label}</dt>
            <dd className="min-w-0 break-words text-right text-[13px] font-semibold text-slate-800 dark:text-slate-100">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
