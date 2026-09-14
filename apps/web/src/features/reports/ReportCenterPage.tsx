import { DataTable } from '../../components/table/DataTable';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Activity, BarChart3, Bookmark, Building2, CalendarClock, Camera, Download, ExternalLink, FileDown, FileText, GitCompare, Loader2, Printer, RefreshCw, Save, Search, UploadCloud, UserRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageTitle } from '../../components/ui/PageTitle';
import { useGoogleDriveEnabled } from '../../hooks/useGoogleDriveEnabled';
import { ApiError, apiFetch, showToast } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import type { ExecutivePack, ReportDataset, ReportFilters, ReportKey, ReportOptions, ReportOverview, ReportSchedule, SavedReportFilter } from '../../types/reports';
import { formatThaiDateTime } from '../../utils/date';
import { breakdownWidth, reportCell, reportSearchText } from './reportDisplay';
import { CsatAnalyticsPanel } from './CsatAnalyticsPanel';

const RANGE_OPTIONS = [
  { value: 7, label: '7 วัน' },
  { value: 30, label: '30 วัน' },
  { value: 90, label: '90 วัน' },
  { value: 365, label: '1 ปี' },
  { value: 0, label: 'ทั้งหมด' },
];

function errorText(reason: unknown): string {
  return reason instanceof ApiError || reason instanceof Error ? reason.message : 'ไม่สามารถโหลดรายงานได้';
}

function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadPdf(filename: string, pdfBase64: string) {
  const bytes = Uint8Array.from(atob(pdfBase64), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

interface ReportPdfResult {
  filename: string;
  pdfBase64: string;
  drive: { id: string; name: string; webViewLink: string } | null;
  driveError: string | null;
}

function currentMonth(): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value ?? String(new Date().getUTCFullYear());
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  return `${year}-${month}`;
}

function reportQueryString(filters: ReportFilters): string {
  const params = new URLSearchParams({ rangeDays: String(filters.rangeDays), comparePrevious: String(filters.comparePrevious !== false) });
  if (filters.departmentId) params.set('departmentId', filters.departmentId);
  if (filters.ownerId) params.set('ownerId', filters.ownerId);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  return params.toString();
}

function detailPath(row: Record<string, string | number | boolean | null>): string | null {
  const id = String(row.id ?? '');
  if (!id) return null;
  const paths: Record<string, string> = {
    Ticket: '/tickets/',
    'Service Request': '/service-requests/',
    'Access Request': '/access-requests/',
    Asset: '/assets/',
    Incident: '/incidents/',
  };
  return paths[String(row.source)] ? `${paths[String(row.source)]}${id}` : null;
}

export function ReportCenterPage() {
  const { hasPermission } = useAuth();
  const [searchParams] = useSearchParams();
  const driveEnabled = useGoogleDriveEnabled();
  const [driveLink, setDriveLink] = useState<string | null>(null);
  const [rangeDays, setRangeDays] = useState(30);
  const [activeKey, setActiveKey] = useState<ReportKey>(() => (searchParams.get('report') as ReportKey | null) ?? 'service-desk');
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [comparePrevious, setComparePrevious] = useState(true);
  const [filterName, setFilterName] = useState('');
  const [packMonth, setPackMonth] = useState(currentMonth);
  const [showScheduling, setShowScheduling] = useState(false);
  const [scheduleName, setScheduleName] = useState('รายงานประจำเดือน');
  const [scheduleHour, setScheduleHour] = useState(8);

  const filters = useMemo<ReportFilters>(() => ({
    rangeDays,
    ...(departmentId ? { departmentId } : {}),
    ...(ownerId ? { ownerId } : {}),
    comparePrevious,
  }), [comparePrevious, departmentId, ownerId, rangeDays]);

  const optionsQuery = useQuery({
    queryKey: ['reports', 'options'],
    queryFn: () => apiFetch<ReportOptions>('/api/v1/reports/options'),
    staleTime: 5 * 60 * 1000,
  });
  const savedFiltersQuery = useQuery({
    queryKey: ['reports', 'saved-filters', activeKey],
    queryFn: () => apiFetch<SavedReportFilter[]>(`/api/v1/reports/saved-filters?reportKey=${activeKey}`),
  });
  const schedulesQuery = useQuery({
    queryKey: ['reports', 'schedules'],
    queryFn: () => apiFetch<ReportSchedule[]>('/api/v1/reports/schedules'),
    enabled: true,
  });
  const packQuery = useQuery({
    queryKey: ['reports', 'executive-pack', packMonth],
    queryFn: () => apiFetch<ExecutivePack>(`/api/v1/reports/executive-pack?month=${packMonth}`),
    enabled: false,
  });

  const overviewQuery = useQuery({
    queryKey: ['reports', 'overview', rangeDays],
    queryFn: () => apiFetch<ReportOverview>(`/api/v1/reports?rangeDays=${rangeDays}`),
  });
  const definitions = useMemo(() => overviewQuery.data?.definitions ?? [], [overviewQuery.data?.definitions]);

  useEffect(() => {
    if (definitions.length && !definitions.some((item) => item.key === activeKey)) {
      setActiveKey(definitions[0].key);
    }
  }, [activeKey, definitions]);

  const reportQuery = useQuery({
    queryKey: ['reports', activeKey, filters],
    queryFn: () => apiFetch<ReportDataset>(`/api/v1/reports/${activeKey}?${reportQueryString(filters)}`),
    enabled: definitions.some((item) => item.key === activeKey),
  });

  const rows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('th');
    if (!query) return reportQuery.data?.rows ?? [];
    return (reportQuery.data?.rows ?? []).filter((row) => reportSearchText(row).includes(query));
  }, [reportQuery.data?.rows, search]);

  const csvMutation = useMutation({
    mutationFn: () => apiFetch<{ filename: string; csv: string }>(`/api/v1/reports/${activeKey}/exports/csv`, {
      method: 'POST', body: JSON.stringify(filters),
    }),
    onSuccess: ({ filename, csv }) => downloadCsv(filename, csv),
  });
  const printMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/reports/${activeKey}/exports/print`, {
      method: 'POST', body: JSON.stringify(filters),
    }),
    onSuccess: () => window.print(),
  });
  const pdfMutation = useMutation({
    mutationFn: () => apiFetch<ReportPdfResult>(`/api/v1/reports/${activeKey}/exports/pdf`, {
      method: 'POST', body: JSON.stringify(filters),
    }),
    onSuccess: ({ filename, pdfBase64 }) => downloadPdf(filename, pdfBase64),
  });
  /**
   * เก็บสำเนาไว้ใน Drive อย่างเดียว ไม่ดาวน์โหลดซ้ำ — ปุ่มนี้มีไว้ให้ทีมเปิดรายงานย้อนหลังจาก
   * โฟลเดอร์เดียวกันได้โดยไม่ต้องล็อกอินเข้าระบบ ไม่ใช่ทางเลือกที่สองของการดาวน์โหลด
   */
  const driveMutation = useMutation({
    mutationFn: () => apiFetch<ReportPdfResult>(`/api/v1/reports/${activeKey}/exports/pdf`, {
      method: 'POST', body: JSON.stringify({ ...filters, saveToDrive: true }),
    }, { silent: true }),
    onSuccess: ({ drive, driveError }) => {
      setDriveLink(drive?.webViewLink ?? null);
      if (drive) showToast('success', `เก็บสำเนา "${drive.name}" ไว้ใน Google Drive แล้ว`);
      else showToast('error', driveError ?? 'เก็บสำเนาลง Google Drive ไม่สำเร็จ');
    },
    onError: (error) => { setDriveLink(null); showToast('error', errorText(error)); },
  });
  const saveFilterMutation = useMutation({
    mutationFn: () => apiFetch<SavedReportFilter>('/api/v1/reports/saved-filters', {
      method: 'POST', body: JSON.stringify({ reportKey: activeKey, name: filterName.trim(), filters, isShared: false }),
    }),
    onSuccess: () => { setFilterName(''); void savedFiltersQuery.refetch(); showToast('success', 'บันทึก Saved Filter แล้ว'); },
  });
  const snapshotMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/reports/${activeKey}/snapshots`, {
      method: 'POST', body: JSON.stringify({ ...filters, snapshotKind: rangeDays <= 31 ? 'monthly' : 'manual' }),
    }),
    onSuccess: () => showToast('success', 'บันทึก Snapshot รายงานแล้ว'),
  });
  const scheduleMutation = useMutation({
    mutationFn: () => apiFetch<ReportSchedule>('/api/v1/reports/schedules', {
      method: 'POST', body: JSON.stringify({ reportKey: activeKey, name: scheduleName.trim() || 'รายงานประจำเดือน', frequency: 'monthly', dayOfMonth: 1, runHour: scheduleHour, format: 'PDF', saveToDrive: driveEnabled, filters }),
    }),
    onSuccess: () => { setShowScheduling(true); void schedulesQuery.refetch(); showToast('success', 'ตั้งเวลา Scheduled Report แล้ว'); },
  });
  const schedulePackMutation = useMutation({
    mutationFn: () => apiFetch<ReportSchedule>('/api/v1/reports/schedules', {
      method: 'POST', body: JSON.stringify({ reportKey: 'executive-pack', name: 'Monthly Executive Pack', frequency: 'monthly', dayOfMonth: 1, runHour: scheduleHour, format: 'PDF', saveToDrive: driveEnabled, filters: { rangeDays: 0, comparePrevious: true } }),
    }),
    onSuccess: () => { void schedulesQuery.refetch(); showToast('success', 'ตั้งเวลา Monthly Executive Pack แล้ว'); },
  });
  const packSnapshotMutation = useMutation({
    mutationFn: () => apiFetch('/api/v1/reports/executive-pack/snapshots', { method: 'POST', body: JSON.stringify({ month: packMonth }) }),
    onSuccess: () => showToast('success', 'บันทึก Monthly Executive Pack แล้ว'),
  });
  const packPdfMutation = useMutation({
    mutationFn: () => apiFetch<ReportPdfResult>('/api/v1/reports/executive-pack/exports/pdf', { method: 'POST', body: JSON.stringify({ month: packMonth }) }),
    onSuccess: ({ filename, pdfBase64 }) => downloadPdf(filename, pdfBase64),
  });

  function applySavedFilter(saved: SavedReportFilter) {
    const savedFilters = saved.filters;
    if (savedFilters.rangeDays !== undefined) setRangeDays(Number(savedFilters.rangeDays));
    setDepartmentId(savedFilters.departmentId ?? '');
    setOwnerId(savedFilters.ownerId ?? '');
    setComparePrevious(savedFilters.comparePrevious !== false);
    setSearch('');
  }

  return (
    <div className="space-y-5" data-testid="report-center-page">
      <div className="flex flex-wrap items-start justify-between gap-3" data-print-hide>
        <PageTitle eyebrow="ธรรมาภิบาลและรายงาน / Report Center" title="Report Center" description="รายงานมาตรฐานรวมสำหรับบริการ สินทรัพย์ ความมั่นคง และธรรมาภิบาล" />
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-semibold text-slate-500">
            ช่วงข้อมูล
            <select
              aria-label="ช่วงข้อมูลรายงาน"
              value={rangeDays}
              onChange={(event) => { setRangeDays(Number(event.target.value)); setSearch(''); }}
              className="ml-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            >
              {RANGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <Button size="sm" variant="ghost" onClick={() => { void overviewQuery.refetch(); void reportQuery.refetch(); }}>
            <RefreshCw className="h-4 w-4" />รีเฟรช
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200" data-print-hide>
        โมดูลนี้ใช้รายงานมาตรฐานที่ตรวจสอบย้อนหลังได้ พร้อม CSV, พิมพ์ผ่านเบราว์เซอร์ และดาวน์โหลด PDF จริง (Cloudflare Browser Rendering) — Field/PDF Designer แบบลากวางถูกตัดออกจากขอบเขตถาวรตามการตัดสินใจ R-05
      </div>

      <Card data-print-hide data-testid="report-filter-panel">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2"><Search className="h-4 w-4 text-primary-600" />ตัวกรองรายงาน</span><span className="text-xs font-normal text-slate-400">กรองก่อนคำนวณ KPI และ export</span></CardHeader>
        <CardBody className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300"><span className="mb-1 flex items-center gap-1"><Building2 className="h-3.5 w-3.5" />Department</span><select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal dark:border-slate-600 dark:bg-slate-800"><option value="">ทุกหน่วยงาน</option>{optionsQuery.data?.departments.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300"><span className="mb-1 flex items-center gap-1"><UserRound className="h-3.5 w-3.5" />Owner</span><select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal dark:border-slate-600 dark:bg-slate-800"><option value="">ทุกผู้รับผิดชอบ</option>{optionsQuery.data?.owners.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300"><span className="mb-1 flex items-center gap-1"><Bookmark className="h-3.5 w-3.5" />Saved Filter</span><select defaultValue="" onChange={(event) => { const saved = savedFiltersQuery.data?.find((item) => item.id === event.target.value); if (saved) applySavedFilter(saved); }} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal dark:border-slate-600 dark:bg-slate-800"><option value="">เลือก filter ที่บันทึกไว้</option>{savedFiltersQuery.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          </div>
          <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300"><input type="checkbox" checked={comparePrevious} onChange={(event) => setComparePrevious(event.target.checked)} /><GitCompare className="h-3.5 w-3.5" />เปรียบเทียบงวดก่อนหน้า</label><div className="flex flex-1 items-center gap-2"><input value={filterName} onChange={(event) => setFilterName(event.target.value)} placeholder="ชื่อ Saved Filter ใหม่" className="min-w-[180px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" /><Button size="sm" variant="outline" isLoading={saveFilterMutation.isPending} disabled={!filterName.trim()} onClick={() => saveFilterMutation.mutate()}><Save className="h-4 w-4" />บันทึก Filter</Button></div></div>
          {saveFilterMutation.isError && <p className="text-xs text-red-600">{errorText(saveFilterMutation.error)}</p>}
        </CardBody>
      </Card>

      <Card data-print-hide>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100"><CalendarClock className="h-4 w-4 text-primary-600" />Monthly Executive Pack</p>
            <p className="mt-1 text-xs text-slate-500">สร้าง PDF template สำหรับเสนอผู้จัดการ พร้อม KPI, เทียบเดือนก่อน และ Data Freshness</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="month" value={packMonth} onChange={(event) => setPackMonth(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" />
            <Button size="sm" variant="outline" isLoading={packQuery.isFetching} onClick={() => { void packQuery.refetch(); }}><FileText className="h-4 w-4" />Generate</Button>
            {hasPermission('report.export') && <>
              <Button size="sm" variant="outline" isLoading={packSnapshotMutation.isPending} onClick={() => packSnapshotMutation.mutate()}><Camera className="h-4 w-4" />Snapshot</Button>
              <Button size="sm" variant="outline" isLoading={packPdfMutation.isPending} onClick={() => packPdfMutation.mutate()}><FileDown className="h-4 w-4" />PDF ผู้จัดการ</Button>
            </>}
            {hasPermission('report.schedule') && <Button size="sm" variant="outline" isLoading={schedulePackMutation.isPending} onClick={() => schedulePackMutation.mutate()}><CalendarClock className="h-4 w-4" />ตั้งเวลาทุกวันที่ 1</Button>}
          </div>
        </CardBody>
      </Card>

      {packQuery.data && <Card data-testid="executive-pack-preview">
        <CardHeader>{packQuery.data.title}</CardHeader>
        <CardBody className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{packQuery.data.metrics.map((item) => <StatCard key={item.label} icon={<BarChart3 className="h-5 w-5" />} {...item} />)}</div>
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <p className="mb-2 text-xs font-bold">Compare Previous Period</p>
              {packQuery.data.comparison.map((item) => <div key={item.label} className="flex justify-between border-b border-slate-100 py-1.5 text-xs last:border-0 dark:border-slate-700"><span>{item.label}</span><span className="font-semibold">{item.current ?? '—'} <span className="text-slate-400">({item.delta === null ? '—' : item.delta > 0 ? `+${item.delta}` : item.delta})</span></span></div>)}
            </div>
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <p className="mb-2 text-xs font-bold">Data Freshness</p>
              {packQuery.data.freshness.slice(0, 6).map((item) => <div key={item.source} className="flex justify-between gap-2 border-b border-slate-100 py-1.5 text-xs last:border-0 dark:border-slate-700"><span>{item.source}</span><span className={item.status === 'stale' ? 'font-semibold text-amber-600' : 'text-slate-500'}>{item.lastUpdatedAt ? formatThaiDateTime(item.lastUpdatedAt) : 'ไม่พบข้อมูล'}</span></div>)}
            </div>
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700" data-testid="kpi-definition-panel">
              <p className="mb-2 text-xs font-bold">KPI Definition</p>
              {packQuery.data.kpis.length ? packQuery.data.kpis.map((item) => <div key={item.key} className="border-b border-slate-100 py-1.5 text-xs last:border-0 dark:border-slate-700"><div className="flex justify-between gap-2 font-semibold"><span>{item.label}</span><span className="text-slate-400">เป้าหมาย {item.target === null ? '—' : `${item.target} ${item.unit}`}</span></div><p className="mt-0.5 text-slate-500">{item.description} · {item.formula}</p></div>) : <p className="text-xs text-slate-400">ยังไม่มีนิยาม KPI</p>}
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-2">{packQuery.data.sections.map((section) => <div key={section.key} className="rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800/60"><div className="flex justify-between font-semibold"><span>{section.label}</span><span>{section.totalRows.toLocaleString('th-TH')} รายการ</span></div>{section.alerts.slice(0, 2).map((alert) => <p key={alert} className="mt-1 text-amber-700">⚠ {alert}</p>)}</div>)}</div>
          {schedulesQuery.data?.filter((item) => item.reportKey === 'executive-pack').map((item) => <div key={item.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/60"><span className="font-semibold">Scheduled: {item.name}</span><span className="ml-2 text-slate-500">ครั้งถัดไป {formatThaiDateTime(item.nextRunAt)}{item.saveToDrive ? ' · Drive' : ''}</span></div>)}
        </CardBody>
      </Card>}

      {overviewQuery.isLoading && <div className="flex justify-center py-20"><Loader2 className="h-7 w-7 animate-spin text-primary-600" /></div>}
      {overviewQuery.isError && <EmptyState icon={<Activity className="h-10 w-10" />} title="โหลด Report Center ไม่สำเร็จ" message={errorText(overviewQuery.error)} />}
      {overviewQuery.data && definitions.length === 0 && <EmptyState icon={<BarChart3 className="h-10 w-10" />} title="ยังไม่มีรายงานที่เข้าถึงได้" message="สิทธิ์ของบัญชีนี้ยังไม่ครอบคลุมแหล่งข้อมูลรายงาน" />}

      {definitions.length > 0 && (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1" data-print-hide>
            {definitions.map((definition) => (
              <button
                key={definition.key}
                onClick={() => { setActiveKey(definition.key); setSearch(''); }}
                className={`whitespace-nowrap rounded-full border px-3 py-2 text-xs font-semibold ${activeKey === definition.key ? 'border-primary-700 bg-primary-700 text-white' : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}
              >
                {definition.label}
              </button>
            ))}
          </div>

          {reportQuery.isLoading && <div className="flex justify-center py-20"><Loader2 className="h-7 w-7 animate-spin text-primary-600" /></div>}
          {reportQuery.isError && <EmptyState icon={<Activity className="h-10 w-10" />} title="โหลดรายงานไม่สำเร็จ" message={errorText(reportQuery.error)} />}

          {reportQuery.data && (
            <section id="report-print-area" className="space-y-5">
              <Card>
                <CardBody className="flex flex-wrap items-start gap-3">
                  <FileText className="mt-0.5 h-6 w-6 text-primary-600" />
                  <div className="min-w-[240px] flex-1">
                    <h2 className="font-bold text-slate-800 dark:text-slate-100">{reportQuery.data.definition.label}</h2>
                    <p className="mt-1 text-sm text-slate-500">{reportQuery.data.definition.description}</p>
                    <p className="mt-2 text-xs text-slate-400">สร้างเมื่อ {formatThaiDateTime(reportQuery.data.generatedAt)} · {reportQuery.data.totalRows.toLocaleString('th-TH')} รายการ</p>
                  </div>
                  {hasPermission('report.export') && (
                    <div className="flex flex-col items-end gap-1" data-print-hide>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" isLoading={csvMutation.isPending} onClick={() => csvMutation.mutate()}><Download className="h-4 w-4" />CSV</Button>
                        <Button size="sm" variant="outline" isLoading={snapshotMutation.isPending} onClick={() => snapshotMutation.mutate()}><Camera className="h-4 w-4" />Snapshot</Button>
                        <Button size="sm" variant="outline" data-testid="report-print" isLoading={printMutation.isPending} onClick={() => printMutation.mutate()}><Printer className="h-4 w-4" />พิมพ์</Button>
                        <Button size="sm" variant="outline" data-testid="report-pdf" isLoading={pdfMutation.isPending} onClick={() => pdfMutation.mutate()}><FileDown className="h-4 w-4" />ดาวน์โหลด PDF</Button>
                        {driveEnabled && (
                          <Button size="sm" variant="outline" data-testid="report-pdf-drive" isLoading={driveMutation.isPending} onClick={() => { setDriveLink(null); driveMutation.mutate(); }}><UploadCloud className="h-4 w-4" />เก็บสำเนาลง Drive</Button>
                        )}
                        {hasPermission('report.schedule') && <Button size="sm" variant="outline" onClick={() => setShowScheduling((value) => !value)}><CalendarClock className="h-4 w-4" />ตั้งเวลา</Button>}
                      </div>
                      {driveLink && (
                        <a href={driveLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 underline dark:text-primary-300">
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />เปิดสำเนาใน Google Drive
                        </a>
                      )}
                      {pdfMutation.isError && <p className="text-xs text-red-600">{errorText(pdfMutation.error)}</p>}
                    </div>
                  )}
                </CardBody>
              </Card>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {reportQuery.data.metrics.map((metric) => <StatCard key={metric.label} icon={<BarChart3 className="h-5 w-5" />} {...metric} />)}
              </div>

              {(reportQuery.data.comparison?.length || reportQuery.data.freshness?.length) && <div className="grid gap-4 lg:grid-cols-2" data-testid="report-insights-panel">
                {reportQuery.data.comparison && <Card><CardHeader className="flex items-center gap-2"><GitCompare className="h-4 w-4 text-primary-600" />Compare Previous Period</CardHeader><CardBody className="space-y-2">{reportQuery.data.comparison.map((item) => <div key={item.label} className="flex items-center justify-between border-b border-slate-100 py-2 text-xs last:border-0 dark:border-slate-700"><span>{item.label}</span><span className="font-semibold">{item.current ?? '—'} <span className={item.delta !== null && item.delta > 0 ? 'text-amber-600' : 'text-teal-600'}>({item.delta === null ? '—' : item.delta > 0 ? `+${item.delta}` : item.delta})</span></span></div>)}</CardBody></Card>}
                {reportQuery.data.freshness && <Card><CardHeader className="flex items-center gap-2"><Activity className="h-4 w-4 text-primary-600" />Data Freshness</CardHeader><CardBody className="space-y-2">{reportQuery.data.freshness.map((item) => <div key={item.source} className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 text-xs last:border-0 dark:border-slate-700"><span>{item.source}</span><span className={item.status === 'stale' ? 'font-semibold text-amber-600' : item.status === 'unknown' ? 'text-slate-400' : 'text-teal-600'}>{item.lastUpdatedAt ? formatThaiDateTime(item.lastUpdatedAt) : 'ไม่พบเวลาอัปเดต'}</span></div>)}</CardBody></Card>}
              </div>}

              {activeKey === 'service-desk' && reportQuery.data.csat && <CsatAnalyticsPanel data={reportQuery.data.csat} />}

              {reportQuery.data.alerts.length > 0 && (
                <Card className="border-amber-200 dark:border-amber-900">
                  <CardHeader>จุดที่ต้องติดตาม</CardHeader>
                  <CardBody><ul className="space-y-2 text-sm text-amber-800 dark:text-amber-200">{reportQuery.data.alerts.map((alert) => <li key={alert}>• {alert}</li>)}</ul></CardBody>
                </Card>
              )}

              {(reportQuery.data.breakdowns.length > 0 || reportQuery.data.trend.length > 0) && (
                <div className="grid gap-4 lg:grid-cols-2">
                  {reportQuery.data.breakdowns.slice(0, 2).map((breakdown) => (
                    <Card key={breakdown.label}>
                      <CardHeader>{breakdown.label}</CardHeader>
                      <CardBody className="space-y-3">
                        {breakdown.items.length ? breakdown.items.slice(0, 10).map((item) => (
                          <div key={item.label} className="grid grid-cols-[minmax(90px,1fr)_3fr_48px] items-center gap-2 text-xs">
                            <span className="truncate font-medium" title={item.label}>{item.label}</span>
                            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><div className="h-full rounded-full bg-primary-600" style={{ width: `${breakdownWidth(item, breakdown.items)}%` }} /></div>
                            <span className="text-right font-bold">{item.value.toLocaleString('th-TH')}</span>
                          </div>
                        )) : <p className="text-sm text-slate-400">ไม่มีข้อมูล</p>}
                      </CardBody>
                    </Card>
                  ))}
                  {reportQuery.data.trend.length > 0 && (
                    <Card>
                      <CardHeader>แนวโน้ม 6 เดือน</CardHeader>
                      <CardBody>
                        <div className="flex h-48 items-end gap-3 border-b border-slate-200 px-2 dark:border-slate-700">
                          {reportQuery.data.trend.map((point) => {
                            const maximum = Math.max(1, ...reportQuery.data.trend.flatMap((item) => [item.primary, item.secondary ?? 0]));
                            return <div key={point.label} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1 text-center"><div className="flex items-end justify-center gap-1"><div title={`${reportQuery.data.trendLabels?.primary ?? 'หลัก'} ${point.primary}`} className="w-3 rounded-t bg-primary-600" style={{ height: `${Math.max(3, point.primary / maximum * 150)}px` }} />{point.secondary !== undefined && <div title={`${reportQuery.data.trendLabels?.secondary ?? 'รอง'} ${point.secondary}`} className="w-3 rounded-t bg-teal-600" style={{ height: `${Math.max(3, point.secondary / maximum * 150)}px` }} />}</div><span className="truncate text-[10px] text-slate-400">{point.label}</span></div>;
                          })}
                        </div>
                        <p className="mt-3 text-center text-xs text-slate-400">{reportQuery.data.trendLabels?.primary}{reportQuery.data.trendLabels?.secondary ? ` · ${reportQuery.data.trendLabels.secondary}` : ''}</p>
                      </CardBody>
                    </Card>
                  )}
                </div>
              )}

              <Card>
                <CardHeader className="flex flex-wrap items-center justify-between gap-3">
                  <span>รายละเอียด</span>
                  <div className="flex min-w-[240px] items-center gap-2 font-normal" data-print-hide><Search className="h-4 w-4 text-slate-400" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาในรายงาน..." className="w-full bg-transparent text-sm outline-none" /><span className="whitespace-nowrap text-xs text-slate-400">{rows.length} รายการ</span></div>
                </CardHeader>
                <div className="overflow-x-auto">
                  <DataTable className="min-w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900/40"><tr>{reportQuery.data.columns.map((column) => <th key={column.key} className="whitespace-nowrap px-4 py-3 font-semibold">{column.label}</th>)}</tr></thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">{rows.map((row, index) => { const path = detailPath(row); return <tr key={String(row.id ?? row.code ?? index)} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">{reportQuery.data.columns.map((column) => <td key={column.key} className="max-w-[260px] whitespace-nowrap px-4 py-3 text-slate-700 dark:text-slate-200" title={reportCell(row[column.key])}>{column.key === 'title' && path ? <Link to={path} className="font-semibold text-primary-700 hover:underline dark:text-primary-300">{reportCell(row[column.key])}</Link> : reportCell(row[column.key])}</td>)}</tr>; })}</tbody>
                  </DataTable>
                  {!rows.length && <p className="p-8 text-center text-sm text-slate-400">ไม่พบข้อมูลในช่วงเวลาหรือคำค้นนี้</p>}
                </div>
              </Card>

              {showScheduling && <Card data-print-hide data-testid="report-scheduling-panel"><CardHeader className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-primary-600" />Scheduled Report</CardHeader><CardBody className="space-y-3"><div className="grid gap-3 sm:grid-cols-[1fr_120px_auto]"><input value={scheduleName} onChange={(event) => setScheduleName(event.target.value)} aria-label="ชื่อกำหนดการรายงาน" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" /><label className="flex items-center gap-2 text-xs text-slate-500">เวลา <input type="number" min={0} max={23} value={scheduleHour} onChange={(event) => setScheduleHour(Number(event.target.value))} className="w-16 rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" />:00</label><Button size="sm" isLoading={scheduleMutation.isPending} onClick={() => scheduleMutation.mutate()}><CalendarClock className="h-4 w-4" />ตั้งเวลาทุกวันที่ 1</Button></div>{scheduleMutation.isError && <p className="text-xs text-red-600">{errorText(scheduleMutation.error)}</p>}{schedulesQuery.isLoading && <p className="text-xs text-slate-400">กำลังโหลดกำหนดการ...</p>}{schedulesQuery.data?.filter((item) => item.reportKey === activeKey).map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/60"><span className="font-semibold">{item.name}</span><span className="text-slate-500">ครั้งถัดไป {formatThaiDateTime(item.nextRunAt)} · {item.format}{item.saveToDrive ? ' · Drive' : ''}</span></div>)}</CardBody></Card>}

              {(csvMutation.isError || printMutation.isError) && <p className="text-sm text-red-600" data-print-hide>{errorText(csvMutation.error ?? printMutation.error)}</p>}
            </section>
          )}
        </>
      )}
    </div>
  );
}
