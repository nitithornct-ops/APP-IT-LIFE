import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
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
      <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">บัญชี LINE ที่ผูกกับพนักงาน</h1>
      <p className="-mt-2 text-sm text-slate-500 dark:text-slate-400">
        ตรวจและอนุมัติการผูกบัญชี LINE กับทะเบียนผู้ใช้ ก่อนให้สิทธิ์แจ้งซ่อมผ่านพอร์ทัลสาธารณะ
      </p>

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
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-2 py-2">ชื่อ LINE</th>
                    <th className="px-2 py-2">รหัสพนักงาน</th>
                    <th className="px-2 py-2">หน่วยงาน</th>
                    <th className="px-2 py-2">สถานะ</th>
                    <th className="px-2 py-2" />
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
                        <div className="flex justify-end gap-2 text-xs">
                          {row.link_status === 'Pending' && (
                            <button type="button" onClick={() => updateMutation.mutate({ id: row.id, nextStatus: 'Active' })} className="text-green-700 hover:underline dark:text-green-400">
                              อนุมัติ
                            </button>
                          )}
                          {row.link_status !== 'Suspended' && (
                            <button type="button" onClick={() => updateMutation.mutate({ id: row.id, nextStatus: 'Suspended' })} className="text-red-700 hover:underline dark:text-red-400">
                              ระงับ
                            </button>
                          )}
                          {row.link_status === 'Suspended' && (
                            <button type="button" onClick={() => updateMutation.mutate({ id: row.id, nextStatus: 'Active' })} className="text-green-700 hover:underline dark:text-green-400">
                              ยกเลิกระงับ
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
