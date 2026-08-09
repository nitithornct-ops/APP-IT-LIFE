import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Circle, GitPullRequestArrow, Loader2, ShieldAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import type { ChangeDetail } from '../../types/changes';
import { formatThaiDate } from '../../utils/date';
import { changeRiskTone, changeStatusTone, profileName } from './changeDisplay';

const fieldClass = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900';
const FLOW = ['ยื่นคำขอ', 'ผ่านการทดสอบ', 'อนุมัติแล้ว', 'ติดตั้งใช้งานแล้ว'] as const;

function Info({ label, children }: { label: string; children: ReactNode }) {
  return <div><p className="text-xs font-semibold text-slate-400">{label}</p><div className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{children || '—'}</div></div>;
}

function Workflow({ status }: { status: ChangeDetail['change']['status'] }) {
  const activeIndex = FLOW.indexOf(status as (typeof FLOW)[number]);
  return <div className="grid gap-2 sm:grid-cols-4" aria-label="ลำดับงาน Change">{FLOW.map((step, index) => {
    const complete = activeIndex >= index;
    return <div key={step} className={`flex items-center gap-2 rounded-xl border p-3 text-sm font-semibold ${complete ? 'border-primary-300 bg-primary-50 text-primary-800 dark:border-primary-700 dark:bg-primary-950/30 dark:text-primary-200' : 'border-slate-200 text-slate-400 dark:border-slate-700'}`}>{complete ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <Circle className="h-4 w-4 shrink-0" />}<span>{step}</span></div>;
  })}</div>;
}

function ActionError({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="text-sm text-red-600">{error instanceof ApiError ? error.message : 'ดำเนินการไม่สำเร็จ'}</p>;
}

export function ChangeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission, me } = useAuth();
  const actorId = me?.profile.id;
  const [testResult, setTestResult] = useState('');
  const [testPassed, setTestPassed] = useState(true);
  const [approvalComment, setApprovalComment] = useState('');
  const [version, setVersion] = useState('');
  const [rollbackPlan, setRollbackPlan] = useState('');
  const query = useQuery({ queryKey: ['changes', 'detail', id], queryFn: () => apiFetch<ChangeDetail>(`/api/v1/changes/${id}`), enabled: Boolean(id) });
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['changes'] }); void queryClient.invalidateQueries({ queryKey: ['changes', 'detail', id] }); };
  const testMutation = useMutation({ mutationFn: () => apiFetch(`/api/v1/changes/${id}/test-signoff`, { method: 'POST', body: JSON.stringify({ result: testResult, passed: testPassed }) }), onSuccess: refresh });
  const approvalMutation = useMutation({ mutationFn: (approve: boolean) => apiFetch(`/api/v1/changes/${id}/approval`, { method: 'POST', body: JSON.stringify({ approve, comment: approvalComment || undefined }) }), onSuccess: refresh });
  const deployMutation = useMutation({ mutationFn: () => apiFetch(`/api/v1/changes/${id}/deploy`, { method: 'POST', body: JSON.stringify({ version, rollbackPlan: rollbackPlan || undefined }) }), onSuccess: refresh });

  if (query.isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!query.data) return null;
  const { change, attachments, relationships } = query.data;
  const canTest = hasPermission('change.test') && change.status === 'ยื่นคำขอ' && actorId !== change.requester_id;
  const canApprove = hasPermission('change.approve') && change.status === 'ผ่านการทดสอบ' && actorId !== change.requester_id && actorId !== change.test_signoff_by;
  const canDeploy = hasPermission('change.deploy') && change.status === 'อนุมัติแล้ว' && actorId !== change.approver_id;

  return <div className="flex flex-col gap-4" data-testid="change-detail-page">
    <button type="button" onClick={() => navigate('/changes')} className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-700"><ArrowLeft className="h-4 w-4" /> กลับไป Change Management</button>
    <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-mono text-sm text-slate-500">{change.change_number}</p><h1 className="text-xl font-bold">{change.title}</h1><p className="text-sm text-slate-500">{change.system_affected}</p></div><div className="flex gap-2"><Badge variant={changeRiskTone[change.risk_level]}>Risk {change.risk_level}</Badge><Badge variant={changeStatusTone[change.status]}>{change.status}</Badge></div></div>
    {change.status === 'ปฏิเสธ' ? <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200"><ShieldAlert className="h-5 w-5" /> คำขอนี้ถูกปฏิเสธ: {change.approval_comment}</div> : <Workflow status={change.status} />}

    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2"><CardHeader>รายละเอียดคำขอ</CardHeader><CardBody className="grid gap-4 sm:grid-cols-2"><Info label="รายละเอียด">{change.description}</Info><Info label="ประเมินผลกระทบ">{change.impact_assessment}</Info><Info label="ประเภท Change">{change.change_type}</Info><Info label="แผน Rollback">{change.rollback_plan}</Info><Info label="คำขอบริการต้นทาง">{change.source_service_request ? <Link to={`/service-requests/${change.source_service_request.id}`} className="text-primary-700 hover:underline">{change.source_service_request.service_code} — {change.source_service_request.service_name}</Link> : '—'}</Info><Info label="หมายเหตุ">{change.notes}</Info></CardBody></Card>
      <Card><CardHeader>ผู้เกี่ยวข้อง / หลักฐาน</CardHeader><CardBody className="grid gap-3"><Info label="ผู้ยื่น">{profileName(change.requester)}</Info><Info label="วันที่ยื่น">{formatThaiDate(change.request_date, 'd MMM yyyy HH:mm')}</Info><Info label="ผู้ทดสอบ">{profileName(change.tester ?? undefined)}</Info><Info label="ผู้อนุมัติ">{profileName(change.approver ?? undefined)}</Info><Info label="ผู้ติดตั้ง">{profileName(change.deployer ?? undefined)}</Info><Info label="ไฟล์ / ความสัมพันธ์ CMDB">{attachments.length} ไฟล์ · {relationships.length} ความสัมพันธ์</Info></CardBody></Card>
    </div>

    {(change.test_result || change.approve_result || change.version) && <Card><CardHeader>บันทึก Workflow</CardHeader><CardBody className="grid gap-4 sm:grid-cols-3"><Info label="ผลการทดสอบ">{change.test_result}{change.test_signoff_at ? `\n${formatThaiDate(change.test_signoff_at, 'd MMM yyyy HH:mm')}` : ''}</Info><Info label="ผลอนุมัติ">{change.approve_result}{change.approval_comment ? ` — ${change.approval_comment}` : ''}{change.approve_date ? `\n${formatThaiDate(change.approve_date, 'd MMM yyyy HH:mm')}` : ''}</Info><Info label="การติดตั้ง">{change.version ? `Version ${change.version}` : '—'}{change.deploy_date ? `\n${formatThaiDate(change.deploy_date, 'd MMM yyyy HH:mm')}` : ''}</Info></CardBody></Card>}

    {canTest && <Card data-testid="change-test-form"><CardHeader>รับรองผลการทดสอบ</CardHeader><CardBody><form className="grid gap-3 sm:grid-cols-[1fr_auto]" onSubmit={(event) => { event.preventDefault(); testMutation.mutate(); }}><label className="text-xs font-semibold">ผลการทดสอบ<textarea required maxLength={1000} rows={3} data-testid="change-test-result" value={testResult} onChange={(e) => setTestResult(e.target.value)} className={fieldClass} /></label><div className="flex flex-col justify-end gap-2"><label className="text-sm"><input type="checkbox" checked={testPassed} onChange={(e) => setTestPassed(e.target.checked)} className="mr-2" />ผ่านการทดสอบ</label><Button type="submit" size="sm" isLoading={testMutation.isPending} data-testid="change-test-submit">บันทึกผลทดสอบ</Button></div><ActionError error={testMutation.error} /></form></CardBody></Card>}
    {hasPermission('change.test') && change.status === 'ยื่นคำขอ' && actorId === change.requester_id && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800" data-testid="change-sod-requester-test">ผู้ยื่นคำขอต้องไม่เป็นผู้รับรองผลการทดสอบรายการเดียวกัน</p>}

    {canApprove && <Card data-testid="change-approval-form"><CardHeader>การอนุมัติอิสระ</CardHeader><CardBody className="grid gap-3"><label className="text-xs font-semibold">ความเห็น / เหตุผลเมื่อปฏิเสธ<textarea maxLength={500} rows={3} data-testid="change-approval-comment" value={approvalComment} onChange={(e) => setApprovalComment(e.target.value)} className={fieldClass} /></label><div className="flex gap-2"><Button size="sm" isLoading={approvalMutation.isPending} data-testid="change-approve-submit" onClick={() => approvalMutation.mutate(true)}>อนุมัติ</Button><Button size="sm" variant="danger" disabled={!approvalComment.trim()} isLoading={approvalMutation.isPending} data-testid="change-reject-submit" onClick={() => approvalMutation.mutate(false)}>ปฏิเสธ</Button></div><ActionError error={approvalMutation.error} /></CardBody></Card>}
    {hasPermission('change.approve') && change.status === 'ผ่านการทดสอบ' && !canApprove && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800" data-testid="change-sod-approval">ผู้ยื่นหรือผู้ทดสอบต้องไม่เป็นผู้อนุมัติ Change รายการเดียวกัน</p>}

    {canDeploy && <Card data-testid="change-deploy-form"><CardHeader>บันทึกการติดตั้งใช้งาน</CardHeader><CardBody><form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); deployMutation.mutate(); }}><label className="text-xs font-semibold">Version ที่ติดตั้ง<input required maxLength={60} data-testid="change-deploy-version" value={version} onChange={(e) => setVersion(e.target.value)} className={fieldClass} /></label><label className="text-xs font-semibold">ปรับแผน Rollback<textarea maxLength={2000} rows={3} value={rollbackPlan} onChange={(e) => setRollbackPlan(e.target.value)} className={fieldClass} /></label><ActionError error={deployMutation.error} /><div className="sm:col-span-2"><Button type="submit" size="sm" isLoading={deployMutation.isPending} data-testid="change-deploy-submit">ยืนยันติดตั้งใช้งาน</Button></div></form></CardBody></Card>}
    {hasPermission('change.deploy') && change.status === 'อนุมัติแล้ว' && actorId === change.approver_id && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800" data-testid="change-sod-deploy">ผู้อนุมัติต้องไม่เป็นผู้ติดตั้ง Change รายการเดียวกัน</p>}
    <div className="flex items-center gap-2 text-xs text-slate-400"><GitPullRequestArrow className="h-4 w-4" /> ทุกขั้นตอนถูกบันทึก Audit Log และตรวจ Segregation of Duties ซ้ำที่ฐานข้อมูล</div>
  </div>;
}
