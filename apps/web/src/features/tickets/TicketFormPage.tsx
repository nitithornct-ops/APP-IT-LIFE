import { TICKET_RATING_CRITERIA } from '@itlife/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Printer } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { apiFetch } from '../../services/apiClient';
import type { BrandingSettings } from '../../types/settings';
import type { TicketDetail } from '../../types/tickets';
import { formatThaiDate } from '../../utils/date';

function Field({ label, value, wide = false }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return <div className={wide ? 'sm:col-span-2' : ''}>
    <p className="text-[11px] font-semibold text-slate-500">{label}</p>
    <div className="mt-1 min-h-7 border-b border-dotted border-slate-400 text-sm font-medium text-slate-900">{value || '—'}</div>
  </div>;
}

export function TicketFormPage() {
  const { id } = useParams<{ id: string }>();
  const ticketQuery = useQuery({ queryKey: ['tickets', id], queryFn: () => apiFetch<TicketDetail>(`/api/v1/tickets/${id}`), enabled: Boolean(id) });
  const brandingQuery = useQuery({ queryKey: ['branding'], queryFn: () => apiFetch<BrandingSettings>('/api/v1/settings/branding') });

  if (ticketQuery.isLoading) return <div className="flex justify-center py-24" role="status"><Loader2 className="h-8 w-8 animate-spin text-primary-600" /></div>;
  if (!ticketQuery.data) return <p className="py-20 text-center text-sm text-slate-500">ไม่พบ Ticket นี้ หรือท่านไม่มีสิทธิ์เข้าถึง</p>;

  const ticket = ticketQuery.data;
  const requesterName = ticket.requester?.full_name ?? ticket.requester_name_snapshot ?? ticket.guest_name ?? '—';
  const department = ticket.department_name_snapshot ?? ticket.guest_department ?? '—';
  const ratingItems = ticket.rating_criteria_snapshot?.length
    ? ticket.rating_criteria_snapshot
    : TICKET_RATING_CRITERIA.flatMap((criterion) => {
      const score = ticket.rating_details?.[criterion.key];
      return score === undefined ? [] : [{ key: criterion.key, label: criterion.label, score }];
    });

  return <div className="ticket-form-screen space-y-4">
    <div className="ticket-form-actions flex flex-wrap items-center justify-between gap-3">
      <Link to={`/tickets/${ticket.id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-primary-700 hover:underline dark:text-primary-300"><ArrowLeft className="h-4 w-4" />กลับไป Ticket</Link>
      <Button onClick={() => window.print()}><Printer className="h-4 w-4" />พิมพ์ / บันทึก PDF</Button>
    </div>

    <article className="ticket-print-page mx-auto w-full max-w-[210mm] bg-white p-6 text-slate-900 shadow-sm sm:p-10" data-testid="ticket-form-page">
      <header className="flex items-start gap-4 border-b-2 border-primary-700 pb-4">
        {brandingQuery.data?.logoUrl
          ? <img src={brandingQuery.data.logoUrl} alt="โลโก้หน่วยงาน" className="h-16 w-16 object-contain" />
          : <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-primary-700 text-xl font-extrabold text-white">IT</div>}
        <div className="min-w-0 flex-1 text-center">
          <p className="text-sm font-semibold">{brandingQuery.data?.organizationName ?? 'LIFE IT'}</p>
          <h1 className="mt-1 text-xl font-extrabold">แบบฟอร์มการให้บริการและแจ้งซ่อม</h1>
          <p className="mt-1 font-mono text-sm font-bold text-primary-800">{ticket.ticket_no}</p>
        </div>
        <Badge variant="secondary">{ticket.status}</Badge>
      </header>

      <section className="mt-5">
        <h2 className="ticket-form-section-title">ข้อมูลผู้แจ้งและงานบริการ</h2>
        <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          <Field label="ผู้แจ้ง" value={requesterName} />
          <Field label="หน่วยงาน" value={department} />
          <Field label="เบอร์ติดต่อ" value={ticket.requester_phone} />
          <Field label="สถานที่" value={ticket.location} />
          <Field label="วันที่แจ้ง" value={formatThaiDate(ticket.created_at, 'd MMM yyyy HH:mm')} />
          <Field label="กำหนดแล้วเสร็จ" value={ticket.due_at ? formatThaiDate(ticket.due_at, 'd MMM yyyy HH:mm') : null} />
          <Field label="หมวดหมู่" value={ticket.ticket_categories?.name} />
          <Field label="ระดับความสำคัญ" value={ticket.priority} />
          <Field label="ผู้รับผิดชอบ" value={ticket.assignee?.full_name ?? ticket.assignee_name_snapshot} />
          <Field label="ช่องทางแจ้ง" value={ticket.source_channel} />
        </div>
      </section>

      <section className="mt-5">
        <h2 className="ticket-form-section-title">รายละเอียดและผลการดำเนินงาน</h2>
        <div className="mt-3 space-y-4">
          <Field label="เรื่อง" value={ticket.title} wide />
          <div><p className="text-[11px] font-semibold text-slate-500">รายละเอียดปัญหา/คำขอ</p><p className="mt-1 min-h-16 whitespace-pre-wrap rounded border border-slate-300 p-3 text-sm">{ticket.description || '—'}</p></div>
          <div><p className="text-[11px] font-semibold text-slate-500">ผลการแก้ไข</p><p className="mt-1 min-h-16 whitespace-pre-wrap rounded border border-slate-300 p-3 text-sm">{ticket.resolution || '—'}</p></div>
        </div>
      </section>

      {ticket.worklogs.length > 0 && <section className="mt-5">
        <h2 className="ticket-form-section-title">ประวัติการดำเนินงาน</h2>
        <table className="mt-3 w-full border-collapse text-xs"><thead><tr className="bg-slate-100"><th>วันเวลา</th><th>รายการ</th><th>รายละเอียด</th><th>ผู้ดำเนินการ</th></tr></thead><tbody>{ticket.worklogs.filter((item) => item.is_public).map((item) => <tr key={item.id}><td>{formatThaiDate(item.created_at, 'd/MM/yyyy HH:mm')}</td><td>{item.action}</td><td>{item.detail ?? '—'}</td><td>{item.actor?.full_name ?? 'ระบบ'}</td></tr>)}</tbody></table>
      </section>}

      <section className="mt-5 break-inside-avoid">
        <h2 className="ticket-form-section-title">ผลประเมินการให้บริการ</h2>
        {ratingItems.length ? <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">{ratingItems.map((item) => <div key={item.key} className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 text-sm"><span>{item.label}</span><strong>{item.score}/5</strong></div>)}</div> : <p className="mt-3 text-sm text-slate-500">ยังไม่มีการประเมินหลังปิดงาน</p>}
        {ticket.feedback && <p className="mt-3 rounded bg-slate-50 p-3 text-sm">ความคิดเห็น: {ticket.feedback}</p>}
      </section>

      <footer className="mt-8 grid grid-cols-1 gap-8 border-t border-slate-300 pt-5 sm:grid-cols-2">
        <div className="text-center"><div className="mx-auto h-24 max-w-56 border-b border-slate-400"></div><p className="mt-2 text-sm">ผู้รับบริการ / ผู้แจ้ง</p></div>
        <div className="text-center">
          <div className="mx-auto flex h-24 max-w-56 items-end justify-center border-b border-slate-400 pb-1">{ticket.signature_url && <img src={ticket.signature_url} alt="ลายเซ็นรับรอง Ticket" className="max-h-20 max-w-full object-contain" />}</div>
          <p className="mt-2 text-sm">ผู้รับรองการให้บริการ</p>
        </div>
      </footer>
      <p className="mt-8 text-center text-[10px] text-slate-400">เอกสารสร้างอัตโนมัติจากข้อมูล Ticket ณ {formatThaiDate(new Date().toISOString(), 'd MMM yyyy HH:mm')}</p>
    </article>
  </div>;
}
