import { zodResolver } from '@hookform/resolvers/zod';
import { TICKET_RATING_CRITERIA } from '@itlife/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, FileText, Loader2, MessageSquare, Paperclip, RotateCcw, Send, Shield } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { useAuth } from '../../stores/authContext';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { AssignableStaff, TicketDetail, TicketStatus } from '../../types/tickets';
import type { ContractVendorRef } from '../../types/vendorsContracts';
import { INCIDENT_CATEGORIES, INCIDENT_SEVERITIES, type Incident } from '../../types/incidents';
import { formatThaiDate } from '../../utils/date';
import { TicketFeedbackPanel } from './TicketFeedbackPanel';
import { TicketSignaturePanel } from './TicketSignaturePanel';
import { canSubmitTicketFeedback } from './ticketFeedback';
import { LOCKED_TICKET_STATUSES, ticketStatusLabel, ticketStatusTone } from './ticketDisplay';

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
  outsourceVendorId: z.string().optional(),
  outsourceIssueNo: z.string().trim().optional(),
});

type UpdateForm = z.infer<typeof updateSchema>;

function UpdateWorkPanel({ ticket, staff, vendors, focusOnLoad = false }: { ticket: TicketDetail; staff: AssignableStaff[]; vendors: ContractVendorRef[]; focusOnLoad?: boolean }) {
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
    defaultValues: { status: ticket.status, assigneeId: ticket.assignee_id ?? '', outsourceVendorId: ticket.outsource_vendor_id ?? '', outsourceName: ticket.outsource_name ?? '' },
  });
  const selectedStatus = watch('status');

  useEffect(() => {
    if (!focusOnLoad) return;
    document.getElementById('ticket-work-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focusOnLoad]);

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
    <Card id="ticket-work-panel" data-testid="ticket-work-panel" className={focusOnLoad ? 'scroll-mt-4 ring-2 ring-primary-300 dark:ring-primary-700' : 'scroll-mt-4'}>
      <CardHeader>
        <p>ดำเนินการ / แก้ไข Ticket</p>
        <p className="mt-0.5 text-xs font-normal text-slate-500 dark:text-slate-400">อัปเดตผู้รับผิดชอบ สถานะ เวลา และผลการแก้ไขจากจุดนี้</p>
      </CardHeader>
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
                  {ticketStatusLabel[s]}
                </option>
              ))}
            </select>
            {selectedStatus === 'เสร็จสิ้น' && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">ซ่อมเสร็จแล้วและรอผู้แจ้งตรวจสอบ — ยังไม่เปิดแบบประเมิน</p>
            )}
            {selectedStatus === 'ปิดงาน' && (
              <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">ยืนยันจบ Ticket — ระบบจะเปิดแบบประเมินให้ผู้แจ้ง</p>
            )}
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
                <label htmlFor="upd-outsource-vendor" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">เลือกจากทะเบียน Vendor</label>
                <select id="upd-outsource-vendor" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('outsourceVendorId')}><option value="">— ระบุชื่อเอง —</option>{vendors.filter((vendor) => vendor.status === 'Active').map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.vendor_code} — {vendor.name}</option>)}</select>
              </div>
              <div>
                <label htmlFor="upd-outsource-name" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  ชื่อผู้ให้บริการภายนอก (กรณีไม่มีในทะเบียน)
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

function ConversationComposer({
  ticketId,
  canComment,
  canInternalNote,
  publicLocked,
}: {
  ticketId: string;
  canComment: boolean;
  canInternalNote: boolean;
  publicLocked: boolean;
}) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [internal, setInternal] = useState(!canComment && canInternalNote);
  const [serverError, setServerError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/tickets/${ticketId}/conversation`, {
      method: 'POST',
      body: JSON.stringify({ message, visibility: internal ? 'internal' : 'public' }),
    }),
    onSuccess: () => {
      setMessage('');
      setServerError(null);
      void queryClient.invalidateQueries({ queryKey: ['tickets', ticketId] });
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'ส่งข้อความไม่สำเร็จ'),
  });

  if (!canComment && !canInternalNote) return null;
  const selectedLocked = !internal && publicLocked;

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40">
      {canInternalNote && (
        <label className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={internal}
            onChange={(event) => setInternal(event.target.checked)}
            disabled={!canComment && canInternalNote}
          />
          <Shield className="h-3.5 w-3.5" />บันทึกภายใน (ผู้แจ้งจะไม่เห็น)
        </label>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
          {internal ? 'บันทึกสำหรับเจ้าหน้าที่' : 'ข้อความถึงผู้เกี่ยวข้อง'}
          <textarea
            aria-label={internal ? 'บันทึกภายใน' : 'ข้อความสนทนา'}
            rows={2}
            value={message}
            disabled={selectedLocked}
            onChange={(event) => setMessage(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
          />
        </label>
        <Button size="sm" disabled={!message.trim() || selectedLocked} isLoading={mutation.isPending} onClick={() => mutation.mutate()}>
          <Send className="h-4 w-4" />ส่ง
        </Button>
      </div>
      {selectedLocked && <p className="mt-2 text-xs text-amber-600">Ticket ที่ปิดหรือยกเลิกแล้วเพิ่มได้เฉพาะบันทึกภายใน</p>}
      {serverError && <p className="mt-2 text-xs text-red-600">{serverError}</p>}
    </div>
  );
}

export function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
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
  const vendorOptionsQuery = useQuery({ queryKey: ['vendors-contracts', 'vendor-options'], queryFn: () => apiFetch<ContractVendorRef[]>('/api/v1/vendors/options'), enabled: hasPermission('ticket.update') && hasPermission('vendor.view') });

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
  const canManage = hasPermission('ticket.update') || hasPermission('ticket.assign') || hasPermission('ticket.close') || hasPermission('ticket.triage');
  const canUpdateWork = canManage && !LOCKED_TICKET_STATUSES.includes(ticket.status);
  const canComment = hasPermission('ticket.comment');
  const canInternalNote = hasPermission('ticket.internal_note') && hasPermission('ticket.update');
  const canManageSignature = hasPermission('setting.manage');
  const canReopen = hasPermission('ticket.close') && (ticket.status === 'เสร็จสิ้น' || ticket.status === 'ปิดงาน');
  const canRate = canSubmitTicketFeedback(ticket, me?.profile.id);
  const canEscalate =
    hasPermission('incident.create') &&
    hasPermission('ticket.escalate') &&
    !ticket.incident_id &&
    !['ปิดงาน', 'ยกเลิก', 'ยกระดับเป็น Incident'].includes(ticket.status);
  const ratingBreakdown = ticket.rating_criteria_snapshot?.length
    ? ticket.rating_criteria_snapshot
    : TICKET_RATING_CRITERIA.flatMap((criterion) => {
      const score = ticket.rating_details?.[criterion.key];
      return score === undefined ? [] : [{ key: criterion.key, label: criterion.label, score }];
    });

  return (
    <div className="flex flex-col gap-4">
      <Link to="/tickets" className="flex w-fit items-center gap-1 text-sm text-primary-700 hover:underline dark:text-primary-300">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        กลับไปรายการ Ticket
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-slate-500 dark:text-slate-400">{ticket.ticket_no}</p>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100">
            {ticket.title}
            {ticket.is_security && <AlertTriangle className="h-5 w-5 text-red-500" aria-label="Security" />}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant={ticketStatusTone[ticket.status]}>{ticketStatusLabel[ticket.status]}</Badge>
            <Badge variant="secondary">{ticket.priority}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/tickets/${ticket.id}/form`} className="inline-flex min-h-[34px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-primary-700 hover:bg-primary-50 dark:border-slate-600 dark:bg-slate-800 dark:text-primary-300">
            <FileText className="h-4 w-4" aria-hidden="true" />ดูแบบฟอร์ม
          </Link>
          {canReopen && <ReopenButton ticketId={ticket.id} />}
        </div>
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

          {(ticket.attachments ?? []).length > 0 && (
            <Card>
              <CardHeader><span className="flex items-center gap-2"><Paperclip className="h-4 w-4" aria-hidden="true" />ไฟล์แนบ ({ticket.attachments.length})</span></CardHeader>
              <CardBody>
                <div className="grid gap-3 sm:grid-cols-2">
                  {ticket.attachments.map((attachment) => (
                    <a
                      key={attachment.id}
                      href={attachment.signed_url ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                      className={`overflow-hidden rounded-lg border border-slate-200 bg-white transition hover:border-primary-300 hover:bg-primary-50 dark:border-slate-700 dark:bg-slate-900 ${attachment.signed_url ? '' : 'pointer-events-none opacity-60'}`}
                    >
                      {attachment.mime_type.startsWith('image/') && attachment.signed_url && (
                        <img src={attachment.signed_url} alt={attachment.original_filename} className="h-36 w-full object-cover" />
                      )}
                      <div className="p-3">
                        <p className="truncate text-sm font-semibold text-primary-700 dark:text-primary-300">{attachment.original_filename}</p>
                        <p className="mt-1 text-xs text-slate-400">{(attachment.size_bytes / (1024 * 1024)).toFixed(1)} MB{attachment.uploader_label ? ` · ${attachment.uploader_label}` : ''}</p>
                      </div>
                    </a>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}

          {canUpdateWork && <UpdateWorkPanel ticket={ticket} staff={staffQuery.data ?? []} vendors={vendorOptionsQuery.data ?? []} focusOnLoad={searchParams.get('action') === 'edit'} />}
          {canEscalate && <EscalateIncidentPanel ticket={ticket} />}
          {ticket.incident_id && (
            <Card><CardHeader>Incident ที่เชื่อมโยง</CardHeader><CardBody><Link to={`/incidents/${ticket.incident_id}`} className="text-primary-700 hover:underline dark:text-primary-300">เปิด Incident จาก Ticket นี้</Link></CardBody></Card>
          )}
          {canRate && <TicketFeedbackPanel ticketId={ticket.id} />}
          {ticket.rating && (
            <Card>
              <CardHeader>ผลประเมินการบริการ</CardHeader>
              <CardBody>
                <p className="flex items-center gap-2 text-amber-500">
                  <span aria-label={`${ticket.rating} จาก 5 คะแนน`}>{'⭐'.repeat(ticket.rating)}</span>
                  <strong className="text-sm text-slate-700 dark:text-slate-200">คะแนนรวม {ticket.rating}/5</strong>
                </p>
                {ratingBreakdown.length > 0 && (
                  <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                    {ratingBreakdown.map((criterion) => (
                      <div key={criterion.key} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-900/50">
                        <dt className="text-slate-600 dark:text-slate-300">{criterion.label}</dt>
                        <dd className="font-extrabold text-amber-600">{criterion.score}/5</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {ticket.feedback && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{ticket.feedback}</p>}
                {ticket.feedback_at && <p className="mt-2 text-xs text-slate-400">ประเมินเมื่อ {formatThaiDate(ticket.feedback_at, 'd MMM yyyy HH:mm')}</p>}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader><span className="flex items-center gap-2"><MessageSquare className="h-4 w-4" />การสนทนาและประวัติการดำเนินงาน</span></CardHeader>
            <CardBody>
              <ConversationComposer
                ticketId={ticket.id}
                canComment={canComment}
                canInternalNote={canInternalNote}
                publicLocked={ticket.status === 'ปิดงาน' || ticket.status === 'ยกเลิก'}
              />
              <ol className="flex flex-col gap-3">
                {ticket.worklogs.map((w) => (
                  <li key={w.id} className={`border-l-2 pl-3 text-sm ${w.entry_type === 'internal_note' ? 'border-amber-400 bg-amber-50/60 py-2 pr-2 dark:bg-amber-900/10' : 'border-slate-200 dark:border-slate-700'}`}>
                    <p className="font-semibold text-slate-800 dark:text-slate-200">
                      {w.action}
                      {w.entry_type === 'internal_note' && <span className="ml-2"><Badge variant="warning">ภายใน</Badge></span>}
                      {w.status_from && w.status_to && w.status_from !== w.status_to && (
                        <span className="ml-1 font-normal text-slate-400">
                          ({ticketStatusLabel[w.status_from]} → {ticketStatusLabel[w.status_to]})
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
          <TicketSignaturePanel
            ticketId={ticket.id}
            signatureUrl={ticket.signature_url}
            signatureSource={ticket.signature_source}
            uploadedAt={ticket.signature_uploaded_at}
            canManage={canManageSignature}
          />
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>ข้อมูล Ticket</CardHeader>
            <CardBody className="divide-y divide-slate-100 dark:divide-slate-700">
              <InfoRow label="เลขที่ Ticket" value={ticket.ticket_no} />
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
