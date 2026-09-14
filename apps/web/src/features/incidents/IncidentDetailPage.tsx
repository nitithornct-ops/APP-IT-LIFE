import { DataTable } from '../../components/table/DataTable';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Clock3, ExternalLink, Loader2, Network, Plus, ShieldCheck, Siren } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { PageTitle } from '../../components/ui/PageTitle';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import {
  BREACH_RISK_LEVELS,
  INCIDENT_SEVERITIES,
  NOTIFICATION_CLOCK_STATUSES,
  NOTIFICATION_CLOCK_TYPES,
  NOTIFICATION_TIMELINE_EVENT_TYPES,
  REGULATORY_DECISIONS,
  REGULATORY_DESTINATIONS,
  REGULATORY_NOTIFICATION_STATUSES,
  type Incident,
  type IncidentCiRef,
  type IncidentCiRelationship,
  type IncidentDetail,
  type IncidentReferences,
  type NotificationClock,
  type NotificationTimelineEvent,
  type ProfileRef,
} from '../../types/incidents';
import { formatThaiDate } from '../../utils/date';
import { incidentStatusTone, riskTone } from './incidentDisplay';

const fieldClass = 'w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900';
type RegulatoryDecision = (typeof REGULATORY_DECISIONS)[number];
type ClockStatus = (typeof NOTIFICATION_CLOCK_STATUSES)[number];
type ClockType = (typeof NOTIFICATION_CLOCK_TYPES)[number];

function Info({ label, children }: { label: string; children: ReactNode }) {
  return <div><p className="text-xs font-semibold text-slate-400">{label}</p><div className="text-sm text-slate-700 dark:text-slate-200">{children ?? '—'}</div></div>;
}

function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="text-sm text-red-600" role="alert">{error instanceof ApiError ? error.message : 'ดำเนินการไม่สำเร็จ'}</p>;
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

function employeeName(employee: IncidentCiRef['owner'] | IncidentCiRef['administrator']): string {
  if (!employee || typeof employee !== 'object') return '—';
  const value = employee as { first_name_th?: string; last_name_th?: string; nickname?: string | null };
  return [value.first_name_th, value.last_name_th].filter(Boolean).join(' ') || value.nickname || '—';
}

function localDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function isoDateTime(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function ManagementPanel({ incident, assignees, ciOptions }: { incident: Incident; assignees: ProfileRef[]; ciOptions: IncidentReferences['configurationItems'] }) {
  const [severity, setSeverity] = useState(incident.severity ?? '');
  const [likelihood, setLikelihood] = useState(incident.likelihood?.toString() ?? '');
  const [impact, setImpact] = useState(incident.impact?.toString() ?? '');
  const [assigneeId, setAssigneeId] = useState(incident.assignee_id ?? '');
  const [affectedCiId, setAffectedCiId] = useState(incident.affected_ci_id ?? '');
  const [detectionSource, setDetectionSource] = useState(incident.detection_source ?? '');
  const [incidentCommanderId, setIncidentCommanderId] = useState(incident.incident_commander_id ?? '');
  const [majorIncident, setMajorIncident] = useState(incident.major_incident);
  const [containment, setContainment] = useState(incident.containment ?? '');
  const [eradication, setEradication] = useState(incident.eradication ?? '');
  const [recovery, setRecovery] = useState(incident.recovery ?? '');
  const [status, setStatus] = useState<Incident['status']>(incident.status === 'ปิดเคส' ? 'กำลังดำเนินการ' : incident.status);
  const [notes, setNotes] = useState(incident.notes ?? '');
  const mutation = useIncidentAction(incident.id, '', 'PATCH');
  function submit(event: FormEvent) {
    event.preventDefault();
    mutation.mutate({ severity: severity || null, likelihood: likelihood ? Number(likelihood) : null, impact: impact ? Number(impact) : null, assigneeId: assigneeId || null, affectedCiId: affectedCiId || null, detectionSource, incidentCommanderId: incidentCommanderId || null, majorIncident, containment, eradication, recovery, status, notes });
  }
  return <Card><CardHeader>จำแนก ประเมินความเสี่ยง สั่งการ และตอบสนอง</CardHeader><CardBody><form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-4" data-testid="incident-manage-form">
    <label className="text-xs font-semibold">ความรุนแรง<select value={severity} onChange={(e) => setSeverity(e.target.value)} className={`${fieldClass} mt-1`}><option value="">— ยังไม่ระบุ —</option>{INCIDENT_SEVERITIES.map((value) => <option key={value}>{value}</option>)}</select></label>
    <label className="text-xs font-semibold">Likelihood (1–5)<select value={likelihood} onChange={(e) => setLikelihood(e.target.value)} className={`${fieldClass} mt-1`}><option value="">—</option>{[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}</select></label>
    <label className="text-xs font-semibold">Impact (1–5)<select value={impact} onChange={(e) => setImpact(e.target.value)} className={`${fieldClass} mt-1`}><option value="">—</option>{[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}</select></label>
    <label className="flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-800 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-200"><input type="checkbox" checked={majorIncident} onChange={(e) => setMajorIncident(e.target.checked)} /> <Siren className="h-4 w-4" /> Major Incident</label>
    <label className="text-xs font-semibold sm:col-span-2">Affected System / CI<select value={affectedCiId} onChange={(e) => setAffectedCiId(e.target.value)} className={`${fieldClass} mt-1`}><option value="">— ไม่ผูก CI —</option>{ciOptions.map((item) => <option key={item.id} value={item.id}>{item.ci_code} · {item.name} · {item.criticality}</option>)}</select></label>
    <label className="text-xs font-semibold sm:col-span-2">Detection Source<input value={detectionSource} onChange={(e) => setDetectionSource(e.target.value)} placeholder="SIEM / Monitoring / User report" className={`${fieldClass} mt-1`} /></label>
    <label className="text-xs font-semibold sm:col-span-2">Incident Commander<select value={incidentCommanderId} onChange={(e) => setIncidentCommanderId(e.target.value)} className={`${fieldClass} mt-1`}><option value="">— ยังไม่กำหนด —</option>{assignees.map((item) => <option key={item.id} value={item.id}>{item.full_name} ({item.email})</option>)}</select></label>
    <label className="text-xs font-semibold sm:col-span-2">ผู้รับผิดชอบ<select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={`${fieldClass} mt-1`}><option value="">— ยังไม่มอบหมาย —</option>{assignees.map((item) => <option key={item.id} value={item.id}>{item.full_name} ({item.email})</option>)}</select></label>
    <label className="text-xs font-semibold">สถานะ<select value={status} onChange={(e) => setStatus(e.target.value as Incident['status'])} className={`${fieldClass} mt-1`}><option>เปิด</option><option>กำลังดำเนินการ</option></select></label>
    <label className="text-xs font-semibold sm:col-span-3">หมายเหตุ<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${fieldClass} mt-1`} /></label>
    <label className="text-xs font-semibold sm:col-span-4">Containment<textarea value={containment} onChange={(e) => setContainment(e.target.value)} rows={3} placeholder="การจำกัดขอบเขตและลดผลกระทบทันที" className={`${fieldClass} mt-1`} /></label>
    <label className="text-xs font-semibold sm:col-span-2">Eradication<textarea value={eradication} onChange={(e) => setEradication(e.target.value)} rows={3} placeholder="การกำจัดต้นเหตุ/ภัยคุกคาม" className={`${fieldClass} mt-1`} /></label>
    <label className="text-xs font-semibold sm:col-span-2">Recovery<textarea value={recovery} onChange={(e) => setRecovery(e.target.value)} rows={3} placeholder="การกู้คืนบริการและเฝ้าระวัง" className={`${fieldClass} mt-1`} /></label>
    <ErrorText error={mutation.error} /><div className="sm:col-span-4"><Button type="submit" size="sm" isLoading={mutation.isPending} data-testid="incident-manage-submit">บันทึกการดำเนินงาน</Button></div>
  </form></CardBody></Card>;
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
  return <Card data-testid="incident-regulatory-assessment"><CardHeader>ประเมินหน้าที่แจ้งภายนอก</CardHeader><CardBody><form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
    <label className="text-xs font-semibold sm:col-span-2">ความเสี่ยงต่อสิทธิและเสรีภาพ<select value={breachRiskLevel} onChange={(e) => setBreachRiskLevel(e.target.value)} className={`${fieldClass} mt-1`}><option value="">— ไม่ระบุ —</option>{BREACH_RISK_LEVELS.map((item) => <option key={item}>{item}</option>)}</select></label>
    <div className="sm:col-span-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">ผู้ประเมินต้องบันทึกเหตุผลและตัดสินแต่ละปลายทางเอง ระบบจะไม่ตีความข้อกฎหมายอัตโนมัติ</div>
    <Decision label="แจ้ง สคส." value={pdpcRequired} onChange={setPdpc} /><Decision label="แจ้งเจ้าของข้อมูล" value={dataSubjectRequired} onChange={setDataSubject} /><Decision label="แจ้ง สกมช./ThaiCERT" value={ncsaRequired} onChange={setNcsa} /><Decision label="หน่วยงานกำกับอื่น" value={otherRegulatorRequired} onChange={setOther} />
    <label className="text-xs font-semibold sm:col-span-4">เหตุผลการประเมิน<textarea value={assessment} onChange={(e) => setAssessment(e.target.value)} rows={4} required className={`${fieldClass} mt-1`} /></label>
    <ErrorText error={mutation.error} /><div className="sm:col-span-4"><Button type="submit" size="sm" isLoading={mutation.isPending} data-testid="incident-assessment-submit">บันทึกผลประเมิน</Button></div>
  </form></CardBody></Card>;
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
  function submit(event: FormEvent) { event.preventDefault(); mutation.mutate({ destination, agency, notificationType, required, status, deadline: isoDateTime(deadline), referenceNo, evidenceUrl, reasonNotRequired, notes }); }
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

function clockStatusLabel(status: ClockStatus): string {
  return { RUNNING: 'กำลังนับ', NOTIFIED: 'แจ้งแล้ว', NOT_REQUIRED: 'ไม่ต้องแจ้ง', EXPIRED: 'เกินกำหนด' }[status];
}

function clockDueText(clock: NotificationClock | undefined): string {
  if (!clock) return 'ยังไม่ได้เริ่มนับ';
  if (clock.status === 'NOT_REQUIRED') return 'ไม่ต้องแจ้งตามผลประเมิน';
  if (clock.status === 'NOTIFIED') return clock.notified_at ? `แจ้งแล้ว ${formatThaiDate(clock.notified_at, 'd MMM yyyy HH:mm')}` : 'แจ้งแล้ว';
  if (clock.status === 'EXPIRED') return 'เกินกำหนด';
  if (!clock.deadline_at) return 'เริ่มนับแล้ว แต่ยังไม่กำหนดเส้นตาย';
  const diffHours = Math.ceil((new Date(clock.deadline_at).getTime() - Date.now()) / 3_600_000);
  return diffHours < 0 ? `เกินกำหนด ${Math.abs(diffHours)} ชม.` : `เหลือประมาณ ${diffHours} ชม.`;
}

function NotificationClockForm({ incidentId, clockType, clock }: { incidentId: string; clockType: ClockType; clock?: NotificationClock }) {
  const [startedAt, setStartedAt] = useState(localDateTime(clock?.started_at));
  const [deadlineAt, setDeadlineAt] = useState(localDateTime(clock?.deadline_at));
  const [status, setStatus] = useState<ClockStatus>(clock?.status ?? 'RUNNING');
  const [notifiedAt, setNotifiedAt] = useState(localDateTime(clock?.notified_at));
  const [referenceNo, setReferenceNo] = useState(clock?.reference_no ?? '');
  const [notes, setNotes] = useState(clock?.notes ?? '');
  const mutation = useIncidentAction(incidentId, '/notification-clocks');
  function submit(event: FormEvent) { event.preventDefault(); mutation.mutate({ clockType, startedAt: isoDateTime(startedAt), deadlineAt: isoDateTime(deadlineAt), status, notifiedAt: isoDateTime(notifiedAt), referenceNo, notes }); }
  const label = clockType === 'PDPA' ? 'PDPA' : 'Cyber';
  return <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><div className="mb-2 flex items-center justify-between gap-2"><div><p className="font-semibold">{label} notification clock</p><p className="text-xs text-slate-500">{clockDueText(clock)}</p></div><Badge variant={clock?.status === 'NOTIFIED' ? 'success' : clock?.status === 'EXPIRED' ? 'danger' : 'warning'}>{clock ? clockStatusLabel(clock.status) : 'ยังไม่เริ่ม'}</Badge></div><form onSubmit={submit} className="grid gap-2 sm:grid-cols-2"><label className="text-xs font-semibold">เริ่มนับเมื่อ<input type="datetime-local" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} className={`${fieldClass} mt-1`} /></label><label className="text-xs font-semibold">เส้นตาย<input type="datetime-local" value={deadlineAt} onChange={(e) => setDeadlineAt(e.target.value)} className={`${fieldClass} mt-1`} /></label><label className="text-xs font-semibold">สถานะ<select value={status} onChange={(e) => setStatus(e.target.value as ClockStatus)} className={`${fieldClass} mt-1`}>{NOTIFICATION_CLOCK_STATUSES.map((item) => <option key={item} value={item}>{clockStatusLabel(item)}</option>)}</select></label><label className="text-xs font-semibold">แจ้งเมื่อ<input type="datetime-local" required={status === 'NOTIFIED'} value={notifiedAt} onChange={(e) => setNotifiedAt(e.target.value)} className={`${fieldClass} mt-1`} /></label><label className="text-xs font-semibold">เลขอ้างอิง<input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} className={`${fieldClass} mt-1`} /></label><label className="text-xs font-semibold">หมายเหตุ<input value={notes} onChange={(e) => setNotes(e.target.value)} className={`${fieldClass} mt-1`} /></label><ErrorText error={mutation.error} /><div className="sm:col-span-2"><Button type="submit" size="sm" isLoading={mutation.isPending}>บันทึก clock</Button></div></form></div>;
}

function NotificationClocksPanel({ incidentId, clocks }: { incidentId: string; clocks: NotificationClock[] }) {
  const byType = new Map(clocks.map((clock) => [clock.clock_type, clock]));
  return <Card><CardHeader className="flex items-center gap-2"><Clock3 className="h-4 w-4" /> PDPA / Cyber notification clock</CardHeader><CardBody><p className="mb-3 text-xs text-slate-500">กำหนดวันเริ่มและเส้นตายตามผลประเมิน/นโยบายขององค์กร ระบบไม่ hard-code ระยะเวลาตามกฎหมาย</p><div className="grid gap-3 lg:grid-cols-2">{NOTIFICATION_CLOCK_TYPES.map((clockType) => <NotificationClockForm key={clockType} incidentId={incidentId} clockType={clockType} clock={byType.get(clockType)} />)}</div></CardBody></Card>;
}

const TIMELINE_LABELS: Record<(typeof NOTIFICATION_TIMELINE_EVENT_TYPES)[number], string> = {
  REPORT_RECEIVED: 'รับแจ้งเหตุ', DPO_ACKNOWLEDGED: 'DPO รับทราบ', PDPA_CLOCK_STARTED: 'เริ่ม PDPA clock', PDPA_NOTIFIED: 'แจ้ง PDPA แล้ว',
  CYBER_CLOCK_STARTED: 'เริ่ม Cyber clock', CYBER_NOTIFIED: 'แจ้ง Cyber แล้ว', DATA_SUBJECT_NOTIFIED: 'แจ้งเจ้าของข้อมูลแล้ว',
  OTHER_REGULATOR_NOTIFIED: 'แจ้งหน่วยงานอื่นแล้ว', NOTIFICATION_RECORDED: 'บันทึกรายการแจ้ง', OTHER: 'เหตุการณ์อื่น',
};

function NotificationTimelinePanel({ incidentId, events }: { incidentId: string; events: NotificationTimelineEvent[] }) {
  const [note, setNote] = useState('');
  const mutation = useIncidentAction(incidentId, '/notification-timeline');
  return <Card><CardHeader>Notification Timeline</CardHeader><CardBody><div className="space-y-3">{events.length === 0 ? <p className="text-sm text-slate-400">ยังไม่มีเหตุการณ์ใน timeline</p> : events.map((event) => <div key={event.id} className="flex gap-3 border-l-2 border-primary-200 pl-3 dark:border-primary-800"><div className="min-w-0"><p className="text-sm font-semibold">{TIMELINE_LABELS[event.event_type] ?? event.event_type}{event.destination ? ` · ${event.destination}` : ''}</p><p className="text-xs text-slate-500">{formatThaiDate(event.occurred_at, 'd MMM yyyy HH:mm')}{event.reference_no ? ` · ${event.reference_no}` : ''}</p>{event.note && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{event.note}</p>}</div></div>)}</div><form className="mt-4 flex flex-col gap-2 border-t border-slate-200 pt-3 dark:border-slate-700" onSubmit={(event) => { event.preventDefault(); mutation.mutate({ eventType: 'OTHER', note }); setNote(''); }}><label className="text-xs font-semibold">เพิ่มเหตุการณ์/หมายเหตุการแจ้ง<textarea value={note} onChange={(e) => setNote(e.target.value)} required rows={2} className={`${fieldClass} mt-1`} /></label><ErrorText error={mutation.error} /><Button type="submit" size="sm" className="self-start" isLoading={mutation.isPending}><Plus className="h-4 w-4" /> เพิ่มใน Timeline</Button></form></CardBody></Card>;
}

function AutomationPanel({ incident, canCreateProblem, canCreateChange, followUpProblems, emergencyChanges }: { incident: Incident; canCreateProblem: boolean; canCreateChange: boolean; followUpProblems: { id: string; problem_number: string; title: string; status: string }[]; emergencyChanges: { id: string; change_number: string; title: string; status: string; risk_level: string }[] }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const problemMutation = useMutation({ mutationFn: () => apiFetch<{ problem: { id: string }; duplicate: boolean }>(`/api/v1/incidents/${incident.id}/create-problem`, { method: 'POST', body: '{}' }), onSuccess: (result) => { void queryClient.invalidateQueries({ queryKey: ['incidents', incident.id] }); void navigate(`/problems/${result.problem.id}`); }, onError: setError });
  const changeMutation = useMutation({ mutationFn: () => apiFetch<{ change: { id: string }; duplicate: boolean }>(`/api/v1/incidents/${incident.id}/create-emergency-change`, { method: 'POST', body: '{}' }), onSuccess: (result) => { void queryClient.invalidateQueries({ queryKey: ['incidents', incident.id] }); void navigate(`/changes/${result.change.id}`); }, onError: setError });
  if (!canCreateProblem && !canCreateChange) return null;
  return <Card><CardHeader>ITIL follow-up</CardHeader><CardBody><p className="mb-3 text-sm text-slate-500">สร้างงานต่อจาก Incident พร้อมรักษาความสัมพันธ์ Incident → Problem → Change</p>{(followUpProblems.length > 0 || emergencyChanges.length > 0) && <div className="mb-3 grid gap-2 sm:grid-cols-2">{followUpProblems.map((problem) => <Link key={problem.id} to={`/problems/${problem.id}`} className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm hover:border-amber-400 dark:border-amber-900 dark:bg-amber-950/20"><span className="font-mono text-xs">{problem.problem_number}</span><span className="ml-2 font-semibold">{problem.title}</span><p className="text-xs text-slate-500">Problem · {problem.status}</p></Link>)}{emergencyChanges.map((change) => <Link key={change.id} to={`/changes/${change.id}`} className="rounded-lg border border-purple-200 bg-purple-50 p-2 text-sm hover:border-purple-400 dark:border-purple-900 dark:bg-purple-950/20"><span className="font-mono text-xs">{change.change_number}</span><span className="ml-2 font-semibold">{change.title}</span><p className="text-xs text-slate-500">Emergency Change · {change.status}</p></Link>)}</div>}<div className="flex flex-wrap gap-2">{canCreateProblem && <Button size="sm" variant="outline" isLoading={problemMutation.isPending} onClick={() => { setError(null); problemMutation.mutate(); }} data-testid="incident-create-problem"><Plus className="h-4 w-4" /> Create Problem</Button>}{canCreateChange && <Button size="sm" variant="danger" isLoading={changeMutation.isPending} onClick={() => { setError(null); changeMutation.mutate(); }} data-testid="incident-create-emergency-change"><Plus className="h-4 w-4" /> Create Emergency Change</Button>}</div><ErrorText error={error} /></CardBody></Card>;
}

function ClosePanel({ incident }: { incident: Incident }) {
  const [rootCause, setRootCause] = useState('');
  const [resolution, setResolution] = useState('');
  const [lessonsLearned, setLessons] = useState(incident.lessons_learned ?? '');
  const mutation = useIncidentAction(incident.id, '/close');
  return <Card><CardHeader>ปิดเคส</CardHeader><CardBody><form onSubmit={(event) => { event.preventDefault(); mutation.mutate({ rootCause, resolution, lessonsLearned }); }} className="grid gap-3" data-testid="incident-close-form"><label className="text-xs font-semibold">Root Cause<textarea required value={rootCause} onChange={(e) => setRootCause(e.target.value)} rows={2} className={`${fieldClass} mt-1`} /></label><label className="text-xs font-semibold">ผลการแก้ไข<textarea required value={resolution} onChange={(e) => setResolution(e.target.value)} rows={2} className={`${fieldClass} mt-1`} /></label><label className="text-xs font-semibold">บทเรียนที่ได้รับ<textarea value={lessonsLearned} onChange={(e) => setLessons(e.target.value)} rows={2} className={`${fieldClass} mt-1`} /></label><ErrorText error={mutation.error} /><Button type="submit" size="sm" variant="danger" className="justify-self-start" isLoading={mutation.isPending} data-testid="incident-close-submit">ตรวจ Gate และปิดเคส</Button></form></CardBody></Card>;
}

export function IncidentDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('incident.manage');
  const canRegulatory = canManage || hasPermission('incident.regulatory');
  const canCreateProblem = hasPermission('problem.manage');
  const canCreateChange = hasPermission('change.create');
  const query = useQuery({ queryKey: ['incidents', id], queryFn: () => apiFetch<IncidentDetail>(`/api/v1/incidents/${id}`), enabled: Boolean(id) });
  const assigneesQuery = useQuery({ queryKey: ['incidents', 'assignees'], queryFn: () => apiFetch<ProfileRef[]>('/api/v1/incidents/assignees'), enabled: canManage });
  const referencesQuery = useQuery({ queryKey: ['incidents', 'references'], queryFn: () => apiFetch<IncidentReferences>('/api/v1/incidents/references'), enabled: canManage });
  if (query.isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!query.data) return null;
  const { incident, regulatoryNotifications, notificationClocks, notificationTimeline, ciRelationships } = query.data;
  const ci = incident.affected_ci;
  return <div className="flex flex-col gap-4" data-testid="incident-detail-page">
    <Link to="/incidents" className="flex items-center gap-1 text-sm text-slate-500"><ArrowLeft className="h-4 w-4" /> กลับไปรายการ Incident</Link>
    <div className="flex flex-wrap items-start justify-between gap-2"><PageTitle eyebrow={`บริการและกระบวนการ IT / ${incident.incident_number}`} title={<>{incident.title}</>} description={<>รายงานโดย {incident.reporter?.full_name ?? incident.reporter?.email ?? '—'} · {formatThaiDate(incident.report_date, 'd MMM yyyy HH:mm')}</>} /><div className="flex flex-wrap gap-1"><Badge variant={incidentStatusTone[incident.status]}>{incident.status}</Badge>{incident.severity && <Badge variant={riskTone[incident.severity]}>{incident.severity}</Badge>}{incident.risk_level && <Badge variant={riskTone[incident.risk_level]}>Risk {incident.risk_level} ({incident.risk_score})</Badge>}{incident.major_incident && <Badge variant="danger"><Siren className="h-3 w-3" /> Major Incident</Badge>}{incident.contains_personal_data && <Badge variant="danger">ข้อมูลส่วนบุคคล</Badge>}</div></div>
    {incident.contains_personal_data && !incident.dpo_notified_at && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"><AlertTriangle className="mr-1 inline h-4 w-4" />DPO ยังไม่รับทราบ{incident.dpo_notify_deadline ? ` · กำหนด ${formatThaiDate(incident.dpo_notify_deadline, 'd MMM yyyy HH:mm')}` : ''}</div>}
    <Card><CardHeader>รายละเอียดเหตุการณ์</CardHeader><CardBody className="grid grid-cols-2 gap-4 sm:grid-cols-4"><Info label="ประเภท">{incident.category}</Info><Info label="Detection Source">{incident.detection_source}</Info><Info label="Incident Commander">{incident.incident_commander?.full_name ?? '—'}</Info><Info label="ผู้รับผิดชอบ">{incident.assignee?.full_name ?? '—'}</Info><div className="col-span-full"><Info label="รายละเอียด"><p className="whitespace-pre-wrap">{incident.description}</p></Info></div>{incident.source_ticket && <Info label="ต้นทาง"><Link to={`/tickets/${incident.source_ticket.id}`} className="text-primary-700 hover:underline">Ticket: {incident.source_ticket.title}</Link></Info>}{incident.evidence_url && <Info label="หลักฐาน"><a href={incident.evidence_url} target="_blank" rel="noreferrer" className="text-primary-700 hover:underline">เปิดหลักฐาน <ExternalLink className="inline h-3 w-3" /></a></Info>}</CardBody></Card>
    <Card><CardHeader className="flex items-center gap-2"><Network className="h-4 w-4" /> CMDB / Affected System</CardHeader><CardBody>{ci ? <><div className="grid gap-4 sm:grid-cols-4"><Info label="CI">{ci.ci_code} · {ci.name}<p className="text-xs text-slate-500">{ci.ci_type} · {ci.environment} · {ci.status}</p></Info><Info label="Owner">{employeeName(ci.owner)}</Info><Info label="Criticality">{ci.criticality}</Info><Info label="Administrator">{employeeName(ci.administrator)}</Info><Info label="Vendor">{ci.vendor ? `${ci.vendor.vendor_code} · ${ci.vendor.name}` : '—'}</Info><Info label="Contract">{ci.contract ? `${ci.contract.contract_number} · ${ci.contract.name}` : '—'}</Info><Info label="Backup">{ci.backup_required ? `ต้องมี · ${ci.backup_reference ?? 'ยังไม่ระบุ reference'}` : 'ไม่บังคับ'}</Info><Info label="Dependencies">{ciRelationships.filter((item) => item.related_ci).length} รายการ</Info></div>{ciRelationships.length > 0 && <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700"><p className="mb-2 text-xs font-semibold text-slate-500">ระบบ/CI ที่พึ่งพาหรือเกี่ยวข้อง</p><div className="grid gap-2 sm:grid-cols-2">{ciRelationships.map((item: IncidentCiRelationship) => <div key={item.id} className="rounded-lg bg-slate-50 p-2 text-sm dark:bg-slate-900"><span className="font-semibold">{item.related_ci ? `${item.related_ci.ci_code} · ${item.related_ci.name}` : 'CI ที่ไม่พบใน CMDB'}</span><span className="ml-2 text-xs text-slate-500">{item.relationship_type} · {item.impact_level}</span></div>)}</div></div>}</> : <div><Info label="Affected System (legacy)">{incident.affected_system ?? 'ยังไม่ได้ผูก CI'}</Info><p className="mt-2 text-xs text-amber-700">แนะนำให้ผู้ดูแลผูกระบบจาก CMDB เพื่อดึง Owner, Criticality, Vendor, Contract, Backup และ dependency</p></div>}</CardBody></Card>
    <Card><CardHeader className="flex items-center gap-2"><Network className="h-4 w-4" /> CMDB / Affected System</CardHeader><CardBody>{ci ? <><div className="grid gap-4 sm:grid-cols-4"><Info label="CI">{ci.ci_code} · {ci.name}<p className="text-xs text-slate-500">{ci.ci_type} · {ci.environment} · {ci.status}</p></Info><Info label="Owner">{employeeName(ci.owner)}</Info><Info label="Criticality">{ci.criticality}</Info><Info label="Administrator">{employeeName(ci.administrator)}</Info><Info label="Vendor">{ci.vendor ? `${ci.vendor.vendor_code} · ${ci.vendor.name}` : '—'}</Info><Info label="Contract">{ci.contract ? `${ci.contract.contract_number} · ${ci.contract.name}` : '—'}</Info><Info label="Backup">{ci.backup_required ? `ต้องมี · ${ci.backup_reference ?? 'ยังไม่ระบุ reference'}` : 'ไม่บังคับ'}</Info><Info label="Dependencies">{ciRelationships.filter((item) => item.related_ci).length} รายการ</Info></div>{ciRelationships.length > 0 && <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700"><p className="mb-2 text-xs font-semibold text-slate-500">ระบบ/CI ที่พึ่งพาหรือเกี่ยวข้อง</p><div className="grid gap-2 sm:grid-cols-2">{ciRelationships.map((item: IncidentCiRelationship) => <div key={item.id} className="rounded-lg bg-slate-50 p-2 text-sm dark:bg-slate-900"><span className="font-semibold">{item.related_ci ? `${item.related_ci.ci_code} · ${item.related_ci.name}` : 'CI ที่ไม่พบใน CMDB'}</span><span className="ml-2 text-xs text-slate-500">{item.relationship_type} · {item.impact_level}</span></div>)}</div></div>}</> : <div><Info label="Affected System (legacy)">{incident.affected_system ?? 'ยังไม่ได้ผูก CI'}</Info><p className="mt-2 text-xs text-amber-700">แนะนำให้ผู้ดูแลผูกระบบจาก CMDB เพื่อดึง Owner, Criticality, Vendor, Contract, Backup และ dependency</p></div>}</CardBody></Card>
    {(incident.containment || incident.eradication || incident.recovery) && <Card><CardHeader>Response phases</CardHeader><CardBody className="grid gap-4 sm:grid-cols-3"><Info label="Containment"><p className="whitespace-pre-wrap">{incident.containment}</p></Info><Info label="Eradication"><p className="whitespace-pre-wrap">{incident.eradication}</p></Info><Info label="Recovery"><p className="whitespace-pre-wrap">{incident.recovery}</p></Info></CardBody></Card>}
    {canManage && <ManagementPanel incident={incident} assignees={assigneesQuery.data ?? []} ciOptions={referencesQuery.data?.configurationItems ?? []} />}
    {(canCreateProblem || canCreateChange || query.data.followUpProblems.length > 0 || query.data.emergencyChanges.length > 0) && <AutomationPanel incident={incident} canCreateProblem={canCreateProblem} canCreateChange={canCreateChange} followUpProblems={query.data.followUpProblems} emergencyChanges={query.data.emergencyChanges} />}
    {canRegulatory && <><DpoAcknowledgement incident={incident} /><RegulatoryAssessmentPanel incident={incident} /><NotificationClocksPanel incidentId={incident.id} clocks={notificationClocks} /><RegulatoryNotificationPanel incident={incident} /></>}
    <Card><CardHeader>ประวัติการแจ้งหน่วยงานกำกับ/เจ้าของข้อมูล</CardHeader><CardBody>{regulatoryNotifications.length === 0 ? <p className="text-sm text-slate-400">ยังไม่มีรายการ</p> : <div className="overflow-x-auto"><DataTable className="w-full text-left text-sm"><thead className="text-xs text-slate-500"><tr><th className="px-2 py-2">ปลายทาง</th><th className="px-2 py-2">หน่วยงาน</th><th className="px-2 py-2">สถานะ</th><th className="px-2 py-2">กำหนด/แจ้งเมื่อ</th><th className="px-2 py-2">หลักฐาน</th></tr></thead><tbody>{regulatoryNotifications.map((item) => <tr key={item.id} className="border-t dark:border-slate-700"><td className="px-2 py-2 font-mono text-xs">{item.destination}</td><td className="px-2 py-2">{item.agency}<p className="text-xs text-slate-400">{item.notification_type}</p></td><td className="px-2 py-2"><Badge variant={item.status === 'แจ้งแล้ว' ? 'success' : item.status === 'รอแจ้ง' ? 'warning' : 'secondary'}>{item.status}</Badge></td><td className="px-2 py-2 text-xs">{item.notified_at ? formatThaiDate(item.notified_at, 'd MMM yyyy HH:mm') : item.deadline ? formatThaiDate(item.deadline, 'd MMM yyyy HH:mm') : '—'}</td><td className="px-2 py-2">{item.reference_no ?? '—'}{item.evidence_url && <a href={item.evidence_url} target="_blank" rel="noreferrer" className="ml-2 text-primary-700">เปิด</a>}</td></tr>)}</tbody></DataTable></div>}</CardBody></Card>
    {canRegulatory && <NotificationTimelinePanel incidentId={incident.id} events={notificationTimeline} />}
    {canManage && incident.status !== 'ปิดเคส' && <ClosePanel incident={incident} />}
    {incident.status === 'ปิดเคส' && <Card><CardHeader>สรุปการปิดเคส</CardHeader><CardBody className="grid gap-3"><Info label="Root Cause">{incident.root_cause}</Info><Info label="ผลการแก้ไข">{incident.resolution}</Info><Info label="บทเรียน">{incident.lessons_learned ?? '—'}</Info></CardBody></Card>}
  </div>;
}
