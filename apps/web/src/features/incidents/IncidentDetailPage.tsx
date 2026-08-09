import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, ExternalLink, Loader2, ShieldCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import {
  BREACH_RISK_LEVELS,
  INCIDENT_SEVERITIES,
  REGULATORY_DECISIONS,
  REGULATORY_DESTINATIONS,
  REGULATORY_NOTIFICATION_STATUSES,
  type Incident,
  type IncidentDetail,
  type ProfileRef,
} from '../../types/incidents';
import { formatThaiDate } from '../../utils/date';
import { incidentStatusTone, riskTone } from './incidentDisplay';

const fieldClass = 'w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900';
type RegulatoryDecision = (typeof REGULATORY_DECISIONS)[number];

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><p className="text-xs font-semibold text-slate-400">{label}</p><div className="text-sm text-slate-700 dark:text-slate-200">{children ?? '—'}</div></div>;
}

function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="text-sm text-red-600">{error instanceof ApiError ? error.message : 'ดำเนินการไม่สำเร็จ'}</p>;
}

function useIncidentAction(id: string, suffix: string, method = 'POST') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch(`/api/v1/incidents/${id}${suffix}`, { method, body: JSON.stringify(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['incidents', id] });
      void queryClient.invalidateQueries({ queryKey: ['incidents'] });
      void queryClient.invalidateQueries({ queryKey: ['incidents', 'matrix'] });
    },
  });
}

function ManagementPanel({ incident, assignees }: { incident: Incident; assignees: ProfileRef[] }) {
  const [severity, setSeverity] = useState(incident.severity ?? '');
  const [likelihood, setLikelihood] = useState(incident.likelihood?.toString() ?? '');
  const [impact, setImpact] = useState(incident.impact?.toString() ?? '');
  const [assigneeId, setAssigneeId] = useState(incident.assignee_id ?? '');
  const [status, setStatus] = useState(incident.status === 'ปิดเคส' ? 'กำลังดำเนินการ' : incident.status);
  const [notes, setNotes] = useState(incident.notes ?? '');
  const mutation = useIncidentAction(incident.id, '', 'PATCH');
  function submit(event: FormEvent) {
    event.preventDefault();
    mutation.mutate({ severity: severity || null, likelihood: likelihood ? Number(likelihood) : null, impact: impact ? Number(impact) : null, assigneeId: assigneeId || null, status, notes });
  }
  return (
    <Card>
      <CardHeader>จำแนก ประเมินความเสี่ยง และมอบหมาย</CardHeader>
      <CardBody><form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="incident-manage-form">
        <label className="text-xs font-semibold">ความรุนแรง<select value={severity} onChange={(e) => setSeverity(e.target.value)} className={`${fieldClass} mt-1`}><option value="">— ยังไม่ระบุ —</option>{INCIDENT_SEVERITIES.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="text-xs font-semibold">Likelihood (1–5)<select value={likelihood} onChange={(e) => setLikelihood(e.target.value)} className={`${fieldClass} mt-1`}><option value="">—</option>{[1,2,3,4,5].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="text-xs font-semibold">Impact (1–5)<select value={impact} onChange={(e) => setImpact(e.target.value)} className={`${fieldClass} mt-1`}><option value="">—</option>{[1,2,3,4,5].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="text-xs font-semibold sm:col-span-2">ผู้รับผิดชอบ<select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={`${fieldClass} mt-1`}><option value="">— ยังไม่มอบหมาย —</option>{assignees.map((item) => <option key={item.id} value={item.id}>{item.full_name} ({item.email})</option>)}</select></label>
        <label className="text-xs font-semibold">สถานะ<select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={`${fieldClass} mt-1`}><option>เปิด</option><option>กำลังดำเนินการ</option></select></label>
        <label className="text-xs font-semibold sm:col-span-3">หมายเหตุ<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${fieldClass} mt-1`} /></label>
        <ErrorText error={mutation.error} />
        <div className="sm:col-span-3"><Button type="submit" size="sm" isLoading={mutation.isPending} data-testid="incident-manage-submit">บันทึกการดำเนินงาน</Button></div>
      </form></CardBody>
    </Card>
  );
}

function RegulatoryAssessmentPanel({ incident }: { incident: Incident }) {
  const [breachRiskLevel, setBreachRiskLevel] = useState(incident.breach_risk_level ?? '');
  const [pdpcRequired, setPdpc] = useState(incident.pdpc_notify_required);
  const [dataSubjectRequired, setDataSubject] = useState(incident.data_subject_notify_required);
  const [ncsaRequired, setNcsa] = useState(incident.ncsa_report_required);
  const [otherRegulatorRequired, setOther] = useState(incident.other_regulator_required);
  const [assessment, setAssessment] = useState(incident.regulatory_assessment ?? '');
  const mutation = useIncidentAction(incident.id, '/regulatory-assessment');
  function submit(event: FormEvent) { event.preventDefault(); mutation.mutate({ breachRiskLevel: breachRiskLevel || undefined, pdpcRequired, dataSubjectRequired, ncsaRequired, otherRegulatorRequired, assessment }); }
  const Decision = ({ label, value, onChange }: { label: string; value: RegulatoryDecision; onChange: (value: RegulatoryDecision) => void }) => <label className="text-xs font-semibold">{label}<select value={value} onChange={(e) => onChange(e.target.value as RegulatoryDecision)} className={`${fieldClass} mt-1`}>{REGULATORY_DECISIONS.map((item) => <option key={item}>{item}</option>)}</select></label>;
  return (
    <Card data-testid="incident-regulatory-assessment">
      <CardHeader>ประเมินหน้าที่แจ้งภายนอก</CardHeader>
      <CardBody><form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <label className="text-xs font-semibold sm:col-span-2">ความเสี่ยงต่อสิทธิและเสรีภาพ<select value={breachRiskLevel} onChange={(e) => setBreachRiskLevel(e.target.value)} className={`${fieldClass} mt-1`}><option value="">— ไม่ระบุ —</option>{BREACH_RISK_LEVELS.map((item) => <option key={item}>{item}</option>)}</select></label>
        <div className="sm:col-span-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">ระบบไม่ตัดสินผลทางกฎหมายอัตโนมัติ ผู้ประเมินต้องบันทึกเหตุผลและตัดสินแต่ละปลายทางเอง</div>
        <Decision label="แจ้ง สคส." value={pdpcRequired} onChange={setPdpc} /><Decision label="แจ้งเจ้าของข้อมูล" value={dataSubjectRequired} onChange={setDataSubject} /><Decision label="แจ้ง สกมช./ThaiCERT" value={ncsaRequired} onChange={setNcsa} /><Decision label="หน่วยงานกำกับอื่น" value={otherRegulatorRequired} onChange={setOther} />
        <label className="text-xs font-semibold sm:col-span-4">เหตุผลการประเมิน<textarea value={assessment} onChange={(e) => setAssessment(e.target.value)} rows={4} required className={`${fieldClass} mt-1`} /></label>
        <ErrorText error={mutation.error} /><div className="sm:col-span-4"><Button type="submit" size="sm" isLoading={mutation.isPending} data-testid="incident-assessment-submit">บันทึกผลประเมิน</Button></div>
      </form></CardBody>
    </Card>
  );
}

function DpoAcknowledgement({ incident }: { incident: Incident }) {
  const [note, setNote] = useState('');
  const mutation = useIncidentAction(incident.id, '/dpo-notified');
  return <Card><CardHeader>DPO acknowledgement</CardHeader><CardBody>{incident.dpo_notified_at ? <p className="text-sm text-emerald-700"><ShieldCheck className="mr-1 inline h-4 w-4" />DPO รับทราบแล้ว {formatThaiDate(incident.dpo_notified_at, 'd MMM yyyy HH:mm')} — {incident.dpo_notify_note}</p> : <form onSubmit={(event) => { event.preventDefault(); mutation.mutate({ note }); }} className="flex flex-col gap-2"><textarea value={note} onChange={(e) => setNote(e.target.value)} required rows={2} placeholder="รายละเอียดการแจ้ง/การคัดกรอง" className={fieldClass} /><ErrorText error={mutation.error} /><Button type="submit" size="sm" className="self-start" isLoading={mutation.isPending} data-testid="incident-dpo-notified-submit">บันทึกว่า DPO รับทราบแล้ว</Button></form>}</CardBody></Card>;
}

function RegulatoryNotificationPanel({ incident }: { incident: Incident }) {
  const [destination, setDestination] = useState('PDPC');
  const [agency, setAgency] = useState('');
  const [notificationType, setType] = useState('');
  const [required, setRequired] = useState(true);
  const [status, setStatus] = useState('รอแจ้ง');
  const [deadline, setDeadline] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [reasonNotRequired, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const mutation = useIncidentAction(incident.id, '/regulatory-notifications');
  function submit(event: FormEvent) { event.preventDefault(); mutation.mutate({ destination, agency, notificationType, required, status, deadline: deadline ? new Date(deadline).toISOString() : undefined, referenceNo, evidenceUrl, reasonNotRequired, notes }); }
  return <Card><CardHeader>บันทึกการแจ้ง/หลักฐาน</CardHeader><CardBody><form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="regulatory-notification-form">
    <label className="text-xs font-semibold">ปลายทาง<select value={destination} onChange={(e) => setDestination(e.target.value)} className={`${fieldClass} mt-1`}>{REGULATORY_DESTINATIONS.map((item) => <option key={item}>{item}</option>)}</select></label>
    <label className="text-xs font-semibold">หน่วยงาน/ผู้รับแจ้ง<input value={agency} onChange={(e) => setAgency(e.target.value)} required className={`${fieldClass} mt-1`} /></label>
    <label className="text-xs font-semibold">ประเภทการแจ้ง<input value={notificationType} onChange={(e) => setType(e.target.value)} required className={`${fieldClass} mt-1`} /></label>
    <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={required} onChange={(e) => { setRequired(e.target.checked); if (!e.target.checked) setStatus('ไม่ต้องแจ้ง'); }} /> มีหน้าที่ต้องแจ้ง</label>
    <label className="text-xs font-semibold">สถานะ<select value={status} onChange={(e) => setStatus(e.target.value)} className={`${fieldClass} mt-1`}>{REGULATORY_NOTIFICATION_STATUSES.map((item) => <option key={item}>{item}</option>)}</select></label>
    <label className="text-xs font-semibold">กำหนดเวลา<input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={`${fieldClass} mt-1`} /></label>
    <label className="text-xs font-semibold">เลขรับเรื่อง<input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} className={`${fieldClass} mt-1`} /></label>
    <label className="text-xs font-semibold sm:col-span-2">ลิงก์หลักฐาน<input type="url" value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)} className={`${fieldClass} mt-1`} /></label>
    {!required && <label className="text-xs font-semibold sm:col-span-3">เหตุผลที่ไม่ต้องแจ้ง<textarea value={reasonNotRequired} onChange={(e) => setReason(e.target.value)} required rows={2} className={`${fieldClass} mt-1`} /></label>}
    <label className="text-xs font-semibold sm:col-span-3">หมายเหตุ<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${fieldClass} mt-1`} /></label>
    <ErrorText error={mutation.error} /><div className="sm:col-span-3"><Button type="submit" size="sm" isLoading={mutation.isPending} data-testid="regulatory-notification-submit">บันทึกรายการ</Button></div>
  </form></CardBody></Card>;
}

function ClosePanel({ incident }: { incident: Incident }) {
  const [rootCause, setRootCause] = useState('');
  const [resolution, setResolution] = useState('');
  const [lessonsLearned, setLessons] = useState('');
  const mutation = useIncidentAction(incident.id, '/close');
  return <Card><CardHeader>ปิดเคส</CardHeader><CardBody><form onSubmit={(event) => { event.preventDefault(); mutation.mutate({ rootCause, resolution, lessonsLearned }); }} className="grid gap-3" data-testid="incident-close-form"><label className="text-xs font-semibold">Root Cause<textarea required value={rootCause} onChange={(e) => setRootCause(e.target.value)} rows={2} className={`${fieldClass} mt-1`} /></label><label className="text-xs font-semibold">ผลการแก้ไข<textarea required value={resolution} onChange={(e) => setResolution(e.target.value)} rows={2} className={`${fieldClass} mt-1`} /></label><label className="text-xs font-semibold">บทเรียนที่ได้รับ<textarea value={lessonsLearned} onChange={(e) => setLessons(e.target.value)} rows={2} className={`${fieldClass} mt-1`} /></label><ErrorText error={mutation.error} /><Button type="submit" size="sm" variant="danger" className="justify-self-start" isLoading={mutation.isPending} data-testid="incident-close-submit">ตรวจ Gate และปิดเคส</Button></form></CardBody></Card>;
}

export function IncidentDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('incident.manage');
  const canRegulatory = canManage || hasPermission('incident.regulatory');
  const query = useQuery({ queryKey: ['incidents', id], queryFn: () => apiFetch<IncidentDetail>(`/api/v1/incidents/${id}`), enabled: Boolean(id) });
  const assigneesQuery = useQuery({ queryKey: ['incidents', 'assignees'], queryFn: () => apiFetch<ProfileRef[]>('/api/v1/incidents/assignees'), enabled: canManage });
  if (query.isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!query.data) return null;
  const { incident, regulatoryNotifications } = query.data;
  return <div className="flex flex-col gap-4" data-testid="incident-detail-page">
    <Link to="/incidents" className="flex items-center gap-1 text-sm text-slate-500"><ArrowLeft className="h-4 w-4" /> กลับไปรายการ Incident</Link>
    <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-mono text-sm text-slate-500">{incident.incident_number}</p><h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{incident.title}</h1><p className="text-sm text-slate-500">รายงานโดย {incident.reporter?.full_name ?? incident.reporter?.email ?? '—'} · {formatThaiDate(incident.report_date, 'd MMM yyyy HH:mm')}</p></div><div className="flex flex-wrap gap-1"><Badge variant={incidentStatusTone[incident.status]}>{incident.status}</Badge>{incident.severity && <Badge variant={riskTone[incident.severity]}>{incident.severity}</Badge>}{incident.risk_level && <Badge variant={riskTone[incident.risk_level]}>Risk {incident.risk_level} ({incident.risk_score})</Badge>}{incident.contains_personal_data && <Badge variant="danger">ข้อมูลส่วนบุคคล</Badge>}</div></div>
    {incident.contains_personal_data && !incident.dpo_notified_at && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"><AlertTriangle className="mr-1 inline h-4 w-4" />DPO ยังไม่รับทราบ{incident.dpo_notify_deadline ? ` · กำหนด ${formatThaiDate(incident.dpo_notify_deadline, 'd MMM yyyy HH:mm')}` : ''}</div>}
    <Card><CardHeader>รายละเอียดเหตุการณ์</CardHeader><CardBody className="grid grid-cols-2 gap-4 sm:grid-cols-4"><Info label="ประเภท">{incident.category}</Info><Info label="ระบบที่กระทบ">{incident.affected_system ?? '—'}</Info><Info label="ผู้รับผิดชอบ">{incident.assignee?.full_name ?? '—'}</Info><Info label="ผลประเมินภายนอก">{incident.regulatory_assessment_status}</Info><div className="col-span-full"><Info label="รายละเอียด"><p className="whitespace-pre-wrap">{incident.description}</p></Info></div>{incident.source_ticket && <Info label="ต้นทาง"><Link to={`/tickets/${incident.source_ticket.id}`} className="text-primary-700 hover:underline">Ticket: {incident.source_ticket.title}</Link></Info>}{incident.evidence_url && <Info label="หลักฐาน"><a href={incident.evidence_url} target="_blank" rel="noreferrer" className="text-primary-700 hover:underline">เปิดหลักฐาน <ExternalLink className="inline h-3 w-3" /></a></Info>}</CardBody></Card>
    {canManage && <ManagementPanel incident={incident} assignees={assigneesQuery.data ?? []} />}
    {canRegulatory && <><DpoAcknowledgement incident={incident} /><RegulatoryAssessmentPanel incident={incident} /><RegulatoryNotificationPanel incident={incident} /></>}
    <Card><CardHeader>ประวัติการแจ้งหน่วยงานกำกับ/เจ้าของข้อมูล</CardHeader><CardBody>{regulatoryNotifications.length === 0 ? <p className="text-sm text-slate-400">ยังไม่มีรายการ</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs text-slate-500"><tr><th className="px-2 py-2">ปลายทาง</th><th className="px-2 py-2">หน่วยงาน</th><th className="px-2 py-2">สถานะ</th><th className="px-2 py-2">กำหนด/แจ้งเมื่อ</th><th className="px-2 py-2">หลักฐาน</th></tr></thead><tbody>{regulatoryNotifications.map((item) => <tr key={item.id} className="border-t dark:border-slate-700"><td className="px-2 py-2 font-mono text-xs">{item.destination}</td><td className="px-2 py-2">{item.agency}<p className="text-xs text-slate-400">{item.notification_type}</p></td><td className="px-2 py-2"><Badge variant={item.status === 'แจ้งแล้ว' ? 'success' : item.status === 'รอแจ้ง' ? 'warning' : 'secondary'}>{item.status}</Badge></td><td className="px-2 py-2 text-xs">{item.notified_at ? formatThaiDate(item.notified_at, 'd MMM yyyy HH:mm') : item.deadline ? formatThaiDate(item.deadline, 'd MMM yyyy HH:mm') : '—'}</td><td className="px-2 py-2">{item.reference_no ?? '—'}{item.evidence_url && <a href={item.evidence_url} target="_blank" rel="noreferrer" className="ml-2 text-primary-700">เปิด</a>}</td></tr>)}</tbody></table></div>}</CardBody></Card>
    {canManage && incident.status !== 'ปิดเคส' && <ClosePanel incident={incident} />}
    {incident.status === 'ปิดเคส' && <Card><CardHeader>สรุปการปิดเคส</CardHeader><CardBody className="grid gap-3"><Info label="Root Cause">{incident.root_cause}</Info><Info label="ผลการแก้ไข">{incident.resolution}</Info><Info label="บทเรียน">{incident.lessons_learned ?? '—'}</Info></CardBody></Card>}
  </div>;
}
