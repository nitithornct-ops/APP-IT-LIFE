import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../ui/Button';
import { ApiError } from '../../services/apiClient';

/** ช่องทางผู้แจ้งส่งงานกลับเมื่อทดสอบแล้วพบว่ายังใช้งานไม่ได้ */
export function RequesterReopenCard({ onSubmit }: { onSubmit: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!reason.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await onSubmit(reason.trim());
      setReason('');
    } catch (submitError) {
      setError(submitError instanceof ApiError || submitError instanceof Error ? submitError.message : 'ส่งกลับให้ทีม IT ไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-800 dark:bg-amber-950/20" data-testid="requester-reopen-card">
      <p className="flex items-center gap-2 text-sm font-bold text-amber-900 dark:text-amber-200"><RotateCcw className="h-4 w-4" aria-hidden="true" />ยังใช้งานไม่ได้?</p>
      <p className="mt-1 text-xs leading-5 text-amber-800 dark:text-amber-300">ส่งเหตุผลกลับให้ทีม IT ระบบจะเปิดงานซ้ำและเริ่ม SLA รอบใหม่ โดยเก็บประวัติรอบเดิมไว้</p>
      <textarea
        rows={2}
        value={reason}
        disabled={submitting}
        onChange={(event) => setReason(event.target.value)}
        maxLength={2000}
        placeholder="เช่น ทดสอบแล้วจอยังไม่แสดงภาพ"
        className="mt-3 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500 dark:border-amber-700 dark:bg-slate-900"
      />
      {error && <p className="mt-2 text-xs font-semibold text-red-600" role="alert">{error}</p>}
      <Button size="sm" className="mt-3" disabled={!reason.trim() || submitting} isLoading={submitting} onClick={() => void submit()}>
        ส่งกลับให้ทีม IT
      </Button>
    </section>
  );
}

