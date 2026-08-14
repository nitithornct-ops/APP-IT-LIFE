import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TablePagination } from '../../components/table/DataTable';
import { FormModal } from '../../components/ui/Modal';
import { AlertTriangle, CheckCircle2, GitBranch, Loader2, Network, Plus, Waypoints, X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { RequirePermission } from '../../components/RequirePermission';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { PaginatedResult } from '../../types/admin';
import type { CiNodeOption, CiRelationship } from '../../types/cmdb';
import {
  RELATIONSHIP_IMPACT_LEVELS,
  RELATIONSHIP_DIRECTIONS,
  RELATIONSHIP_STATUSES,
  RELATIONSHIP_TYPES_ENABLED,
  relationshipStatusTone,
} from './cmdbDisplay';

const createRelSchema = z.object({
  sourceType: z.enum(['CI', 'Asset', 'Incident', 'Change']),
  sourceId: z.string().min(1, 'กรุณาเลือกต้นทาง'),
  targetType: z.enum(['CI', 'Asset', 'Incident', 'Change']),
  targetId: z.string().min(1, 'กรุณาเลือกปลายทาง'),
  relationshipType: z.enum(RELATIONSHIP_TYPES_ENABLED),
  direction: z.enum(RELATIONSHIP_DIRECTIONS).optional(),
  impactLevel: z.enum(RELATIONSHIP_IMPACT_LEVELS).optional(),
  description: z.string().trim().optional(),
});
type CreateRelForm = z.infer<typeof createRelSchema>;

function CreateRelationshipForm({ nodeOptions, onClose }: { nodeOptions: CiNodeOption[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateRelForm>({ resolver: zodResolver(createRelSchema), defaultValues: { sourceType: 'CI', targetType: 'CI' } });
  const sourceType = watch('sourceType');
  const targetType = watch('targetType');

  const mutation = useMutation({
    mutationFn: (values: CreateRelForm) => apiFetch('/api/v1/cmdb/relationships', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['cmdb', 'relationships'] });
      onClose();
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'สร้างความสัมพันธ์ไม่สำเร็จ'),
  });

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3 dark:border-slate-700 dark:bg-slate-900/40"
      noValidate
    >
      <div className="flex items-center justify-between sm:col-span-3">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">เพิ่มความสัมพันธ์</h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div>
        <label htmlFor="rel-source-type" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ประเภทต้นทาง</label>
        <select id="rel-source-type" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('sourceType')}>
          <option value="CI">CI</option>
          <option value="Asset">Asset</option>
          <option value="Incident">Incident</option>
          <option value="Change">Change</option>
        </select>
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="rel-source" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ต้นทาง</label>
        <select id="rel-source" data-testid="rel-create-source" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('sourceId')}>
          <option value="">— เลือก —</option>
          {nodeOptions.filter((n) => n.type === sourceType).map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
        {errors.sourceId && <p className="mt-1 text-xs text-red-600">{errors.sourceId.message}</p>}
      </div>

      <div>
        <label htmlFor="rel-target-type" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ประเภทปลายทาง</label>
        <select id="rel-target-type" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('targetType')}>
          <option value="CI">CI</option>
          <option value="Asset">Asset</option>
          <option value="Incident">Incident</option>
          <option value="Change">Change</option>
        </select>
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="rel-target" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ปลายทาง</label>
        <select id="rel-target" data-testid="rel-create-target" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('targetId')}>
          <option value="">— เลือก —</option>
          {nodeOptions.filter((n) => n.type === targetType).map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
        {errors.targetId && <p className="mt-1 text-xs text-red-600">{errors.targetId.message}</p>}
      </div>

      <div>
        <label htmlFor="rel-type" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ความสัมพันธ์</label>
        <select id="rel-type" data-testid="rel-create-type" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('relationshipType')}>
          {RELATIONSHIP_TYPES_ENABLED.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="rel-direction" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ทิศทาง</label>
        <select id="rel-direction" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('direction')}>
          {RELATIONSHIP_DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="rel-impact" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Impact Level</label>
        <select id="rel-impact" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('impactLevel')}>
          {RELATIONSHIP_IMPACT_LEVELS.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
      </div>

      <div className="sm:col-span-3">
        <label htmlFor="rel-desc" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">คำอธิบาย</label>
        <input id="rel-desc" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('description')} />
      </div>

      {serverError && <p className="text-xs text-red-600 sm:col-span-3">{serverError}</p>}

      <div className="sm:col-span-3">
        <Button type="submit" size="sm" isLoading={isSubmitting} data-testid="rel-create-submit">บันทึก</Button>
      </div>
    </form>
  );
}

function RelationshipActions({ rel, onDone }: { rel: CiRelationship; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [statusValue, setStatusValue] = useState('');
  const [reason, setReason] = useState('');

  const statusMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/cmdb/relationships/${rel.id}/status`, { method: 'POST', body: JSON.stringify({ status: statusValue, reason: reason || undefined }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['cmdb', 'relationships'] });
      setStatusValue('');
      setReason('');
      onDone();
    },
  });
  const verifyMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/cmdb/relationships/${rel.id}/verify`, { method: 'POST', body: '{}' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['cmdb', 'relationships'] }),
  });

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs dark:border-slate-700 dark:bg-slate-900/40">
      <select value={statusValue} onChange={(e) => setStatusValue(e.target.value)} data-testid={`rel-status-select-${rel.id}`} className="rounded-lg border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-900">
        <option value="">เปลี่ยนสถานะ...</option>
        {RELATIONSHIP_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      {statusValue === 'Inactive' && (
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผล (จำเป็น)" className="rounded-lg border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-900" />
      )}
      <Button size="sm" variant="outline" disabled={!statusValue} isLoading={statusMutation.isPending} data-testid={`rel-status-save-${rel.id}`} onClick={() => statusMutation.mutate()}>
        บันทึกสถานะ
      </Button>
      <Button size="sm" variant="outline" isLoading={verifyMutation.isPending} data-testid={`rel-verify-${rel.id}`} onClick={() => verifyMutation.mutate()}>
        Verify
      </Button>
    </div>
  );
}

export function CiRelationshipsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [relationshipType, setRelationshipType] = useState('');
  const [status, setStatus] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const nodeOptionsQuery = useQuery({ queryKey: ['cmdb', 'node-options'], queryFn: () => apiFetch<CiNodeOption[]>('/api/v1/cmdb/relationships/node-options') });
  const relationshipsQuery = useQuery({
    queryKey: ['cmdb', 'relationships', page, pageSize, relationshipType, status],
    queryFn: () =>
      apiFetch<PaginatedResult<CiRelationship>>(
        `/api/v1/cmdb/relationships?page=${page}&pageSize=${pageSize}${relationshipType ? `&relationshipType=${encodeURIComponent(relationshipType)}` : ''}${status ? `&status=${encodeURIComponent(status)}` : ''}`,
      ),
  });

  const items = relationshipsQuery.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">ความสัมพันธ์ CI (CI Relationships)</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">แผนผังความเชื่อมโยงระหว่าง Configuration Item / Asset</p>
        </div>
        <RequirePermission permission="cmdb.manage">
          <Button size="sm" onClick={() => setShowCreate((v) => !v)} data-testid="rel-create-toggle">
            <Plus className="h-4 w-4" aria-hidden="true" />
            เพิ่มความสัมพันธ์
          </Button>
        </RequirePermission>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard icon={<GitBranch className="h-5 w-5" />} label="ความสัมพันธ์ทั้งหมด" value={relationshipsQuery.data?.pagination.totalItems ?? 0} tone="primary" />
        <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="Active (หน้านี้)" value={items.filter((item) => item.status === 'Active').length} tone="teal" />
        <StatCard icon={<AlertTriangle className="h-5 w-5" />} label="High / Critical (หน้านี้)" value={items.filter((item) => item.impact_level === 'High' || item.impact_level === 'Critical').length} tone="amber" />
        <StatCard icon={<Network className="h-5 w-5" />} label="โหนดที่เลือกได้" value={nodeOptionsQuery.data?.length ?? 0} tone="gray" />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <span>รายการความสัมพันธ์</span>
          <div className="flex flex-wrap items-center gap-2 text-xs font-normal">
            <select value={relationshipType} onChange={(e) => { setRelationshipType(e.target.value); setPage(1); }} className="rounded-full border border-slate-300 px-3 py-1 dark:border-slate-600 dark:bg-slate-900">
              <option value="">ทุกประเภทความสัมพันธ์</option>
              {RELATIONSHIP_TYPES_ENABLED.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="rounded-full border border-slate-300 px-3 py-1 dark:border-slate-600 dark:bg-slate-900">
              <option value="">ทุกสถานะ</option>
              {RELATIONSHIP_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </CardHeader>
        <CardBody>
          {showCreate && nodeOptionsQuery.data && <FormModal title="เพิ่มความสัมพันธ์ CI" description="เชื่อมโยงต้นทาง ปลายทาง และชนิดความสัมพันธ์" size="lg" onClose={() => setShowCreate(false)}><CreateRelationshipForm nodeOptions={nodeOptionsQuery.data} onClose={() => setShowCreate(false)} /></FormModal>}

          {relationshipsQuery.isLoading && (
            <div className="flex justify-center py-8" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
            </div>
          )}

          {relationshipsQuery.data && items.length === 0 && <EmptyState icon={<Waypoints className="h-10 w-10" aria-hidden="true" />} title="ไม่พบความสัมพันธ์" />}

          <div className="flex flex-col gap-2">
            {items.map((r) => (
              <div key={r.id} data-testid={`rel-row-${r.id}`} className="rounded-lg border border-slate-100 p-3 dark:border-slate-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-medium text-slate-800 dark:text-slate-200">{r.sourceName ?? `${r.source_type}:${r.source_id.slice(0, 8)}`}</span>
                    <span className="mx-2 text-slate-400">— {r.relationship_type} →</span>
                    <span className="font-medium text-slate-800 dark:text-slate-200">{r.targetName ?? `${r.target_type}:${r.target_id.slice(0, 8)}`}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{r.impact_level}</Badge>
                    <Badge variant={relationshipStatusTone[r.status]}>{r.status}</Badge>
                    <RequirePermission permission="cmdb.manage">
                      <button type="button" data-testid={`rel-manage-${r.id}`} onClick={() => setExpandedId(expandedId === r.id ? null : r.id)} className="text-xs text-primary-700 hover:underline dark:text-primary-300">
                        {expandedId === r.id ? 'ปิด' : 'จัดการ'}
                      </button>
                    </RequirePermission>
                  </div>
                </div>
                {expandedId === r.id && (
                  <div className="mt-2">
                    <RelationshipActions rel={r} onDone={() => setExpandedId(null)} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {relationshipsQuery.data && <TablePagination page={relationshipsQuery.data.pagination.page} pageSize={pageSize} totalItems={relationshipsQuery.data.pagination.totalItems} totalPages={relationshipsQuery.data.pagination.totalPages} onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} />}
        </CardBody>
      </Card>
    </div>
  );
}
