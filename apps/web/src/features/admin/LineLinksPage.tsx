import { DataTable } from '../../components/table/DataTable';
import { RowActions } from '../../components/table/RowActions';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, MessageCircle, RotateCcw, ShieldBan, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageTitle } from '../../components/ui/PageTitle';
import { apiFetch } from '../../services/apiClient';

interface LineUserRow {
  id: string;
  display_name: string | null;
  full_name: string | null;
  link_status: 'Pending' | 'Active' | 'Suspended' | 'Unlinked' | null;
  friend_status: string | null;
  last_login_at: string | null;
}

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'secondary'> = {
  Active: 'success', Pending: 'success', Suspended: 'danger', Unlinked: 'success',
};
const STATUS_LABEL: Record<string, string> = { Active: 'พร้อมใช้งาน', Pending: 'พร้อมใช้งาน', Suspended: 'ระงับ', Unlinked: 'พร้อมใช้งาน' };

const FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'ทั้งหมด' }, { value: 'Active', label: 'พร้อมใช้งาน' }, { value: 'Suspended', label: 'ระงับ' },
];

/** ดูและระงับบัญชี LINE ที่เข้าใช้ Service Portal โดยไม่ผูกกับทะเบียนพนักงาน */
export function LineLinksPage() {
  const [status, setStatus] = useState('');
  const queryClient = useQueryClient();

  const linksQuery = useQuery({
    queryKey: ['admin', 'line-links', status],
    queryFn: () => apiFetch<LineUserRow[]>(`/api/v1/line/admin/links${status ? `?status=${status}` : ''}`),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, nextStatus }: { id: string; nextStatus: string }) =>
      apiFetch(`/api/v1/line/admin/links/${id}/status`, { method: 'POST', body: JSON.stringify({ status: nextStatus }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'line-links'] }),
  });

  return (
    <div className="flex flex-col gap-4">
      <PageTitle eyebrow="บุคลากรและสิทธิ์ / บัญชี LINE" title="บัญชี LINE ที่ใช้แจ้งซ่อม" description="บัญชี LINE ใช้งาน Service Portal ได้ทันทีโดยไม่ต้องผูกรหัสพนักงาน หน้านี้ใช้สำหรับตรวจสอบและระงับบัญชีเท่านั้น" />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        <StatCard icon={<UsersRound className="h-5 w-5" />} label={`รายการสถานะ ${FILTERS.find((filter) => filter.value === status)?.label ?? 'ทั้งหมด'}`} value={linksQuery.data?.length ?? 0} tone="primary" />
        <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="พร้อมใช้งาน (ผลลัพธ์นี้)" value={linksQuery.data?.filter((row) => row.link_status !== 'Suspended').length ?? 0} tone="teal" />
        <StatCard icon={<ShieldBan className="h-5 w-5" />} label="ระงับ (ผลลัพธ์นี้)" value={linksQuery.data?.filter((row) => row.link_status === 'Suspended').length ?? 0} tone="gray" />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center gap-2">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setStatus(filter.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                status === filter.value ? 'bg-primary-700 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </CardHeader>
        <CardBody>
          {linksQuery.isLoading && (
            <div className="flex justify-center py-8" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
            </div>
          )}

          {linksQuery.data && linksQuery.data.length === 0 && (
            <EmptyState icon={<MessageCircle className="h-10 w-10" aria-hidden="true" />} title="ไม่มีรายการในสถานะนี้" />
          )}

          {linksQuery.data && linksQuery.data.length > 0 && (
            <div className="overflow-x-auto">
              <DataTable className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-2 py-2">ชื่อ LINE</th>
                    <th className="px-2 py-2">สถานะเพื่อน LINE OA</th>
                    <th className="px-2 py-2">เข้าใช้ล่าสุด</th>
                    <th className="px-2 py-2">สถานะ</th>
                    <th className="px-2 py-2 text-right">ดำเนินการ</th>
                  </tr>
                </thead>
                <tbody>
                  {linksQuery.data.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="px-2 py-2 font-medium text-slate-800 dark:text-slate-200">{row.full_name ?? row.display_name ?? '-'}</td>
                      <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{row.friend_status ?? '-'}</td>
                      <td className="px-2 py-2 text-xs text-slate-500 dark:text-slate-400">{row.last_login_at ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(row.last_login_at)) : '-'}</td>
                      <td className="px-2 py-2">
                        <Badge variant={row.link_status ? STATUS_VARIANT[row.link_status] : 'secondary'}>
                          {row.link_status ? STATUS_LABEL[row.link_status] : '-'}
                        </Badge>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <RowActions
                            recordLabel={row.full_name ?? row.display_name ?? 'บัญชี LINE'}
                            actions={[
                              { kind: 'custom', icon: RotateCcw, label: 'ยกเลิกระงับ', hidden: row.link_status !== 'Suspended', onClick: () => updateMutation.mutate({ id: row.id, nextStatus: 'Active' }) },
                              { kind: 'cancel', label: 'ระงับ', hidden: row.link_status === 'Suspended', confirmDescription: 'บัญชี LINE นี้จะใช้แจ้งงานผ่าน LINE ไม่ได้จนกว่าจะยกเลิกระงับ', onConfirm: () => updateMutation.mutate({ id: row.id, nextStatus: 'Suspended' }) },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
