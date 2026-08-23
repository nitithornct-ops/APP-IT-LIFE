import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListTree, Loader2, Plus } from 'lucide-react';
import { useState } from 'react';
import { RequirePermission } from '../../components/RequirePermission';
import { DataTable } from '../../components/table/DataTable';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Modal } from '../../components/ui/Modal';
import { QueryError } from '../../components/ui/QueryError';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { CauseCode } from '../../types/causeCodes';
import type { TicketCategory } from '../../types/admin';

/**
 * ทะเบียนรหัสสาเหตุการปิดงาน (design handoff 3j — ชิปสาเหตุ)
 *
 * อยู่ใน Master Data เพราะเป็นข้อมูลอ้างอิงชุดเดียวกับหมวดหมู่ Ticket ที่มันผูกอยู่
 * รหัสแก้ไม่ได้หลังสร้าง — รายงานย้อนหลังและ tag ของบทความ KB อ้างถึงรหัสนี้ ถ้าเปลี่ยนได้
 * ข้อมูลเก่าจะถูกตีความใหม่ย้อนหลังโดยที่ไม่มีใครตั้งใจ ตั้งผิดให้ปิดใช้แล้วสร้างใหม่แทน
 */

const fieldClass =
  'mt-1 h-10 w-full rounded-[7px] border border-hairline-control px-3 text-[13px] outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';

function CreateCauseCodeForm({ categories, onClose }: { categories: TicketCategory[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      apiFetch('/api/v1/cause-codes', {
        method: 'POST',
        body: JSON.stringify({
          code: code.trim().toUpperCase(),
          name: name.trim(),
          description: description.trim() || null,
          categoryId: categoryId || null,
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'cause-codes'] });
      void queryClient.invalidateQueries({ queryKey: ['cause-codes'] });
      onClose();
    },
    onError: (reason: unknown) =>
      setError(reason instanceof ApiError || reason instanceof Error ? reason.message : 'เพิ่มรหัสสาเหตุไม่สำเร็จ'),
  });

  return (
    <form
      className="space-y-3 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        create.mutate();
      }}
    >
      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
        รหัส
        <input
          required
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder="NET_CABLE"
          maxLength={32}
          className={`${fieldClass} font-mono`}
        />
        <span className="mt-1 block text-[10.5px] font-normal text-slate-400">
          ตัวพิมพ์ใหญ่ ตัวเลข ขีดกลางหรือขีดล่าง — แก้ไม่ได้หลังสร้าง
        </span>
      </label>

      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
        ชื่อที่ช่างเห็น
        <input required value={name} onChange={(event) => setName(event.target.value)} maxLength={120} className={fieldClass} />
      </label>

      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
        คำอธิบาย (ไม่บังคับ)
        <input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} className={fieldClass} />
      </label>

      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
        ใช้กับหมวดหมู่
        <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className={fieldClass}>
          <option value="">ทุกหมวดหมู่</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
      </label>

      {error && <p className="text-[12px] text-danger-700 dark:text-red-300" role="alert">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" size="sm" variant="outline" onClick={onClose}>ยกเลิก</Button>
        <Button type="submit" size="sm" disabled={create.isPending}>
          {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          บันทึก
        </Button>
      </div>
    </form>
  );
}

export function CauseCodesSection() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const query = useQuery({
    queryKey: ['admin', 'cause-codes'],
    queryFn: () => apiFetch<CauseCode[]>('/api/v1/cause-codes?includeInactive=true'),
  });

  const categoriesQuery = useQuery({
    queryKey: ['admin', 'ticket-categories'],
    queryFn: () => apiFetch<TicketCategory[]>('/api/v1/ticket-categories'),
  });

  const toggle = useMutation({
    mutationFn: (cause: CauseCode) =>
      apiFetch(`/api/v1/cause-codes/${cause.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !cause.is_active }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'cause-codes'] });
      void queryClient.invalidateQueries({ queryKey: ['cause-codes'] });
    },
  });

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <span>รหัสสาเหตุการปิดงาน</span>
        <RequirePermission permission="cause_code.manage">
          <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            เพิ่มรหัสสาเหตุ
          </Button>
        </RequirePermission>
      </CardHeader>
      <CardBody>
        {showCreate && (
          <Modal title="เพิ่มรหัสสาเหตุ" size="md" onClose={() => setShowCreate(false)}>
            <CreateCauseCodeForm categories={categoriesQuery.data ?? []} onClose={() => setShowCreate(false)} />
          </Modal>
        )}

        {query.isLoading && (
          <div className="flex justify-center py-8" role="status">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
          </div>
        )}

        {query.isError && (
          <QueryError error={query.error} title="โหลดทะเบียนสาเหตุไม่สำเร็จ" onRetry={() => void query.refetch()} isRetrying={query.isFetching} />
        )}

        {query.data && query.data.length === 0 && (
          <EmptyState
            icon={<ListTree className="h-10 w-10" aria-hidden="true" />}
            title="ยังไม่มีรหัสสาเหตุ"
            message="ช่างจะยังบันทึกสาเหตุเป็นข้อความได้ตามปกติ แต่ระบบจะยังจัดกลุ่มว่าปัญหาใดเกิดซ้ำบ่อยไม่ได้"
          />
        )}

        {query.data && query.data.length > 0 && (
          <div className="overflow-x-auto">
            <DataTable className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-2 py-2">รหัส</th>
                  <th className="px-2 py-2">ชื่อ</th>
                  <th className="px-2 py-2">หมวดหมู่</th>
                  <th className="px-2 py-2">สถานะ</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {query.data.map((cause) => (
                  <tr key={cause.id} className="border-t border-slate-100 dark:border-slate-700">
                    <td className="px-2 py-2 font-mono text-[12px] text-slate-600 dark:text-slate-300">{cause.code}</td>
                    <td className="px-2 py-2">
                      <span className="font-medium text-slate-800 dark:text-slate-200">{cause.name}</span>
                      {cause.description && (
                        <span className="mt-0.5 block text-[11px] text-slate-400">{cause.description}</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{cause.category?.name ?? 'ทุกหมวดหมู่'}</td>
                    <td className="px-2 py-2">
                      <Badge variant={cause.is_active ? 'success' : 'secondary'}>{cause.is_active ? 'ใช้งาน' : 'ปิดใช้'}</Badge>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <RequirePermission permission="cause_code.manage">
                        <Button size="sm" variant="outline" disabled={toggle.isPending} onClick={() => toggle.mutate(cause)}>
                          {cause.is_active ? 'ปิดใช้' : 'เปิดใช้'}
                        </Button>
                      </RequirePermission>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
