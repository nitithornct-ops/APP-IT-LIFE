import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import type { AccessRequestDetail, AccessRequestStatus } from '../../types/accessRequests';
import { formatThaiDate } from '../../utils/date';

const statusTone: Record<AccessRequestStatus, 'warning' | 'info' | 'success' | 'danger'> = {
  รออนุมัติจากหัวหน้างาน: 'warning',
  รอส่วนงานไอทีดำเนินการ: 'info',
  เสร็จสิ้น: 'success',
  ปฏิเสธ: 'danger',
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
      apiFetch(`/api/v1/access-requests/${requestId}/approve`, { method: 'POST', body: JSON.stringify({ approved, comment }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['access-requests', requestId] });
      setServerError(null);
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'ดำเนินการไม่สำเร็จ'),
  });

  return (
    <Card>
      <CardHeader>พิจารณาอนุมัติคำขอ (หัวหน้างาน)</CardHeader>
      <CardBody className="flex flex-col gap-3">
        <textarea
          rows={2}
          placeholder="ความเห็น (ถ้ามี)"
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

function ProcessPanel({ requestId }: { requestId: string }) {
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (success: boolean) =>
      apiFetch(`/api/v1/access-requests/${requestId}/process`, { method: 'POST', body: JSON.stringify({ success, comment }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['access-requests', requestId] });
      setServerError(null);
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'ดำเนินการไม่สำเร็จ'),
  });

  return (
    <Card>
      <CardHeader>ดำเนินการให้สิทธิ์จริง (IT)</CardHeader>
      <CardBody className="flex flex-col gap-3">
        <textarea
          rows={2}
          placeholder="บันทึกผลการดำเนินการ"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
        />
        {serverError && <p className="text-xs text-red-600">{serverError}</p>}
        <div className="flex gap-2">
          <Button size="sm" isLoading={mutation.isPending} onClick={() => mutation.mutate(true)}>
            ดำเนินการสำเร็จ
          </Button>
          <Button size="sm" variant="outline" isLoading={mutation.isPending} onClick={() => mutation.mutate(false)}>
            ไม่สำเร็จ
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export function AccessRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { me, hasPermission } = useAuth();

  const requestQuery = useQuery({
    queryKey: ['access-requests', id],
    queryFn: () => apiFetch<AccessRequestDetail>(`/api/v1/access-requests/${id}`),
    enabled: !!id,
  });

  if (requestQuery.isLoading) {
    return (
      <div className="flex justify-center py-16" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
      </div>
    );
  }

  if (!requestQuery.data) {
    return <p className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">ไม่พบคำขอสิทธิ์นี้ หรือท่านไม่มีสิทธิ์เข้าถึง</p>;
  }

  const request = requestQuery.data;
  const isRequester = request.requester_id === me?.profile.id;
  const canApprove = request.status === 'รออนุมัติจากหัวหน้างาน' && !isRequester && (request.approver_id === me?.profile.id || hasPermission('access_request.approve'));
  const canProcess = request.status === 'รอส่วนงานไอทีดำเนินการ' && hasPermission('access_request.process') && request.approved_by !== me?.profile.id;

  return (
    <div className="flex flex-col gap-4">
      <Link to="/access-requests" className="flex w-fit items-center gap-1 text-sm text-primary-700 hover:underline dark:text-primary-300">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        กลับไปรายการคำขอสิทธิ์
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">
            {request.access_systems?.name} — {request.access_level}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant={statusTone[request.status]}>{request.status}</Badge>
            <Badge variant="secondary">{request.request_type}</Badge>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader>เหตุผล</CardHeader>
            <CardBody>
              <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{request.reason}</p>
              {request.approval_comment && (
                <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-900/40 dark:text-slate-200">
                  <strong>ความเห็นผู้อนุมัติ:</strong> {request.approval_comment}
                </div>
              )}
              {request.it_comment && (
                <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">
                  <strong>บันทึกจากไอที:</strong> {request.it_comment}
                </div>
              )}
            </CardBody>
          </Card>

          {canApprove && <ApprovalPanel requestId={request.id} />}
          {canProcess && <ProcessPanel requestId={request.id} />}
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>ข้อมูลคำขอ</CardHeader>
            <CardBody className="divide-y divide-slate-100 dark:divide-slate-700">
              <InfoRow label="ผู้ขอ" value={request.requester?.full_name} />
              <InfoRow label="หัวหน้างาน (ผู้อนุมัติ)" value={request.approver?.full_name} />
              <InfoRow label="ผลการอนุมัติ" value={request.approved === null ? null : request.approved ? 'อนุมัติ' : 'ปฏิเสธ'} />
              <InfoRow label="อนุมัติเมื่อ" value={request.approved_at ? formatThaiDate(request.approved_at, 'd MMM yyyy HH:mm') : null} />
              <InfoRow label="เจ้าหน้าที่ไอที" value={request.it_handler?.full_name} />
              <InfoRow label="ดำเนินการเมื่อ" value={request.it_action_at ? formatThaiDate(request.it_action_at, 'd MMM yyyy HH:mm') : null} />
              <InfoRow label="รอบทบทวนถัดไป" value={request.review_due ? formatThaiDate(request.review_due, 'd MMM yyyy') : null} />
              <InfoRow label="ยื่นเมื่อ" value={formatThaiDate(request.created_at, 'd MMM yyyy HH:mm')} />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
