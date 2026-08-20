import type { TicketRatingCriterion, TicketRatingDetails, TicketRatingKey } from '@itlife/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Star } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { TicketRatingFields } from '../../components/tickets/TicketRatingFields';
import { ApiError, apiFetch } from '../../services/apiClient';

export function TicketFeedbackPanel({ ticketId }: { ticketId: string }) {
  const queryClient = useQueryClient();
  const [scores, setScores] = useState<Partial<TicketRatingDetails>>({});
  const [feedback, setFeedback] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const criteriaQuery = useQuery({
    queryKey: ['ticket-rating-criteria', 'active'],
    queryFn: () => apiFetch<TicketRatingCriterion[]>('/api/v1/ticket-rating-criteria'),
  });
  const criteria = criteriaQuery.data ?? [];

  const mutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/tickets/${ticketId}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ ratings: scores, feedback: feedback.trim() || undefined }),
    }),
    onSuccess: () => {
      setSubmitted(true);
      setServerError(null);
      void queryClient.invalidateQueries({ queryKey: ['tickets', ticketId] });
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'ส่งคะแนนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (criteria.length && criteria.every((criterion) => scores[criterion.key] !== undefined)) mutation.mutate();
  }

  function setCriterionScore(key: TicketRatingKey, value: number) {
    setScores((current) => ({ ...current, [key]: value }));
  }

  const isComplete = criteria.length > 0 && criteria.every((criterion) => scores[criterion.key] !== undefined);

  if (submitted) {
    return (
      <Card>
        <CardBody className="flex items-center gap-3 bg-emerald-50 p-5 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">
          <CheckCircle2 className="h-6 w-6 shrink-0" aria-hidden="true" />
          <div><p className="font-bold">ขอบคุณสำหรับการประเมิน</p><p className="text-sm">ระบบบันทึกคะแนนการบริการเรียบร้อยแล้ว</p></div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex items-center gap-2">
        <Star className="h-5 w-5 fill-amber-400 text-amber-400" aria-hidden="true" />
        ประเมินการบริการหลังปิดงาน
      </CardHeader>
      <CardBody>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {criteriaQuery.isLoading && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />กำลังโหลดหัวข้อประเมิน...</p>}
          {criteriaQuery.isError && <p role="alert" className="text-sm font-semibold text-red-600">โหลดหัวข้อประเมินไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</p>}
          {criteria.length > 0 && <TicketRatingFields criteria={criteria} scores={scores} onChange={setCriterionScore} />}

          <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            ความคิดเห็นเพิ่มเติม <span className="font-normal text-slate-400">(ไม่บังคับ)</span>
            <textarea
              rows={3}
              maxLength={2000}
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              placeholder="บอกเราได้ว่าประทับใจหรือควรปรับปรุงเรื่องใด"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-slate-600 dark:bg-slate-900"
            />
          </label>

          {serverError && <p role="alert" className="text-sm font-semibold text-red-600 dark:text-red-400">{serverError}</p>}
          <Button type="submit" size="sm" isLoading={mutation.isPending} disabled={!isComplete} className="w-fit">
            ส่งแบบประเมิน
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
