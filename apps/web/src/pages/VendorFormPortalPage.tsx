import { useMutation, useQuery } from '@tanstack/react-query';
import { Building2, CheckCircle2, Clock3, FileText, Send, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { WordLikeEditor } from '../features/forms/WordLikeEditor';
import { apiFetch } from '../services/apiClient';
import type { VendorFormPortalData, VendorResponse } from '../types/forms';
import { formatThaiDate } from '../utils/date';

const fieldClass = 'mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20';
const initialResponse: Required<Pick<VendorResponse, 'slaCategory' | 'rootCause' | 'resolution' | 'creditType' | 'changeTypes' | 'assessorName'>> & VendorResponse = {
  slaCategory: 'Minor Case', rootCause: '', resolution: '', prevention: '', creditType: 'none', changeTypes: [], assessorName: '',
};

export function VendorFormPortalPage() {
  const { token = '' } = useParams();
  const [form, setForm] = useState(initialResponse);
  const [submitted, setSubmitted] = useState(false);
  const query = useQuery({ queryKey: ['vendor-form', token], queryFn: () => apiFetch<VendorFormPortalData>(`/api/v1/public/forms/${token}`), retry: false });
  useEffect(() => {
    if (query.data?.vendor_response?.submittedAt) setForm({ ...initialResponse, ...query.data.vendor_response });
  }, [query.data]);
  const submit = useMutation({
    mutationFn: () => apiFetch<{ id: string; form_no: string; status: string; vendor_responded_at: string }>(`/api/v1/public/forms/${token}/response`, { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => { setSubmitted(true); void query.refetch(); },
  });

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleChangeType(value: string) {
    const current = form.changeTypes ?? [];
    update('changeTypes', current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  if (query.isLoading) return <div className="flex min-h-screen items-center justify-center bg-slate-100 text-sm text-slate-500"><Clock3 className="mr-2 h-5 w-5 animate-pulse" />กำลังเปิดแบบฟอร์ม...</div>;
  if (query.isError || !query.data) return <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4"><Card className="max-w-lg"><CardBody className="py-12 text-center"><FileText className="mx-auto h-12 w-12 text-slate-300" /><h1 className="mt-4 text-xl font-extrabold text-slate-800">ไม่สามารถเปิดแบบฟอร์มได้</h1><p className="mt-2 text-sm text-slate-500">ลิงก์อาจไม่ถูกต้อง หมดอายุ หรือแบบฟอร์มถูกปิดแล้ว กรุณาติดต่อเจ้าหน้าที่ IT</p></CardBody></Card></div>;

  const data = query.data;
  if (submitted) return <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4"><Card className="max-w-xl"><CardBody className="py-12 text-center"><CheckCircle2 className="mx-auto h-16 w-16 text-emerald-500" /><h1 className="mt-4 text-2xl font-extrabold text-slate-900">ส่งผลการประเมินเรียบร้อยแล้ว</h1><p className="mt-2 text-slate-500">คำตอบของท่านถูกบันทึกใน {data.form_no} และแจ้งกลับไปยังทีม IT แล้ว</p></CardBody></Card></div>;

  return <div className="min-h-screen bg-slate-100 pb-12">
    <header className="border-b border-slate-200 bg-white shadow-sm"><div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-4"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-700 text-white"><Building2 className="h-6 w-6" /></div><div><p className="font-extrabold text-slate-900">Vendor Response Portal</p><p className="text-xs text-slate-500">แบบฟอร์มประเมินและตอบกลับงาน IT / ERP</p></div><div className="ml-auto hidden items-center gap-2 text-xs font-semibold text-emerald-700 sm:flex"><ShieldCheck className="h-4 w-4" />ลิงก์เฉพาะงาน · เข้ารหัสและมีวันหมดอายุ</div></div></header>
    <main className="mx-auto max-w-7xl space-y-4 px-4 py-6">
      <Card><CardBody className="grid gap-4 md:grid-cols-[1fr_auto]"><div><p className="text-xs font-bold uppercase tracking-wide text-primary-700">{data.form_no}</p><h1 className="mt-1 text-xl font-extrabold text-slate-900">{data.title}</h1><p className="mt-1 text-sm text-slate-500">{data.template?.name}{data.ticket ? ` · ${data.ticket.ticket_no} ${data.ticket.title}` : ''}</p></div><div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900"><p className="font-bold">กำหนดตอบกลับ</p><p>{data.vendor_due_at ? formatThaiDate(data.vendor_due_at) : 'ไม่ได้กำหนด'}</p></div></CardBody></Card>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_460px]">
        <div><p className="mb-2 text-sm font-bold text-slate-700">เอกสารแบบฟอร์มจากทีม IT</p><WordLikeEditor value={data.content_html} onChange={() => undefined} fileName={`${data.form_no}-${data.title}`} readOnly /></div>
        <Card className="h-fit xl:sticky xl:top-4"><CardHeader><p>ส่วนตอบกลับโดย Vendor / Outsource</p><p className="mt-1 text-xs font-normal text-slate-500">กรอก SLA, Root Cause, วิธีแก้ และ Manday/Credit ให้ครบก่อนส่ง</p></CardHeader><CardBody>
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); submit.mutate(); }}>
            <label className="block text-sm font-semibold">ประเภทงาน (SLA Category)<select value={form.slaCategory} onChange={(event) => update('slaCategory', event.target.value)} className={fieldClass}><option>Emergency Case</option><option>Minor Case</option><option>Other</option></select></label>
            <label className="block text-sm font-semibold">วันที่คาดว่าจะแก้ไขเสร็จ<input type="date" value={form.targetCompletionDate ?? ''} onChange={(event) => update('targetCompletionDate', event.target.value)} className={fieldClass} /></label>
            <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold">รับแจ้งเรื่อง<input value={form.receivedDuration ?? ''} onChange={(event) => update('receivedDuration', event.target.value)} placeholder="เช่น 45 นาที" className={fieldClass} /></label><label className="text-xs font-semibold">Workaround<input value={form.workaroundDuration ?? ''} onChange={(event) => update('workaroundDuration', event.target.value)} placeholder="เช่น 3 ชั่วโมง" className={fieldClass} /></label><label className="text-xs font-semibold">วิเคราะห์สาเหตุ<input value={form.analysisDuration ?? ''} onChange={(event) => update('analysisDuration', event.target.value)} className={fieldClass} /></label><label className="text-xs font-semibold">แก้ไขถาวร<input value={form.resolutionDuration ?? ''} onChange={(event) => update('resolutionDuration', event.target.value)} className={fieldClass} /></label></div>
            <label className="block text-sm font-semibold">สาเหตุหลัก (Root Cause Analysis)<textarea required rows={5} value={form.rootCause} onChange={(event) => update('rootCause', event.target.value)} className={fieldClass} /></label>
            <label className="block text-sm font-semibold">วิธีการแก้ไขปัญหา<textarea required rows={5} value={form.resolution} onChange={(event) => update('resolution', event.target.value)} className={fieldClass} /></label>
            <label className="block text-sm font-semibold">วิธีป้องกันไม่ให้เกิดซ้ำ<textarea rows={4} value={form.prevention ?? ''} onChange={(event) => update('prevention', event.target.value)} className={fieldClass} /></label>
            <fieldset className="rounded-lg border border-slate-200 p-3"><legend className="px-1 text-sm font-bold">Manday / Credit</legend><div className="space-y-2 text-sm"><label className="flex items-center gap-2"><input type="radio" checked={form.creditType === 'none'} onChange={() => update('creditType', 'none')} />ไม่ใช้ Credit (Bug / อยู่ในประกัน)</label><label className="flex items-center gap-2"><input type="radio" checked={form.creditType === 'manday'} onChange={() => update('creditType', 'manday')} />ใช้ Credit / Manday</label></div>{form.creditType === 'manday' && <div className="mt-3 space-y-3"><div className="flex flex-wrap gap-3">{['Adjust', 'Edit', 'Add', 'Delete'].map((item) => <label key={item} className="flex items-center gap-1.5 text-xs font-semibold"><input type="checkbox" checked={(form.changeTypes ?? []).includes(item)} onChange={() => toggleChangeType(item)} />{item}</label>)}</div><div className="grid grid-cols-3 gap-2"><label className="text-xs font-semibold">คงเหลือเดิม<input type="number" min={0} step="0.01" value={form.creditBalanceBefore ?? ''} onChange={(event) => update('creditBalanceBefore', event.target.value ? Number(event.target.value) : undefined)} className={fieldClass} /></label><label className="text-xs font-semibold">ใช้ครั้งนี้<input type="number" min={0} step="0.01" value={form.mandayUsed ?? ''} onChange={(event) => update('mandayUsed', event.target.value ? Number(event.target.value) : undefined)} className={fieldClass} /></label><label className="text-xs font-semibold">คงเหลือสุทธิ<input type="number" min={0} step="0.01" value={form.creditBalanceAfter ?? ''} onChange={(event) => update('creditBalanceAfter', event.target.value ? Number(event.target.value) : undefined)} className={fieldClass} /></label></div></div>}</fieldset>
            <label className="block text-sm font-semibold">หมายเหตุการประเมิน<textarea rows={3} value={form.assessmentNote ?? ''} onChange={(event) => update('assessmentNote', event.target.value)} className={fieldClass} /></label>
            <label className="block text-sm font-semibold">ชื่อผู้ประเมิน / ผู้รับจ้าง<input required value={form.assessorName} onChange={(event) => update('assessorName', event.target.value)} className={fieldClass} /></label>
            <p className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">เมื่อกดส่ง ระบบจะบันทึกชื่อผู้ประเมินและรายละเอียดข้างต้นไว้กับแบบฟอร์มงานนี้ เพื่อให้ทีม IT ตรวจรับและปิดงาน</p>
            <Button type="submit" className="w-full" isLoading={submit.isPending} disabled={!form.rootCause.trim() || !form.resolution.trim() || !form.assessorName.trim()}><Send className="h-4 w-4" />ส่งผลการประเมิน</Button>
          </form>
        </CardBody></Card>
      </div>
    </main>
  </div>;
}

