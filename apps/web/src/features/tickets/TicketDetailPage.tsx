import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Loader2, RotateCcw, Star } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router-dom';
import { z } from 'zod';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { useAuth } from '../../stores/authContext';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { AssignableStaff, TicketDetail, TicketStatus } from '../../types/tickets';
import { INCIDENT_CATEGORIES, INCIDENT_SEVERITIES, type Incident } from '../../types/incidents';
import { formatThaiDate } from '../../utils/date';

const TICKET_STATUSES: TicketStatus[] = [
  'ใหม่',
  'รับเรื่องแล้ว',
  'กำลังดำเนินการ',
  'รออะไหล่',
  'รอผู้ใช้งาน',
  'ส่งต่อ Outsource',
  'เสร็จสิ้น',
  'ปิดงาน',
  'ยกเลิก',
];

const statusTone: Record<TicketStatus, 'secondary' | 'info' | 'warning' | 'success' | 'danger' | 'primary'> = {
  ใหม่: 'info',
  รับเรื่องแล้ว: 'primary',
  กำลังดำเนินการ: 'primary',
  รออะไหล่: 'warning',
  รอผู้ใช้งาน: 'warning',
  'ส่งต่อ Outsource': 'warning',
  เสร็จสิ้น: 'success',
  ปิดงาน: 'success',
  ยกเลิก: 'secondary',
  'ยกระดับเป็น Incident': 'danger',
};

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-right font-medium text-slate-800 dark:text-slate-200">{value ?? '—'}</span>
    </div>
  );
}

const updateSchema = z.object({
  status: z.string().min(1),
  assigneeId: z.string().optional(),
  note: z.string().trim().optional(),
  minutesSpent: z.string().optional(),
  resolution: z.string().trim().optional(),
  outsourceName: z.string().trim().optional(),
  outsourceIssueNo: z.string().trim().optional(),
});

type UpdateForm = z.infer<typeof updateSchema>;

function UpdateWorkPanel({ ticket, staff }: { ticket: TicketDetail; staff: AssignableStaff[] }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { isSubmitting },
  } = useForm<UpdateForm>({
    resolver: zodResolver(updateSchema),
    defaultValues: { status: ticket.status, assigneeId: ticket.assignee_id ?? '' },
  });
  const selectedStatus = watch('status');

  const mutation = useMutation({
    mutationFn: (values: UpdateForm) =>
      apiFetch(`/api/v1/tickets/${ticket.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...values,
          assigneeId: values.assigneeId || undefined,
          minutesSpent: values.minutesSpent ? Number(values.minutesSpent) : undefined,
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tickets', ticket.id] });
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      reset({ status: ticket.status, assigneeId: ticket.assignee_id ?? '', note: '' });
      setServerError(null);
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'อัปเดต Ticket ไม่สำเร็จ'),
  });

  return (
    <Card>
      <CardHeader>อัปเดตงาน</CardHeader>
      <CardBody>
        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="grid grid-cols-1 gap-3 sm:grid-cols-2" noValidate>
          <div>
            <label htmlFor="upd-status" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              สถานะ
            </label>
            <select
              id="upd-status"
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
              {...register('status')}
            >
              {TICKET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="upd-assignee" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              ผู้รับผิดชอบ
            </label>
            <select
              id="upd-assignee"
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
              {...register('assigneeId')}
            >
              <option value="">— ไม่ระบุ —</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="upd-note" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              บันทึกเพิ่มเติม
            </label>
            <textarea
              id="upd-note"
              rows={2}
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
              {...register('note')}
            />
          </div>

          <div>
            <label htmlFor="upd-minutes" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              เวลาที่ใช้ (นาที)
            </label>
            <input
              id="upd-minutes"
              type="number"
              min={0}
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
              {...register('minutesSpent')}
            />
          </div>

          {(selectedStatus === 'เสร็จสิ้น' || selectedStatus === 'ปิดงาน') && (
            <div className="sm:col-span-2">
              <label htmlFor="upd-resolution" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                ผลการแก้ไข (จำเป็นก่อนปิดงาน)
              </label>
              <textarea
                id="upd-resolution"
                rows={2}
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
                {...register('resolution')}
              />
            </div>
          )}

          {selectedStatus === 'ส่งต่อ Outsource' && (
            <>
              <div>
                <label htmlFor="upd-outsource-name" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  ชื่อผู้ให้บริการภายนอก
                </label>
                <input
                  id="upd-outsource-name"
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
                  {...register('outsourceName')}
                />
              </div>
              <div>
                <label htmlFor="upd-outsource-issue" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  เลขแจ้งปัญหา (ถ้ามี)
                </label>
                <input
                  id="upd-outsource-issue"
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
                  {...register('outsourceIssueNo')}
                />
              </div>
            </>
          )}

          {selectedStatus === 'ยกเลิก' && (
            <p className="text-xs text-amber-600 sm:col-span-2">กรุณาระบุเหตุผลการยกเลิกในช่อง "บันทึกเพิ่มเติม" ด้านบน</p>
          )}

          {serverError && <p className="text-xs text-red-600 sm:col-span-2">{serverError}</p>}

          <div className="sm:col-span-2">
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              บันทึก
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function ReopenButton({ ticketId }: { ticketId: string }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [showInput, setShowInput] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/tickets/${ticketId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'กำลังดำเนินการ', note: reason }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tickets', ticketId] });
      setShowInput(false);
      setReason('');
    },
  });

  if (!showInput) {
    return (
      <Button size="sm" variant="outline" onClick={() => setShowInput(true)}>
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
        เปิดงานซ้ำ
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <input
        placeholder="เหตุผลการเปิดงานซ้ำ"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
      />
      <div className="flex gap-2">
        <Button size="sm" disabled={!reason.trim()} isLoading={mutation.isPending} onClick={() => mutation.mutate()}>
          ยืนยัน
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShowInput(false)}>
          ยกเลิก
        </Button>
      </div>
    </div>
  );
}

function EscalateIncidentPanel({ ticket }: { ticket: TicketDetail }) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<(typeof INCIDENT_CATEGORIES)[number]>(INCIDENT_CATEGORIES[0]);
  const [severity, setSeverity] = useState<(typeof INCIDENT_SEVERITIES)[number]>('ปานกลาง');
  const [containsPersonalData, setContainsPersonalData] = useState(false);
  const [notes, setNotes] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => apiFetch<Incident>(`/api/v1/incidents/from-ticket/${ticket.id}`, { method: 'POST', body: JSON.stringify({ category, severity, containsPersonalData, notes }) }),
    onSuccess: () => {
      setServerError(null);
      void queryClient.invalidateQueries({ queryKey: ['tickets', ticket.id] });
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      void queryClient.invalidateQueries({ queryKey: ['incidents'] });
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'ยกระดับเป็น Incident ไม่สำเร็จ'),
  });
  const fieldClass = 'w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900';
  return (
    <Card>
      <CardHeader>ยกระดับเป็น Incident</CardHeader>
      <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold">ประเภท Incident<select value={category} onChange={(e) => setCategory(e.target.value as typeof category)} className={`${fieldClass} mt-1`}>{INCIDENT_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="text-xs font-semibold">ความรุนแรง<select value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)} className={`${fieldClass} mt-1`}>{INCIDENT_SEVERITIES.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={containsPersonalData} onChange={(e) => setContainsPersonalData(e.target.checked)} /> เกี่ยวข้องกับข้อมูลส่วนบุคคล</label>
        <label className="text-xs font-semibold sm:col-span-2">หมายเหตุ<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${fieldClass} mt-1`} /></label>
        {serverError && <p className="text-sm text-red-600 sm:col-span-2">{serverError}</p>}
        <div className="sm:col-span-2"><Button size="sm" variant="danger" isLoading={mutation.isPending} onClick={() => mutation.mutate()} data-testid="ticket-escalate-incident-submit">ยืนยันการยกระดับและสร้าง Incident</Button></div>
      </CardBody>
    </Card>
  );
}

const feedbackSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  feedback: z.string().trim().optional(),
});

type FeedbackForm = z.infer<typeof feedbackSchema>;

function FeedbackPanel({ ticketId }: { ticketId: string }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<FeedbackForm>({ resolver: zodResolver(feedbackSchema), defaultValues: { rating: 5 } });

  const mutation = useMutation({
    mutationFn: (values: FeedbackForm) =>
      apiFetch(`/api/v1/tickets/${ticketId}/feedback`, { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['tickets', ticketId] }),
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'ส่งคะแนนไม่สำเร็จ'),
  });

  return (
    <Card>
      <CardHeader className="flex items-center gap-2">
        <Star className="h-4 w-4 text-amber-500" aria-hidden="true" />
        ให้คะแนนความพึงพอใจ
      </CardHeader>
      <CardBody>
        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="flex flex-col gap-3" noValidate>
          <select
            className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
            {...register('rating')}
          >
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {'⭐'.repeat(n)} ({n})
              </option>
            ))}
          </select>
          <textarea
            rows={2}
            placeholder="ความคิดเห็นเพิ่มเติม (ถ้ามี)"
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
            {...register('feedback')}
          />
          {serverError && <p className="text-xs text-red-600">{serverError}</p>}
          <Button type="submit" size="sm" isLoading={isSubmitting} className="w-fit">
            ส่งคะแนน
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

export function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { me, hasPermission } = useAuth();

  const ticketQuery = useQuery({
    queryKey: ['tickets', id],
    queryFn: () => apiFetch<TicketDetail>(`/api/v1/tickets/${id}`),
    enabled: !!id,
  });

  const staffQuery = useQuery({
    queryKey: ['tickets', 'assignable-staff'],
    queryFn: () => apiFetch<AssignableStaff[]>('/api/v1/tickets/assignable-staff'),
    enabled: hasPermission('ticket.update') || hasPermission('ticket.assign'),
  });

  if (ticketQuery.isLoading) {
    return (
      <div className="flex justify-center py-16" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
      </div>
    );
  }

  if (!ticketQuery.data) {
    return <p className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">ไม่พบ Ticket นี้ หรือท่านไม่มีสิทธิ์เข้าถึง</p>;
  }

  const ticket = ticketQuery.data;
  const canManage = hasPermission('ticket.update') || hasPermission('ticket.assign') || hasPermission('ticket.close');
  const canReopen = hasPermission('ticket.close') && (ticket.status === 'เสร็จสิ้น' || ticket.status === 'ปิดงาน');
  const canRate =
    ticket.requester_id === me?.profile.id &&
    (ticket.status === 'เสร็จสิ้น' || ticket.status === 'ปิดงาน') &&
    !ticket.rating;
  const canEscalate =
    hasPermission('incident.manage') &&
    hasPermission('ticket.update') &&
    !ticket.incident_id &&
    !['ปิดงาน', 'ยกเลิก', 'ยกระดับเป็น Incident'].includes(ticket.status);

  return (
    <div className="flex flex-col gap-4">
      <Link to="/tickets" className="flex w-fit items-center gap-1 text-sm text-primary-700 hover:underline dark:text-primary-300">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        กลับไปรายการ Ticket
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100">
            {ticket.title}
            {ticket.is_security && <AlertTriangle className="h-5 w-5 text-red-500" aria-label="Security" />}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant={statusTone[ticket.status]}>{ticket.status}</Badge>
            <Badge variant="secondary">{ticket.priority}</Badge>
          </div>
        </div>
        {canReopen && <ReopenButton ticketId={ticket.id} />}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader>รายละเอียด</CardHeader>
            <CardBody>
              <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{ticket.description}</p>
              {ticket.resolution && (
                <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">
                  <strong>ผลการแก้ไข:</strong> {ticket.resolution}
                </div>
              )}
            </CardBody>
          </Card>

          {canManage && <UpdateWorkPanel ticket={ticket} staff={staffQuery.data ?? []} />}
          {canEscalate && <EscalateIncidentPanel ticket={ticket} />}
          {ticket.incident_id && (
            <Card><CardHeader>Incident ที่เชื่อมโยง</CardHeader><CardBody><Link to={`/incidents/${ticket.incident_id}`} className="text-primary-700 hover:underline dark:text-primary-300">เปิด Incident จาก Ticket นี้</Link></CardBody></Card>
          )}
          {canRate && <FeedbackPanel ticketId={ticket.id} />}
          {ticket.rating && (
            <Card>
              <CardHeader>คะแนนความพึงพอใจ</CardHeader>
              <CardBody>
                <p className="text-amber-500">{'⭐'.repeat(ticket.rating)}</p>
                {ticket.feedback && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{ticket.feedback}</p>}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader>ประวัติการดำเนินงาน</CardHeader>
            <CardBody>
              <ol className="flex flex-col gap-3">
                {ticket.worklogs.map((w) => (
                  <li key={w.id} className="border-l-2 border-slate-200 pl-3 text-sm dark:border-slate-700">
                    <p className="font-semibold text-slate-800 dark:text-slate-200">
                      {w.action}
                      {w.status_from && w.status_to && w.status_from !== w.status_to && (
                        <span className="ml-1 font-normal text-slate-400">
                          ({w.status_from} → {w.status_to})
                        </span>
                      )}
                    </p>
                    {w.detail && <p className="text-slate-600 dark:text-slate-300">{w.detail}</p>}
                    <p className="text-xs text-slate-400">
                      {w.actor?.full_name ?? '—'} · {formatThaiDate(w.created_at, 'd MMM yyyy HH:mm')}
                      {w.minutes_spent ? ` · ${w.minutes_spent} นาที` : ''}
                    </p>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>ข้อมูล Ticket</CardHeader>
            <CardBody className="divide-y divide-slate-100 dark:divide-slate-700">
              <InfoRow label="ผู้แจ้ง" value={ticket.requester?.full_name} />
              <InfoRow label="ผู้รับผิดชอบ" value={ticket.assignee?.full_name ?? 'ยังไม่ได้มอบหมาย'} />
              <InfoRow label="หมวดหมู่" value={ticket.ticket_categories?.name} />
              <InfoRow label="สถานที่" value={ticket.location} />
              <InfoRow label="เบอร์ติดต่อ" value={ticket.requester_phone} />
              <InfoRow label="แจ้งเมื่อ" value={formatThaiDate(ticket.created_at, 'd MMM yyyy HH:mm')} />
              <InfoRow label="กำหนดตอบกลับ" value={ticket.response_due_at ? formatThaiDate(ticket.response_due_at, 'd MMM yyyy HH:mm') : null} />
              <InfoRow label="กำหนดแก้ไข" value={ticket.due_at ? formatThaiDate(ticket.due_at, 'd MMM yyyy HH:mm') : null} />
              {ticket.reopen_count > 0 && <InfoRow label="เปิดงานซ้ำ" value={`${ticket.reopen_count} ครั้ง`} />}
              {ticket.outsource_name && <InfoRow label="Outsource" value={`${ticket.outsource_name} (${ticket.outsource_issue_no ?? '-'})`} />}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
