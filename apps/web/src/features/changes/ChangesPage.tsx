import { DataTable } from '../../components/table/DataTable';
import { RowActions } from '../../components/table/RowActions';
import { FormModal } from '../../components/ui/Modal';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitPullRequestArrow, Loader2, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import type { PaginatedResult } from '../../types/admin';
import { CHANGE_RISK_LEVELS, CHANGE_STATUSES, type ChangeReferences, type ChangeRequest } from '../../types/changes';
import { formatThaiDate } from '../../utils/date';
import { changeRiskTone, changeStatusTone, profileName } from './changeDisplay';

const fieldClass = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900';

function CreateChangeForm({ references, onClose }: { references: ChangeReferences; onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ title: '', systemAffected: '', changeType: '', description: '', impactAssessment: '', riskLevel: 'ต่ำ', rollbackPlan: '', sourceServiceRequestId: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const mutation = useMutation({
    mutationFn: () => apiFetch<ChangeRequest>('/api/v1/changes', { method: 'POST', body: JSON.stringify({ ...form, sourceServiceRequestId: form.sourceServiceRequestId || null }) }),
    onSuccess: (data) => { void queryClient.invalidateQueries({ queryKey: ['changes'] }); void navigate(`/changes/${data.id}`); },
    onError: (reason) => setError(reason instanceof ApiError ? reason.message : 'สร้างคำขอเปลี่ยนแปลงไม่สำเร็จ'),
  });

  return <Card data-testid="change-create-form"><CardHeader className="flex items-center justify-between"><span>ยื่นคำขอเปลี่ยนแปลง</span><button type="button" onClick={onClose} aria-label="ปิด"><X className="h-4 w-4" /></button></CardHeader><CardBody>
    <form className="grid gap-3 sm:grid-cols-3" onSubmit={(event) => { event.preventDefault(); setError(null); mutation.mutate(); }}>
      <label className="text-xs font-semibold sm:col-span-2">หัวข้อ<input required maxLength={200} data-testid="change-create-title" value={form.title} onChange={(e) => set('title', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold">ระบบที่ได้รับผลกระทบ<input required maxLength={150} data-testid="change-create-system" value={form.systemAffected} onChange={(e) => set('systemAffected', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold">ประเภท Change<input maxLength={60} value={form.changeType} onChange={(e) => set('changeType', e.target.value)} placeholder="เช่น Standard / Normal" className={fieldClass} /></label>
      <label className="text-xs font-semibold">ระดับความเสี่ยง<select data-testid="change-create-risk" value={form.riskLevel} onChange={(e) => set('riskLevel', e.target.value)} className={fieldClass}>{CHANGE_RISK_LEVELS.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label className="text-xs font-semibold">คำขอบริการต้นทาง<select value={form.sourceServiceRequestId} onChange={(e) => set('sourceServiceRequestId', e.target.value)} className={fieldClass}><option value="">— ไม่เชื่อม —</option>{references.serviceRequests.map((item) => <option key={item.id} value={item.id}>{item.service_code} — {item.service_name}</option>)}</select></label>
      <label className="text-xs font-semibold sm:col-span-3">รายละเอียด<textarea required maxLength={3000} rows={4} data-testid="change-create-description" value={form.description} onChange={(e) => set('description', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold sm:col-span-2">ประเมินผลกระทบ<textarea maxLength={2000} rows={3} value={form.impactAssessment} onChange={(e) => set('impactAssessment', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold">แผน Rollback<textarea maxLength={2000} rows={3} data-testid="change-create-rollback" value={form.rollbackPlan} onChange={(e) => set('rollbackPlan', e.target.value)} className={fieldClass} /></label>
      {error && <p className="text-sm text-red-600 sm:col-span-3">{error}</p>}
      <div className="sm:col-span-3"><Button type="submit" size="sm" isLoading={mutation.isPending} data-testid="change-create-submit">ยื่นคำขอ</Button></div>
    </form>
  </CardBody></Card>;
}

export function ChangesPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('change.create');
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [risk, setRisk] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const references = useQuery({ queryKey: ['changes', 'references'], queryFn: () => apiFetch<ChangeReferences>('/api/v1/changes/references'), enabled: canCreate && showCreate });
  const query = useQuery({ queryKey: ['changes', debouncedSearch, status, risk], queryFn: () => apiFetch<PaginatedResult<ChangeRequest>>(`/api/v1/changes?page=1&pageSize=100${debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ''}${status ? `&status=${encodeURIComponent(status)}` : ''}${risk ? `&riskLevel=${encodeURIComponent(risk)}` : ''}`) });
  const items = query.data?.items ?? [];

  return <div className="flex flex-col gap-4" data-testid="changes-page">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h1 className="text-xl font-bold">Change Management</h1><p className="text-sm text-slate-500">ยื่นคำขอ · ทดสอบ · อนุมัติอย่างเป็นอิสระ · ติดตั้งใช้งาน</p></div>{canCreate && <Button size="sm" onClick={() => setShowCreate((value) => !value)} data-testid="change-create-toggle"><Plus className="h-4 w-4" /> ยื่นคำขอ</Button>}</div>
    {showCreate && <FormModal title="ยื่นคำขอเปลี่ยนแปลง" description="ระบุขอบเขต ความเสี่ยง แผนทดสอบ และแผนย้อนกลับ" size="xl" onClose={() => setShowCreate(false)}>{references.isLoading ? <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin" /></div> : references.data && <CreateChangeForm references={references.data} onClose={() => setShowCreate(false)} />}</FormModal>}
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><StatCard icon={<GitPullRequestArrow className="h-5 w-5" />} label="ทั้งหมด" value={query.data?.pagination.totalItems ?? 0} tone="primary" /><StatCard icon={<GitPullRequestArrow className="h-5 w-5" />} label="รอทดสอบ" value={items.filter((item) => item.status === 'ยื่นคำขอ').length} tone="gray" /><StatCard icon={<GitPullRequestArrow className="h-5 w-5" />} label="รออนุมัติ/ติดตั้ง" value={items.filter((item) => ['ผ่านการทดสอบ', 'อนุมัติแล้ว'].includes(item.status)).length} tone="amber" /><StatCard icon={<GitPullRequestArrow className="h-5 w-5" />} label="ติดตั้งแล้ว" value={items.filter((item) => item.status === 'ติดตั้งใช้งานแล้ว').length} tone="teal" /></div>
    <Card><CardHeader className="flex flex-wrap items-center justify-between gap-2"><span>รายการ Change</span><div className="flex gap-2 text-xs font-normal"><select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-full border px-3 py-1 dark:bg-slate-900"><option value="">ทุกสถานะ</option>{CHANGE_STATUSES.map((value) => <option key={value}>{value}</option>)}</select><select value={risk} onChange={(e) => setRisk(e.target.value)} className="rounded-full border px-3 py-1 dark:bg-slate-900"><option value="">ทุกระดับความเสี่ยง</option>{CHANGE_RISK_LEVELS.map((value) => <option key={value}>{value}</option>)}</select></div></CardHeader><CardBody>
      <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาเลข Change หัวข้อ หรือระบบ..." className={`${fieldClass} mb-3 max-w-sm`} />
      {query.isLoading && <Loader2 className="mx-auto my-8 h-5 w-5 animate-spin" />}{query.data && !items.length && <EmptyState icon={<GitPullRequestArrow className="h-10 w-10" />} title="ยังไม่มีคำขอเปลี่ยนแปลง" />}
      {!!items.length && <div className="overflow-x-auto"><DataTable className="w-full text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="p-2">เลขที่</th><th className="p-2">รายการ</th><th className="p-2">ผู้ยื่น</th><th className="p-2">Risk</th><th className="p-2">สถานะ</th><th className="p-2 text-right">ดำเนินการ</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} data-testid={`change-row-${item.id}`} className="border-t border-slate-100 dark:border-slate-700"><td className="p-2"><Link to={`/changes/${item.id}`} className="font-mono text-xs text-primary-700 hover:underline dark:text-primary-300">{item.change_number}</Link><p className="text-xs text-slate-400">{formatThaiDate(item.request_date, 'd MMM yyyy HH:mm')}</p></td><td className="p-2"><Link to={`/changes/${item.id}`} className="font-semibold hover:underline">{item.title}</Link><p className="text-xs text-slate-400">{item.system_affected}</p></td><td className="p-2 text-slate-500">{profileName(item.requester)}</td><td className="p-2"><Badge variant={changeRiskTone[item.risk_level]}>{item.risk_level}</Badge></td><td className="p-2"><Badge variant={changeStatusTone[item.status]}>{item.status}</Badge></td><td className="p-2 text-right"><RowActions recordLabel={item.change_number} actions={[{ kind: 'view', to: `/changes/${item.id}` }]} /></td></tr>)}</tbody></DataTable></div>}
    </CardBody></Card>
  </div>;
}
