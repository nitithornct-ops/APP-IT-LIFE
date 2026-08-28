import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CheckCircle2, FileSignature, Loader2, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { apiFetch } from '../../services/apiClient';
import { formatThaiDate } from '../../utils/date';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

interface OutsourceSubmission {
  id: string;
  revision: number;
  response: Record<string, unknown>;
  signer_name: string;
  signer_position: string | null;
  submitted_at: string;
  review_status: 'Submitted' | 'Revision Requested' | 'Accepted';
  reviewed_at: string | null;
  review_note: string | null;
  signature_url: string | null;
}

export function OutsourceSubmissionCard({ ticketId, canReview }: { ticketId: string; canReview: boolean }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const queryKey = ['tickets', ticketId, 'outsource-submission'];
  const query = useQuery({ queryKey, queryFn: () => apiFetch<OutsourceSubmission | null>(`/api/v1/outsource-submissions/${ticketId}`) });
  const mutation = useMutation({
    mutationFn: (status: 'Accepted' | 'Revision Requested') => apiFetch(`/api/v1/outsource-submissions/${ticketId}/review`, { method: 'POST', body: JSON.stringify({ status, note: note || undefined }) }),
    onSuccess: () => { setNote(''); void queryClient.invalidateQueries({ queryKey }); void queryClient.invalidateQueries({ queryKey: ['tickets', ticketId] }); },
  });

  if (query.isLoading) return <section className="rounded-xl border border-slate-200 p-4"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></section>;
  const submission = query.data;
  if (!submission) return <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-4"><p className="flex items-center gap-2 text-sm font-bold text-amber-800"><Building2 className="h-4 w-4" />ส่วนที่ 3: รอผลการดำเนินงานจากบริษัท</p><p className="mt-1 text-xs text-amber-700">บริษัทจะเห็นงานนี้ใน Outsource Portal และลงนามส่งกลับผ่านส่วนของบริษัทเท่านั้น</p></section>;

  const response = submission.response;
  const statusVariant = submission.review_status === 'Accepted' ? 'success' : submission.review_status === 'Revision Requested' ? 'danger' : 'warning';
  const statusLabel = submission.review_status === 'Accepted' ? 'ตรวจรับแล้ว' : submission.review_status === 'Revision Requested' ? 'ส่งกลับให้แก้ไข' : 'รอตรวจรับ';
  return <section className="rounded-xl border border-cyan-200 bg-cyan-50/40 p-4" data-testid="outsource-submission-card">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="flex items-center gap-2 text-sm font-bold text-cyan-900"><FileSignature className="h-4 w-4" />ส่วนที่ 3: ผลการดำเนินงานและลายเซ็นบริษัท</p><p className="mt-1 text-xs text-slate-500">ฉบับที่ {submission.revision} · ส่งเมื่อ {formatThaiDate(submission.submitted_at, 'd MMM yyyy HH:mm')}</p></div><Badge variant={statusVariant}>{statusLabel}</Badge></div>
    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="font-bold text-slate-700">สาเหตุ</dt><dd className="mt-1 whitespace-pre-wrap text-slate-600">{String(response.rootCause ?? '—')}</dd></div><div><dt className="font-bold text-slate-700">วิธีแก้ไข</dt><dd className="mt-1 whitespace-pre-wrap text-slate-600">{String(response.resolution ?? '—')}</dd></div><div><dt className="font-bold text-slate-700">ผลการทดสอบ</dt><dd className="mt-1 whitespace-pre-wrap text-slate-600">{String(response.testResult ?? '—')}</dd></div><div><dt className="font-bold text-slate-700">ผู้ลงนาม</dt><dd className="mt-1 text-slate-600">{submission.signer_name}{submission.signer_position ? ` · ${submission.signer_position}` : ''}</dd></div></dl>
    {submission.signature_url && <div className="mt-4 rounded-lg border bg-white p-3 text-center"><img src={submission.signature_url} alt="ลายเซ็นบริษัท" className="mx-auto max-h-28 max-w-full object-contain" /></div>}
    {submission.review_note && <p className="mt-3 rounded-lg bg-white/80 p-3 text-xs text-slate-700"><strong>หมายเหตุตรวจรับ:</strong> {submission.review_note}</p>}
    {canReview && submission.review_status === 'Submitted' && <div className="mt-4 border-t border-cyan-200 pt-3"><label className="text-xs font-semibold text-slate-700">หมายเหตุถึงบริษัท<textarea rows={2} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" isLoading={mutation.isPending} onClick={() => mutation.mutate('Accepted')}><CheckCircle2 className="h-4 w-4" />ตรวจรับผลบริษัท</Button><Button size="sm" variant="outline" disabled={!note.trim() || mutation.isPending} onClick={() => mutation.mutate('Revision Requested')}><RotateCcw className="h-4 w-4" />ส่งกลับให้แก้ไข</Button></div></div>}
  </section>;
}

