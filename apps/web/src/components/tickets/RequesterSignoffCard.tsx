import type { TicketRatingCriterion, TicketRatingDetails, TicketRatingKey } from '@itlife/shared';
import { CheckCircle2, FileSignature, Star, UserRoundCheck } from 'lucide-react';
import { useState } from 'react';
import { RequesterSignatureInput } from '../../features/tickets/RequesterSignatureInput';
import { ApiError } from '../../services/apiClient';
import { formatThaiDate } from '../../utils/date';
import { TicketRatingFields } from './TicketRatingFields';

export function RequesterSignoffCard({
  status,
  signatureUrl,
  signedAt,
  requesterName,
  criteria,
  rating,
  onSign,
}: {
  status: string;
  signatureUrl?: string | null;
  signedAt?: string | null;
  requesterName?: string | null;
  criteria: TicketRatingCriterion[];
  rating?: number | null;
  onSign: (file: File, ratings: TicketRatingDetails, feedback?: string) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [scores, setScores] = useState<Partial<TicketRatingDetails>>({});
  const [feedback, setFeedback] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const ratingComplete = criteria.length > 0 && criteria.every((criterion) => scores[criterion.key] !== undefined);

  function setCriterionScore(key: TicketRatingKey, value: number) {
    setScores((current) => ({ ...current, [key]: value }));
  }

  if (signatureUrl) {
    return (
      <section className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-800 dark:bg-emerald-950/30" data-testid="requester-signoff-history">
        <p className="flex items-center gap-2 text-sm font-bold text-emerald-800 dark:text-emerald-200">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> ส่วนที่ 5: ผู้แจ้งประเมิน ตรวจรับ และลงนามแล้ว
        </p>
        {requesterName && <p className="mt-2 text-xs font-semibold text-emerald-800 dark:text-emerald-200">ผู้ประเมินและผู้ลงนาม: {requesterName}</p>}
        {rating != null && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">ผลประเมินรวม {rating}/5 คะแนน</p>}
        <div className="mt-3 rounded-lg bg-white p-3 text-center dark:bg-slate-900">
          <img src={signatureUrl} alt="ลายเซ็นผู้แจ้งตรวจรับงาน" className="mx-auto max-h-28 max-w-full object-contain" />
        </div>
        {signedAt && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">ลงนามเมื่อ {formatThaiDate(signedAt, 'd MMM yyyy HH:mm')}</p>}
      </section>
    );
  }

  if (status !== 'เสร็จสิ้น') return null;

  async function submit() {
    if (!file || !confirmed || !ratingComplete) return;
    setSubmitting(true);
    setError('');
    try {
      await onSign(file, scores as TicketRatingDetails, feedback.trim() || undefined);
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
          <FileSignature className="h-4 w-4" aria-hidden="true" /> ส่วนที่ 5: ประเมิน ตรวจรับ และปิดงาน
        </p>
        <p className="mt-1 text-xs text-primary-700 dark:text-primary-300">ผู้แจ้งต้องทดสอบผล ให้คะแนน และลงลายเซ็นเพื่อยืนยันปิด Ticket</p>
      </div>

      <div className="mb-4 flex items-center gap-2 rounded-lg border border-primary-100 bg-white px-3 py-2 text-sm dark:border-primary-900 dark:bg-slate-900">
        <UserRoundCheck className="h-4 w-4 shrink-0 text-primary-700 dark:text-primary-300" aria-hidden="true" />
        <span className="text-slate-600 dark:text-slate-300">ผู้ประเมินและผู้ลงนาม</span>
        <strong className="ml-auto text-right text-slate-900 dark:text-white">{requesterName || 'ผู้แจ้ง Ticket'}</strong>
      </div>

      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/80 p-3 dark:border-amber-800 dark:bg-amber-950/20">
        <p className="mb-3 flex items-center gap-2 text-sm font-bold text-amber-900 dark:text-amber-200">
          <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden="true" /> แบบประเมินการให้บริการ
        </p>
        {criteria.length > 0 ? (
          <TicketRatingFields criteria={criteria} scores={scores} onChange={setCriterionScore} compact />
        ) : (
          <p role="alert" className="text-xs font-semibold text-red-600 dark:text-red-400">ยังไม่พบหัวข้อประเมิน กรุณาลองโหลดหน้าใหม่หรือติดต่อผู้ดูแลระบบ</p>
        )}
        <label className="mt-3 block text-xs font-semibold text-slate-700 dark:text-slate-200">
          ความคิดเห็นเพิ่มเติม <span className="font-normal text-slate-400">(ไม่บังคับ)</span>
          <textarea
            rows={2}
            maxLength={2000}
            value={feedback}
            disabled={submitting}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="ข้อเสนอแนะเกี่ยวกับการให้บริการ"
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-slate-600 dark:bg-slate-900"
          />
        </label>
      </div>

      <RequesterSignatureInput disabled={submitting} onChange={setFile} />
      <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary-700" />
        <span>ข้าพเจ้าได้ตรวจสอบแล้ว และยืนยันว่าปัญหาได้รับการแก้ไขเรียบร้อย</span>
      </label>
      {error && <p className="mt-2 text-xs font-semibold text-red-600" role="alert">{error}</p>}
      <button
        type="button"
        disabled={!file || !confirmed || !ratingComplete || submitting}
        onClick={() => void submit()}
        className="public-primary-button mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'กำลังบันทึก…' : 'ส่งแบบประเมิน ลงลายเซ็น และปิดงาน'}
      </button>
    </section>
  );
}
