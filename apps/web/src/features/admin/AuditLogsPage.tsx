import { DataTable, TablePagination } from '../../components/table/DataTable';
import { ExportCsvButton } from '../../components/table/ExportCsvButton';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, FileClock, Loader2, LogIn, Search, ShieldAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Card, CardBody, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { AuditLogItem, AuditOverview, LoginLogItem, PaginatedResult } from '../../types/admin';
import { formatThaiDate } from '../../utils/date';

type LogTab = 'audit' | 'login';

const resultStyles: Record<AuditLogItem['result'], string> = {
  success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
  fail: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
  denied: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200',
};

function errorText(reason: unknown): string {
  return reason instanceof ApiError || reason instanceof Error ? reason.message : 'โหลดข้อมูลไม่สำเร็จ';
}

function detailText(detail: Record<string, unknown> | null): string {
  if (!detail || Object.keys(detail).length === 0) return '—';
  return JSON.stringify(detail);
}

export function AuditLogsPage() {
  const [tab, setTab] = useState<LogTab>('audit');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [actor, setActor] = useState('');
  const [module, setModule] = useState('');
  const [action, setAction] = useState('');
  const [result, setResult] = useState('');

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (actor.trim()) params.set(tab === 'audit' ? 'actor' : 'email', actor.trim());
    if (tab === 'audit') {
      if (module.trim()) params.set('module', module.trim());
      if (action.trim()) params.set('action', action.trim());
      if (result) params.set('result', result);
    } else if (result) params.set('success', result);
    return params.toString();
  }, [action, actor, from, module, page, pageSize, result, tab, to]);

  const overviewQuery = useQuery({
    queryKey: ['admin', 'audit-overview'],
    queryFn: () => apiFetch<AuditOverview>('/api/v1/audit-logs/overview?days=30'),
  });
  const logsQuery = useQuery<PaginatedResult<AuditLogItem | LoginLogItem>>({
    queryKey: ['admin', 'audit-logs', tab, queryString],
    queryFn: () => tab === 'audit'
      ? apiFetch<PaginatedResult<AuditLogItem | LoginLogItem>>(`/api/v1/audit-logs?${queryString}`)
      : apiFetch<PaginatedResult<AuditLogItem | LoginLogItem>>(`/api/v1/audit-logs/login-logs?${queryString}`),
  });

  const resetPage = () => setPage(1);
  const switchTab = (next: LogTab) => {
    setTab(next);
    setPage(1);
    setActor('');
    setModule('');
    setAction('');
    setResult('');
  };

  return (
    <div className="space-y-5" data-testid="audit-log-page">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">Audit Log</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">ตรวจสอบกิจกรรมระบบและประวัติการเข้าสู่ระบบ ข้อมูลส่วนนี้อ่านอย่างเดียวและแก้ไขไม่ได้</p>
      </div>

      {overviewQuery.data && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard icon={<FileClock className="h-5 w-5" />} label="กิจกรรม 30 วัน" value={overviewQuery.data.auditTotal} tone="primary" />
          <StatCard icon={<ShieldAlert className="h-5 w-5" />} label="ถูกปฏิเสธ" value={overviewQuery.data.denied} tone="danger" />
          <StatCard icon={<AlertTriangle className="h-5 w-5" />} label="ทำรายการไม่สำเร็จ" value={overviewQuery.data.failedActions} tone="amber" />
          <StatCard icon={<LogIn className="h-5 w-5" />} label="เข้าสู่ระบบ" value={overviewQuery.data.loginTotal} tone="teal" />
          <StatCard icon={<AlertTriangle className="h-5 w-5" />} label="เข้าสู่ระบบไม่สำเร็จ" value={overviewQuery.data.failedLogins} tone="danger" />
        </div>
      )}

      <Card>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="ประเภทประวัติ">
              <button type="button" role="tab" aria-selected={tab === 'audit'} onClick={() => switchTab('audit')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === 'audit' ? 'bg-primary-700 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>Audit Trail</button>
              <button type="button" role="tab" aria-selected={tab === 'login'} onClick={() => switchTab('login')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === 'login' ? 'bg-primary-700 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>Login History</button>
            </div>
            <ExportCsvButton
              disabled={!logsQuery.data?.items.length}
              fileName={`${tab === 'audit' ? 'audit-trail' : 'login-history'}-page-${page}.csv`}
              getRows={() => (tab === 'audit'
                ? [
                  ['เวลา', 'ผู้ดำเนินการ', 'การกระทำ', 'โมดูล', 'ตารางเป้าหมาย', 'Target ID', 'รายละเอียด', 'ผลลัพธ์'],
                  ...((logsQuery.data?.items ?? []) as AuditLogItem[]).map((log) => [
                    formatThaiDate(log.created_at, 'd MMM yyyy HH:mm'),
                    log.actor_email ?? 'ระบบ',
                    log.action,
                    log.module,
                    log.target_table ?? '',
                    log.target_id ?? '',
                    detailText(log.detail),
                    log.result,
                  ]),
                ]
                : [
                  ['เวลา', 'อีเมล', 'ผลลัพธ์', 'MFA', 'IP Address', 'หมายเหตุ'],
                  ...((logsQuery.data?.items ?? []) as LoginLogItem[]).map((log) => [
                    formatThaiDate(log.created_at, 'd MMM yyyy HH:mm'),
                    log.email_attempted,
                    log.success ? 'success' : 'fail',
                    log.mfa_used ? 'ผ่าน' : '',
                    log.ip_address ?? '',
                    log.failure_reason ?? '',
                  ]),
                ])}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <label className="text-xs font-semibold text-slate-500">ตั้งแต่วันที่<input aria-label="ตั้งแต่วันที่" type="date" value={from} onChange={(event) => { setFrom(event.target.value); resetPage(); }} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
            <label className="text-xs font-semibold text-slate-500">ถึงวันที่<input aria-label="ถึงวันที่" type="date" value={to} onChange={(event) => { setTo(event.target.value); resetPage(); }} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
            <label className="text-xs font-semibold text-slate-500">{tab === 'audit' ? 'ผู้ดำเนินการ' : 'อีเมล'}<div className="relative mt-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={actor} onChange={(event) => { setActor(event.target.value); resetPage(); }} placeholder="ค้นหาอีเมล" className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-600 dark:bg-slate-900" /></div></label>
            {tab === 'audit' && <label className="text-xs font-semibold text-slate-500">โมดูล<input value={module} onChange={(event) => { setModule(event.target.value); resetPage(); }} placeholder="เช่น settings" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>}
            {tab === 'audit' && <label className="text-xs font-semibold text-slate-500">การกระทำ<input value={action} onChange={(event) => { setAction(event.target.value); resetPage(); }} placeholder="เช่น UPDATE_SETTING" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>}
            <label className="text-xs font-semibold text-slate-500">ผลลัพธ์<select value={result} onChange={(event) => { setResult(event.target.value); resetPage(); }} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"><option value="">ทั้งหมด</option>{tab === 'audit' ? <><option value="success">success</option><option value="fail">fail</option><option value="denied">denied</option></> : <><option value="true">สำเร็จ</option><option value="false">ไม่สำเร็จ</option></>}</select></label>
          </div>
        </CardBody>
      </Card>

      {logsQuery.isLoading && <div className="flex justify-center py-12" role="status"><Loader2 className="h-7 w-7 animate-spin text-primary-600" /></div>}
      {logsQuery.isError && <EmptyState icon={<AlertTriangle className="h-10 w-10" />} title="โหลดประวัติไม่สำเร็จ" message={errorText(logsQuery.error)} />}
      {logsQuery.data && logsQuery.data.items.length === 0 && <EmptyState icon={<Search className="h-10 w-10" />} title="ไม่พบประวัติ" message="ลองเปลี่ยนช่วงวันที่หรือเงื่อนไขการค้นหา" />}
      {logsQuery.data && logsQuery.data.items.length > 0 && (tab === 'audit'
        ? <AuditTable items={logsQuery.data.items as AuditLogItem[]} />
        : <LoginTable items={logsQuery.data.items as LoginLogItem[]} />)}

      {logsQuery.data && <TablePagination page={logsQuery.data.pagination.page} pageSize={pageSize} totalItems={logsQuery.data.pagination.totalItems} totalPages={logsQuery.data.pagination.totalPages} onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} />}
    </div>
  );
}

function AuditTable({ items }: { items: AuditLogItem[] }) {
  return <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700"><DataTable mode="server" className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800"><tr><th className="px-4 py-3">เวลา</th><th className="px-4 py-3">ผู้ดำเนินการ</th><th className="px-4 py-3">การกระทำ / โมดูล</th><th className="px-4 py-3">เป้าหมาย</th><th className="px-4 py-3">รายละเอียด</th><th className="px-4 py-3">ผลลัพธ์</th></tr></thead><tbody>{items.map((log) => <tr key={log.id} className="border-t border-slate-100 align-top dark:border-slate-700"><td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatThaiDate(log.created_at, 'd MMM yyyy HH:mm')} น.</td><td className="px-4 py-3 text-slate-700 dark:text-slate-300">{log.actor_email ?? 'ระบบ'}</td><td className="px-4 py-3"><code className="text-xs font-semibold text-primary-700 dark:text-primary-300">{log.action}</code><p className="mt-1 text-xs text-slate-500">{log.module}</p></td><td className="px-4 py-3 text-xs text-slate-500">{log.target_table ?? '—'}{log.target_id && <span className="block max-w-40 truncate" title={log.target_id}>{log.target_id}</span>}</td><td className="max-w-xs px-4 py-3"><span className="block truncate text-xs text-slate-500" title={detailText(log.detail)}>{detailText(log.detail)}</span></td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${resultStyles[log.result]}`}>{log.result}</span></td></tr>)}</tbody></DataTable></div>;
}

function LoginTable({ items }: { items: LoginLogItem[] }) {
  return <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700"><DataTable mode="server" className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800"><tr><th className="px-4 py-3">เวลา</th><th className="px-4 py-3">อีเมล</th><th className="px-4 py-3">ผลลัพธ์</th><th className="px-4 py-3">MFA</th><th className="px-4 py-3">IP Address</th><th className="px-4 py-3">สาเหตุ</th></tr></thead><tbody>{items.map((log) => <tr key={log.id} className="border-t border-slate-100 dark:border-slate-700"><td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatThaiDate(log.created_at, 'd MMM yyyy HH:mm')} น.</td><td className="px-4 py-3 text-slate-700 dark:text-slate-300">{log.email_attempted}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${log.success ? resultStyles.success : resultStyles.fail}`}>{log.success ? 'success' : 'fail'}</span></td><td className="px-4 py-3 text-slate-500">{log.mfa_used ? 'ใช้งาน' : '—'}</td><td className="px-4 py-3 font-mono text-xs text-slate-500">{log.ip_address ?? '—'}</td><td className="px-4 py-3 text-xs text-slate-500">{log.failure_reason ?? '—'}</td></tr>)}</tbody></DataTable></div>;
}
