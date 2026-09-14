import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, CalendarClock, Check, CheckCircle2, ClipboardCheck, FileCheck2, Flag, Loader2, Plus, ShieldCheck, UserRound, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../../components/table/DataTable';
import { ExportAllButton } from '../../components/table/ExportAllButton';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormModal, Modal } from '../../components/ui/Modal';
import { ApiError, apiFetch, showToast } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import type { AccessCertificationCampaign, AccessCertificationCampaignDetail, AccessCertificationDecisionResult, AccessCertificationItem, AccessCertificationOptions } from '../../types/accessCampaigns';
import { formatThaiDate, formatThaiDateTime } from '../../utils/date';

interface CreateCampaignValues {
  code: string;
  name: string;
  systemId: string;
  reviewerId: string;
  dueDate: string;
}

function defaultDueDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
}

function campaignStatusBadge(campaign: Pick<AccessCertificationCampaign, 'status' | 'is_overdue'>) {
  if (campaign.status === 'completed') return <Badge variant="success"><CheckCircle2 className="h-3 w-3" />ลงนามแล้ว</Badge>;
  if (campaign.status === 'cancelled') return <Badge variant="secondary">ยกเลิก</Badge>;
  if (campaign.is_overdue || campaign.status === 'overdue') return <Badge variant="danger"><Flag className="h-3 w-3" />เกินกำหนด</Badge>;
  return <Badge variant="warning"><CalendarClock className="h-3 w-3" />กำลังทบทวน</Badge>;
}

function itemStatusBadge(status: AccessCertificationItem['status']) {
  if (status === 'approved') return <Badge variant="success"><Check className="h-3 w-3" />Approved</Badge>;
  if (status === 'revoked') return <Badge variant="danger"><XCircle className="h-3 w-3" />Revoke</Badge>;
  return <Badge variant="warning">Pending</Badge>;
}

function CreateCampaignForm({ options, onClose }: { options: AccessCertificationOptions; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<CreateCampaignValues>({ code: '', name: '', systemId: '', reviewerId: '', dueDate: defaultDueDate() });
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => apiFetch<AccessCertificationCampaign>('/api/v1/access-registry/campaigns', {
      method: 'POST',
      body: JSON.stringify({ ...values, systemId: values.systemId || null }),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'access-certification-campaigns'] });
      showToast('success', 'เปิด Access Certification Campaign แล้ว');
      onClose();
    },
    onError: (reason) => setError(reason instanceof ApiError ? reason.message : 'เปิด Campaign ไม่สำเร็จ'),
  });

  const update = (key: keyof CreateCampaignValues, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const valid = values.code.trim().length >= 2 && values.name.trim().length > 0 && values.reviewerId.length > 0 && values.dueDate.length === 10;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => { event.preventDefault(); setError(null); mutation.mutate(); }}
      noValidate
    >
      <div className="rounded-lg border border-primary-100 bg-primary-50/70 p-3 text-xs text-primary-900 dark:border-primary-900 dark:bg-primary-950/30 dark:text-primary-100">
        ระบบจะถ่าย Evidence Snapshot ของสิทธิ์ที่กำลังใช้งาน/รอเริ่มทั้งหมดในขอบเขตที่เลือกทันทีที่เปิด Campaign
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          Campaign Code *
          <input value={values.code} onChange={(event) => update('code', event.target.value.toUpperCase())} placeholder="ERP-ACCESS-2569" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" />
        </label>
        <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          Due Date *
          <input type="date" value={values.dueDate} onChange={(event) => update('dueDate', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" />
        </label>
      </div>
      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
        ชื่อ Campaign *
        <input value={values.name} onChange={(event) => update('name', event.target.value)} placeholder="ทบทวนสิทธิ์ ERP ประจำปี 2569" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          ขอบเขตระบบ
          <select value={values.systemId} onChange={(event) => update('systemId', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900">
            <option value="">ทุกระบบงาน</option>
            {options.systems.map((system) => <option key={system.id} value={system.id}>{system.name}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          Reviewer *
          <select value={values.reviewerId} onChange={(event) => update('reviewerId', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900">
            <option value="">— เลือกหัวหน้าส่วน/Reviewer —</option>
            {options.reviewers.map((reviewer) => <option key={reviewer.id} value={reviewer.id}>{reviewer.full_name} — {reviewer.email}</option>)}
          </select>
        </label>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-700">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>ยกเลิก</Button>
        <Button type="submit" size="sm" isLoading={mutation.isPending} disabled={!valid}>เปิด Campaign</Button>
      </div>
    </form>
  );
}

function EscalationForm({ campaign, onClose }: { campaign: AccessCertificationCampaignDetail; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/access-registry/campaigns/${campaign.id}/escalate`, { method: 'POST', body: JSON.stringify({ reason }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'access-certification-campaigns'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'access-certification-campaign', campaign.id] });
      onClose();
    },
    onError: (reasonError) => setError(reasonError instanceof ApiError ? reasonError.message : 'Escalate ไม่สำเร็จ'),
  });
  return (
    <FormModal title="Escalate Campaign" description="ส่งต่อให้ Reviewer เร่งทบทวนรายการที่เกินกำหนด" size="sm" onClose={onClose}>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); setError(null); mutation.mutate(); }} noValidate>
        <p className="text-sm text-slate-600 dark:text-slate-300">Reviewer: <strong>{campaign.reviewer?.full_name ?? '—'}</strong></p>
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
          เหตุผล *
          <textarea rows={4} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="เช่น ใกล้ปิดรอบ Audit และยังมีรายการค้าง" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" />
        </label>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-700">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>ยกเลิก</Button>
          <Button type="submit" size="sm" variant="danger" isLoading={mutation.isPending} disabled={reason.trim().length < 3}>ส่ง Escalation</Button>
        </div>
      </form>
    </FormModal>
  );
}

function AccessCertificationDetailModal({ campaignId, canManage, canReview, onClose }: { campaignId: string; canManage: boolean; canReview: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkNote, setBulkNote] = useState('');
  const [signOffNote, setSignOffNote] = useState('');
  const [showEscalation, setShowEscalation] = useState(false);
  const query = useQuery({
    queryKey: ['admin', 'access-certification-campaign', campaignId],
    queryFn: () => apiFetch<AccessCertificationCampaignDetail>(`/api/v1/access-registry/campaigns/${campaignId}`),
  });
  const campaign = query.data;
  const pendingItems = useMemo(() => (campaign?.items ?? []).filter((item) => item.status === 'pending'), [campaign?.items]);
  const canAct = Boolean(campaign && canReview && (campaign.status === 'open' || campaign.status === 'overdue'));
  const allPendingSelected = pendingItems.length > 0 && pendingItems.every((item) => selectedIds.has(item.id));

  useEffect(() => {
    setSelectedIds(new Set());
    setBulkNote('');
    setSignOffNote('');
  }, [campaignId]);

  const decisionMutation = useMutation({
    mutationFn: (status: 'approved' | 'revoked') => apiFetch<AccessCertificationDecisionResult>(`/api/v1/access-registry/campaigns/${campaignId}/decisions`, {
      method: 'POST',
      body: JSON.stringify({ decisions: [...selectedIds].map((itemId) => ({ itemId, status, note: bulkNote.trim() || undefined })) }),
    }),
    onSuccess: () => {
      setSelectedIds(new Set());
      setBulkNote('');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'access-certification-campaigns'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'access-certification-campaign', campaignId] });
    },
  });

  const signOffMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/access-registry/campaigns/${campaignId}/sign-off`, { method: 'POST', body: JSON.stringify({ note: signOffNote.trim() || undefined }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'access-certification-campaigns'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'access-certification-campaign', campaignId] });
    },
  });

  const toggleItem = (itemId: string) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
    return next;
  });

  if (query.isLoading || !campaign) {
    return <Modal title="Access Certification Campaign" onClose={onClose} size="xl"><div className="flex justify-center py-12" role="status"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div></Modal>;
  }

  const snapshotCapturedAt = String(campaign.evidence_snapshot.capturedAt ?? '');
  return (
    <Modal title={campaign.name} description={`${campaign.campaign_code} · Access Certification Campaign`} icon={<ClipboardCheck className="h-5 w-5" />} size="xl" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-900/40">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-100"><UserRound className="h-4 w-4 text-primary-600" />Reviewer: {campaign.reviewer?.full_name ?? '—'}</span>
            <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300"><CalendarClock className="h-4 w-4" />Due: {formatThaiDate(campaign.due_date, 'd MMM yyyy')}</span>
            {campaign.system?.name ? <span className="text-slate-500">System: {campaign.system.name}</span> : <span className="text-slate-500">Scope: ทุกระบบ</span>}
            {campaignStatusBadge(campaign)}
          </div>
          <ExportAllButton url={`/api/v1/access-registry/campaigns/${campaign.id}/export`} label="Export User Access Review" />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatCard icon={<UserRound className="h-4 w-4" />} label="ผู้ใช้" value={campaign.stats.totalUsers} tone="primary" />
          <StatCard icon={<ShieldCheck className="h-4 w-4" />} label="สิทธิ์ทั้งหมด" value={campaign.stats.totalEntitlements} tone="teal" />
          <StatCard icon={<CheckCircle2 className="h-4 w-4" />} label="Approved" value={campaign.stats.approved} tone="teal" />
          <StatCard icon={<XCircle className="h-4 w-4" />} label="Revoke" value={campaign.stats.revoked} tone="danger" />
          <StatCard icon={<CalendarClock className="h-4 w-4" />} label="Pending" value={campaign.stats.pending} tone={campaign.stats.pending ? 'amber' : 'gray'} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary-100 bg-primary-50/60 px-3 py-2 text-xs text-primary-900 dark:border-primary-900 dark:bg-primary-950/30 dark:text-primary-100">
          <span className="inline-flex items-center gap-2"><FileCheck2 className="h-4 w-4" />Evidence Snapshot: {snapshotCapturedAt ? formatThaiDateTime(snapshotCapturedAt) : 'บันทึกแล้ว'} · {campaign.stats.totalEntitlements} entitlements</span>
          <span className="font-semibold">ความคืบหน้า {campaign.stats.completionPercentage}%</span>
        </div>

        {campaign.is_overdue && campaign.status !== 'completed' && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200">
            <div><p className="font-bold">Campaign เกินกำหนด</p><p className="mt-0.5 text-xs">ค้าง {campaign.stats.pending} รายการ · Escalated แล้ว {campaign.escalation_count} ครั้ง</p></div>
            {canManage && <Button size="sm" variant="danger" onClick={() => setShowEscalation(true)}><ArrowUpRight className="h-4 w-4" />Escalate</Button>}
          </div>
        )}

        {canAct && pendingItems.length > 0 && (
          <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-300 px-3 text-xs font-semibold dark:border-slate-600">
                <input type="checkbox" checked={allPendingSelected} onChange={() => setSelectedIds(allPendingSelected ? new Set() : new Set(pendingItems.map((item) => item.id)))} className="h-4 w-4 rounded border-slate-300 text-primary-600" />
                เลือก Pending ทั้งหมด
              </label>
              <span className="text-xs text-slate-500">เลือกแล้ว {selectedIds.size} รายการ</span>
              {selectedIds.size > 0 && <>
                <input value={bulkNote} onChange={(event) => setBulkNote(event.target.value)} placeholder="หมายเหตุ Bulk (ถ้ามี)" className="min-h-9 min-w-52 flex-1 rounded-lg border border-slate-300 px-3 text-xs dark:border-slate-600 dark:bg-slate-900" />
                <Button size="sm" variant="success" isLoading={decisionMutation.isPending} onClick={() => decisionMutation.mutate('approved')}><Check className="h-4 w-4" />Bulk Approve</Button>
                <Button size="sm" variant="danger" isLoading={decisionMutation.isPending} onClick={() => decisionMutation.mutate('revoked')}><XCircle className="h-4 w-4" />Bulk Revoke</Button>
              </>}
            </div>
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <DataTable mode="server" toolbar={false} pagination={false} currentPageExport={false} rowNumber={false} cardOnMobile tableId="access-certification-items" className="min-w-[980px] w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900"><tr><th className="px-3 py-2">เลือก</th><th className="px-3 py-2">ผู้ใช้</th><th className="px-3 py-2">ระบบ / RBAC item</th><th className="px-3 py-2">Actions</th><th className="px-3 py-2">Classification</th><th className="px-3 py-2">สถานะ Review</th><th className="px-3 py-2">ตัดสินใจเมื่อ</th></tr></thead>
            <tbody>
              {(campaign.items ?? []).map((item) => {
                const snapshot = item.evidence_snapshot ?? {};
                const userName = item.user?.full_name ?? String(snapshot.userName ?? '—');
                const systemName = item.system?.name ?? String(snapshot.systemName ?? '—');
                const itemName = item.access_control_item?.name ?? String(snapshot.accessItemName ?? item.access_level ?? '—');
                return <tr key={item.id} className="border-t border-slate-100 align-top dark:border-slate-700">
                  <td data-label="เลือก" className="px-3 py-2">{canAct && item.status === 'pending' ? <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleItem(item.id)} aria-label={`เลือกรายการ ${userName} ${itemName}`} className="h-4 w-4 rounded border-slate-300 text-primary-600" /> : <span className="text-slate-300">—</span>}</td>
                  <td data-label="ผู้ใช้" className="px-3 py-2"><p className="font-semibold text-slate-800 dark:text-slate-100">{userName}</p><p className="text-[11px] text-slate-500">{item.user?.email ?? String(snapshot.userEmail ?? '')}</p></td>
                  <td data-label="ระบบ / RBAC item" className="px-3 py-2"><p className="font-semibold">{systemName}</p><p className="text-[11px] text-slate-500">{itemName}</p><p className="font-mono text-[10px] text-slate-400">{item.access_control_item?.code ?? String(snapshot.accessItemCode ?? '')}</p></td>
                  <td data-label="Actions" className="px-3 py-2">{item.permission_actions.join(', ') || String(snapshot.permissionActions ?? '—')}</td>
                  <td data-label="Classification" className="px-3 py-2">{item.data_classification ?? String(snapshot.dataClassification ?? '—')}{item.privileged_access && <p className="font-semibold text-red-600">Privileged</p>}</td>
                  <td data-label="สถานะ Review" className="px-3 py-2">{itemStatusBadge(item.status)}{item.decision_note && <p className="mt-1 max-w-52 text-[11px] text-slate-500">{item.decision_note}</p>}</td>
                  <td data-label="ตัดสินใจเมื่อ" className="px-3 py-2 text-slate-500">{item.decided_at ? formatThaiDateTime(item.decided_at) : '—'}</td>
                </tr>;
              })}
            </tbody>
          </DataTable>
        </div>

        {campaign.status === 'completed' ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-200"><p className="font-bold">ลงนามรับรองแล้ว</p><p className="mt-1 text-xs">{campaign.signed_off_at ? formatThaiDateTime(campaign.signed_off_at) : '—'} · {campaign.sign_off_note || 'ไม่มีหมายเหตุ'}</p></div> : canAct && <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700"><label className="min-w-60 flex-1 text-xs font-semibold text-slate-700 dark:text-slate-200">Sign-off note<textarea rows={2} value={signOffNote} onChange={(event) => setSignOffNote(event.target.value)} placeholder="สรุปผล/ข้อยกเว้นของรอบทบทวน" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal dark:border-slate-600 dark:bg-slate-900" /></label><Button size="sm" isLoading={signOffMutation.isPending} disabled={campaign.stats.pending > 0} onClick={() => signOffMutation.mutate()}><FileCheck2 className="h-4 w-4" />Sign-off Campaign</Button></div>}
      </div>
      {showEscalation && <EscalationForm campaign={campaign} onClose={() => setShowEscalation(false)} />}
    </Modal>
  );
}

export function AccessCertificationCampaigns() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('access_registry.manage');
  const canReview = hasPermission('access_registry.review') || canManage;
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const campaignsQuery = useQuery({
    queryKey: ['admin', 'access-certification-campaigns'],
    queryFn: () => apiFetch<AccessCertificationCampaign[]>('/api/v1/access-registry/campaigns'),
  });
  const optionsQuery = useQuery({
    queryKey: ['admin', 'access-certification-options'],
    queryFn: () => apiFetch<AccessCertificationOptions>('/api/v1/access-registry/campaigns/options'),
    enabled: canManage,
  });
  const campaigns = campaignsQuery.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-primary-600" />Access Certification Campaign</span>
        {canManage && <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" />เปิด Campaign</Button>}
      </CardHeader>
      <CardBody>
        {campaignsQuery.isLoading && <div className="flex justify-center py-8" role="status"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>}
        {campaignsQuery.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">โหลด Campaign ไม่สำเร็จ กรุณาลองใหม่</p>}
        {!campaignsQuery.isLoading && campaigns.length === 0 && <EmptyState icon={<ClipboardCheck className="h-10 w-10" aria-hidden="true" />} title="ยังไม่มี Access Certification Campaign" message="เปิด Campaign เพื่อสร้างหลักฐาน Snapshot และมอบหมาย Reviewer" />}
        {campaigns.length > 0 && <div className="overflow-x-auto"><DataTable mode="server" toolbar={false} pagination={false} currentPageExport={false} cardOnMobile tableId="access-certification-campaigns" className="min-w-[980px] w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900"><tr><th className="px-3 py-2">Campaign</th><th className="px-3 py-2">System</th><th className="px-3 py-2">Reviewer</th><th className="px-3 py-2">Due Date</th><th className="px-3 py-2">Progress</th><th className="px-3 py-2">สถานะ</th><th className="px-3 py-2 text-right">ดำเนินการ</th></tr></thead>
          <tbody>{campaigns.map((campaign) => <tr key={campaign.id} className="border-t border-slate-100 align-top dark:border-slate-700">
            <td data-label="Campaign" className="px-3 py-3"><p className="font-semibold text-slate-800 dark:text-slate-100">{campaign.name}</p><p className="mt-0.5 font-mono text-[11px] text-slate-500">{campaign.campaign_code}</p>{campaign.escalation_count > 0 && <p className="mt-1 text-[11px] font-semibold text-red-600">Escalated {campaign.escalation_count} ครั้ง</p>}</td>
            <td data-label="System" className="px-3 py-3 text-slate-600 dark:text-slate-300">{campaign.system?.name ?? 'ทุกระบบ'}</td>
            <td data-label="Reviewer" className="px-3 py-3"><p className="font-semibold">{campaign.reviewer?.full_name ?? '—'}</p><p className="text-[11px] text-slate-500">{campaign.reviewer?.email ?? ''}</p></td>
            <td data-label="Due Date" className="px-3 py-3 text-slate-600 dark:text-slate-300">{formatThaiDate(campaign.due_date, 'd MMM yyyy')}</td>
            <td data-label="Progress" className="px-3 py-3"><p className="font-semibold">{campaign.stats.approved + campaign.stats.revoked} / {campaign.stats.totalEntitlements}</p><p className="text-[11px] text-slate-500">Approved {campaign.stats.approved} · Revoke {campaign.stats.revoked} · Pending {campaign.stats.pending}</p></td>
            <td data-label="สถานะ" className="px-3 py-3">{campaignStatusBadge(campaign)}</td>
            <td data-label="ดำเนินการ" className="px-3 py-3 text-right"><Button size="sm" variant="outline" onClick={() => setSelectedCampaignId(campaign.id)}><FileCheck2 className="h-4 w-4" />เปิด Review</Button></td>
          </tr>)}</tbody>
        </DataTable></div>}
      </CardBody>
      {showCreate && optionsQuery.data && <FormModal title="เปิด Access Certification Campaign" description="กำหนดผู้ทบทวน ขอบเขต และกำหนดส่งสำหรับรอบ Audit" size="lg" onClose={() => setShowCreate(false)}><CreateCampaignForm options={optionsQuery.data} onClose={() => setShowCreate(false)} /></FormModal>}
      {showCreate && optionsQuery.isLoading && <span className="sr-only" role="status">กำลังโหลดตัวเลือก Campaign</span>}
      {selectedCampaignId && <AccessCertificationDetailModal campaignId={selectedCampaignId} canManage={canManage} canReview={canReview} onClose={() => setSelectedCampaignId(null)} />}
    </Card>
  );
}
