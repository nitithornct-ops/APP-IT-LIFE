import type { TicketRatingCriterion } from '@itlife/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Plus, Save, ToggleLeft, ToggleRight } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { ApiError, apiFetch } from '../../services/apiClient';

function errorText(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : 'บันทึกหัวข้อประเมินไม่สำเร็จ';
}

function CriterionRow({ criterion, canManage }: { criterion: TicketRatingCriterion; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState(criterion.label);
  const [description, setDescription] = useState(criterion.description ?? '');
  const [sortOrder, setSortOrder] = useState(String(criterion.sort_order));

  useEffect(() => {
    setLabel(criterion.label);
    setDescription(criterion.description ?? '');
    setSortOrder(String(criterion.sort_order));
  }, [criterion]);

  const mutation = useMutation({
    mutationFn: (patch: Record<string, unknown>) => apiFetch<TicketRatingCriterion>(`/api/v1/ticket-rating-criteria/${criterion.id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ticket-rating-criteria'] }),
  });
  const changed = label.trim() !== criterion.label
    || description.trim() !== (criterion.description ?? '')
    || Number(sortOrder) !== criterion.sort_order;

  return (
    <div className={`rounded-xl border p-3 ${criterion.status === 'active' ? 'border-slate-200 dark:border-slate-700' : 'border-dashed border-slate-300 bg-slate-50 opacity-75 dark:border-slate-600 dark:bg-slate-900/40'}`}>
      <div className="grid gap-3 lg:grid-cols-[minmax(180px,1fr)_minmax(220px,1.5fr)_90px_auto] lg:items-end">
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">ชื่อหัวข้อ
          <input aria-label={`ชื่อหัวข้อ ${criterion.label}`} disabled={!canManage} value={label} maxLength={160} onChange={(event) => setLabel(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-900" />
        </label>
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">คำอธิบายเพิ่มเติม
          <input aria-label={`คำอธิบาย ${criterion.label}`} disabled={!canManage} value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} placeholder="ไม่บังคับ" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-900" />
        </label>
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">ลำดับ
          <input aria-label={`ลำดับ ${criterion.label}`} disabled={!canManage} type="number" min={0} max={9999} value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-900" />
        </label>
        {canManage && <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={changed ? 'primary' : 'outline'} disabled={!changed || !label.trim()} isLoading={mutation.isPending} onClick={() => mutation.mutate({ label: label.trim(), description: description.trim() || null, sortOrder: Number(sortOrder) })}><Save className="h-4 w-4" />บันทึก</Button>
          <Button size="sm" variant="outline" isLoading={mutation.isPending} onClick={() => mutation.mutate({ status: criterion.status === 'active' ? 'inactive' : 'active' })}>
            {criterion.status === 'active' ? <ToggleRight className="h-4 w-4 text-emerald-600" /> : <ToggleLeft className="h-4 w-4" />}
            {criterion.status === 'active' ? 'ปิดใช้' : 'เปิดใช้'}
          </Button>
        </div>}
      </div>
      {mutation.isError && <p role="alert" className="mt-2 text-xs font-semibold text-red-600">{errorText(mutation.error)}</p>}
    </div>
  );
}

export function TicketRatingCriteriaSetting({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const criteriaQuery = useQuery({
    queryKey: ['ticket-rating-criteria', 'all'],
    queryFn: () => apiFetch<TicketRatingCriterion[]>('/api/v1/ticket-rating-criteria?includeInactive=true'),
  });
  const createMutation = useMutation({
    mutationFn: () => apiFetch<TicketRatingCriterion>('/api/v1/ticket-rating-criteria', {
      method: 'POST',
      body: JSON.stringify({ label: label.trim(), description: description.trim() || undefined }),
    }),
    onSuccess: async () => {
      setLabel('');
      setDescription('');
      await queryClient.invalidateQueries({ queryKey: ['ticket-rating-criteria'] });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (label.trim()) createMutation.mutate();
  };

  return (
    <Card data-testid="ticket-rating-criteria-setting">
      <CardHeader className="flex items-center gap-2"><ListChecks className="h-5 w-5 text-primary-600" />หัวข้อแบบประเมิน Ticket</CardHeader>
      <CardBody className="space-y-4">
        <div><p className="text-sm font-semibold text-slate-800 dark:text-slate-100">เพิ่ม แก้ไข และเปิด–ปิดหัวข้อประเมิน</p><p className="mt-1 text-xs text-slate-500">การเปลี่ยนชื่อมีผลกับแบบประเมินใหม่เท่านั้น ผลที่ส่งแล้วจะคงชื่อหัวข้อเดิมไว้</p></div>
        {canManage && <form onSubmit={submit} className="grid gap-3 rounded-xl bg-primary-50 p-3 dark:bg-primary-950/20 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">หัวข้อใหม่
            <input aria-label="หัวข้อประเมินใหม่" value={label} maxLength={160} onChange={(event) => setLabel(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" />
          </label>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">คำอธิบาย
            <input aria-label="คำอธิบายหัวข้อใหม่" value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} placeholder="ไม่บังคับ" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" />
          </label>
          <Button type="submit" size="sm" disabled={!label.trim()} isLoading={createMutation.isPending}><Plus className="h-4 w-4" />เพิ่มหัวข้อ</Button>
        </form>}
        {createMutation.isError && <p role="alert" className="text-xs font-semibold text-red-600">{errorText(createMutation.error)}</p>}
        {criteriaQuery.isLoading && <p className="text-sm text-slate-500">กำลังโหลดหัวข้อประเมิน...</p>}
        {criteriaQuery.isError && <p role="alert" className="text-sm font-semibold text-red-600">{errorText(criteriaQuery.error)}</p>}
        <div className="space-y-2">{(criteriaQuery.data ?? []).map((criterion) => <CriterionRow key={criterion.id} criterion={criterion} canManage={canManage} />)}</div>
      </CardBody>
    </Card>
  );
}

