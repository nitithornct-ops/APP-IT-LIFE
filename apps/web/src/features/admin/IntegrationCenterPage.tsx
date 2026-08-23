import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, BellRing, CheckCircle2, Clock3, Code2, ExternalLink, Link2, Loader2, Mail,
  MessageCircle, MessageSquare, RefreshCw, RotateCcw, Send, ShieldCheck, TriangleAlert, Webhook, XCircle,
} from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageTitle } from '../../components/ui/PageTitle';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { IntegrationCenterResponse, IntegrationChannel, IntegrationEvent, IntegrationStatus } from '../../types/integrations';
import { formatThaiDateTime } from '../../utils/date';

const STATUS_COPY: Record<IntegrationStatus, { label: string; badge: 'success' | 'warning' | 'danger' | 'secondary'; dot: string }> = {
  active: { label: 'พร้อมใช้งาน', badge: 'success', dot: 'bg-success-600' },
  disabled: { label: 'ปิดอยู่', badge: 'secondary', dot: 'bg-slate-400' },
  incomplete: { label: 'ตั้งค่าไม่ครบ', badge: 'warning', dot: 'bg-warning-600' },
  unavailable: { label: 'ยังไม่รองรับ', badge: 'secondary', dot: 'bg-slate-300' },
  degraded: { label: 'ต้องตรวจสอบ', badge: 'danger', dot: 'bg-danger-600' },
};

const CHANNEL_ICONS: Record<string, typeof BellRing> = {
  'in-app': BellRing,
  'line-messaging': MessageCircle,
  'line-login': ShieldCheck,
  smtp: Mail,
  teams: MessageSquare,
  webhook: Webhook,
};

function errorText(reason: unknown): string {
  return reason instanceof ApiError || reason instanceof Error ? reason.message : 'โหลดข้อมูลไม่สำเร็จ';
}

function eventBadge(status: string): 'success' | 'warning' | 'danger' | 'secondary' {
  if (status === 'COMPLETED') return 'success';
  if (['ERROR', 'DEAD'].includes(status)) return 'danger';
  if (['PENDING', 'PROCESSING'].includes(status)) return 'warning';
  return 'secondary';
}

function ChannelCard({ channel }: { channel: IntegrationChannel }) {
  const Icon = CHANNEL_ICONS[channel.id] ?? Link2;
  const status = STATUS_COPY[channel.status];
  return (
    <article className={`rounded-[10px] border bg-white p-3.5 dark:bg-slate-900/50 ${channel.status === 'degraded' ? 'border-danger-300 dark:border-danger-700' : 'border-hairline dark:border-white/[.08]'}`}>
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-50 text-primary-700 dark:bg-primary-950/50 dark:text-primary-300"><Icon className="h-4.5 w-4.5" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-[13px] font-bold text-ink-heading dark:text-white">{channel.name}</h3><Badge variant={status.badge}><span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />{status.label}</Badge></div>
          <p className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400">{channel.description}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-[11px] dark:border-white/[.07]">
        <span className="text-slate-400">{channel.detail}</span>
        {channel.delivered24h !== null && <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">{channel.delivered24h.toLocaleString('th-TH')} / 24ชม.</span>}
      </div>
    </article>
  );
}

function LineMessagePreview() {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex items-center gap-2"><Send className="h-4 w-4 text-primary-600" />ตัวอย่างข้อความ LINE</CardHeader>
      <div className="bg-[#8CABD9] p-4">
        <div className="max-w-[270px] rounded-[3px_12px_12px_12px] bg-white px-3.5 py-3 text-[12px] leading-5 text-slate-800 shadow-sm">
          <p className="font-bold">อัปเดตงานแจ้งซ่อม</p>
          <p className="mt-1">Ticket <span className="font-mono font-semibold">{'{{ticket_no}}'}</span></p>
          <p>{'{{title}}'}</p>
          <p className="mt-1">สถานะ: <strong>{'{{status}}'}</strong></p>
          <p>ผู้ดำเนินการ: {'{{assignee}}'}</p>
          <div className="mt-2 rounded-md bg-[#06C755] px-3 py-2 text-center font-bold text-white">เปิดดูรายละเอียด</div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {['ticket_no', 'title', 'status', 'assignee'].map((variable) => <span key={variable} className="rounded bg-white/85 px-2 py-1 font-mono text-[10px] font-semibold text-slate-700">{'{{'}{variable}{'}}'}</span>)}
        </div>
      </div>
      <CardBody className="text-[11px] leading-5 text-slate-500">Preview นี้แสดงเฉพาะโครงข้อความ ไม่ดึงข้อมูลผู้ใช้หรือ secret มาแสดงในหน้าเว็บ</CardBody>
    </Card>
  );
}

function RecentEventRow({ event, onAction, pending }: { event: IntegrationEvent; onAction: (event: IntegrationEvent, action: string) => void; pending: boolean }) {
  return (
    <div className="grid gap-2 border-b border-slate-100 px-3 py-3 last:border-b-0 dark:border-white/[.07] lg:grid-cols-[minmax(0,1.4fr)_110px_90px_130px] lg:items-center">
      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="truncate font-mono text-[11px] font-semibold text-primary-700 dark:text-primary-300">{event.code}</span><Badge variant={eventBadge(event.status)}>{event.status}</Badge></div><p className="mt-1 truncate text-xs text-slate-600 dark:text-slate-300">{event.eventType} → {event.channel}</p>{event.error && <p className="mt-1 line-clamp-2 text-[11px] text-danger-600 dark:text-danger-300">{event.error}</p>}</div>
      <div className="text-[11px] text-slate-500"><span className="lg:hidden">พยายาม: </span><span className="font-mono">{event.attempt}</span></div>
      <div><span className="font-mono text-[10px] text-slate-400">{formatThaiDateTime(event.occurredAt)}</span></div>
      <div className="flex justify-start gap-1 lg:justify-end">{event.actions.map((action) => <Button key={action} size="sm" variant={action === 'cancel' ? 'danger' : 'outline'} disabled={pending} onClick={() => onAction(event, action)}>{action === 'retry' ? <RotateCcw className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}{action === 'retry' ? 'Retry' : 'ยกเลิก'}</Button>)}</div>
    </div>
  );
}

export function IntegrationCenterPanel({ data, onAction, actionPending = false }: { data: IntegrationCenterResponse; onAction?: (event: IntegrationEvent, action: string) => void; actionPending?: boolean }) {
  return (
    <div className="space-y-4" data-testid="integration-center-panel">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <StatCard icon={<Link2 className="h-5 w-5" />} label="ช่องทางพร้อมใช้" value={data.summary.activeChannels} tone="primary" />
        <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="ส่งสำเร็จ 24 ชม." value={data.summary.delivered24h} tone="teal" />
        <StatCard icon={<TriangleAlert className="h-5 w-5" />} label="ส่งล้มเหลว 24 ชม." value={data.summary.failed24h} tone={data.summary.failed24h ? 'danger' : 'gray'} />
        <StatCard icon={<Clock3 className="h-5 w-5" />} label="รอใน Outbox" value={data.summary.outboxWaiting} tone={data.summary.outboxWaiting ? 'amber' : 'gray'} />
        <StatCard icon={<Activity className="h-5 w-5" />} label="Outbox ผิดพลาด" value={data.summary.outboxFailed} tone={data.summary.outboxFailed ? 'danger' : 'gray'} />
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[296px_minmax(0,1fr)_320px]">
        <Card className="h-fit"><CardHeader className="flex items-center gap-2"><Link2 className="h-4 w-4 text-primary-600" />ช่องทางเชื่อมต่อ</CardHeader><CardBody className="space-y-2.5">{data.channels.map((channel) => <ChannelCard key={channel.id} channel={channel} />)}</CardBody></Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2"><BellRing className="h-4 w-4 text-primary-600" />กติกาแจ้งเตือนที่ใช้งานจริง</span><Badge variant="secondary"><Code2 className="h-3 w-3" />จัดการจาก Source Code</Badge></CardHeader>
          <div className="overflow-x-auto">
            <table className="min-w-[620px] w-full text-left">
              <thead className="bg-slate-50 font-mono text-[10px] uppercase tracking-wider text-slate-400 dark:bg-slate-900/50"><tr><th className="px-4 py-2.5">เหตุการณ์</th><th className="px-3 py-2.5">ช่องทาง</th><th className="px-3 py-2.5">ผู้รับ</th><th className="px-3 py-2.5">สถานะ</th></tr></thead>
              <tbody>{data.rules.map((rule) => <tr key={rule.id} className="border-t border-slate-100 text-xs dark:border-white/[.07]"><td className="px-4 py-3 font-semibold text-slate-800 dark:text-slate-100">{rule.event}</td><td className="px-3 py-3 text-slate-600 dark:text-slate-300">{rule.channel}</td><td className="px-3 py-3 text-slate-500">{rule.recipients}</td><td className="px-3 py-3"><Badge variant={STATUS_COPY[rule.status].badge}>{STATUS_COPY[rule.status].label}</Badge></td></tr>)}</tbody>
            </table>
          </div>
          <div className="flex gap-2 border-t border-blue-100 bg-blue-50 px-4 py-3 text-[11px] leading-5 text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><p>กฎเหล่านี้สะท้อน flow ที่มีในระบบจริง ปัจจุบันยังไม่มีตาราง Notification Rule จึงไม่แสดง toggle ที่กดแล้วไม่เกิดผล</p></div>
        </Card>

        <div className="space-y-4"><LineMessagePreview /><Card><CardHeader className="flex items-center gap-2"><Activity className="h-4 w-4 text-primary-600" />สถานะ Integration Outbox</CardHeader><CardBody className="grid grid-cols-2 gap-2 text-xs">{Object.entries(data.outbox).map(([key, value]) => <div key={key} className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-900"><p className="font-mono text-[10px] uppercase text-slate-400">{key}</p><p className="mt-1 font-mono text-lg font-bold text-slate-800 dark:text-slate-100">{value}</p></div>)}</CardBody></Card></div>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2"><Activity className="h-4 w-4 text-primary-600" />เหตุการณ์ล่าสุด</span><span className="font-mono text-[10px] font-normal text-slate-400">อัปเดต {formatThaiDateTime(data.generatedAt)}</span></CardHeader>
        {data.recentEvents.length ? <div>{data.recentEvents.map((event) => <RecentEventRow key={`${event.source}-${event.id}`} event={event} pending={actionPending} onAction={(row, action) => onAction?.(row, action)} />)}</div> : <EmptyState icon={<CheckCircle2 className="h-9 w-9" />} title="ยังไม่มีประวัติการส่ง" message="เมื่อระบบส่งแจ้งเตือนหรือมีรายการใน Integration Outbox ประวัติจะแสดงที่นี่" />}
      </Card>
    </div>
  );
}

export function IntegrationCenterPage() {
  const queryClient = useQueryClient();
  const overviewQuery = useQuery({ queryKey: ['admin', 'integration-center'], queryFn: () => apiFetch<IntegrationCenterResponse>('/api/v1/integrations/overview'), refetchInterval: 30_000 });
  const actionMutation = useMutation({
    mutationFn: ({ event, action }: { event: IntegrationEvent; action: string }) => apiFetch(`/api/v1/governance/integrations/outbox/${event.id}/actions/${action}`, { method: 'POST', body: '{}' }),
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['admin', 'integration-center'] }), queryClient.invalidateQueries({ queryKey: ['governance', 'integrations'] })]); },
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><PageTitle eyebrow="ตั้งค่าและบัญชี / การเชื่อมต่อ" title="การเชื่อมต่อและแจ้งเตือน" description="ดูสถานะช่องทาง กฎที่ระบบใช้งานจริง และคิวส่งซ้ำ โดยไม่เปิดเผย token หรือ secret" /><Button variant="outline" disabled={overviewQuery.isFetching} onClick={() => void overviewQuery.refetch()}>{overviewQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}รีเฟรช</Button></div>
      {overviewQuery.isLoading && <div className="flex justify-center py-24" role="status"><Loader2 className="h-8 w-8 animate-spin text-primary-600" /></div>}
      {overviewQuery.isError && <EmptyState icon={<ExternalLink className="h-10 w-10" />} title="โหลด Integration Center ไม่สำเร็จ" message={errorText(overviewQuery.error)} action={<Button onClick={() => void overviewQuery.refetch()}>ลองอีกครั้ง</Button>} />}
      {actionMutation.isError && <p className="rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:bg-danger-950/30 dark:text-danger-200" role="alert">{errorText(actionMutation.error)}</p>}
      {overviewQuery.data && <IntegrationCenterPanel data={overviewQuery.data} actionPending={actionMutation.isPending} onAction={(event, action) => actionMutation.mutate({ event, action })} />}
    </div>
  );
}
