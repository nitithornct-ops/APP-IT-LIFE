import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Paperclip, Upload } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import type { AssignableStaff } from '../../types/tickets';
import type { ServiceRequestDetail, ServiceRequestStatus, ServiceRequestTaskStatus } from '../../types/serviceRequests';
import { formatThaiDate } from '../../utils/date';

const REQUEST_STATUSES: ServiceRequestStatus[] = [
  'รอมอบหมาย',
  'กำลังดำเนินการ',
  'รอผู้ใช้งาน',
  'รอผู้ให้บริการ',
  'รอยืนยันผล',
  'ปิดงาน',
  'ยกเลิก',
];

const TASK_STATUSES: ServiceRequestTaskStatus[] = ['รอดำเนินการ', 'กำลังดำเนินการ', 'เสร็จสิ้น', 'ข้าม'];

const statusTone: Record<ServiceRequestStatus, 'secondary' | 'info' | 'warning' | 'success' | 'danger' | 'primary'> = {
  รออนุมัติ: 'warning',
  รอมอบหมาย: 'info',
  กำลังดำเนินการ: 'primary',
  รอผู้ใช้งาน: 'warning',
  รอผู้ให้บริการ: 'warning',
  รอยืนยันผล: 'warning',
  ปิดงาน: 'success',
  ปฏิเสธ: 'danger',
  ยกเลิก: 'secondary',
};

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-right font-medium text-slate-800 dark:text-slate-200">{value ?? '—'}</span>
    </div>
  );
}

function ApprovalPanel({ requestId }: { requestId: string }) {
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (approved: boolean) =>
      apiFetch(`/api/v1/service-requests/${requestId}/approve`, { method: 'POST', body: JSON.stringify({ approved, comment }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['service-requests', requestId] });
      setServerError(null);
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'ดำเนินการไม่สำเร็จ'),
  });

  return (
    <Card>
      <CardHeader>พิจารณาอนุมัติคำขอ</CardHeader>
      <CardBody className="flex flex-col gap-3">
        <textarea
          rows={2}
          placeholder="ความเห็น (จำเป็นเมื่อปฏิเสธ)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
        />
        {serverError && <p className="text-xs text-red-600">{serverError}</p>}
        <div className="flex gap-2">
          <Button size="sm" isLoading={mutation.isPending} onClick={() => mutation.mutate(true)}>
            อนุมัติ
          </Button>
          <Button size="sm" variant="outline" isLoading={mutation.isPending} onClick={() => mutation.mutate(false)}>
            ปฏิเสธ
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function UpdateWorkPanel({ request, staff }: { request: ServiceRequestDetail; staff: AssignableStaff[] }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ServiceRequestStatus>(request.status === 'รออนุมัติ' ? 'รอมอบหมาย' : request.status);
  const [assigneeId, setAssigneeId] = useState(request.assignee_id ?? '');
  const [note, setNote] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/service-requests/${request.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          assigneeId: assigneeId || undefined,
          note: note || undefined,
          fulfillmentNotes: note || undefined,
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['service-requests', request.id] });
      setNote('');
      setServerError(null);
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'อัปเดตคำขอไม่สำเร็จ'),
  });

  const finalizing = status === 'รอยืนยันผล' || status === 'ปิดงาน';

  return (
    <Card>
      <CardHeader>อัปเดตงาน</CardHeader>
      <CardBody>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="sr-upd-status" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              สถานะ
            </label>
            <select
              id="sr-upd-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as ServiceRequestStatus)}
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
            >
              {REQUEST_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="sr-upd-assignee" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              ผู้รับผิดชอบ
            </label>
            <select
              id="sr-upd-assignee"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
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
            <label htmlFor="sr-upd-note" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              {finalizing ? 'ผลการดำเนินการ (จำเป็นก่อนส่งมอบ/ปิดงาน)' : 'บันทึกเพิ่มเติม'}
            </label>
            <textarea
              id="sr-upd-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
            />
          </div>

          {status === 'ยกเลิก' && (
            <p className="text-xs text-amber-600 sm:col-span-2">กรุณาระบุเหตุผลการยกเลิกในช่อง "บันทึกเพิ่มเติม" ด้านบน</p>
          )}

          {serverError && <p className="text-xs text-red-600 sm:col-span-2">{serverError}</p>}

          <div className="sm:col-span-2">
            <Button size="sm" isLoading={mutation.isPending} onClick={() => mutation.mutate()}>
              บันทึก
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function ConfirmPanel({ requestId }: { requestId: string }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (accept: boolean) =>
      apiFetch(`/api/v1/service-requests/${requestId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: accept ? 'ปิดงาน' : 'กำลังดำเนินการ', note: note || undefined }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['service-requests', requestId] });
      setServerError(null);
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'ดำเนินการไม่สำเร็จ'),
  });

  return (
    <Card>
      <CardHeader>ยืนยันผลการดำเนินงาน</CardHeader>
      <CardBody className="flex flex-col gap-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">โปรดตรวจสอบผลการดำเนินการ แล้วยืนยัน หรือส่งกลับให้แก้ไขเพิ่มเติม</p>
        <textarea
          rows={2}
          placeholder="สิ่งที่ต้องการให้แก้ไขเพิ่มเติม (จำเป็นเมื่อส่งกลับ)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
        />
        {serverError && <p className="text-xs text-red-600">{serverError}</p>}
        <div className="flex gap-2">
          <Button size="sm" isLoading={mutation.isPending} onClick={() => mutation.mutate(true)}>
            ยืนยันและปิดงาน
          </Button>
          <Button size="sm" variant="outline" isLoading={mutation.isPending} onClick={() => mutation.mutate(false)}>
            ส่งกลับแก้ไข
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function CancelButton({ requestId }: { requestId: string }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [showInput, setShowInput] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/service-requests/${requestId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'ยกเลิก', cancelReason: reason }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['service-requests', requestId] });
      setShowInput(false);
      setReason('');
    },
  });

  if (!showInput) {
    return (
      <Button size="sm" variant="outline" onClick={() => setShowInput(true)}>
        ยกเลิกคำขอ
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <input
        placeholder="เหตุผลการยกเลิก"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
      />
      <div className="flex gap-2">
        <Button size="sm" disabled={!reason.trim()} isLoading={mutation.isPending} onClick={() => mutation.mutate()}>
          ยืนยันยกเลิก
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShowInput(false)}>
          ปิด
        </Button>
      </div>
    </div>
  );
}

function TasksPanel({ request, canManage }: { request: ServiceRequestDetail; canManage: boolean }) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: ServiceRequestTaskStatus }) =>
      apiFetch(`/api/v1/service-requests/${request.id}/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['service-requests', request.id] }),
  });

  if (!request.tasks.length) return null;

  return (
    <Card>
      <CardHeader>Checklist</CardHeader>
      <CardBody>
        <ul className="flex flex-col gap-2">
          {request.tasks.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
              <span>
                {t.task_name}
                {t.is_required && <span className="ml-1 text-xs text-red-500">*</span>}
              </span>
              {canManage ? (
                <select
                  value={t.status}
                  onChange={(e) => mutation.mutate({ taskId: t.id, status: e.target.value as ServiceRequestTaskStatus })}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900"
                >
                  {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              ) : (
                <Badge variant={t.status === 'เสร็จสิ้น' ? 'success' : 'secondary'}>{t.status}</Badge>
              )}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function AttachmentsPanel({ request, canUpload }: { request: ServiceRequestDetail; canUpload: boolean }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new ApiError('FILE_REQUIRED', 'กรุณาเลือกไฟล์');
      if (file.size > 10 * 1024 * 1024) throw new ApiError('FILE_TOO_LARGE', 'ไฟล์ต้องมีขนาดไม่เกิน 10 MB');
      const data = new FormData();
      data.append('file', file);
      data.append('module', 'service_request');
      data.append('targetTable', 'service_requests');
      data.append('targetId', request.id);
      return apiFetch('/api/v1/files', { method: 'POST', body: data });
    },
    onSuccess: () => {
      setFile(null);
      setServerError(null);
      void queryClient.invalidateQueries({ queryKey: ['service-requests', request.id] });
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'อัปโหลดไฟล์ไม่สำเร็จ'),
  });

  return (
    <Card>
      <CardHeader><span className="flex items-center gap-2"><Paperclip className="h-4 w-4" />ไฟล์แนบ ({request.attachments?.length ?? 0})</span></CardHeader>
      <CardBody className="space-y-3">
        {(request.attachments ?? []).length > 0 ? (
          <ul className="space-y-2">
            {request.attachments.map((attachment) => (
              <li key={attachment.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-800 dark:text-slate-200">{attachment.original_filename}</p>
                  <p className="text-xs text-slate-400">{Math.ceil(attachment.size_bytes / 1024).toLocaleString()} KB · {formatThaiDate(attachment.created_at, 'd MMM yyyy HH:mm')}</p>
                </div>
                {attachment.signed_url && <a className="shrink-0 text-primary-700 hover:underline dark:text-primary-300" href={attachment.signed_url} target="_blank" rel="noreferrer">เปิดไฟล์</a>}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-500">ยังไม่มีไฟล์แนบ</p>}

        {canUpload && (
          <div className="flex flex-col gap-2 border-t border-slate-100 pt-3 dark:border-slate-700 sm:flex-row sm:items-center">
            <input
              aria-label="เลือกไฟล์แนบคำขอบริการ"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,.txt"
              className="min-w-0 flex-1 text-sm"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <Button size="sm" disabled={!file} isLoading={mutation.isPending} onClick={() => mutation.mutate()}>
              <Upload className="h-4 w-4" />อัปโหลด
            </Button>
          </div>
        )}
        {serverError && <p className="text-xs text-red-600">{serverError}</p>}
      </CardBody>
    </Card>
  );
}

export function ServiceRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { me, hasPermission } = useAuth();

  const requestQuery = useQuery({
    queryKey: ['service-requests', id],
    queryFn: () => apiFetch<ServiceRequestDetail>(`/api/v1/service-requests/${id}`),
    enabled: !!id,
  });

  const staffQuery = useQuery({
    queryKey: ['service-requests', 'assignable-staff'],
    queryFn: () => apiFetch<AssignableStaff[]>('/api/v1/service-requests/assignable-staff'),
    enabled: hasPermission('service_request.update') || hasPermission('service_request.assign'),
  });

  if (requestQuery.isLoading) {
    return (
      <div className="flex justify-center py-16" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
      </div>
    );
  }

  if (!requestQuery.data) {
    return <p className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">ไม่พบคำขอบริการนี้ หรือท่านไม่มีสิทธิ์เข้าถึง</p>;
  }

  const request = requestQuery.data;
  const isRequester = request.requester_id === me?.profile.id;
  const canManage = hasPermission('service_request.update') || hasPermission('service_request.assign') || hasPermission('service_request.close');
  const canApprove = request.status === 'รออนุมัติ' && !isRequester;
  const canConfirm = request.status === 'รอยืนยันผล' && isRequester;
  const nonTerminal = !['ปิดงาน', 'ปฏิเสธ', 'ยกเลิก'].includes(request.status);
  const canCancel = nonTerminal && request.status !== 'รอยืนยันผล' && (isRequester || canManage);

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/service-requests"
        className="flex w-fit items-center gap-1 text-sm text-primary-700 hover:underline dark:text-primary-300"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        กลับไปรายการคำขอบริการ
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{request.service_name}</h1>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant={statusTone[request.status]}>{request.status}</Badge>
            <Badge variant="secondary">{request.priority}</Badge>
          </div>
        </div>
        {canCancel && <CancelButton requestId={request.id} />}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader>รายละเอียด</CardHeader>
            <CardBody>
              <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{request.summary}</p>
              {request.business_justification && (
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{request.business_justification}</p>
              )}
              {request.fulfillment_notes && (
                <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">
                  <strong>ผลการดำเนินการ:</strong> {request.fulfillment_notes}
                </div>
              )}
              {request.cancel_reason && (
                <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-200">
                  <strong>เหตุผลการยกเลิก:</strong> {request.cancel_reason}
                </div>
              )}
            </CardBody>
          </Card>

          {canApprove && <ApprovalPanel requestId={request.id} />}
          {canManage && <UpdateWorkPanel request={request} staff={staffQuery.data ?? []} />}
          {canConfirm && <ConfirmPanel requestId={request.id} />}
          <TasksPanel request={request} canManage={canManage} />
          <AttachmentsPanel request={request} canUpload={nonTerminal} />

          <Card>
            <CardHeader>ประวัติการดำเนินงาน</CardHeader>
            <CardBody>
              <ol className="flex flex-col gap-3">
                {request.history.map((h) => (
                  <li key={h.id} className="border-l-2 border-slate-200 pl-3 text-sm dark:border-slate-700">
                    <p className="font-semibold text-slate-800 dark:text-slate-200">
                      {h.action}
                      {h.status_from && h.status_to && h.status_from !== h.status_to && (
                        <span className="ml-1 font-normal text-slate-400">
                          ({h.status_from} → {h.status_to})
                        </span>
                      )}
                    </p>
                    {h.comment && <p className="text-slate-600 dark:text-slate-300">{h.comment}</p>}
                    <p className="text-xs text-slate-400">
                      {h.actor?.full_name ?? '—'} · {formatThaiDate(h.created_at, 'd MMM yyyy HH:mm')}
                    </p>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>ข้อมูลคำขอ</CardHeader>
            <CardBody className="divide-y divide-slate-100 dark:divide-slate-700">
              <InfoRow label="ผู้ขอ" value={request.requester?.full_name} />
              <InfoRow label="ขอให้" value={request.requested_for} />
              <InfoRow label="ผู้รับผิดชอบ" value={request.assignee?.full_name ?? 'ยังไม่ได้มอบหมาย'} />
              <InfoRow label="กลุ่มอนุมัติ" value={request.approval_group?.name} />
              <InfoRow label="ยื่นเมื่อ" value={formatThaiDate(request.created_at, 'd MMM yyyy HH:mm')} />
              <InfoRow label="ครบกำหนด" value={request.due_at ? formatThaiDate(request.due_at, 'd MMM yyyy HH:mm') : null} />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
