import { useMutation } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowRight, ClipboardList, ExternalLink, History, PackageSearch,
  ScanLine, ShieldCheck, TriangleAlert,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import type { AssetFieldSummary, AssetFieldTicket } from '../../types/fieldWork';
import { formatThaiDate } from '../../utils/date';
import { QrScanner } from './QrScanner';

/**
 * จอ 1 ของ Mobile Field Workflow (design handoff 3j) — สแกน QR แล้วรู้ทันทีว่ากำลังยืนอยู่หน้าเครื่องอะไร
 *
 * ออกแบบให้ใช้มือเดียวบนจอ 390px: ข้อมูลเครื่องอยู่บนสุด คำเตือนซ่อมซ้ำอยู่เหนือประวัติ และปุ่มลงมือ
 * อยู่ท้ายสุดในระยะนิ้วโป้ง ทุกตัวเลขมาจาก Ticket จริงที่ผูกกับเครื่องนี้ ไม่มีสถานะที่ระบบเดาเอง
 */
export function AssetScanPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const [summary, setSummary] = useState<AssetFieldSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lookup = useMutation({
    mutationFn: (raw: string) =>
      apiFetch<AssetFieldSummary>(`/api/v1/assets/lookup?code=${encodeURIComponent(raw)}`),
    onSuccess: (data) => {
      setError(null);
      setSummary(data);
    },
    onError: (reason: unknown) => {
      setSummary(null);
      setError(reason instanceof ApiError || reason instanceof Error ? reason.message : 'ค้นหาทรัพย์สินไม่สำเร็จ');
    },
  });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <PageHeader
        eyebrow="หน้างาน / Field"
        title="สแกนทรัพย์สิน"
        description="สแกน QR บนตัวเครื่องเพื่อดูประวัติซ่อมและเปิดใบงานกับเครื่องนั้นได้ทันที"
        leading={<ScanLine className="h-4 w-4" aria-hidden="true" />}
      />

      {!summary && (
        <Card>
          <CardBody>
            <QrScanner busy={lookup.isPending} onDetected={(raw) => lookup.mutate(raw)} />
            {lookup.isPending && (
              <p className="mt-3 text-center text-[12px] text-slate-500 dark:text-slate-400" role="status">กำลังค้นหาเครื่อง...</p>
            )}
            {error && (
              <p className="mt-3 flex items-start gap-2 rounded-[8px] border border-danger-100 bg-danger-50 px-3 py-2.5 text-[12px] leading-5 text-danger-700 dark:border-danger-700 dark:bg-danger-700/20 dark:text-danger-100" role="alert">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {error}
              </p>
            )}
          </CardBody>
        </Card>
      )}

      {summary && (
        <>
          <AssetIdentityCard summary={summary} />

          {summary.repeatRepair.isRepeat && (
            <p className="flex items-start gap-2 rounded-[10px] border border-danger-200 bg-danger-50 px-3.5 py-3 text-[12.5px] leading-5 text-danger-700 dark:border-danger-700 dark:bg-danger-700/20 dark:text-danger-100" role="alert">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                <strong>ซ่อมซ้ำ {summary.repeatRepair.count} ครั้ง</strong> ใน {summary.repeatRepair.windowDays} วันที่ผ่านมา
                {summary.repeatRepair.lastRepairedAt && ` · ครั้งล่าสุด ${formatThaiDate(summary.repeatRepair.lastRepairedAt)}`}
                <span className="mt-0.5 block text-[11.5px] font-normal opacity-90">พิจารณาหาสาเหตุที่แท้จริงหรือเสนอเปลี่ยนเครื่อง แทนการซ่อมเฉพาะหน้าอีกครั้ง</span>
              </span>
            </p>
          )}

          {summary.openTickets.length > 0 && (
            <Card>
              <CardHeader className="flex items-center gap-2"><ClipboardList className="h-4 w-4 text-primary-600" aria-hidden="true" />ใบงานที่ยังเปิดค้างกับเครื่องนี้</CardHeader>
              <CardBody className="space-y-2">
                {summary.openTickets.map((ticket) => <TicketRow key={ticket.id} ticket={ticket} />)}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2"><History className="h-4 w-4 text-primary-600" aria-hidden="true" />ประวัติงานซ่อม</span>
              {summary.historyScope === 'personal' && (
                <span className="text-[10.5px] font-normal text-warning-700 dark:text-warning-100">เห็นเฉพาะใบที่ท่านเกี่ยวข้อง</span>
              )}
            </CardHeader>
            <CardBody className="space-y-2">
              {summary.history.length === 0 ? (
                <p className="text-[12px] text-slate-500 dark:text-slate-400">
                  {summary.historyScope === 'personal'
                    ? 'ไม่มีใบงานของเครื่องนี้ที่ท่านเกี่ยวข้อง — เครื่องนี้อาจเคยซ่อมโดยช่างคนอื่น'
                    : 'เครื่องนี้ยังไม่เคยมีใบงานซ่อมในระบบ'}
                </p>
              ) : (
                summary.history.map((ticket) => <TicketRow key={ticket.id} ticket={ticket} />)
              )}
              {summary.historySampled && (
                <p className="text-[11px] text-slate-400 dark:text-slate-500">แสดงเฉพาะรายการล่าสุด เครื่องนี้มีประวัติมากกว่าที่แสดง</p>
              )}
            </CardBody>
          </Card>

          <div className="sticky bottom-2 space-y-2">
            {hasPermission('ticket.create') && (
              <Button
                className="min-h-[50px] w-full text-[15px]"
                onClick={() => navigate(`/tickets?newForAsset=${summary.asset.id}`)}
              >
                เปิดใบงานกับเครื่องนี้ <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => { setSummary(null); setError(null); }}>
                <ScanLine className="h-4 w-4" aria-hidden="true" />สแกนเครื่องอื่น
              </Button>
              <Link
                to={`/assets/${summary.asset.id}`}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[7px] border border-slate-300 bg-white px-4 text-[13.5px] font-semibold text-slate-700 hover:bg-primary-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />รายละเอียดเครื่อง
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AssetIdentityCard({ summary }: { summary: AssetFieldSummary }) {
  const { asset } = summary;
  const fields = [
    { label: 'ยี่ห้อ / รุ่น', value: [asset.brand, asset.model].filter(Boolean).join(' ') || '—' },
    { label: 'Serial', value: asset.serialNumber || '—' },
    { label: 'สถานที่', value: asset.location || '—' },
    { label: 'ผู้ครอบครอง', value: asset.ownerName || 'ยังไม่ระบุ' },
  ];

  return (
    <div className="rounded-[12px] bg-[#0B1B36] p-4 text-white shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] text-white/55">{asset.assetCode}</p>
          <h2 className="mt-0.5 truncate text-[17px] font-extrabold">{asset.name}</h2>
          <p className="mt-0.5 truncate text-[11.5px] text-white/55">{asset.categoryName || asset.assetType || 'ไม่ระบุประเภท'}</p>
        </div>
        <span className="shrink-0">
          {asset.warrantyActive === null ? (
            <Badge variant="secondary">ไม่มีข้อมูลประกัน</Badge>
          ) : asset.warrantyActive ? (
            <Badge variant="success"><ShieldCheck className="h-3 w-3" aria-hidden="true" />ในประกัน</Badge>
          ) : (
            <Badge variant="warning">หมดประกัน</Badge>
          )}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2.5">
        {fields.map((field) => (
          <div key={field.label} className="min-w-0 rounded-[8px] bg-white/[.07] px-2.5 py-2">
            <dt className="text-[10px] text-white/45">{field.label}</dt>
            <dd className="mt-0.5 truncate text-[12px] font-semibold">{field.value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-white/55">
        <PackageSearch className="h-3.5 w-3.5" aria-hidden="true" />
        สถานะทะเบียน: {asset.status || 'ไม่ระบุ'}
        {asset.warrantyExpire && ` · ประกันถึง ${formatThaiDate(asset.warrantyExpire)}`}
      </p>
    </div>
  );
}

function TicketRow({ ticket }: { ticket: AssetFieldTicket }) {
  return (
    <Link
      to={`/tickets/${ticket.id}`}
      className="flex items-center gap-3 rounded-[8px] border border-hairline px-3 py-2.5 hover:border-primary-300 hover:bg-primary-50/40 dark:border-white/[.08] dark:hover:bg-white/[.05]"
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="font-mono text-[10.5px] font-semibold text-slate-400">{ticket.ticketNo}</span>
          {ticket.overdue && <Badge variant="danger">เกินกำหนด</Badge>}
        </span>
        <span className="mt-0.5 block truncate text-[12.5px] font-semibold text-ink-heading dark:text-slate-100">{ticket.title}</span>
        <span className="mt-0.5 block truncate text-[11px] text-slate-500 dark:text-slate-400">
          {ticket.status}
          {ticket.assigneeName && ` · ${ticket.assigneeName}`}
          {ticket.closedAt ? ` · ปิด ${formatThaiDate(ticket.closedAt)}` : ticket.createdAt ? ` · แจ้ง ${formatThaiDate(ticket.createdAt)}` : ''}
        </span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />
    </Link>
  );
}
