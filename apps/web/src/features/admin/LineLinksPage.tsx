import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Loader2, MessageCircle, RotateCcw, ShieldBan, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { DataTable } from '../../components/table/DataTable';
import { RowActions } from '../../components/table/RowActions';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageTitle } from '../../components/ui/PageTitle';
import { apiFetch } from '../../services/apiClient';

interface LineUserRow {
  id: string;
  display_name: string | null;
  full_name: string | null;
  linked_user_id: string | null;
  link_status: 'Pending' | 'Active' | 'Suspended' | 'Unlinked' | null;
  friend_status: string | null;
  last_login_at: string | null;
}

interface LinkOption {
  id: string;
  employee_code: string | null;
  full_name: string | null;
  email: string | null;
  status: string;
  linked_line_user_id: string | null;
}

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'secondary'> = {
  Active: 'success', Pending: 'warning', Suspended: 'danger', Unlinked: 'secondary',
};
const STATUS_LABEL: Record<string, string> = {
  Active: 'พร้อมใช้งาน', Pending: 'รอตรวจสอบ', Suspended: 'ระงับ', Unlinked: 'ยังไม่เชื่อม',
};
const FILTERS = [
  { value: '', label: 'ทั้งหมด' },
  { value: 'Active', label: 'พร้อมใช้งาน' },
  { value: 'Suspended', label: 'ระงับ' },
];
const selectClass = 'h-10 min-w-64 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 shadow-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-primary-900/40';

function optionLabel(option: LinkOption) {
  return [option.employee_code, option.full_name, option.email].filter(Boolean).join(' · ') || option.id;
}

/** เชื่อมบัญชี LINE กับผู้ใช้ระบบแบบหนึ่งต่อหนึ่ง เพื่อให้การแจ้งเตือนไปยังบุคคลที่ถูกต้อง */
export function LineLinksPage() {
  const [status, setStatus] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();

  const linksQuery = useQuery({
    queryKey: ['admin', 'line-links', status],
    queryFn: () => apiFetch<LineUserRow[]>(`/api/v1/line/admin/links${status ? `?status=${status}` : ''}`),
  });
  const optionsQuery = useQuery({
    queryKey: ['admin', 'line-link-options'],
    queryFn: () => apiFetch<LinkOption[]>('/api/v1/line/admin/link-options'),
  });
  const updateStatusMutation = useMutation({
    mutationFn: ({ id, nextStatus }: { id: string; nextStatus: string }) =>
      apiFetch(`/api/v1/line/admin/links/${id}/status`, { method: 'POST', body: JSON.stringify({ status: nextStatus }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'line-links'] }),
  });
  const updateLinkMutation = useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string | null }) =>
      apiFetch(`/api/v1/line/admin/links/${id}/link`, { method: 'PATCH', body: JSON.stringify({ userId }) }),
    onSuccess: (_data, variables) => {
      setSelectedUserIds((current) => {
        const next = { ...current };
        delete next[variables.id];
        return next;
      });
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'line-links'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'line-link-options'] }),
      ]);
    },
  });

  const rows = linksQuery.data ?? [];
  const options = optionsQuery.data ?? [];
  const loading = linksQuery.isLoading || optionsQuery.isLoading;

  return (
    <div className="flex flex-col gap-4">
      <PageTitle eyebrow="บุคลากรและสิทธิ์ / บัญชี LINE" title="เชื่อมบัญชี LINE กับผู้ใช้" description="เลือกผู้ใช้ระบบให้ตรงกับบัญชี LINE ที่ Login เข้ามา ระบบจะใช้การเชื่อมนี้เพื่อส่งสถานะ Ticket ไปยัง LINE ของคนนั้น" />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        <StatCard icon={<UsersRound className="h-5 w-5" />} label={`รายการสถานะ ${FILTERS.find((filter) => filter.value === status)?.label ?? 'ทั้งหมด'}`} value={rows.length} tone="primary" />
        <StatCard icon={<Link2 className="h-5 w-5" />} label="เชื่อมผู้ใช้แล้ว (ผลลัพธ์นี้)" value={rows.filter((row) => row.linked_user_id).length} tone="teal" />
        <StatCard icon={<ShieldBan className="h-5 w-5" />} label="ระงับ (ผลลัพธ์นี้)" value={rows.filter((row) => row.link_status === 'Suspended').length} tone="gray" />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center gap-2">
          {FILTERS.map((filter) => <button key={filter.value} type="button" onClick={() => setStatus(filter.value)} className={`rounded-full px-3 py-1 text-xs font-medium ${status === filter.value ? 'bg-primary-700 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>{filter.label}</button>)}
        </CardHeader>
        <CardBody>
          {loading && <div className="flex justify-center py-8" role="status"><Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" /></div>}
          {(linksQuery.isError || optionsQuery.isError) && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">โหลดข้อมูลการเชื่อม LINE ไม่สำเร็จ กรุณาลองใหม่</p>}
          {!loading && linksQuery.data?.length === 0 && <EmptyState icon={<MessageCircle className="h-10 w-10" aria-hidden="true" />} title="ไม่มีรายการในสถานะนี้" />}

          {!loading && rows.length > 0 && (
            <div className="overflow-x-auto">
              <DataTable className="w-full min-w-[1040px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500 dark:text-slate-400"><tr><th className="px-2 py-2">ชื่อ LINE</th><th className="px-2 py-2">เชื่อมกับผู้ใช้ระบบ</th><th className="px-2 py-2">สถานะเพื่อน LINE OA</th><th className="px-2 py-2">เข้าใช้ล่าสุด</th><th className="px-2 py-2">สถานะ</th><th className="px-2 py-2 text-right">ดำเนินการ</th></tr></thead>
                <tbody>
                  {rows.map((row) => {
                    const selectedUserId = selectedUserIds[row.id] ?? row.linked_user_id ?? '';
                    const isSavingThisRow = updateLinkMutation.isPending && updateLinkMutation.variables?.id === row.id;
                    return (
                      <tr key={row.id} className="border-t border-slate-100 dark:border-slate-700">
                        <td className="px-2 py-3 font-medium text-slate-800 dark:text-slate-200">{row.full_name ?? row.display_name ?? '-'}{row.full_name && row.display_name && row.full_name !== row.display_name && <p className="text-xs font-normal text-slate-400">LINE: {row.display_name}</p>}</td>
                        <td className="px-2 py-3">
                          <div className="flex items-center gap-2">
                            <select aria-label={`เลือกผู้ใช้สำหรับ ${row.full_name ?? row.display_name ?? 'บัญชี LINE'}`} className={selectClass} value={selectedUserId} disabled={isSavingThisRow} onChange={(event) => setSelectedUserIds((current) => ({ ...current, [row.id]: event.target.value }))}>
                              <option value="">— ยังไม่เชื่อมผู้ใช้ —</option>
                              {options.map((option) => {
                                const linkedElsewhere = Boolean(option.linked_line_user_id && option.linked_line_user_id !== row.id);
                                const inactive = option.status !== 'active';
                                return <option key={option.id} value={option.id} disabled={linkedElsewhere || inactive}>{optionLabel(option)}{linkedElsewhere ? ' (เชื่อม LINE อื่นแล้ว)' : inactive ? ' (Inactive)' : ''}</option>;
                              })}
                            </select>
                            <Button size="sm" variant={selectedUserId ? 'primary' : 'outline'} isLoading={isSavingThisRow} disabled={selectedUserId === (row.linked_user_id ?? '')} onClick={() => updateLinkMutation.mutate({ id: row.id, userId: selectedUserId || null })}>{selectedUserId ? 'บันทึก' : 'ยกเลิกเชื่อม'}</Button>
                          </div>
                        </td>
                        <td className="px-2 py-3 text-slate-600 dark:text-slate-300">{row.friend_status ?? '-'}</td>
                        <td className="px-2 py-3 text-xs text-slate-500 dark:text-slate-400">{row.last_login_at ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(row.last_login_at)) : '-'}</td>
                        <td className="px-2 py-3"><Badge variant={row.link_status ? STATUS_VARIANT[row.link_status] : 'secondary'}>{row.link_status ? STATUS_LABEL[row.link_status] : '-'}</Badge></td>
                        <td className="px-2 py-3 text-right"><RowActions recordLabel={row.full_name ?? row.display_name ?? 'บัญชี LINE'} actions={[
                          { kind: 'custom', icon: RotateCcw, label: 'ยกเลิกระงับ', hidden: row.link_status !== 'Suspended', onClick: () => updateStatusMutation.mutate({ id: row.id, nextStatus: 'Active' }) },
                          { kind: 'cancel', label: 'ระงับ', hidden: row.link_status === 'Suspended', confirmDescription: 'บัญชี LINE นี้จะใช้แจ้งงานและรับแจ้งเตือนผ่าน LINE ไม่ได้จนกว่าจะยกเลิกระงับ', onConfirm: () => updateStatusMutation.mutate({ id: row.id, nextStatus: 'Suspended' }) },
                          { kind: 'delete', deleteEndpoint: `/api/v1/record-deletions/line-links/${row.id}` },
                        ]} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </DataTable>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
