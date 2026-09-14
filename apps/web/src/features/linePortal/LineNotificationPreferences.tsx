import { Loader2, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError } from '../../services/apiClient';
import { lineApiFetch } from '../../services/lineApiClient';

const NOTIFICATION_TYPES = [
  ['ticket_assigned', 'ได้รับมอบหมายงานแจ้งซ่อม'],
  ['ticket_status_changed', 'อัปเดตสถานะใบงาน'],
  ['ticket_comment', 'ข้อความใหม่ในใบงาน'],
  ['ticket_closed', 'ปิดงานเรียบร้อย'],
  ['response_warning', 'ใกล้ผิด Response SLA'],
  ['response_breached', 'ผิด Response SLA แล้ว'],
  ['resolution_warning', 'ใกล้ผิด Resolution SLA'],
  ['resolution_breached', 'ผิด Resolution SLA แล้ว'],
  ['workflow_approval', 'เอกสารหรือคำขอที่รออนุมัติ'],
  ['task_reminder', 'เตือนงานของฉัน'],
  ['incident_assigned', 'ได้รับมอบหมาย Incident'],
  ['vulnerability_status', 'อัปเดตช่องโหว่'],
  ['license_expiry', 'ใบอนุญาตใกล้หมดอายุ'],
  ['contract_expiry', 'สัญญาใกล้หมดอายุ'],
] as const;

interface PreferencesResponse {
  disabledTypes: string[];
  updatedAt: string | null;
}

export function LineNotificationPreferences() {
  const [disabledTypes, setDisabledTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.resolve(lineApiFetch<PreferencesResponse>('/api/v1/line/notification-preferences'))
      .then((data) => {
        if (!active) return;
        setDisabledTypes(data?.disabledTypes ?? []);
        setLoaded(true);
      })
      .catch((error) => {
        if (active) setMessage(error instanceof ApiError ? error.message : 'โหลดการตั้งค่าไม่สำเร็จ');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function save(next: string[]) {
    setDisabledTypes(next);
    setSaving(true);
    setMessage(null);
    try {
      await lineApiFetch<PreferencesResponse>('/api/v1/line/notification-preferences', {
        method: 'PATCH', body: JSON.stringify({ disabledTypes: next }),
      });
      setMessage('บันทึกการตั้งค่าแล้ว');
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'บันทึกการตั้งค่าไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mx-4 overflow-hidden rounded-card border border-hairline bg-white shadow-card dark:border-slate-700 dark:bg-slate-900">
      <div className="border-b border-hairline px-4 py-3 dark:border-slate-700">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">การแจ้งเตือนผ่าน LINE</p>
        <p className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">ปิดเฉพาะประเภทที่ไม่ต้องการได้ โดยการแจ้งเตือนในระบบจะยังคงอยู่</p>
      </div>
      <div className="p-4">
        {loading && <p className="flex items-center gap-2 text-xs text-slate-500" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />กำลังโหลดการตั้งค่า</p>}
        {!loading && loaded && (
          <div className="grid gap-2 sm:grid-cols-2">
            {NOTIFICATION_TYPES.map(([type, label]) => (
              <label key={type} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                  checked={!disabledTypes.includes(type)}
                  disabled={saving}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? disabledTypes.filter((item) => item !== type)
                      : [...disabledTypes, type];
                    void save(next);
                  }}
                />
                {label}
              </label>
            ))}
          </div>
        )}
        {saving && <p className="mt-3 flex items-center gap-2 text-[11px] text-slate-500"><Save className="h-3.5 w-3.5" aria-hidden="true" />กำลังบันทึก</p>}
        {message && <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400" role="status">{message}</p>}
      </div>
    </section>
  );
}
