import { DataTable } from '../../components/table/DataTable';
import { RowActions } from '../../components/table/RowActions';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock3, Link2Off, Loader2, MessageCircle, RotateCcw, UsersRound } from 'lucide-react';
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
  employee_code: string | null;
  department: string | null;
  link_status: 'Pending' | 'Active' | 'Suspended' | 'Unlinked' | null;
  friend_status: string | null;
  last_login_at: string | null;
}

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'secondary'> = {
  Active: 'success', Pending: 'warning', Suspended: 'danger', Unlinked: 'secondary',
};
const STATUS_LABEL: Record<string, string> = { Active: 'อนุมัติแล้ว', Pending: 'รออนุมัติ', Suspended: 'ระงับ', Unlinked: 'ยกเลิกผูก' };

const FILTERS: Array<{ value: string; label: string }> = [
  { value: 'Pending', label: 'รออนุมัติ' }, { value: 'Active', label: 'อนุมัติแล้ว' },
  { value: 'Suspended', label: 'ระงับ' }, { value: '', label: 'ทั้งหมด' },
];

/** อนุมัติ/ระงับการผูกบัญชี LINE กับพนักงาน — เทียบเท่า "IT Admin ตรวจและอนุมัติจากหลังบ้าน" ของระบบเดิม */
export function LineLinksPage() {
  const [status, setStatus] = useState('Pending');
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
      <PageTitle eyebrow="บุคลากรและสิทธิ์ / บัญชี LINE ที่ผูก" title="บัญชี LINE ที่ผูกกับพนักงาน" description="ตรวจและอนุมัติการผูกบัญชี LINE กับทะเบียนผู้ใช้ ก่อนให้สิทธิ์แจ้งซ่อมผ่านพอร์ทัลสาธารณะ" />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard icon={<UsersRound className="h-5 w-5" />} label={`รายการสถานะ ${FILTERS.find((filter) => filter.value === status)?.label ?? 'ทั้งหมด'}`} value={linksQuery.data?.length ?? 0} tone="primary" />
        <StatCard icon={<Clock3 className="h-5 w-5" />} label="รออนุมัติ (ผลลัพธ์นี้)" value={linksQuery.data?.filter((row) => row.link_status === 'Pending').length ?? 0} tone="amber" />
        <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="อนุมัติแล้ว (ผลลัพธ์นี้)" value={linksQuery.data?.filter((row) => row.link_status === 'Active').length ?? 0} tone="teal" />
        <StatCard icon={<Link2Off className="h-5 w-5" />} label="ระงับ/ยกเลิก (ผลลัพธ์นี้)" value={linksQuery.data?.filter((row) => row.link_status === 'Suspended' || row.link_status === 'Unlinked').length ?? 0} tone="gray" />
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
                    <th className="px-2 py-2">รหัสพนักงาน</th>
                    <th className="px-2 py-2">หน่วยงาน</th>
                    <th className="px-2 py-2">สถานะ</th>
                    <th className="px-2 py-2 text-right">ดำเนินการ</th>
                  </tr>
                </thead>
                <tbody>
                  {linksQuery.data.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="px-2 py-2 font-medium text-slate-800 dark:text-slate-200">{row.full_name ?? row.display_name ?? '-'}</td>
                      <td className="px-2 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">{row.employee_code ?? '-'}</td>
                      <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{row.department ?? '-'}</td>
                      <td className="px-2 py-2">
                        <Badge variant={row.link_status ? STATUS_VARIANT[row.link_status] : 'secondary'}>
                          {row.link_status ? STATUS_LABEL[row.link_status] : '-'}
                        </Badge>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <RowActions
                          recordLabel={row.full_name ?? row.display_name ?? row.employee_code ?? 'บัญชี LINE'}
                          actions={[
                            { kind: 'custom', icon: CheckCircle2, label: 'อนุมัติ', hidden: row.link_status !== 'Pending', onClick: () => updateMutation.mutate({ id: row.id, nextStatus: 'Active' }) },
                            { kind: 'custom', icon: RotateCcw, label: 'ยกเลิกระงับ', hidden: row.link_status !== 'Suspended', onClick: () => updateMutation.mutate({ id: row.id, nextStatus: 'Active' }) },
                            { kind: 'cancel', label: 'ระงับ', hidden: row.link_status === 'Suspended', confirmDescription: 'บัญชี LINE นี้จะใช้แจ้งงานผ่าน LINE ไม่ได้จนกว่าจะยกเลิกระงับ ข้อมูลการเชื่อมโยงยังอยู่ครบ', onConfirm: () => updateMutation.mutate({ id: row.id, nextStatus: 'Suspended' }) },
                          ]}
                        />
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
