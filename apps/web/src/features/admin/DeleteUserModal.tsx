import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmModal } from '../../components/ui/Modal';
import { ApiError, apiFetch } from '../../services/apiClient';

interface DeletionPreview {
  hasDependencies: boolean;
  dependencies: Array<{ table: string; column: string; count: number }>;
}

const dependencyLabels: Record<string, string> = {
  notifications: 'การแจ้งเตือน', tickets: 'ใบแจ้งงาน', ticket_worklogs: 'ประวัติใบแจ้งงาน',
  file_attachments: 'ไฟล์แนบ', tasks: 'งาน', task_items: 'รายการงาน',
  service_requests: 'คำขอบริการ', access_requests: 'คำขอสิทธิ์',
  approval_group_members: 'สมาชิกกลุ่มอนุมัติ', access_group_members: 'สมาชิกกลุ่มสิทธิ์',
  user_access_reviews: 'ประวัติทบทวนสิทธิ์',
};

export function DeleteUserModal({ userId, identity, onClose }: {
  userId: string; identity: string; onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [mode, setMode] = useState<'hard' | 'preserve-history'>('preserve-history');
  const preview = useQuery({
    queryKey: ['admin', 'users', userId, 'deletion-preview'],
    queryFn: () => apiFetch<DeletionPreview>(`/api/v1/users/${userId}/deletion-preview`),
    retry: false,
    staleTime: 0,
  });
  const mutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/users/${userId}`, {
      method: 'DELETE', body: JSON.stringify({ reason: reason.trim(), mode }),
    }),
    onSuccess: () => {
      onClose();
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'], predicate: (query) => !query.queryKey.includes('deletion-preview') });
    },
  });
  const error = mutation.error ?? preview.error;
  return (
    <ConfirmModal
      title={`ลบผู้ใช้งาน "${identity}"`}
      description="เลือกวิธีลบบัญชี ตรวจสอบผลกระทบ และยืนยันด้วยตัวเอง"
      tone="danger"
      confirmLabel="ยืนยันลบบัญชี"
      isPending={mutation.isPending}
      confirmDisabled={!preview.data || preview.isFetching || !confirmed || reason.trim().length < 3 || (mode === 'hard' && preview.data.hasDependencies)}
      onConfirm={() => mutation.mutate()}
      onClose={onClose}
    >
      <div className="space-y-4 text-sm">
        {preview.isFetching && <p role="status">กำลังตรวจสอบข้อมูลที่เกี่ยวข้อง...</p>}
        {preview.data && <>
          <p>{preview.data.hasDependencies ? 'พบข้อมูลที่อ้างอิงบัญชีนี้ การลบแบบเก็บประวัติจะคงข้อมูลเหล่านี้ไว้ทั้งหมด' : 'ไม่พบข้อมูลที่ขัดขวางการลบถาวร'}</p>
          {preview.data.dependencies.length > 0 && (
            <ul className="list-disc space-y-1 pl-5">
              {preview.data.dependencies.map((item) => (
                <li key={`${item.table}.${item.column}`}>
                  {dependencyLabels[item.table] ?? 'ข้อมูลอ้างอิงอื่น'}: {item.count.toLocaleString('th-TH')} รายการ
                </li>
              ))}
            </ul>
          )}
          <fieldset className="space-y-2">
            <legend className="mb-2 font-medium">วิธีลบบัญชี</legend>
            <label className="flex items-start gap-2">
              <input type="radio" name="user-delete-mode" value="preserve-history" checked={mode === 'preserve-history'} onChange={() => setMode('preserve-history')} disabled={mutation.isPending} />
              <span>ลบบัญชีเข้าใช้งานและเก็บประวัติ — เข้าระบบไม่ได้และหายจากรายชื่อผู้ใช้งาน โดยเก็บชื่อและข้อมูลอ้างอิงสำหรับประวัติงาน</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="user-delete-mode" value="hard" checked={mode === 'hard'} onChange={() => setMode('hard')} disabled={preview.data.hasDependencies || mutation.isPending} />
              <span>ลบถาวร — ใช้ได้เมื่อไม่มีข้อมูลอ้างอิงบัญชี</span>
            </label>
          </fieldset>
          <label className="block">
            <span>เหตุผลการลบ</span>
            <textarea className="mt-1 w-full rounded-md border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-900" value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={1000} disabled={mutation.isPending} placeholder="ระบุเหตุผลอย่างน้อย 3 ตัวอักษร" />
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={mutation.isPending} />
            <span>ฉันเข้าใจว่าบัญชีนี้จะเข้าสู่ระบบไม่ได้ และไม่สามารถกู้คืนบัญชีเดิมได้</span>
          </label>
        </>}
        {error && <p role="alert" className="text-red-600">{error instanceof ApiError ? error.message : 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่'}</p>}
        {preview.isError && <button type="button" onClick={() => void preview.refetch()} className="underline">ตรวจสอบอีกครั้ง</button>}
      </div>
    </ConfirmModal>
  );
}
