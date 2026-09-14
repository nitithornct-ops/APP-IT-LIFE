import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DeleteConfirmModal, DetailModal, FormModal } from '../../components/ui/Modal';
import {
  BookOpenCheck, CheckCircle2, Eye, FilePenLine, History, Loader2, Pencil, Plus,
  Search, Send, Tags, ThumbsDown, ThumbsUp, Trash2, UserRound, X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageTitle } from '../../components/ui/PageTitle';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import {
  KNOWLEDGE_STATUSES, type KnowledgeArticle, type KnowledgeOverview, type KnowledgeReferenceData, type KnowledgeStatus,
} from '../../types/knowledge';
import { formatThaiDate } from '../../utils/date';
import { helpfulRate, knowledgeMatches, normalizeKnowledgeSynonyms, normalizeKnowledgeTags } from './knowledgeDisplay';

const fieldClass = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900';
const notHelpfulReasons = ['เนื้อหาไม่ตรงกับปัญหา', 'ทำตามขั้นตอนไม่สำเร็จ', 'ข้อมูลล้าสมัย', 'อ่านหรือทำความเข้าใจยาก', 'อื่น ๆ'] as const;

function errorText(reason: unknown, fallback: string) {
  return reason instanceof ApiError || reason instanceof Error ? reason.message : fallback;
}

function relationIds(article: KnowledgeArticle | undefined, key: 'article_incidents' | 'article_problems' | 'article_known_errors' | 'article_services'): string[] {
  if (!article) return [];
  if (key === 'article_incidents') return article.article_incidents.flatMap(({ incident }) => incident?.id ? [incident.id] : []);
  if (key === 'article_problems') return article.article_problems.flatMap(({ problem }) => problem?.id ? [problem.id] : []);
  if (key === 'article_known_errors') return article.article_known_errors.flatMap(({ known_error }) => known_error?.id ? [known_error.id] : []);
  return article.article_services.flatMap(({ service }) => service?.id ? [service.id] : []);
}

function MultiReferenceSelect<T extends { id: string }>({ label, value, onChange, options, optionLabel }: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  options: T[];
  optionLabel: (option: T) => string;
}) {
  return <label className="text-xs font-semibold md:col-span-2"><span>{label}</span><select multiple size={Math.min(5, Math.max(3, options.length))} value={value} onChange={(event) => onChange(Array.from(event.currentTarget.selectedOptions, (option) => option.value))} className={`${fieldClass} min-h-[92px]`}>
    {options.map((option) => <option key={option.id} value={option.id}>{optionLabel(option)}</option>)}
  </select><span className="mt-1 block text-[11px] font-normal text-slate-400">กด Ctrl/Cmd เพื่อเลือกหลายรายการ</span></label>;
}

function ArticleForm({ article, overview, references, onClose }: { article?: KnowledgeArticle; overview: KnowledgeOverview; references: KnowledgeReferenceData; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    title: article?.title ?? '', taxonomyId: article?.taxonomy_id ?? '', symptom: article?.symptom ?? '',
    solution: article?.solution ?? '', tags: article?.tags.join(', ') ?? '', synonyms: article?.synonyms?.join(', ') ?? '',
    status: article?.status ?? 'ร่าง' as KnowledgeStatus, articleOwnerId: article?.article_owner_id ?? article?.author_id ?? '',
    reviewerId: article?.reviewer_id ?? '', reviewDueDate: article?.review_due_date ?? '', expiryDate: article?.expiry_date ?? '',
    isDeprecated: article?.is_deprecated ?? false, deprecatedReason: article?.deprecated_reason ?? '',
    searchRank: String(article?.search_rank ?? 0), changeNote: '',
    incidentIds: relationIds(article, 'article_incidents'), problemIds: relationIds(article, 'article_problems'),
    knownErrorIds: relationIds(article, 'article_known_errors'), serviceIds: relationIds(article, 'article_services'),
  });
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => apiFetch<KnowledgeArticle>(article ? `/api/v1/knowledge/articles/${article.id}` : '/api/v1/knowledge/articles', {
      method: article ? 'PATCH' : 'POST',
      body: JSON.stringify({
        title: form.title, taxonomyId: form.taxonomyId, symptom: form.symptom, solution: form.solution,
        tags: normalizeKnowledgeTags(form.tags), synonyms: normalizeKnowledgeSynonyms(form.synonyms), status: form.status,
        articleOwnerId: form.articleOwnerId || undefined, reviewerId: form.reviewerId || undefined,
        reviewDueDate: form.reviewDueDate || undefined, expiryDate: form.expiryDate || undefined,
        isDeprecated: form.isDeprecated, deprecatedReason: form.deprecatedReason || undefined,
        searchRank: Number(form.searchRank || 0), changeNote: form.changeNote || undefined,
        incidentIds: form.incidentIds, problemIds: form.problemIds, knownErrorIds: form.knownErrorIds, serviceIds: form.serviceIds,
      }),
    }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['knowledge'] }); onClose(); },
    onError: (reason) => setError(errorText(reason, 'บันทึกบทความไม่สำเร็จ')),
  });
  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) { setForm((current) => ({ ...current, [key]: value })); }
  return <Card data-testid="knowledge-form" className="border-primary-200 dark:border-primary-900">
    <CardHeader className="flex items-center justify-between"><div><p>{article ? `แก้ไข ${article.article_code}` : 'เพิ่มบทความฐานความรู้'}</p><p className="mt-0.5 text-xs font-normal text-slate-500">ใช้ Knowledge Taxonomy กลาง พร้อมเจ้าของบทความและรอบทบทวน</p></div><button type="button" aria-label="ปิดแบบฟอร์ม" onClick={onClose}><X className="h-4 w-4" /></button></CardHeader>
    <CardBody><form className="grid gap-3 md:grid-cols-2 lg:grid-cols-4" onSubmit={(event) => { event.preventDefault(); setError(null); mutation.mutate(); }}>
      <label className="text-xs font-semibold md:col-span-2 lg:col-span-3">หัวข้อบทความ<input required maxLength={200} data-testid="knowledge-form-title" value={form.title} onChange={(event) => set('title', event.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold">สถานะ<select data-testid="knowledge-form-status" value={form.status} onChange={(event) => set('status', event.target.value as KnowledgeStatus)} className={fieldClass}>{KNOWLEDGE_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
      <label className="text-xs font-semibold md:col-span-2">Knowledge Taxonomy<select data-testid="knowledge-form-taxonomy" value={form.taxonomyId} onChange={(event) => set('taxonomyId', event.target.value)} className={fieldClass}><option value="">— ไม่ระบุ —</option>{(references.taxonomies.length ? references.taxonomies : overview.taxonomies).map((taxonomy) => <option key={taxonomy.id} value={taxonomy.id}>{taxonomy.name}</option>)}</select></label>
      <label className="text-xs font-semibold md:col-span-2">แท็ก คั่นด้วย comma<input data-testid="knowledge-form-tags" maxLength={500} value={form.tags} onChange={(event) => set('tags', event.target.value)} placeholder="network, windows" className={fieldClass} /></label>
      <label className="text-xs font-semibold md:col-span-2">Synonym คั่นด้วย comma<input data-testid="knowledge-form-synonyms" maxLength={1000} value={form.synonyms} onChange={(event) => set('synonyms', event.target.value)} placeholder="wifi, wi-fi, wireless" className={fieldClass} /><span className="mt-1 block text-[11px] font-normal text-slate-400">ช่วยให้ค้นคำใกล้เคียงเจอบทความเดียวกัน</span></label>
      <label className="text-xs font-semibold">Search Ranking<input type="number" min={0} max={1000} value={form.searchRank} onChange={(event) => set('searchRank', event.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold md:col-span-2 lg:col-span-4">อาการ / ปัญหา<textarea data-testid="knowledge-form-symptom" rows={3} maxLength={2000} value={form.symptom} onChange={(event) => set('symptom', event.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold md:col-span-2 lg:col-span-4">วิธีแก้ไข<textarea required rows={7} maxLength={10000} data-testid="knowledge-form-solution" value={form.solution} onChange={(event) => set('solution', event.target.value)} className={fieldClass} /></label>
      <div className="grid gap-3 rounded-xl border border-slate-200 p-3 md:col-span-2 lg:col-span-4 md:grid-cols-2 dark:border-slate-700"><p className="font-bold md:col-span-2">กำกับดูแลบทความ</p>
        <label className="text-xs font-semibold">Article Owner<select value={form.articleOwnerId} onChange={(event) => set('articleOwnerId', event.target.value)} className={fieldClass}><option value="">— ไม่ระบุ —</option>{references.owners.map((person) => <option key={person.id} value={person.id}>{person.full_name || person.email}</option>)}</select></label>
        <label className="text-xs font-semibold">Reviewer<select value={form.reviewerId} onChange={(event) => set('reviewerId', event.target.value)} className={fieldClass}><option value="">— ไม่ระบุ —</option>{references.reviewers.map((person) => <option key={person.id} value={person.id}>{person.full_name || person.email}</option>)}</select></label>
        <label className="text-xs font-semibold">Review Due<input type="date" value={form.reviewDueDate} onChange={(event) => set('reviewDueDate', event.target.value)} className={fieldClass} /></label>
        <label className="text-xs font-semibold">Expiry<input type="date" value={form.expiryDate} onChange={(event) => set('expiryDate', event.target.value)} className={fieldClass} /></label>
        <label className="flex items-center gap-2 text-xs font-semibold md:col-span-2"><input type="checkbox" checked={form.isDeprecated} onChange={(event) => { set('isDeprecated', event.target.checked); if (event.target.checked) set('status', 'ร่าง'); }} className="h-4 w-4 rounded" />Deprecated — ไม่แนะนำให้ผู้ใช้เปิดอ่าน</label>
        {form.isDeprecated && <label className="text-xs font-semibold md:col-span-2">เหตุผลที่ Deprecated<input required value={form.deprecatedReason} onChange={(event) => set('deprecatedReason', event.target.value)} className={fieldClass} /></label>}
        <label className="text-xs font-semibold md:col-span-2">หมายเหตุการเปลี่ยนแปลง<input value={form.changeNote} onChange={(event) => set('changeNote', event.target.value)} placeholder="เช่น อัปเดตขั้นตอนตาม Windows รุ่นใหม่" className={fieldClass} /></label>
      </div>
      <div className="grid gap-3 md:col-span-2 lg:col-span-4 md:grid-cols-2"><p className="font-bold md:col-span-2">ความสัมพันธ์ข้ามโมดูล</p>
        <MultiReferenceSelect label="Related Incident" value={form.incidentIds} onChange={(value) => set('incidentIds', value)} options={references.incidents} optionLabel={(item) => `${item.incident_number} · ${item.title}`} />
        <MultiReferenceSelect label="Related Problem" value={form.problemIds} onChange={(value) => set('problemIds', value)} options={references.problems} optionLabel={(item) => `${item.problem_number} · ${item.title}`} />
        <MultiReferenceSelect label="Related Known Error" value={form.knownErrorIds} onChange={(value) => set('knownErrorIds', value)} options={references.knownErrors} optionLabel={(item) => `${item.known_error_number} · ${item.title}`} />
        <MultiReferenceSelect label="Related Service" value={form.serviceIds} onChange={(value) => set('serviceIds', value)} options={references.services} optionLabel={(item) => `${item.service_code} · ${item.service_name}`} />
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 md:col-span-2 lg:col-span-4 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
      <div className="flex gap-2 md:col-span-2 lg:col-span-4"><Button type="submit" size="sm" isLoading={mutation.isPending} disabled={!form.title.trim() || !form.solution.trim()} data-testid="knowledge-form-submit"><Send className="h-4 w-4" />บันทึกบทความ</Button><Button size="sm" variant="ghost" onClick={onClose}>ยกเลิก</Button></div>
    </form></CardBody>
  </Card>;
}

function ArticleDetail({ article, canManage, canFeedback, onClose }: { article: KnowledgeArticle; canManage: boolean; canFeedback: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState({ helpful: article.helpful_count, notHelpful: article.not_helpful_count ?? 0, voted: Boolean(article.has_voted) });
  const [reason, setReason] = useState('');
  const helpfulMutation = useMutation({
    mutationFn: () => apiFetch<{ helpfulCount: number; alreadyVoted: boolean }>(`/api/v1/knowledge/articles/${article.id}/helpful`, { method: 'POST' }),
    onSuccess: (result) => { setError(null); setFeedback((current) => ({ ...current, helpful: result.helpfulCount, voted: true })); void queryClient.invalidateQueries({ queryKey: ['knowledge'] }); },
    onError: (failure) => setError(errorText(failure, 'บันทึกความคิดเห็นไม่สำเร็จ')),
  });
  const notHelpfulMutation = useMutation({
    mutationFn: () => apiFetch<{ notHelpfulCount: number; alreadyVoted: boolean }>(`/api/v1/knowledge/articles/${article.id}/not-helpful`, { method: 'POST', body: JSON.stringify({ reason }) }),
    onSuccess: (result) => { setError(null); setFeedback((current) => ({ ...current, notHelpful: result.notHelpfulCount, voted: true })); void queryClient.invalidateQueries({ queryKey: ['knowledge'] }); },
    onError: (failure) => setError(errorText(failure, 'บันทึกเหตุผลไม่สำเร็จ')),
  });
  const related = [
    ...(article.article_incidents ?? []).flatMap(({ incident }) => incident ? [`Incident: ${incident.incident_number} · ${incident.title}`] : []),
    ...(article.article_problems ?? []).flatMap(({ problem }) => problem ? [`Problem: ${problem.problem_number} · ${problem.title}`] : []),
    ...(article.article_known_errors ?? []).flatMap(({ known_error }) => known_error ? [`Known Error: ${known_error.known_error_number} · ${known_error.title}`] : []),
    ...(article.article_services ?? []).flatMap(({ service }) => service ? [`Service: ${service.service_code} · ${service.service_name}`] : []),
  ];
  return <Card data-testid={`knowledge-detail-${article.id}`} className="border-primary-200 dark:border-primary-900">
    <CardHeader className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><span>{article.title}</span><Badge variant={article.is_deprecated ? 'danger' : article.status === 'เผยแพร่' ? 'success' : 'warning'}>{article.is_deprecated ? 'Deprecated' : article.status}</Badge></div><p className="mt-1 text-xs font-normal text-slate-500">{article.article_code} · v{article.version_number} · อัปเดต {formatThaiDate(article.updated_at, 'd MMM yyyy HH:mm')}</p></div><button type="button" aria-label="ปิดบทความ" onClick={onClose}><X className="h-4 w-4" /></button></CardHeader>
    <CardBody className="space-y-5">
      {(article.taxonomy || article.category) && <Badge variant="primary">{article.taxonomy?.name ?? article.category?.name}</Badge>}
      {(article.review_due_date || article.expiry_date || article.article_owner || article.reviewer) && <div className="grid gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600 sm:grid-cols-2 dark:bg-slate-900/50 dark:text-slate-300"><span><UserRound className="mr-1 inline h-4 w-4" />Owner: {article.article_owner?.full_name ?? article.article_owner?.email ?? '—'}</span><span>Reviewer: {article.reviewer?.full_name ?? article.reviewer?.email ?? '—'}</span><span>Review Due: {article.review_due_date ?? '—'}</span><span>Expiry: {article.expiry_date ?? '—'}</span></div>}
      {article.symptom && <section><h2 className="mb-1 text-sm font-bold text-primary-700 dark:text-primary-300">อาการ / ปัญหา</h2><p className="whitespace-pre-wrap text-sm leading-6">{article.symptom}</p></section>}
      <section><h2 className="mb-1 text-sm font-bold text-primary-700 dark:text-primary-300">วิธีแก้ไข</h2><p className="whitespace-pre-wrap text-sm leading-7">{article.solution}</p></section>
      {!!article.tags.length && <div className="flex flex-wrap gap-1">{article.tags.map((tag) => <span key={tag} className="rounded-full border border-slate-200 px-2 py-1 text-xs text-slate-500 dark:border-slate-700">#{tag}</span>)}</div>}
      {!!article.synonyms?.length && <p className="text-xs text-slate-500">ค้นพบจากคำพ้อง: {article.synonyms.join(', ')}</p>}
      {!!related.length && <section><h2 className="mb-2 text-sm font-bold text-primary-700 dark:text-primary-300">ความสัมพันธ์</h2><div className="flex flex-wrap gap-2">{related.map((item) => <span key={item} className="rounded-full border border-slate-200 px-2 py-1 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">{item}</span>)}</div></section>}
      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4 text-xs text-slate-500 dark:border-slate-700"><span><Eye className="mr-1 inline h-4 w-4" />{article.views_count} ครั้ง</span><span><ThumbsUp className="mr-1 inline h-4 w-4" />{feedback.helpful}</span><span><ThumbsDown className="mr-1 inline h-4 w-4" />{feedback.notHelpful}</span><span>{helpfulRate({ ...article, helpful_count: feedback.helpful, not_helpful_count: feedback.notHelpful })}% helpful</span>{canFeedback && article.status === 'เผยแพร่' && !article.is_deprecated && <div className="ml-auto flex flex-wrap items-center gap-2">{!feedback.voted && <><Button size="sm" variant="outline" disabled={helpfulMutation.isPending} isLoading={helpfulMutation.isPending} onClick={() => helpfulMutation.mutate()} data-testid="knowledge-helpful"><ThumbsUp className="h-4 w-4" />มีประโยชน์</Button><select aria-label="เหตุผลที่ไม่ช่วยแก้ปัญหา" value={reason} onChange={(event) => setReason(event.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-xs dark:border-slate-600 dark:bg-slate-900"><option value="">ไม่ช่วยแก้ปัญหา เพราะ...</option>{notHelpfulReasons.map((item) => <option key={item}>{item}</option>)}</select><Button size="sm" variant="outline" disabled={!reason || notHelpfulMutation.isPending} isLoading={notHelpfulMutation.isPending} onClick={() => notHelpfulMutation.mutate()} data-testid="knowledge-not-helpful"><ThumbsDown className="h-4 w-4" />ส่งเหตุผล</Button></>}</div>}</div>
      {canManage && !!article.versions?.length && <details className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><summary className="flex cursor-pointer items-center gap-2 text-sm font-bold"><History className="h-4 w-4" />Version History ({article.versions.length})</summary><div className="mt-3 space-y-2">{article.versions.map((version) => <div key={version.id} className="rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-900/50"><p className="font-bold">v{version.version_number} · {version.title}</p><p className="text-slate-500">{formatThaiDate(version.snapshot_at, 'd MMM yyyy HH:mm')} · {version.change_note || '—'}</p></div>)}</div></details>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </CardBody>
  </Card>;
}

function ArticleCard({ article, canManage, onOpen, onEdit }: { article: KnowledgeArticle; canManage: boolean; onOpen: () => void; onEdit: () => void }) {
  const queryClient = useQueryClient();
  const [showDelete, setShowDelete] = useState(false);
  const statusMutation = useMutation({ mutationFn: () => apiFetch(`/api/v1/knowledge/articles/${article.id}/status`, { method: 'POST', body: JSON.stringify({ status: article.status === 'เผยแพร่' ? 'ร่าง' : 'เผยแพร่' }) }), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['knowledge'] }) });
  const deleteMutation = useMutation({ mutationFn: () => apiFetch(`/api/v1/knowledge/articles/${article.id}`, { method: 'DELETE' }), onSuccess: () => { setShowDelete(false); void queryClient.invalidateQueries({ queryKey: ['knowledge'] }); } });
  return <><Card data-testid={`knowledge-card-${article.id}`} className="flex h-full flex-col"><CardBody className="flex flex-1 flex-col">
    <div className="mb-2 flex items-start gap-2"><BookOpenCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary-600" /><div className="min-w-0 flex-1"><p className="font-bold text-slate-800 dark:text-slate-100">{article.title}</p><p className="mt-0.5 text-xs text-slate-400">{article.article_code} · v{article.version_number}</p></div>{article.is_deprecated ? <Badge variant="danger">Deprecated</Badge> : article.status === 'ร่าง' && <Badge variant="warning">ร่าง</Badge>}</div>
    {(article.taxonomy || article.category) && <div className="mb-2"><Badge variant="primary">{article.taxonomy?.name ?? article.category?.name}</Badge></div>}
    <p className="line-clamp-3 flex-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{article.symptom || article.solution}</p>
    <div className="mt-4 flex flex-wrap items-center gap-2"><span className="text-xs text-slate-400"><Eye className="mr-1 inline h-3.5 w-3.5" />{article.views_count} · <ThumbsUp className="mr-1 inline h-3.5 w-3.5" />{article.helpful_count} · <ThumbsDown className="mr-1 inline h-3.5 w-3.5" />{article.not_helpful_count ?? 0}</span><div className="ml-auto flex gap-1"><Button size="sm" onClick={onOpen}>อ่าน</Button>{canManage && <><Button size="sm" variant="outline" aria-label="แก้ไข" onClick={onEdit}><Pencil className="h-4 w-4" /></Button><Button size="sm" variant="outline" aria-label={article.status === 'เผยแพร่' ? 'เก็บเป็นร่าง' : 'เผยแพร่'} isLoading={statusMutation.isPending} disabled={article.is_deprecated} onClick={() => statusMutation.mutate()}>{article.status === 'เผยแพร่' ? <FilePenLine className="h-4 w-4" /> : <Send className="h-4 w-4" />}</Button><Button size="sm" variant="ghost" aria-label="ลบบทความ" onClick={() => setShowDelete(true)}><Trash2 className="h-4 w-4 text-red-600" /></Button></>}</div></div>
  </CardBody></Card>{showDelete && <DeleteConfirmModal title="ลบบทความ" description="คุณต้องการลบบทความนี้หรือไม่?" isPending={deleteMutation.isPending} onClose={() => setShowDelete(false)} onConfirm={() => deleteMutation.mutate()}><div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-900/50"><p className="font-semibold">{article.article_code}</p><p className="text-slate-500">{article.title}</p></div><p className="mt-3 text-xs text-red-600">การดำเนินการนี้อาจไม่สามารถย้อนกลับได้</p></DeleteConfirmModal>}</>;
}

export function KnowledgePage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('knowledge.manage'); const canFeedback = hasPermission('knowledge.feedback');
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(''); const [taxonomyId, setTaxonomyId] = useState(''); const [status, setStatus] = useState('');
  const [showForm, setShowForm] = useState(false); const [editing, setEditing] = useState<KnowledgeArticle>(); const [selected, setSelected] = useState<KnowledgeArticle>(); const [openError, setOpenError] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['knowledge'], queryFn: () => apiFetch<KnowledgeOverview>('/api/v1/knowledge') });
  const referencesQuery = useQuery({ queryKey: ['knowledge', 'references'], enabled: canManage && showForm, queryFn: () => apiFetch<KnowledgeReferenceData>('/api/v1/knowledge/references') });
  const articles = useMemo(() => query.data?.articles ?? [], [query.data?.articles]);
  const taxonomies = query.data?.taxonomies ?? query.data?.categories ?? [];
  const filtered = articles.filter((article) => knowledgeMatches(article, search, taxonomyId) && (!status || article.status === status));
  const published = articles.filter((article) => article.status === 'เผยแพร่' && !article.is_deprecated).length; const drafts = articles.filter((article) => article.status === 'ร่าง').length;
  const views = articles.reduce((sum, article) => sum + article.views_count, 0); const helpful = articles.reduce((sum, article) => sum + article.helpful_count, 0);
  const openArticle = useCallback(async (article: KnowledgeArticle) => { try { setOpenError(null); const data = await apiFetch<KnowledgeArticle>(`/api/v1/knowledge/articles/${article.id}/view`, { method: 'POST' }, { silent: true }); setSelected(data); void queryClient.invalidateQueries({ queryKey: ['knowledge'] }); } catch (reason) { setOpenError(errorText(reason, 'เปิดบทความไม่สำเร็จ')); } }, [queryClient]);
  useEffect(() => {
    const articleId = searchParams.get('article');
    if (!articleId || !query.data || selected) return;
    const article = articles.find((item) => item.id === articleId);
    if (article) void openArticle(article);
  }, [articles, openArticle, query.data, searchParams, selected]);
  if (query.isLoading) return <div className="flex justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-primary-600" /></div>;
  if (query.isError || !query.data) return <EmptyState icon={<BookOpenCheck className="h-10 w-10" />} title="โหลดฐานความรู้ไม่สำเร็จ" message={errorText(query.error, 'กรุณาลองใหม่')} />;
  return <div className="space-y-5" data-testid="knowledge-page">
    <div className="flex flex-wrap items-start justify-between gap-3"><PageTitle eyebrow="บริการและกระบวนการ IT / ฐานความรู้" title="ฐานความรู้ (Knowledge Base)" description="ค้นหาวิธีแก้ปัญหา คู่มือ และคำตอบมาตรฐานก่อนเปิด Service Request" />{canManage && <Button data-testid="knowledge-create-toggle" onClick={() => { setEditing(undefined); setShowForm(true); }}><Plus className="h-4 w-4" />เพิ่มบทความ</Button>}</div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="บทความเผยแพร่" value={published} tone="teal" /><StatCard icon={<FilePenLine className="h-5 w-5" />} label="ฉบับร่าง" value={drafts} tone={drafts ? 'amber' : 'gray'} /><StatCard icon={<Eye className="h-5 w-5" />} label="การเข้าอ่านรวม" value={views} tone="primary" /><StatCard icon={<ThumbsUp className="h-5 w-5" />} label="มีประโยชน์" value={helpful} tone="primary" /></div>
    {showForm && <FormModal title={editing ? 'แก้ไขบทความ' : 'เพิ่มบทความ'} description="จัดการเนื้อหาฐานความรู้และ governance metadata" size="xl" onClose={() => { setShowForm(false); setEditing(undefined); }}>{referencesQuery.isLoading ? <div className="flex justify-center py-20"><Loader2 className="h-7 w-7 animate-spin text-primary-600" /></div> : referencesQuery.isError || !referencesQuery.data ? <p className="p-6 text-sm text-red-600">โหลดรายการอ้างอิงไม่สำเร็จ กรุณาปิดแล้วลองใหม่</p> : <ArticleForm article={editing} overview={query.data} references={referencesQuery.data} onClose={() => { setShowForm(false); setEditing(undefined); }} />}</FormModal>}
    {selected && <DetailModal title={selected.title} description="รายละเอียดบทความฐานความรู้" onClose={() => setSelected(undefined)}><ArticleDetail key={selected.id} article={selected} canManage={canManage} canFeedback={canFeedback} onClose={() => setSelected(undefined)} /></DetailModal>}
    {openError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{openError}</p>}
    <Card><CardBody className="grid gap-3 md:grid-cols-[minmax(240px,1fr)_240px_180px_auto] md:items-end"><label className="text-xs font-semibold">ค้นหา<div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาอาการ วิธีแก้ แท็ก หรือ synonym..." className={`${fieldClass} pl-9`} /></div></label><label className="text-xs font-semibold">Knowledge Taxonomy<select value={taxonomyId} onChange={(event) => setTaxonomyId(event.target.value)} className={fieldClass}><option value="">ทุก Taxonomy</option>{taxonomies.map((taxonomy) => <option key={taxonomy.id} value={taxonomy.id}>{taxonomy.name}</option>)}</select></label>{canManage ? <label className="text-xs font-semibold">สถานะ<select value={status} onChange={(event) => setStatus(event.target.value)} className={fieldClass}><option value="">ทุกสถานะ</option>{KNOWLEDGE_STATUSES.map((item) => <option key={item}>{item}</option>)}</select></label> : <div />}<p className="pb-2 text-right text-xs text-slate-400"><Tags className="mr-1 inline h-4 w-4" />{filtered.length} บทความ</p></CardBody></Card>
    {filtered.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filtered.map((article) => <ArticleCard key={article.id} article={article} canManage={canManage} onOpen={() => void openArticle(article)} onEdit={() => { setEditing(article); setShowForm(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />)}</div> : <EmptyState icon={<Search className="h-10 w-10" />} title="ไม่พบบทความ" message="ลองเปลี่ยนคำค้นหา Knowledge Taxonomy หรือสถานะ" />}
  </div>;
}
