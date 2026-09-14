import {
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ExternalLink,
  FileText,
  GitBranch,
  Link2,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import type { ServiceCatalogStatus } from '../../types/serviceCatalog';

export interface ServiceCatalogPreviewData {
  serviceCode: string;
  serviceName: string;
  category: string | null;
  description: string | null;
  owner: string | null;
  audience: string | null;
  eligibilityRoles: string[];
  eligibilityDepartments: string[];
  slaHours: number;
  fulfillmentGroup: string | null;
  approvalWorkflow: string;
  formVersion: number;
  cost: number | null;
  documentationUrl: string | null;
  knowledge: Array<{ title: string; summary?: string; url?: string }>;
  dependencies: Array<{ type?: string; value?: string; label?: string }>;
  effectiveDate: string | null;
  reviewDate: string | null;
  status: ServiceCatalogStatus;
  formSchema: unknown[];
  checklist: unknown[];
}

interface ServiceCatalogPreviewProps {
  data: ServiceCatalogPreviewData;
  onClose: () => void;
  onPublish?: () => void;
  isPublishing?: boolean;
  error?: string | null;
}

const statusLabels: Record<ServiceCatalogStatus, string> = {
  draft: 'Draft / ร่าง',
  active: 'Published / ใช้งาน',
  suspended: 'Suspended / ระงับ',
  retired: 'Retired / ยกเลิก',
};

function displayValue(value: string | null | undefined) {
  return value?.trim() || '—';
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const parsed = new Date(value + 'T00:00:00');
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }).format(parsed);
}

function formatCost(value: number | null) {
  if (value == null) return '—';
  return new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 2 }).format(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function metadataCard(label: string, value: ReactNode, icon: ReactNode) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/50">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">{value}</div>
    </div>
  );
}

function PreviewField({ field, index }: { field: Record<string, unknown>; index: number }) {
  const label = String(field.label ?? field.key ?? ('Field ' + (index + 1)));
  const type = String(field.type ?? 'text');
  const required = Boolean(field.required);
  const placeholder = type === 'textarea'
    ? 'ช่องข้อความหลายบรรทัด'
    : type === 'select'
      ? 'รายการตัวเลือก'
      : type === 'checkbox'
        ? 'ตัวเลือกแบบ checkbox'
        : 'ช่องกรอกข้อมูล (' + type + ')';

  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
        {label}
        {required && <span className="ml-1 text-rose-500">*</span>}
      </p>
      <div className="mt-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-400 dark:border-slate-600 dark:bg-slate-800">
        {placeholder}
      </div>
    </div>
  );
}

export function ServiceCatalogPreview({ data, onClose, onPublish, isPublishing = false, error }: ServiceCatalogPreviewProps) {
  const formFields = data.formSchema.filter(isRecord);
  const checklistItems = data.checklist.filter(isRecord);
  const lifecycleIndex = data.status === 'retired' ? 2 : data.status === 'active' || data.status === 'suspended' ? 1 : 0;
  const hasEligibility = data.eligibilityRoles.length > 0 || data.eligibilityDepartments.length > 0;

  return (
    <Modal
      title="Preview ก่อน Publish"
      description={data.serviceCode + ' · ตรวจสอบข้อมูลที่ผู้ขอจะเห็นก่อนเปิดใช้งาน'}
      size="xl"
      onClose={onClose}
      testId="service-catalog-preview"
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>กลับไปแก้ไข</Button>
          {onPublish && data.status !== 'active' && data.status !== 'retired' && (
            <Button data-testid="catalog-preview-publish" onClick={onPublish} isLoading={isPublishing}>
              Publish Service
            </Button>
          )}
        </>
      )}
    >
      <div className="space-y-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-primary-200 bg-primary-50/70 p-4 dark:border-primary-800 dark:bg-primary-950/30">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary-700 dark:text-primary-300">{data.serviceCode}</p>
            <h3 className="mt-1 text-2xl font-extrabold text-slate-900 dark:text-white">{data.serviceName}</h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{displayValue(data.category)}</p>
          </div>
          <Badge variant={data.status === 'active' ? 'success' : data.status === 'retired' ? 'danger' : data.status === 'suspended' ? 'warning' : 'secondary'}>
            {statusLabels[data.status]}
          </Badge>
        </div>

        <section aria-label="Service lifecycle" className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
          <div className="flex flex-wrap items-center gap-2">
            {['Draft', 'Publish', 'Retire'].map((step, index) => (
              <div key={step} className="flex items-center gap-2">
                <span className={index <= lifecycleIndex ? 'grid h-8 w-8 place-items-center rounded-full bg-primary-700 text-xs font-extrabold text-white' : 'grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-xs font-extrabold text-slate-400 dark:bg-slate-800'}>
                  {index < lifecycleIndex ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
                </span>
                <span className={index <= lifecycleIndex ? 'text-sm font-bold text-primary-800 dark:text-primary-200' : 'text-sm font-bold text-slate-400'}>{step}</span>
                {index < 2 && <span className="mx-1 h-px w-8 bg-slate-200 dark:bg-slate-700" />}
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            ตรวจสอบ Preview นี้ก่อน Publish เพื่อให้ผู้ขอเห็นข้อมูลบริการและแบบฟอร์มที่ถูกต้อง
          </p>
        </section>

        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{error}</p>}

        <section>
          <h4 className="mb-3 flex items-center gap-2 text-sm font-extrabold text-slate-900 dark:text-white"><GitBranch className="h-4 w-4 text-primary-600" />Service Metadata</h4>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {metadataCard('Service Owner', data.owner, <Users className="h-4 w-4 text-primary-600" />)}
            {metadataCard('Audience', data.audience, <Users className="h-4 w-4 text-primary-600" />)}
            {metadataCard('Eligibility', hasEligibility ? [...data.eligibilityRoles, ...data.eligibilityDepartments].join(' · ') : 'ทุกคนที่มีสิทธิ์ยื่นคำขอ', <CheckCircle2 className="h-4 w-4 text-primary-600" />)}
            {metadataCard('SLA', data.slaHours + ' ชั่วโมง', <CalendarDays className="h-4 w-4 text-primary-600" />)}
            {metadataCard('Fulfillment Group', data.fulfillmentGroup, <Users className="h-4 w-4 text-primary-600" />)}
            {metadataCard('Approval Workflow', data.approvalWorkflow, <GitBranch className="h-4 w-4 text-primary-600" />)}
            {metadataCard('Form Version', 'v' + data.formVersion, <FileText className="h-4 w-4 text-primary-600" />)}
            {metadataCard('Cost', formatCost(data.cost), <CircleDollarSign className="h-4 w-4 text-primary-600" />)}
            {metadataCard('Effective Date', formatDate(data.effectiveDate), <CalendarDays className="h-4 w-4 text-primary-600" />)}
            {metadataCard('Review Date', formatDate(data.reviewDate), <CalendarDays className="h-4 w-4 text-primary-600" />)}
            {metadataCard('Dependency', data.dependencies.length ? data.dependencies.length + ' รายการ' : 'ไม่มี', <Link2 className="h-4 w-4 text-primary-600" />)}
            {metadataCard('Knowledge', data.knowledge.length ? data.knowledge.length + ' บทความ' : 'ไม่มี', <FileText className="h-4 w-4 text-primary-600" />)}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
          <h4 className="text-sm font-extrabold text-slate-900 dark:text-white">คำอธิบายบริการ</h4>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">{displayValue(data.description)}</p>
          {data.documentationUrl && (
            <a href={data.documentationUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary-700 hover:underline dark:text-primary-300">
              <ExternalLink className="h-4 w-4" />Documentation
            </a>
          )}
        </section>

        {data.knowledge.length > 0 && (
          <section>
            <h4 className="mb-3 text-sm font-extrabold text-slate-900 dark:text-white">Knowledge ที่แนะนำ</h4>
            <div className="grid gap-3 md:grid-cols-2">
              {data.knowledge.map((article) => (
                <div key={article.title + '-' + (article.url ?? '')} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  {article.url ? <a href={article.url} target="_blank" rel="noreferrer" className="font-semibold text-primary-700 hover:underline dark:text-primary-300">{article.title}</a> : <p className="font-semibold text-slate-800 dark:text-slate-100">{article.title}</p>}
                  {article.summary && <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{article.summary}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {data.dependencies.length > 0 && (
          <section>
            <h4 className="mb-3 text-sm font-extrabold text-slate-900 dark:text-white">Dependency ที่ต้องผ่านก่อนยื่นคำขอ</h4>
            <ul className="space-y-2">
              {data.dependencies.map((dependency, index) => <li key={(dependency.type ?? 'dependency') + '-' + index} className="flex gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200"><Link2 className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" />{displayValue(dependency.label ?? dependency.value ?? dependency.type)}</li>)}
            </ul>
          </section>
        )}

        <section>
          <h4 className="mb-3 flex items-center gap-2 text-sm font-extrabold text-slate-900 dark:text-white"><FileText className="h-4 w-4 text-primary-600" />แบบฟอร์มคำขอ</h4>
          {formFields.length > 0 ? <div className="grid gap-3 md:grid-cols-2">{formFields.map((field, index) => <PreviewField key={String(field.key ?? index)} field={field} index={index} />)}</div> : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-800 dark:text-slate-400">บริการนี้ไม่มีฟิลด์แบบฟอร์มเพิ่มเติม</p>}
        </section>

        <section>
          <h4 className="mb-3 flex items-center gap-2 text-sm font-extrabold text-slate-900 dark:text-white"><CheckCircle2 className="h-4 w-4 text-primary-600" />Checklist</h4>
          {checklistItems.length > 0 ? <ul className="grid gap-2 md:grid-cols-2">{checklistItems.map((item, index) => <li key={String(item.name ?? 'checklist') + '-' + index} className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200">{String(item.name ?? ('Checklist ' + (index + 1)))}</li>)}</ul> : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-800 dark:text-slate-400">ไม่มี Checklist</p>}
        </section>
      </div>
    </Modal>
  );
}
