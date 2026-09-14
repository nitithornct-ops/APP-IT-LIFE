import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, FileText, KeyRound, Loader2, Plus, RefreshCw, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { FormModal } from '../../components/ui/Modal';
import { PageTitle } from '../../components/ui/PageTitle';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import type { PaginatedResult } from '../../types/admin';
import {
  CONTRACT_STATUSES,
  CONTRACT_TYPES,
  RENEWAL_DECISIONS,
  VENDOR_ASSESSMENT_STATUSES,
  VENDOR_CRITICALITY_TIERS,
  VENDOR_NDA_STATUSES,
  VENDOR_SERVICE_TYPES,
  type Contract,
  type ContractReferences,
  type Vendor,
  type VendorPortalAccount,
  type VendorReferences,
} from '../../types/vendorsContracts';

const fieldClass = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900';
type ActiveTab = 'vendors' | 'contracts';

function errorText(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function listValue(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function VendorForm({ vendor, references, onClose }: { vendor?: Vendor; references: VendorReferences; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: vendor?.name ?? '', serviceType: vendor?.service_type ?? VENDOR_SERVICE_TYPES[0], serviceScope: vendor?.service_scope ?? '',
    contactPerson: vendor?.contact_person ?? '', phone: vendor?.phone ?? '', email: vendor?.email ?? '', contactInfo: vendor?.contact_info ?? '',
    ownerId: vendor?.owner_id ?? '', notes: vendor?.notes ?? '', criticalityTier: vendor?.criticality_tier ?? 'Medium',
    vendorRiskAssessment: vendor?.vendor_risk_assessment ?? '', securityAssessment: vendor?.security_assessment ?? '', dpaStatus: vendor?.dpa_status ?? 'Not Assessed',
    ndaStatus: vendor?.nda_status ?? 'Not Assessed', dataAccess: vendor?.data_access ?? '', systemsAccessed: vendor?.systems_accessed?.join(', ') ?? '', sla: vendor?.sla ?? '',
    incidentContact: vendor?.incident_contact ?? '', escalationContact: vendor?.escalation_contact ?? '', performanceReview: vendor?.performance_review ?? '', annualReview: vendor?.annual_review ?? '',
    performanceReviewDate: vendor?.performance_review_date ?? '', annualReviewDate: vendor?.annual_review_date ?? '', contractNumber: '', contractStart: '', contractEnd: '',
  });
  const [error, setError] = useState('');
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const mutation = useMutation({
    mutationFn: () => apiFetch<Vendor>(vendor ? `/api/v1/vendors/${vendor.id}` : '/api/v1/vendors', {
      method: vendor ? 'PATCH' : 'POST',
      body: JSON.stringify({
        name: form.name, serviceType: form.serviceType, serviceScope: form.serviceScope, contactPerson: form.contactPerson, phone: form.phone,
        email: form.email, contactInfo: form.contactInfo, ownerId: form.ownerId || null, notes: form.notes, criticalityTier: form.criticalityTier,
        vendorRiskAssessment: form.vendorRiskAssessment, securityAssessment: form.securityAssessment, dpaStatus: form.dpaStatus, ndaStatus: form.ndaStatus,
        dataAccess: form.dataAccess, systemsAccessed: listValue(form.systemsAccessed), sla: form.sla, incidentContact: form.incidentContact,
        escalationContact: form.escalationContact, performanceReview: form.performanceReview, annualReview: form.annualReview, performanceReviewDate: form.performanceReviewDate,
        annualReviewDate: form.annualReviewDate,
        ...(!vendor && form.contractNumber ? { initialContract: { contractNumber: form.contractNumber, startDate: form.contractStart, endDate: form.contractEnd } } : {}),
      }),
    }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['vendors-contracts'] }); onClose(); },
    onError: (reason) => setError(errorText(reason, 'Unable to save vendor')),
  });
  return <Card data-testid="vendor-form"><CardHeader className="flex items-center justify-between"><span>{vendor ? `Edit ${vendor.name}` : 'Add Vendor'}</span><button type="button" aria-label="Close" onClick={onClose}><X className="h-4 w-4" /></button></CardHeader><CardBody>
    <form className="grid gap-3 sm:grid-cols-4" onSubmit={(event) => { event.preventDefault(); setError(''); mutation.mutate(); }}>
      <label className="text-xs font-semibold sm:col-span-2">Vendor name<input required maxLength={200} data-testid="vendor-name" value={form.name} onChange={(e) => set('name', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold">Service type<select value={form.serviceType} onChange={(e) => set('serviceType', e.target.value)} className={fieldClass}>{VENDOR_SERVICE_TYPES.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="text-xs font-semibold">Owner<select value={form.ownerId} onChange={(e) => set('ownerId', e.target.value)} className={fieldClass}><option value="">— None —</option>{references.owners.map((item) => <option key={item.id} value={item.id}>{item.full_name ?? item.email}</option>)}</select></label>
      <label className="text-xs font-semibold">Contact person<input value={form.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold">Phone<input value={form.phone} onChange={(e) => set('phone', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold">Email<input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold">Other contact info<input value={form.contactInfo} onChange={(e) => set('contactInfo', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold sm:col-span-4">Service scope<textarea rows={2} value={form.serviceScope} onChange={(e) => set('serviceScope', e.target.value)} className={fieldClass} /></label>
      <div className="sm:col-span-4 border-t pt-3 text-sm font-bold">Risk, privacy & security</div>
      <label className="text-xs font-semibold">Criticality / Tier<select value={form.criticalityTier} onChange={(e) => set('criticalityTier', e.target.value)} className={fieldClass}>{VENDOR_CRITICALITY_TIERS.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="text-xs font-semibold">DPA Status<select value={form.dpaStatus} onChange={(e) => set('dpaStatus', e.target.value)} className={fieldClass}>{VENDOR_ASSESSMENT_STATUSES.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="text-xs font-semibold">NDA<select value={form.ndaStatus} onChange={(e) => set('ndaStatus', e.target.value)} className={fieldClass}>{VENDOR_NDA_STATUSES.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="text-xs font-semibold">Incident contact<input value={form.incidentContact} onChange={(e) => set('incidentContact', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold">Escalation contact<input value={form.escalationContact} onChange={(e) => set('escalationContact', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold sm:col-span-2">Data access<textarea rows={2} value={form.dataAccess} onChange={(e) => set('dataAccess', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold sm:col-span-2">Systems accessed (comma separated)<input value={form.systemsAccessed} onChange={(e) => set('systemsAccessed', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold sm:col-span-2">Vendor risk assessment<textarea rows={3} value={form.vendorRiskAssessment} onChange={(e) => set('vendorRiskAssessment', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold sm:col-span-2">Security assessment<textarea rows={3} value={form.securityAssessment} onChange={(e) => set('securityAssessment', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold sm:col-span-2">SLA<textarea rows={2} value={form.sla} onChange={(e) => set('sla', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold sm:col-span-2">Performance review<textarea rows={2} value={form.performanceReview} onChange={(e) => set('performanceReview', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold sm:col-span-2">Annual review<textarea rows={2} value={form.annualReview} onChange={(e) => set('annualReview', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold">Performance review date<input type="date" value={form.performanceReviewDate} onChange={(e) => set('performanceReviewDate', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold">Annual review date<input type="date" value={form.annualReviewDate} onChange={(e) => set('annualReviewDate', e.target.value)} className={fieldClass} /></label>
      {!vendor && <><div className="sm:col-span-4 border-t pt-3 text-sm font-bold">Initial contract (optional)</div><label className="text-xs font-semibold sm:col-span-2">Contract number<input value={form.contractNumber} onChange={(e) => set('contractNumber', e.target.value)} className={fieldClass} /></label><label className="text-xs font-semibold">Start date<input type="date" value={form.contractStart} onChange={(e) => set('contractStart', e.target.value)} className={fieldClass} /></label><label className="text-xs font-semibold">End date<input type="date" value={form.contractEnd} onChange={(e) => set('contractEnd', e.target.value)} className={fieldClass} /></label></>}
      <label className="text-xs font-semibold sm:col-span-4">Notes<textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} className={fieldClass} /></label>
      {error && <p className="text-sm text-red-600 sm:col-span-4">{error}</p>}<div className="sm:col-span-4"><Button type="submit" size="sm" isLoading={mutation.isPending} data-testid="vendor-submit">Save Vendor</Button></div>
    </form>
  </CardBody></Card>;
}

function VendorPortalAccounts({ vendor, onClose }: { vendor: Vendor; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ username: (vendor.email?.split('@')[0] ?? 'vendor').toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(0, 32), email: vendor.email ?? '', fullName: vendor.contact_person ?? '', position: '' });
  const [error, setError] = useState('');
  const queryKey = ['vendors-contracts', 'portal-accounts', vendor.id];
  const accountsQuery = useQuery({ queryKey, queryFn: () => apiFetch<VendorPortalAccount[]>(`/api/v1/vendors/${vendor.id}/portal-accounts`) });
  const createMutation = useMutation({
    mutationFn: () => apiFetch<VendorPortalAccount>(`/api/v1/vendors/${vendor.id}/portal-accounts`, { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey }); setForm({ username: '', email: '', fullName: '', position: '' }); setError('Invite sent. The vendor will set their own password and MFA.'); },
    onError: (reason) => setError(errorText(reason, 'Unable to send invite')),
  });
  const inviteMutation = useMutation({
    mutationFn: (account: VendorPortalAccount) => apiFetch<VendorPortalAccount>(`/api/v1/vendors/${vendor.id}/portal-accounts/${account.id}/invite`, { method: 'POST', body: '{}' }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey }); setError('Invite resent. Any previous vendor session and MFA factor was revoked.'); },
    onError: (reason) => setError(errorText(reason, 'Unable to resend invite')),
  });
  const statusMutation = useMutation({
    mutationFn: ({ account, status }: { account: VendorPortalAccount; status: 'Active' | 'Inactive' }) => apiFetch(`/api/v1/vendors/${vendor.id}/portal-accounts/${account.id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
    onError: (reason) => setError(errorText(reason, 'Unable to update account status')),
  });
  return <Card><CardHeader className="flex items-center justify-between"><span>Vendor Portal accounts — {vendor.name}</span><button type="button" aria-label="Close" onClick={onClose}><X className="h-4 w-4" /></button></CardHeader><CardBody>
    <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">Vendor signs in at <span className="font-mono">/vendor/portal</span> with company code <span className="font-mono font-bold text-primary-700">{vendor.vendor_code}</span>. Admin never receives or sets a vendor password.</div>
    <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); setError(''); createMutation.mutate(); }}>
      <label className="text-xs font-semibold">Full name<input required value={form.fullName} onChange={(e) => setForm((v) => ({ ...v, fullName: e.target.value }))} className={fieldClass} /></label>
      <label className="text-xs font-semibold">Position<input value={form.position} onChange={(e) => setForm((v) => ({ ...v, position: e.target.value }))} className={fieldClass} /></label>
      <label className="text-xs font-semibold">Username<input required pattern="[A-Za-z0-9._-]{3,32}" value={form.username} onChange={(e) => setForm((v) => ({ ...v, username: e.target.value.toLowerCase() }))} className={fieldClass} /></label>
      <label className="text-xs font-semibold">Email<input required type="email" value={form.email} onChange={(e) => setForm((v) => ({ ...v, email: e.target.value }))} className={fieldClass} /></label>
      {error && <p className="text-sm font-semibold text-red-600 sm:col-span-2">{error}</p>}<div className="sm:col-span-2"><Button type="submit" size="sm" isLoading={createMutation.isPending}><UserPlus className="h-4 w-4" />Create account & send invite</Button></div>
    </form>
    <div className="mt-5 border-t pt-4"><p className="mb-3 text-sm font-bold">Accounts</p>{accountsQuery.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <div className="space-y-2">{accountsQuery.data?.map((account) => <div key={account.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"><div><p className="text-sm font-bold">{account.full_name}</p><p className="text-xs text-slate-500"><span className="font-mono text-primary-700">{account.username}</span> · {account.email}</p><p className="mt-1 text-[11px] text-slate-400">Invite: {account.invite_status} · MFA: {account.mfa_enrolled_at ? 'Enrolled' : 'Not enrolled'}</p></div><div className="flex flex-wrap items-center gap-2"><Badge variant={account.status === 'Active' ? 'success' : 'neutral'}>{account.status}</Badge><Button size="sm" variant="outline" isLoading={inviteMutation.isPending} onClick={() => inviteMutation.mutate(account)}><KeyRound className="h-4 w-4" />Resend invite</Button><Button size="sm" variant="outline" onClick={() => statusMutation.mutate({ account, status: account.status === 'Active' ? 'Inactive' : 'Active' })}>{account.status === 'Active' ? 'Disable' : 'Enable'}</Button></div></div>)}</div>}</div>
  </CardBody></Card>;
}

function ContractForm({ contract, references, onClose }: { contract?: Contract; references: ContractReferences; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    contractNumber: contract?.contract_number ?? '', name: contract?.name ?? '', vendorId: contract?.vendor_id ?? '', contractType: contract?.contract_type ?? 'Other',
    startDate: contract?.start_date ?? '', endDate: contract?.end_date ?? '', contractValue: contract?.contract_value?.toString() ?? '', currency: contract?.currency ?? 'THB', ownerId: contract?.owner_id ?? '',
    budget: contract?.budget?.toString() ?? '', annualCost: contract?.annual_cost?.toString() ?? '', autoRenewal: contract?.auto_renewal ? 'true' : 'false', renewalNoticeDays: String(contract?.renewal_notice_days ?? 30),
    slaOla: contract?.sla_ola ?? '', dpaAttachmentId: contract?.dpa_attachment_id ?? '', securityClause: contract?.security_clause ?? '', renewalDecision: contract?.renewal_decision ?? 'Pending',
    terminationChecklist: contract?.termination_checklist?.join('\n') ?? '', linkedAssetIds: contract?.contract_assets?.map((item) => item.asset?.id).filter((id): id is string => Boolean(id)).join(', ') ?? '', linkedLicenseIds: contract?.contract_licenses?.map((item) => item.license?.id).filter((id): id is string => Boolean(id)).join(', ') ?? '', linkedConfigurationItemIds: contract?.contract_configuration_items?.map((item) => item.configuration_item?.id).filter((id): id is string => Boolean(id)).join(', ') ?? '', status: contract?.status ?? 'Draft', serviceScope: contract?.service_scope ?? '', keyTerms: contract?.key_terms ?? '', notes: contract?.notes ?? '',
  });
  const [error, setError] = useState('');
  const [dpaFile, setDpaFile] = useState<File | null>(null);
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const mutation = useMutation({
    mutationFn: async () => {
      const saved = await apiFetch<Contract>(contract ? `/api/v1/contracts/${contract.id}` : '/api/v1/contracts', {
      method: contract ? 'PATCH' : 'POST',
      body: JSON.stringify({ ...form, ownerId: form.ownerId || null, contractValue: form.contractValue ? Number(form.contractValue) : undefined, budget: form.budget ? Number(form.budget) : undefined, annualCost: form.annualCost ? Number(form.annualCost) : undefined, autoRenewal: form.autoRenewal === 'true', renewalNoticeDays: Number(form.renewalNoticeDays), dpaAttachmentId: form.dpaAttachmentId || null, linkedAssetIds: listValue(form.linkedAssetIds), linkedLicenseIds: listValue(form.linkedLicenseIds), linkedConfigurationItemIds: listValue(form.linkedConfigurationItemIds), terminationChecklist: form.terminationChecklist.split('\n').map((item) => item.trim()).filter(Boolean) }),
      });
      if (dpaFile) {
        const upload = new FormData();
        upload.append('file', dpaFile);
        upload.append('module', 'contract');
        upload.append('targetTable', 'contracts');
        upload.append('targetId', saved.id);
        const attachment = await apiFetch<{ id: string }>('/api/v1/files', { method: 'POST', body: upload });
        await apiFetch(`/api/v1/contracts/${saved.id}`, { method: 'PATCH', body: JSON.stringify({ dpaAttachmentId: attachment.id }) });
      }
      return saved;
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['vendors-contracts'] }); onClose(); },
    onError: (reason) => setError(errorText(reason, 'Unable to save contract')),
  });
  return <Card data-testid="contract-form"><CardHeader className="flex items-center justify-between"><span>{contract ? `Edit ${contract.contract_number}` : 'Add Contract'}</span><button type="button" aria-label="Close" onClick={onClose}><X className="h-4 w-4" /></button></CardHeader><CardBody>
    <form className="grid gap-3 sm:grid-cols-4" onSubmit={(event) => { event.preventDefault(); setError(''); mutation.mutate(); }}>
      <label className="text-xs font-semibold">Contract number<input required data-testid="contract-number" value={form.contractNumber} onChange={(e) => set('contractNumber', e.target.value)} className={fieldClass} /></label><label className="text-xs font-semibold sm:col-span-2">Name<input required data-testid="contract-name" value={form.name} onChange={(e) => set('name', e.target.value)} className={fieldClass} /></label><label className="text-xs font-semibold">Type<select value={form.contractType} onChange={(e) => set('contractType', e.target.value)} className={fieldClass}>{CONTRACT_TYPES.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="text-xs font-semibold sm:col-span-2">Vendor<select required data-testid="contract-vendor" value={form.vendorId} onChange={(e) => set('vendorId', e.target.value)} className={fieldClass}><option value="">— Select vendor —</option>{references.vendors.map((item) => <option key={item.id} value={item.id}>{item.vendor_code} — {item.name}</option>)}</select></label><label className="text-xs font-semibold">Status<select value={form.status} onChange={(e) => set('status', e.target.value)} className={fieldClass}>{CONTRACT_STATUSES.map((item) => <option key={item}>{item}</option>)}</select></label><label className="text-xs font-semibold">Contract owner<select value={form.ownerId} onChange={(e) => set('ownerId', e.target.value)} className={fieldClass}><option value="">— None —</option>{references.owners.map((item) => <option key={item.id} value={item.id}>{item.full_name ?? item.email}</option>)}</select></label>
      <label className="text-xs font-semibold">Start date<input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} className={fieldClass} /></label><label className="text-xs font-semibold">End date<input type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} className={fieldClass} /></label><label className="text-xs font-semibold">Budget<input type="number" min="0" step="0.01" value={form.budget} onChange={(e) => set('budget', e.target.value)} className={fieldClass} /></label><label className="text-xs font-semibold">Annual cost<input type="number" min="0" step="0.01" value={form.annualCost} onChange={(e) => set('annualCost', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold">Contract value<input type="number" min="0" step="0.01" value={form.contractValue} onChange={(e) => set('contractValue', e.target.value)} className={fieldClass} /></label><label className="text-xs font-semibold">Currency<input required pattern="[A-Z]{3}" maxLength={3} value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} className={fieldClass} /></label><label className="text-xs font-semibold">Auto renewal<select value={form.autoRenewal} onChange={(e) => set('autoRenewal', e.target.value)} className={fieldClass}><option value="false">No</option><option value="true">Yes</option></select></label><label className="text-xs font-semibold">Renewal notice<select value={form.renewalNoticeDays} onChange={(e) => set('renewalNoticeDays', e.target.value)} className={fieldClass}><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option></select></label>
      <label className="text-xs font-semibold sm:col-span-2">SLA / OLA<textarea rows={2} value={form.slaOla} onChange={(e) => set('slaOla', e.target.value)} className={fieldClass} /></label><label className="text-xs font-semibold sm:col-span-2">Security clause<textarea rows={2} value={form.securityClause} onChange={(e) => set('securityClause', e.target.value)} className={fieldClass} /></label><label className="text-xs font-semibold sm:col-span-2">DPA attachment ID<input value={form.dpaAttachmentId} onChange={(e) => set('dpaAttachmentId', e.target.value)} className={fieldClass} placeholder="Existing attachment UUID (optional)" /></label><label className="text-xs font-semibold sm:col-span-2">Upload DPA file<input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt" onChange={(e) => setDpaFile(e.target.files?.[0] ?? null)} className={`${fieldClass} px-0`} /></label><label className="text-xs font-semibold sm:col-span-2">Renewal decision<select value={form.renewalDecision} onChange={(e) => set('renewalDecision', e.target.value)} className={fieldClass}>{RENEWAL_DECISIONS.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="text-xs font-semibold sm:col-span-4">Termination checklist (one item per line)<textarea rows={3} value={form.terminationChecklist} onChange={(e) => set('terminationChecklist', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold sm:col-span-4">Linked asset IDs (comma separated)<input value={form.linkedAssetIds} onChange={(e) => set('linkedAssetIds', e.target.value)} className={fieldClass} /></label><label className="text-xs font-semibold sm:col-span-4">Linked license IDs (comma separated)<input value={form.linkedLicenseIds} onChange={(e) => set('linkedLicenseIds', e.target.value)} className={fieldClass} /></label><label className="text-xs font-semibold sm:col-span-4">Linked CI IDs (comma separated)<input value={form.linkedConfigurationItemIds} onChange={(e) => set('linkedConfigurationItemIds', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold sm:col-span-2">Service scope<textarea rows={2} value={form.serviceScope} onChange={(e) => set('serviceScope', e.target.value)} className={fieldClass} /></label><label className="text-xs font-semibold sm:col-span-2">Key terms<textarea rows={2} value={form.keyTerms} onChange={(e) => set('keyTerms', e.target.value)} className={fieldClass} /></label><label className="text-xs font-semibold sm:col-span-4">Notes<textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} className={fieldClass} /></label>
      {error && <p className="text-sm text-red-600 sm:col-span-4">{error}</p>}<div className="sm:col-span-4"><Button type="submit" size="sm" isLoading={mutation.isPending} data-testid="contract-submit">Save Contract</Button></div>
    </form>
  </CardBody></Card>;
}

function VendorTable({ items, canManage, onEdit, onManagePortal }: { items: Vendor[]; canManage: boolean; onEdit: (item: Vendor) => void; onManagePortal: (item: Vendor) => void }) {
  const queryClient = useQueryClient();
  const statusMutation = useMutation({ mutationFn: ({ item, status }: { item: Vendor; status: 'Active' | 'Inactive' }) => apiFetch(`/api/v1/vendors/${item.id}/status`, { method: 'POST', body: JSON.stringify({ status }) }), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['vendors-contracts'] }) });
  return <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="p-3">Vendor</th><th className="p-3">Tier</th><th className="p-3">DPA / NDA</th><th className="p-3">Annual review</th><th className="p-3">Status</th><th className="p-3" /></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-b last:border-0"><td className="p-3"><p className="font-semibold">{item.name}</p><p className="font-mono text-xs text-slate-500">{item.vendor_code}</p></td><td className="p-3">{item.criticality_tier}</td><td className="p-3 text-xs">{item.dpa_status} / {item.nda_status}</td><td className="p-3 text-xs">{item.annual_review_date ?? '—'}</td><td className="p-3"><Badge variant={item.status === 'Active' ? 'success' : 'neutral'}>{item.status}</Badge></td><td className="p-3"><div className="flex justify-end gap-2">{canManage && <><Button size="sm" variant="outline" onClick={() => onEdit(item)}>Edit</Button><Button size="sm" variant="outline" onClick={() => onManagePortal(item)}><KeyRound className="h-4 w-4" />Portal</Button><Button size="sm" variant="outline" onClick={() => statusMutation.mutate({ item, status: item.status === 'Active' ? 'Inactive' : 'Active' })}>{item.status === 'Active' ? 'Disable' : 'Enable'}</Button></>}</div></td></tr>)}</tbody></table></div>;
}

function ContractTable({ items, canManage, onEdit }: { items: Contract[]; canManage: boolean; onEdit: (item: Contract) => void }) {
  const queryClient = useQueryClient();
  const statusMutation = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => apiFetch(`/api/v1/contracts/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['vendors-contracts'] }) });
  return <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="p-3">Contract</th><th className="p-3">Owner / vendor</th><th className="p-3">Annual cost</th><th className="p-3">Renewal</th><th className="p-3">Status</th><th className="p-3" /></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-b last:border-0"><td className="p-3"><p className="font-semibold">{item.name}</p><p className="font-mono text-xs text-slate-500">{item.contract_number}</p></td><td className="p-3 text-xs">{item.vendor?.name ?? item.vendor_id}<br />{item.owner?.full_name ?? '—'}</td><td className="p-3">{item.annual_cost?.toLocaleString() ?? '—'} {item.currency}</td><td className="p-3 text-xs">{item.renewal_decision}<br />{item.auto_renewal ? `Auto / ${item.renewal_notice_days}d` : 'Manual'}</td><td className="p-3"><Badge variant={item.status === 'Active' ? 'success' : 'neutral'}>{item.status}</Badge></td><td className="p-3"><div className="flex justify-end gap-2">{canManage && <><Button size="sm" variant="outline" onClick={() => onEdit(item)}>Edit</Button><select value={item.status} onChange={(e) => statusMutation.mutate({ id: item.id, status: e.target.value })} className="rounded-lg border px-2 text-xs dark:bg-slate-900">{CONTRACT_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></>}</div></td></tr>)}</tbody></table></div>;
}

export function VendorContractsPage() {
  const { hasPermission } = useAuth();
  const canVendorView = hasPermission('vendor.view');
  const canContractView = hasPermission('contract.view');
  const canVendorManage = hasPermission('vendor.manage');
  const canContractManage = hasPermission('contract.manage');
  const [tab, setTab] = useState<ActiveTab>(canVendorView ? 'vendors' : 'contracts');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor>();
  const [editingContract, setEditingContract] = useState<Contract>();
  const [portalVendor, setPortalVendor] = useState<Vendor | null>(null);
  const queryClient = useQueryClient();
  const vendorsQuery = useQuery({ queryKey: ['vendors-contracts', 'vendors', search, status], enabled: canVendorView, queryFn: () => apiFetch<PaginatedResult<Vendor>>(`/api/v1/vendors?page=1&pageSize=100${search ? `&search=${encodeURIComponent(search)}` : ''}${status ? `&status=${status}` : ''}`) });
  const contractsQuery = useQuery({ queryKey: ['vendors-contracts', 'contracts', search, status], enabled: canContractView, queryFn: () => apiFetch<PaginatedResult<Contract>>(`/api/v1/contracts?page=1&pageSize=100${search ? `&search=${encodeURIComponent(search)}` : ''}${status ? `&status=${status}` : ''}`) });
  const vendorRefs = useQuery({ queryKey: ['vendors-contracts', 'vendor-references'], enabled: canVendorManage && tab === 'vendors' && showForm, queryFn: () => apiFetch<VendorReferences>('/api/v1/vendors/references') });
  const contractRefs = useQuery({ queryKey: ['vendors-contracts', 'contract-references'], enabled: canContractManage && tab === 'contracts' && showForm, queryFn: () => apiFetch<ContractReferences>('/api/v1/contracts/references') });
  const expiryMutation = useMutation({ mutationFn: () => apiFetch('/api/v1/contracts/check-expiry', { method: 'POST', body: '{}' }), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['vendors-contracts'] }) });
  const vendors = vendorsQuery.data?.items ?? [];
  const contracts = contractsQuery.data?.items ?? [];
  const closeForm = () => { setShowForm(false); setEditingVendor(undefined); setEditingContract(undefined); };
  const openCreate = () => { setEditingVendor(undefined); setEditingContract(undefined); setShowForm(true); };
  const switchTab = (next: ActiveTab) => { setTab(next); setSearch(''); setStatus(''); closeForm(); };
  return <div className="flex flex-col gap-4" data-testid="vendor-contracts-page">
    <div className="flex flex-wrap items-center justify-between gap-2"><PageTitle eyebrow="Vendor & Contract" title="Vendor / Contract" description="Manage vendor risk, security, contracts, renewals and portal access." /><div className="flex gap-2">{canContractManage && <Button size="sm" variant="outline" isLoading={expiryMutation.isPending} onClick={() => expiryMutation.mutate()}><RefreshCw className="h-4 w-4" />Check expiry</Button>}{(tab === 'vendors' ? canVendorManage : canContractManage) && <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" />Add {tab === 'vendors' ? 'vendor' : 'contract'}</Button>}</div></div>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4"><StatCard icon={<Building2 className="h-5 w-5" />} label="Vendors" value={vendors.length} tone="teal" /><StatCard icon={<FileText className="h-5 w-5" />} label="Contracts" value={contracts.length} tone="primary" /><StatCard icon={<FileText className="h-5 w-5" />} label="Active contracts" value={contracts.filter((item) => item.status === 'Active').length} tone="gray" /><StatCard icon={<FileText className="h-5 w-5" />} label="Contract value" value={contracts.reduce((sum, item) => sum + (item.contract_value ?? 0), 0).toLocaleString()} tone="gray" /></div>
    <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">{canVendorView && <button type="button" onClick={() => switchTab('vendors')} className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${tab === 'vendors' ? 'bg-white text-primary-700 shadow-sm dark:bg-slate-700 dark:text-primary-300' : 'text-slate-500'}`}>Vendors</button>}{canContractView && <button type="button" onClick={() => switchTab('contracts')} className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${tab === 'contracts' ? 'bg-white text-primary-700 shadow-sm dark:bg-slate-700 dark:text-primary-300' : 'text-slate-500'}`}>Contracts</button>}</div>
    {showForm && tab === 'vendors' && <FormModal title={editingVendor ? 'Edit Vendor' : 'Add Vendor'} description="Vendor profile, risk and security assessment" size="xl" onClose={closeForm}>{vendorRefs.isLoading ? <Loader2 className="mx-auto my-10 h-5 w-5 animate-spin" /> : vendorRefs.data && <VendorForm vendor={editingVendor} references={vendorRefs.data} onClose={closeForm} />}</FormModal>}
    {showForm && tab === 'contracts' && <FormModal title={editingContract ? 'Edit Contract' : 'Add Contract'} description="Contract terms, renewals, attachments and linked configuration" size="xl" onClose={closeForm}>{contractRefs.isLoading ? <Loader2 className="mx-auto my-10 h-5 w-5 animate-spin" /> : contractRefs.data && <ContractForm contract={editingContract} references={contractRefs.data} onClose={closeForm} />}</FormModal>}
    {portalVendor && <FormModal title="Vendor Portal accounts" description="Create account and send invite; no admin-generated password" size="xl" onClose={() => setPortalVendor(null)}><VendorPortalAccounts vendor={portalVendor} onClose={() => setPortalVendor(null)} /></FormModal>}
    <Card><CardHeader className="flex flex-wrap items-center justify-between gap-2"><span>{tab === 'vendors' ? 'Vendor register' : 'Contract register'}</span><div className="flex gap-2"><input aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..." className="rounded-lg border px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" /><select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border px-2 text-sm dark:border-slate-600 dark:bg-slate-900"><option value="">All status</option>{(tab === 'vendors' ? ['Active', 'Inactive'] : CONTRACT_STATUSES).map((item) => <option key={item}>{item}</option>)}</select></div></CardHeader><CardBody>{(tab === 'vendors' ? vendorsQuery.isLoading : contractsQuery.isLoading) ? <Loader2 className="mx-auto my-10 h-5 w-5 animate-spin" /> : tab === 'vendors' ? <VendorTable items={vendors} canManage={canVendorManage} onEdit={(item) => { setEditingVendor(item); setShowForm(true); }} onManagePortal={setPortalVendor} /> : <ContractTable items={contracts} canManage={canContractManage} onEdit={(item) => { setEditingContract(item); setShowForm(true); }} />}</CardBody></Card>
  </div>;
}
