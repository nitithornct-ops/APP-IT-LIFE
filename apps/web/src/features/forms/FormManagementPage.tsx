import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Clock3,
  Copy,
  Edit3,
  ExternalLink,
  FileCheck2,
  FilePlus2,
  FileText,
  History,
  Library,
  Plus,
  Save,
  Search,
  Send,
  Share2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormModal, Modal } from '../../components/ui/Modal';
import { apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import type { FormReferences, FormTemplate, IssueForm, IssueFormStatus } from '../../types/forms';
import { formatThaiDate } from '../../utils/date';
import { WordLikeEditor } from './WordLikeEditor';

const fieldClass = 'mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-white';
const blankTemplate = '<h1 style="text-align:center">ชื่อแบบฟอร์ม</h1><p><strong>เลขที่เอกสาร:</strong> {{document_no}}</p><h2>ส่วนที่ 1: ข้อมูลทั่วไป</h2><p>เริ่มพิมพ์รายละเอียด หรือใช้แถบเครื่องมือเพื่อแทรกตารางและตัวแปรฟิลด์</p>';

const statusLabel: Record<IssueFormStatus, string> = {
  Draft: 'ฉบับร่าง',
  'Internal Review': 'รอตรวจสอบ',
  'Sent to Vendor': 'ส่ง Vendor แล้ว',
  'Vendor Replied': 'Vendor ตอบแล้ว',
  Approved: 'อนุมัติแล้ว',
  Closed: 'ปิดงาน',
  Cancelled: 'ยกเลิก',
};

function statusVariant(status: IssueFormStatus) {
  if (status === 'Closed' || status === 'Approved') return 'success' as const;
  if (status === 'Vendor Replied') return 'info' as const;
  if (status === 'Sent to Vendor' || status === 'Internal Review') return 'warning' as const;
  if (status === 'Cancelled') return 'danger' as const;
  return 'secondary' as const;
}

interface EditorState {
  kind: 'template' | 'issue';
  id: string;
  title: string;
  originalTitle: string;
  description: string;
  originalDescription: string;
  category: string;
  originalCategory: string;
  html: string;
  originalHtml: string;
  status?: IssueFormStatus;
  code: string;
  vendorResponse?: IssueForm['vendor_response'];
}

export function FormManagementPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('form.manage');
  const canSendVendor = hasPermission('form.vendor_send');
  const canClose = hasPermission('form.close');
  const [tab, setTab] = useState<'issues' | 'templates'>('issues');
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<EditorState>();
  const [showNewTemplate, setShowNewTemplate] = useState(false);
  const [showNewIssue, setShowNewIssue] = useState(false);
  const [showSendVendor, setShowSendVendor] = useState(false);
  const [shareResult, setShareResult] = useState<{ link: string; email: string | null; vendorName: string }>();
  const [newTemplate, setNewTemplate] = useState({ name: '', description: '', category: 'IT Support', contentHtml: blankTemplate });
  const [newIssue, setNewIssue] = useState({ title: '', templateId: '', ticketId: '' });
  const [vendorSend, setVendorSend] = useState({ vendorId: '', dueDate: '', expiresInDays: 14 });

  const templatesQuery = useQuery({ queryKey: ['form-templates'], queryFn: () => apiFetch<FormTemplate[]>('/api/v1/forms/templates') });
  const issuesQuery = useQuery({ queryKey: ['issue-forms'], queryFn: () => apiFetch<IssueForm[]>('/api/v1/forms/issues') });
  const referencesQuery = useQuery({ queryKey: ['form-references'], queryFn: () => apiFetch<FormReferences>('/api/v1/forms/references') });

  const filteredTemplates = useMemo(() => (templatesQuery.data ?? []).filter((item) => `${item.template_code} ${item.name} ${item.category}`.toLowerCase().includes(search.toLowerCase())), [search, templatesQuery.data]);
  const filteredIssues = useMemo(() => (issuesQuery.data ?? []).filter((item) => `${item.form_no} ${item.title} ${item.ticket?.ticket_no ?? ''} ${item.vendor?.name ?? ''}`.toLowerCase().includes(search.toLowerCase())), [issuesQuery.data, search]);

  const createTemplate = useMutation({
    mutationFn: () => apiFetch<FormTemplate>('/api/v1/forms/templates', { method: 'POST', body: JSON.stringify(newTemplate) }),
    onSuccess: (template) => {
      void queryClient.invalidateQueries({ queryKey: ['form-templates'] });
      setShowNewTemplate(false);
      openTemplate(template);
    },
  });
  const createIssue = useMutation({
    mutationFn: () => apiFetch<IssueForm>('/api/v1/forms/issues', { method: 'POST', body: JSON.stringify({ title: newIssue.title, templateId: newIssue.templateId, ticketId: newIssue.ticketId || null }) }),
    onSuccess: (issue) => {
      void queryClient.invalidateQueries({ queryKey: ['issue-forms'] });
      setShowNewIssue(false);
      openIssue(issue);
    },
  });
  const saveEditor = useMutation({
    mutationFn: async () => {
      if (!editor) throw new Error('ไม่ได้เลือกแบบฟอร์ม');
      return editor.kind === 'template'
        ? apiFetch<FormTemplate>(`/api/v1/forms/templates/${editor.id}`, { method: 'PATCH', body: JSON.stringify({ name: editor.title, description: editor.description, category: editor.category, contentHtml: editor.html }) })
        : apiFetch<IssueForm>(`/api/v1/forms/issues/${editor.id}`, { method: 'PATCH', body: JSON.stringify({ title: editor.title, contentHtml: editor.html }) });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: editor?.kind === 'template' ? ['form-templates'] : ['issue-forms'] });
      setEditor((current) => current ? { ...current, originalHtml: current.html, originalTitle: current.title, originalDescription: current.description, originalCategory: current.category } : current);
    },
  });
  const publishTemplate = useMutation({
    mutationFn: async () => {
      if (!editor || editor.kind !== 'template') throw new Error('ไม่ได้เลือก Template');
      if (editor.html !== editor.originalHtml || editor.title !== editor.originalTitle || editor.description !== editor.originalDescription || editor.category !== editor.originalCategory) {
        await apiFetch<FormTemplate>(`/api/v1/forms/templates/${editor.id}`, { method: 'PATCH', body: JSON.stringify({ name: editor.title, description: editor.description, category: editor.category, contentHtml: editor.html }) });
      }
      return apiFetch<FormTemplate>(`/api/v1/forms/templates/${editor.id}/publish`, { method: 'POST', body: JSON.stringify({ changeNote: 'เผยแพร่จาก Form Studio' }) });
    },
    onSuccess: (template) => {
      void queryClient.invalidateQueries({ queryKey: ['form-templates'] });
      setEditor((current) => current ? { ...current, code: `${template.template_code} · v${template.current_version}`, originalHtml: current.html, originalTitle: current.title, originalDescription: current.description, originalCategory: current.category } : current);
    },
  });
  const sendVendor = useMutation({
    mutationFn: () => apiFetch<{ issue: IssueForm; vendorLink: string; vendor: { name: string; email: string | null } }>(`/api/v1/forms/issues/${editor?.id}/send-vendor`, { method: 'POST', body: JSON.stringify(vendorSend) }),
    onSuccess: ({ issue, vendorLink, vendor }) => {
      void queryClient.invalidateQueries({ queryKey: ['issue-forms'] });
      setEditor((current) => current ? { ...current, status: issue.status } : current);
      setShowSendVendor(false);
      setShareResult({ link: `${window.location.origin}${vendorLink}`, email: vendor.email, vendorName: vendor.name });
    },
  });
  const closeIssue = useMutation({
    mutationFn: () => apiFetch<IssueForm>(`/api/v1/forms/issues/${editor?.id}/close`, { method: 'POST' }),
    onSuccess: (issue) => {
      void queryClient.invalidateQueries({ queryKey: ['issue-forms'] });
      setEditor((current) => current ? { ...current, status: issue.status } : current);
    },
  });

  function openTemplate(template: FormTemplate) {
    setEditor({ kind: 'template', id: template.id, title: template.name, originalTitle: template.name, description: template.description ?? '', originalDescription: template.description ?? '', category: template.category, originalCategory: template.category, html: template.content_html, originalHtml: template.content_html, code: `${template.template_code} · v${template.current_version}` });
  }

  function openIssue(issue: IssueForm) {
    setEditor({ kind: 'issue', id: issue.id, title: issue.title, originalTitle: issue.title, description: issue.template?.name ?? '', originalDescription: issue.template?.name ?? '', category: '', originalCategory: '', html: issue.content_html, originalHtml: issue.content_html, status: issue.status, code: `${issue.form_no} · Template v${issue.template_version}`, vendorResponse: issue.vendor_response });
  }

  const isDirty = editor ? editor.html !== editor.originalHtml || editor.title !== editor.originalTitle || editor.description !== editor.originalDescription || editor.category !== editor.originalCategory : false;
  const loading = templatesQuery.isLoading || issuesQuery.isLoading || referencesQuery.isLoading;
  const vendorReplyCount = (issuesQuery.data ?? []).filter((item) => item.status === 'Vendor Replied').length;
  const waitingVendorCount = (issuesQuery.data ?? []).filter((item) => item.status === 'Sent to Vendor').length;

  if (editor) {
    return <div className="space-y-3" data-testid="form-studio-editor">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" aria-label="กลับไปหน้ารายการ" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700" onClick={() => setEditor(undefined)}><X className="h-5 w-5" /></button>
          <div className="min-w-0">
            <input value={editor.title} disabled={!canManage} onChange={(event) => setEditor({ ...editor, title: event.target.value })} className="w-full min-w-[280px] truncate border-0 bg-transparent text-lg font-extrabold text-slate-900 outline-none disabled:opacity-100 dark:text-white" />
            <p className="text-xs text-slate-500">{editor.code}{editor.kind === 'issue' && editor.status ? ` · ${statusLabel[editor.status]}` : ''}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editor.kind === 'issue' && editor.status === 'Vendor Replied' && <Badge variant="info"><CheckCircle2 className="h-3.5 w-3.5" />มีคำตอบจาก Vendor</Badge>}
          {canManage && <Button size="sm" variant="outline" isLoading={saveEditor.isPending} disabled={!isDirty || !editor.title.trim()} onClick={() => saveEditor.mutate()}><Save className="h-4 w-4" />บันทึก</Button>}
          {editor.kind === 'template' && canManage && <Button size="sm" isLoading={publishTemplate.isPending} onClick={() => publishTemplate.mutate()}><FileCheck2 className="h-4 w-4" />เผยแพร่เวอร์ชัน</Button>}
          {editor.kind === 'issue' && canSendVendor && !['Closed', 'Cancelled'].includes(editor.status ?? '') && <Button size="sm" onClick={() => setShowSendVendor(true)}><Send className="h-4 w-4" />ส่งให้ Vendor</Button>}
          {editor.kind === 'issue' && canClose && editor.status === 'Vendor Replied' && <Button size="sm" variant="secondary" isLoading={closeIssue.isPending} onClick={() => closeIssue.mutate()}><CheckCircle2 className="h-4 w-4" />ตรวจรับและปิดงาน</Button>}
        </div>
      </div>
      {editor.kind === 'template' && <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-2 dark:border-slate-700 dark:bg-slate-800"><label className="text-xs font-semibold">คำอธิบาย<input value={editor.description} disabled={!canManage} onChange={(event) => setEditor({ ...editor, description: event.target.value })} className={fieldClass} /></label><label className="text-xs font-semibold">หมวดหมู่<input value={editor.category} disabled={!canManage} onChange={(event) => setEditor({ ...editor, category: event.target.value })} className={fieldClass} /></label></div>}
      <div className={editor.kind === 'issue' && editor.vendorResponse?.submittedAt ? 'grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]' : ''}>
        <WordLikeEditor value={editor.html} onChange={(html) => setEditor((current) => current ? { ...current, html } : current)} fileName={`${editor.code}-${editor.title}`} readOnly={!canManage || editor.status === 'Closed'} />
        {editor.kind === 'issue' && editor.vendorResponse?.submittedAt && <VendorResponsePanel response={editor.vendorResponse} />}
      </div>
      {showSendVendor && <FormModal title="ส่งแบบฟอร์มให้ Vendor" description="ระบบจะสร้างลิงก์เฉพาะงานและกำหนดวันหมดอายุ" onClose={() => setShowSendVendor(false)} footer={<><Button variant="ghost" onClick={() => setShowSendVendor(false)}>ยกเลิก</Button><Button isLoading={sendVendor.isPending} disabled={!vendorSend.vendorId} onClick={() => sendVendor.mutate()}><Share2 className="h-4 w-4" />สร้างลิงก์ส่งต่อ</Button></>}>
        <div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-semibold md:col-span-2">Vendor<select value={vendorSend.vendorId} onChange={(event) => setVendorSend({ ...vendorSend, vendorId: event.target.value })} className={fieldClass}><option value="">— เลือก Vendor —</option>{referencesQuery.data?.vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.vendor_code} · {vendor.name}{vendor.email ? ` · ${vendor.email}` : ''}</option>)}</select></label><label className="text-sm font-semibold">กำหนดตอบกลับ<input type="date" value={vendorSend.dueDate} onChange={(event) => setVendorSend({ ...vendorSend, dueDate: event.target.value })} className={fieldClass} /></label><label className="text-sm font-semibold">ลิงก์หมดอายุภายใน (วัน)<input type="number" min={1} max={60} value={vendorSend.expiresInDays} onChange={(event) => setVendorSend({ ...vendorSend, expiresInDays: Number(event.target.value) })} className={fieldClass} /></label></div>
      </FormModal>}
      {shareResult && <ShareLinkModal result={shareResult} subject={`แบบฟอร์มประเมินงาน ${editor.code}`} onClose={() => setShareResult(undefined)} />}
    </div>;
  }

  return <div className="space-y-5" data-testid="form-studio-page">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">Form Studio</h1><p className="mt-1 text-sm text-slate-500">สร้างแบบฟอร์มเหมือนเอกสาร Word จัดเวอร์ชัน และส่งให้ Vendor ตอบกลับในงานเดียวกัน</p></div>{canManage && <div className="flex gap-2"><Button variant="outline" onClick={() => setShowNewTemplate(true)}><FilePlus2 className="h-4 w-4" />สร้าง Template</Button><Button onClick={() => setShowNewIssue(true)}><Plus className="h-4 w-4" />สร้างแบบฟอร์มงาน</Button></div>}</div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><StatCard icon={<Library className="h-5 w-5" />} label="Templates" value={templatesQuery.data?.length ?? 0} /><StatCard icon={<FileText className="h-5 w-5" />} label="แบบฟอร์มงานทั้งหมด" value={issuesQuery.data?.length ?? 0} tone="gray" /><StatCard icon={<Clock3 className="h-5 w-5" />} label="รอ Vendor ตอบ" value={waitingVendorCount} tone="amber" /><StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="Vendor ตอบแล้ว" value={vendorReplyCount} tone="teal" /></div>
    <Card><CardBody className="flex flex-wrap items-center gap-3"><div className="flex rounded-lg bg-slate-100 p-1 dark:bg-slate-900"><button type="button" onClick={() => setTab('issues')} className={`rounded-md px-4 py-2 text-sm font-bold ${tab === 'issues' ? 'bg-white text-primary-700 shadow-sm dark:bg-slate-700 dark:text-primary-200' : 'text-slate-500'}`}>แบบฟอร์มงาน</button><button type="button" onClick={() => setTab('templates')} className={`rounded-md px-4 py-2 text-sm font-bold ${tab === 'templates' ? 'bg-white text-primary-700 shadow-sm dark:bg-slate-700 dark:text-primary-200' : 'text-slate-500'}`}>Template Library</button></div><label className="relative ml-auto min-w-[260px] flex-1 md:max-w-md"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาชื่อ เลขที่ Ticket หรือ Vendor..." className={`${fieldClass} mt-0 pl-9`} /></label></CardBody></Card>
    {loading ? <Card><CardBody className="py-16 text-center text-sm text-slate-500">กำลังโหลด Form Studio...</CardBody></Card> : tab === 'templates' ? <TemplateLibrary templates={filteredTemplates} canManage={canManage} onOpen={openTemplate} /> : <IssueLibrary issues={filteredIssues} onOpen={openIssue} />}
    {showNewTemplate && <FormModal title="สร้าง Template ใหม่" description="เริ่มจากเอกสารเปล่า แล้วจัดรูปแบบได้ใน Word-like Editor" size="lg" onClose={() => setShowNewTemplate(false)} footer={<><Button variant="ghost" onClick={() => setShowNewTemplate(false)}>ยกเลิก</Button><Button isLoading={createTemplate.isPending} disabled={!newTemplate.name.trim()} onClick={() => createTemplate.mutate()}><FilePlus2 className="h-4 w-4" />สร้างและเปิด Editor</Button></>}><div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-semibold md:col-span-2">ชื่อแบบฟอร์ม<input value={newTemplate.name} onChange={(event) => setNewTemplate({ ...newTemplate, name: event.target.value })} className={fieldClass} /></label><label className="text-sm font-semibold">หมวดหมู่<input value={newTemplate.category} onChange={(event) => setNewTemplate({ ...newTemplate, category: event.target.value })} className={fieldClass} /></label><label className="text-sm font-semibold md:col-span-2">คำอธิบาย<textarea rows={3} value={newTemplate.description} onChange={(event) => setNewTemplate({ ...newTemplate, description: event.target.value })} className={fieldClass} /></label></div></FormModal>}
    {showNewIssue && <FormModal title="สร้างแบบฟอร์มงาน" description="คัดลอก Template เวอร์ชันปัจจุบันมาเป็นเอกสารงานที่แก้ไขได้อิสระ" size="lg" onClose={() => setShowNewIssue(false)} footer={<><Button variant="ghost" onClick={() => setShowNewIssue(false)}>ยกเลิก</Button><Button isLoading={createIssue.isPending} disabled={!newIssue.title.trim() || !newIssue.templateId} onClick={() => createIssue.mutate()}><Plus className="h-4 w-4" />สร้างแบบฟอร์มงาน</Button></>}><div className="grid gap-4"><label className="text-sm font-semibold">ชื่อเรื่อง<input value={newIssue.title} onChange={(event) => setNewIssue({ ...newIssue, title: event.target.value })} className={fieldClass} /></label><label className="text-sm font-semibold">Template<select value={newIssue.templateId} onChange={(event) => setNewIssue({ ...newIssue, templateId: event.target.value })} className={fieldClass}><option value="">— เลือก Template —</option>{templatesQuery.data?.filter((item) => item.status !== 'Archived').map((template) => <option key={template.id} value={template.id}>{template.template_code} · {template.name} · v{template.current_version}</option>)}</select></label><label className="text-sm font-semibold">ผูกกับ Ticket (ไม่บังคับ)<select value={newIssue.ticketId} onChange={(event) => setNewIssue({ ...newIssue, ticketId: event.target.value })} className={fieldClass}><option value="">— ไม่ผูก Ticket —</option>{referencesQuery.data?.tickets.map((ticket) => <option key={ticket.id} value={ticket.id}>{ticket.ticket_no} · {ticket.title}</option>)}</select></label></div></FormModal>}
    {shareResult && <ShareLinkModal result={shareResult} subject="แบบฟอร์มประเมินงานจาก Form Studio" onClose={() => setShareResult(undefined)} />}
  </div>;
}

function TemplateLibrary({ templates, canManage, onOpen }: { templates: FormTemplate[]; canManage: boolean; onOpen: (item: FormTemplate) => void }) {
  if (!templates.length) return <Card><EmptyState icon={<Library className="h-10 w-10" />} title="ยังไม่มี Template" description="สร้างแบบฟอร์มใหม่เพื่อเริ่มใช้งาน Form Studio" /></Card>;
  return <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">{templates.map((template) => <Card key={template.id} className="flex flex-col"><CardHeader className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-primary-700 dark:text-primary-300">{template.template_code} · v{template.current_version}</p><p className="mt-1 line-clamp-2">{template.name}</p></div><Badge variant={template.status === 'Published' ? 'success' : template.status === 'Archived' ? 'secondary' : 'warning'}>{template.status}</Badge></CardHeader><CardBody className="flex flex-1 flex-col"><p className="line-clamp-3 text-sm text-slate-500">{template.description || 'ไม่มีคำอธิบาย'}</p><div className="mt-4 flex items-center justify-between text-xs text-slate-400"><span>{template.category}</span><span>แก้ไข {formatThaiDate(template.updated_at, 'd MMM yyyy HH:mm')}</span></div><Button className="mt-4 w-full" variant={canManage ? 'outline' : 'ghost'} onClick={() => onOpen(template)}>{canManage ? <Edit3 className="h-4 w-4" /> : <FileText className="h-4 w-4" />}{canManage ? 'เปิดใน Editor' : 'ดูแบบฟอร์ม'}</Button></CardBody></Card>)}</div>;
}

function IssueLibrary({ issues, onOpen }: { issues: IssueForm[]; onOpen: (item: IssueForm) => void }) {
  if (!issues.length) return <Card><EmptyState icon={<FileText className="h-10 w-10" />} title="ยังไม่มีแบบฟอร์มงาน" description="สร้างงานจาก Template แล้วผูก Ticket หรือส่งต่อ Vendor ได้ทันที" /></Card>;
  return <Card><div className="overflow-x-auto"><table className="w-full min-w-[920px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900/50"><tr><th className="px-4 py-3">เลขที่ / ชื่อเรื่อง</th><th className="px-4 py-3">Template / Ticket</th><th className="px-4 py-3">Vendor</th><th className="px-4 py-3">สถานะ</th><th className="px-4 py-3">อัปเดต</th><th className="px-4 py-3" /></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-700">{issues.map((issue) => <tr key={issue.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30"><td className="px-4 py-3"><p className="font-bold text-slate-800 dark:text-slate-100">{issue.form_no}</p><p className="max-w-sm truncate text-slate-500">{issue.title}</p></td><td className="px-4 py-3"><p>{issue.template?.name ?? '—'}</p><p className="text-xs text-primary-700 dark:text-primary-300">{issue.ticket ? `${issue.ticket.ticket_no} · ${issue.ticket.title}` : 'ไม่ผูก Ticket'}</p></td><td className="px-4 py-3">{issue.vendor?.name ?? '—'}</td><td className="px-4 py-3"><Badge variant={statusVariant(issue.status)}>{statusLabel[issue.status]}</Badge></td><td className="px-4 py-3 text-xs text-slate-500">{formatThaiDate(issue.updated_at, 'd MMM yyyy HH:mm')}</td><td className="px-4 py-3 text-right"><Button size="sm" variant="ghost" onClick={() => onOpen(issue)}><Edit3 className="h-4 w-4" />เปิด</Button></td></tr>)}</tbody></table></div></Card>;
}

function VendorResponsePanel({ response }: { response: IssueForm['vendor_response'] }) {
  return <Card className="h-fit xl:sticky xl:top-3"><CardHeader className="flex items-center gap-2"><History className="h-4 w-4 text-primary-600" />คำตอบจาก Vendor</CardHeader><CardBody className="space-y-4 text-sm"><div><p className="text-xs font-bold text-slate-500">ผู้ประเมิน</p><p>{response.assessorName ?? '—'}</p><p className="text-xs text-slate-400">{response.submittedAt ? formatThaiDate(response.submittedAt, 'd MMM yyyy HH:mm') : ''}</p></div><div className="grid grid-cols-2 gap-2"><div><p className="text-xs font-bold text-slate-500">SLA</p><p>{response.slaCategory ?? '—'}</p></div><div><p className="text-xs font-bold text-slate-500">กำหนดเสร็จ</p><p>{response.targetCompletionDate || '—'}</p></div></div><div><p className="text-xs font-bold text-slate-500">Root Cause</p><p className="whitespace-pre-wrap">{response.rootCause ?? '—'}</p></div><div><p className="text-xs font-bold text-slate-500">วิธีแก้ไข</p><p className="whitespace-pre-wrap">{response.resolution ?? '—'}</p></div>{response.prevention && <div><p className="text-xs font-bold text-slate-500">การป้องกันเกิดซ้ำ</p><p className="whitespace-pre-wrap">{response.prevention}</p></div>}<div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900"><p className="font-bold">Manday / Credit</p><p className="mt-1 text-xs text-slate-500">{response.creditType === 'manday' ? `ใช้ ${response.mandayUsed ?? 0} Manday · คงเหลือ ${response.creditBalanceAfter ?? '—'}` : 'ไม่ใช้ Credit / อยู่ในประกัน'}</p></div></CardBody></Card>;
}

function ShareLinkModal({ result, subject, onClose }: { result: { link: string; email: string | null; vendorName: string }; subject: string; onClose: () => void }) {
  return <Modal title="ลิงก์ Vendor พร้อมส่ง" description={`${result.vendorName}${result.email ? ` · ${result.email}` : ''}`} contentPadding="default" onClose={onClose} footer={<Button onClick={onClose}>เสร็จสิ้น</Button>}><div className="space-y-4"><div className="rounded-lg border border-primary-200 bg-primary-50 p-3 text-sm text-primary-900 dark:border-primary-800 dark:bg-primary-950/40 dark:text-primary-100"><p className="font-bold">ลิงก์นี้เข้าถึงเฉพาะแบบฟอร์มงานนี้</p><p className="mt-1 break-all font-mono text-xs">{result.link}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void navigator.clipboard.writeText(result.link)}><Copy className="h-4 w-4" />คัดลอกลิงก์</Button>{result.email && <a href={`mailto:${result.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`กรุณาประเมินและตอบกลับผ่านลิงก์นี้\n${result.link}`)}`} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-primary-700"><ExternalLink className="h-4 w-4" />เปิดอีเมล</a>}</div></div></Modal>;
}
