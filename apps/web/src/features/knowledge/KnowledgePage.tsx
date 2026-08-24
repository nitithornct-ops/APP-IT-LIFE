import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DeleteConfirmModal, DetailModal, FormModal } from '../../components/ui/Modal';
import {
  BookOpenCheck, CheckCircle2, Eye, FilePenLine, Loader2, Pencil, Plus,
  Search, Send, Tags, ThumbsUp, Trash2, X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageTitle } from '../../components/ui/PageTitle';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import {
  KNOWLEDGE_STATUSES, type KnowledgeArticle, type KnowledgeOverview, type KnowledgeStatus,
} from '../../types/knowledge';
import { formatThaiDate } from '../../utils/date';
import { helpfulRate, knowledgeMatches, normalizeKnowledgeTags } from './knowledgeDisplay';

const fieldClass = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900';

function errorText(reason: unknown, fallback: string) {
  return reason instanceof ApiError || reason instanceof Error ? reason.message : fallback;
}

function ArticleForm({ article, overview, onClose }: { article?: KnowledgeArticle; overview: KnowledgeOverview; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    title: article?.title ?? '', categoryId: article?.category_id ?? '', symptom: article?.symptom ?? '',
    solution: article?.solution ?? '', tags: article?.tags.join(', ') ?? '', status: article?.status ?? 'เผยแพร่' as KnowledgeStatus,
  });
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => apiFetch<KnowledgeArticle>(article ? `/api/v1/knowledge/articles/${article.id}` : '/api/v1/knowledge/articles', {
      method: article ? 'PATCH' : 'POST',
      body: JSON.stringify({ ...form, tags: normalizeKnowledgeTags(form.tags) }),
    }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['knowledge'] }); onClose(); },
    onError: (reason) => setError(errorText(reason, 'บันทึกบทความไม่สำเร็จ')),
  });
  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) { setForm((current) => ({ ...current, [key]: value })); }
  return <Card data-testid="knowledge-form" className="border-primary-200 dark:border-primary-900">
    <CardHeader className="flex items-center justify-between"><div><p>{article ? `แก้ไข ${article.article_code}` : 'เพิ่มบทความฐานความรู้'}</p><p className="mt-0.5 text-xs font-normal text-slate-500">เชื่อมหมวด Ticket · รองรับอาการ วิธีแก้ และแท็กค้นหา</p></div><button type="button" aria-label="ปิดแบบฟอร์ม" onClick={onClose}><X className="h-4 w-4" /></button></CardHeader>
    <CardBody><form className="grid gap-3 md:grid-cols-2 lg:grid-cols-4" onSubmit={(event) => { event.preventDefault(); setError(null); mutation.mutate(); }}>
      <label className="text-xs font-semibold md:col-span-2 lg:col-span-3">หัวข้อบทความ<input required maxLength={200} data-testid="knowledge-form-title" value={form.title} onChange={(event) => set('title', event.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold">สถานะ<select data-testid="knowledge-form-status" value={form.status} onChange={(event) => set('status', event.target.value as KnowledgeStatus)} className={fieldClass}>{KNOWLEDGE_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
      <label className="text-xs font-semibold md:col-span-2">หมวด Ticket<select data-testid="knowledge-form-category" value={form.categoryId} onChange={(event) => set('categoryId', event.target.value)} className={fieldClass}><option value="">— ไม่ระบุ —</option>{overview.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      <label className="text-xs font-semibold md:col-span-2">แท็ก คั่นด้วย comma<input data-testid="knowledge-form-tags" maxLength={500} value={form.tags} onChange={(event) => set('tags', event.target.value)} placeholder="wifi, network, windows" className={fieldClass} /></label>
      <label className="text-xs font-semibold md:col-span-2 lg:col-span-4">อาการ / ปัญหา<textarea data-testid="knowledge-form-symptom" rows={3} maxLength={2000} value={form.symptom} onChange={(event) => set('symptom', event.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold md:col-span-2 lg:col-span-4">วิธีแก้ไข<textarea required rows={7} maxLength={10000} data-testid="knowledge-form-solution" value={form.solution} onChange={(event) => set('solution', event.target.value)} className={fieldClass} /></label>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 md:col-span-2 lg:col-span-4 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
      <div className="flex gap-2 md:col-span-2 lg:col-span-4"><Button type="submit" size="sm" isLoading={mutation.isPending} disabled={!form.title.trim() || !form.solution.trim()} data-testid="knowledge-form-submit"><Send className="h-4 w-4" />บันทึกบทความ</Button><Button size="sm" variant="ghost" onClick={onClose}>ยกเลิก</Button></div>
    </form></CardBody>
  </Card>;
}

function ArticleDetail({ article, canFeedback, onClose }: { article: KnowledgeArticle; canFeedback: boolean; onClose: () => void }) {
  const queryClient = useQueryClient(); const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState({ count: article.helpful_count, voted: Boolean(article.has_voted) });
  const helpfulMutation = useMutation({
    mutationFn: () => apiFetch<{ helpfulCount: number; alreadyVoted: boolean }>(`/api/v1/knowledge/articles/${article.id}/helpful`, { method: 'POST' }),
    onSuccess: (result) => { setError(null); setFeedback({ count: result.helpfulCount, voted: true }); void queryClient.invalidateQueries({ queryKey: ['knowledge'] }); },
    onError: (reason) => setError(errorText(reason, 'บันทึกความคิดเห็นไม่สำเร็จ')),
  });
  return <Card data-testid={`knowledge-detail-${article.id}`} className="border-primary-200 dark:border-primary-900">
    <CardHeader className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><span>{article.title}</span><Badge variant={article.status === 'เผยแพร่' ? 'success' : 'warning'}>{article.status}</Badge></div><p className="mt-1 text-xs font-normal text-slate-500">{article.article_code} · อัปเดต {formatThaiDate(article.updated_at, 'd MMM yyyy HH:mm')}</p></div><button type="button" aria-label="ปิดบทความ" onClick={onClose}><X className="h-4 w-4" /></button></CardHeader>
    <CardBody className="space-y-5">
      {article.category && <Badge variant="primary">{article.category.name}</Badge>}
      {article.symptom && <section><h2 className="mb-1 text-sm font-bold text-primary-700 dark:text-primary-300">อาการ / ปัญหา</h2><p className="whitespace-pre-wrap text-sm leading-6">{article.symptom}</p></section>}
      <section><h2 className="mb-1 text-sm font-bold text-primary-700 dark:text-primary-300">วิธีแก้ไข</h2><p className="whitespace-pre-wrap text-sm leading-7">{article.solution}</p></section>
      {!!article.tags.length && <div className="flex flex-wrap gap-1">{article.tags.map((tag) => <span key={tag} className="rounded-full border border-slate-200 px-2 py-1 text-xs text-slate-500 dark:border-slate-700">#{tag}</span>)}</div>}
      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4 text-xs text-slate-500 dark:border-slate-700"><span><Eye className="mr-1 inline h-4 w-4" />{article.views_count} ครั้ง</span><span><ThumbsUp className="mr-1 inline h-4 w-4" />{feedback.count} · {helpfulRate({ ...article, helpful_count: feedback.count })}%</span><span>ผู้เขียน {article.author?.full_name ?? article.author?.email ?? '—'}</span>{canFeedback && <Button size="sm" variant="outline" className="ml-auto" disabled={feedback.voted} isLoading={helpfulMutation.isPending} onClick={() => helpfulMutation.mutate()} data-testid="knowledge-helpful"><ThumbsUp className="h-4 w-4" />{feedback.voted ? 'ให้คะแนนแล้ว' : 'มีประโยชน์'}</Button>}</div>
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
    <div className="mb-2 flex items-start gap-2"><BookOpenCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary-600" /><div className="min-w-0 flex-1"><p className="font-bold text-slate-800 dark:text-slate-100">{article.title}</p><p className="mt-0.5 text-xs text-slate-400">{article.article_code}</p></div>{article.status === 'ร่าง' && <Badge variant="warning">ร่าง</Badge>}</div>
    {article.category && <div className="mb-2"><Badge variant="primary">{article.category.name}</Badge></div>}
    <p className="line-clamp-3 flex-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{article.symptom || article.solution}</p>
    <div className="mt-4 flex flex-wrap items-center gap-2"><span className="text-xs text-slate-400"><Eye className="mr-1 inline h-3.5 w-3.5" />{article.views_count} · <ThumbsUp className="mr-1 inline h-3.5 w-3.5" />{article.helpful_count}</span><div className="ml-auto flex gap-1"><Button size="sm" onClick={onOpen}>อ่าน</Button>{canManage && <><Button size="sm" variant="outline" aria-label="แก้ไข" onClick={onEdit}><Pencil className="h-4 w-4" /></Button><Button size="sm" variant="outline" aria-label={article.status === 'เผยแพร่' ? 'เก็บเป็นร่าง' : 'เผยแพร่'} isLoading={statusMutation.isPending} onClick={() => statusMutation.mutate()}>{article.status === 'เผยแพร่' ? <FilePenLine className="h-4 w-4" /> : <Send className="h-4 w-4" />}</Button><Button size="sm" variant="ghost" aria-label="ลบบทความ" onClick={() => setShowDelete(true)}><Trash2 className="h-4 w-4 text-red-600" /></Button></>}</div></div>
  </CardBody></Card>{showDelete && <DeleteConfirmModal title="ลบบทความ" description="คุณต้องการลบบทความนี้หรือไม่?" isPending={deleteMutation.isPending} onClose={() => setShowDelete(false)} onConfirm={() => deleteMutation.mutate()}><div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-900/50"><p className="font-semibold">{article.article_code}</p><p className="text-slate-500">{article.title}</p></div><p className="mt-3 text-xs text-red-600">การดำเนินการนี้อาจไม่สามารถย้อนกลับได้</p></DeleteConfirmModal>}</>;
}

export function KnowledgePage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth(); const canManage = hasPermission('knowledge.manage'); const canFeedback = hasPermission('knowledge.feedback');
  const [search, setSearch] = useState(''); const [categoryId, setCategoryId] = useState(''); const [status, setStatus] = useState('');
  const [showForm, setShowForm] = useState(false); const [editing, setEditing] = useState<KnowledgeArticle>(); const [selected, setSelected] = useState<KnowledgeArticle>(); const [openError, setOpenError] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['knowledge'], queryFn: () => apiFetch<KnowledgeOverview>('/api/v1/knowledge') });
  const articles = useMemo(() => query.data?.articles ?? [], [query.data?.articles]);
  const filtered = articles.filter((article) => knowledgeMatches(article, search, categoryId) && (!status || article.status === status));
  const published = articles.filter((article) => article.status === 'เผยแพร่').length; const drafts = articles.length - published;
  const views = articles.reduce((sum, article) => sum + article.views_count, 0); const helpful = articles.reduce((sum, article) => sum + article.helpful_count, 0);
  async function openArticle(article: KnowledgeArticle) { try { setOpenError(null); // POST นี้แค่นับยอดเข้าชม ไม่ใช่การบันทึกของผู้ใช้ — silent ไว้ไม่ให้ขึ้น "บันทึกข้อมูลเรียบร้อยแล้ว" ทุกครั้งที่เปิดอ่าน
const data = await apiFetch<KnowledgeArticle>(`/api/v1/knowledge/articles/${article.id}/view`, { method: 'POST' }, { silent: true }); setSelected(data); void queryClient.invalidateQueries({ queryKey: ['knowledge'] }); } catch (reason) { setOpenError(errorText(reason, 'เปิดบทความไม่สำเร็จ')); } }
  if (query.isLoading) return <div className="flex justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-primary-600" /></div>;
  if (query.isError || !query.data) return <EmptyState icon={<BookOpenCheck className="h-10 w-10" />} title="โหลดฐานความรู้ไม่สำเร็จ" message={errorText(query.error, 'กรุณาลองใหม่')} />;
  return <div className="space-y-5" data-testid="knowledge-page">
    <div className="flex flex-wrap items-start justify-between gap-3"><PageTitle eyebrow="บริการและกระบวนการ IT / ฐานความรู้" title="ฐานความรู้ (Knowledge Base)" description="ค้นหาวิธีแก้ปัญหา คู่มือ และคำตอบมาตรฐานก่อนเปิด Ticket ใหม่" />{canManage && <Button data-testid="knowledge-create-toggle" onClick={() => { setEditing(undefined); setShowForm(true); }}><Plus className="h-4 w-4" />เพิ่มบทความ</Button>}</div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="บทความเผยแพร่" value={published} tone="teal" /><StatCard icon={<FilePenLine className="h-5 w-5" />} label="ฉบับร่าง" value={drafts} tone={drafts ? 'amber' : 'gray'} /><StatCard icon={<Eye className="h-5 w-5" />} label="การเข้าอ่านรวม" value={views} tone="primary" /><StatCard icon={<ThumbsUp className="h-5 w-5" />} label="มีประโยชน์" value={helpful} tone="primary" /></div>
    {showForm && <FormModal title={editing ? 'แก้ไขบทความ' : 'เพิ่มบทความ'} description="จัดการเนื้อหาฐานความรู้และสถานะการเผยแพร่" size="xl" onClose={() => { setShowForm(false); setEditing(undefined); }}><ArticleForm article={editing} overview={query.data} onClose={() => { setShowForm(false); setEditing(undefined); }} /></FormModal>}
    {selected && <DetailModal title={selected.title} description="รายละเอียดบทความฐานความรู้" onClose={() => setSelected(undefined)}><ArticleDetail key={selected.id} article={selected} canFeedback={canFeedback && selected.status === 'เผยแพร่'} onClose={() => setSelected(undefined)} /></DetailModal>}
    {openError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{openError}</p>}
    <Card><CardBody className="grid gap-3 md:grid-cols-[minmax(240px,1fr)_240px_180px_auto] md:items-end"><label className="text-xs font-semibold">ค้นหา<div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาอาการ วิธีแก้ หรือแท็ก..." className={`${fieldClass} pl-9`} /></div></label><label className="text-xs font-semibold">หมวด Ticket<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className={fieldClass}><option value="">ทุกหมวดหมู่</option>{query.data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>{canManage ? <label className="text-xs font-semibold">สถานะ<select value={status} onChange={(event) => setStatus(event.target.value)} className={fieldClass}><option value="">ทุกสถานะ</option>{KNOWLEDGE_STATUSES.map((item) => <option key={item}>{item}</option>)}</select></label> : <div />}<p className="pb-2 text-right text-xs text-slate-400"><Tags className="mr-1 inline h-4 w-4" />{filtered.length} บทความ</p></CardBody></Card>
    {filtered.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filtered.map((article) => <ArticleCard key={article.id} article={article} canManage={canManage} onOpen={() => void openArticle(article)} onEdit={() => { setEditing(article); setShowForm(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />)}</div> : <EmptyState icon={<Search className="h-10 w-10" />} title="ไม่พบบทความ" message="ลองเปลี่ยนคำค้น หมวดหมู่ หรือสถานะ" />}
  </div>;
}
