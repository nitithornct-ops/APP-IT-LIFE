import { CheckCircle2, FileSignature } from 'lucide-react';
import { useState } from 'react';
import { RequesterSignatureInput } from '../../features/tickets/RequesterSignatureInput';
import { ApiError } from '../../services/apiClient';
import { formatThaiDate } from '../../utils/date';

export function RequesterSignoffCard({
  status,
  signatureUrl,
  signedAt,
  onSign,
}: {
  status: string;
  signatureUrl?: string | null;
  signedAt?: string | null;
  onSign: (file: File) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (signatureUrl) {
    return (
      <section className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-800 dark:bg-emerald-950/30" data-testid="requester-signoff-history">
        <p className="flex items-center gap-2 text-sm font-bold text-emerald-800 dark:text-emerald-200">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> ส่วนที่ 5: ผู้แจ้งตรวจรับและลงนามแล้ว
        </p>
        <div className="mt-3 rounded-lg bg-white p-3 text-center dark:bg-slate-900">
          <img src={signatureUrl} alt="ลายเซ็นผู้แจ้งตรวจรับงาน" className="mx-auto max-h-28 max-w-full object-contain" />
        </div>
        {signedAt && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">ลงนามเมื่อ {formatThaiDate(signedAt, 'd MMM yyyy HH:mm')}</p>}
      </section>
    );
  }

  if (status !== 'เสร็จสิ้น') return null;

  async function submit() {
    if (!file || !confirmed) return;
    setSubmitting(true);
    setError('');
    try {
      await onSign(file);
    } catch (submitError) {
      setError(submitError instanceof ApiError || submitError instanceof Error ? submitError.message : 'บันทึกการตรวจรับงานไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-xl border border-primary-200 bg-primary-50/50 p-4 dark:border-primary-800 dark:bg-primary-950/30" data-testid="requester-signoff-card">
      <div className="mb-3">
        <p className="flex items-center gap-2 text-sm font-bold text-primary-900 dark:text-primary-100">
          <FileSignature className="h-4 w-4" aria-hidden="true" /> ส่วนที่ 5: ตรวจรับและปิดงาน
        </p>
        <p className="mt-1 text-xs text-primary-700 dark:text-primary-300">กรุณาทดสอบผลการแก้ไข แล้วลงลายเซ็นเพื่อยืนยันและปิด Ticket</p>
      </div>
      <RequesterSignatureInput disabled={submitting} onChange={setFile} />
      <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary-700" />
        <span>ข้าพเจ้าได้ตรวจสอบแล้ว และยืนยันว่าปัญหาได้รับการแก้ไขเรียบร้อย</span>
      </label>
      {error && <p className="mt-2 text-xs font-semibold text-red-600" role="alert">{error}</p>}
      <button
        type="button"
        disabled={!file || !confirmed || submitting}
        onClick={() => void submit()}
        className="public-primary-button mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'กำลังบันทึก…' : 'ลงลายเซ็นและยืนยันปิดงาน'}
      </button>
    </section>
  );
}
