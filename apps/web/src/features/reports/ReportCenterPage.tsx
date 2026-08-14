import { DataTable } from '../../components/table/DataTable';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Activity, BarChart3, Download, FileDown, FileText, Loader2, Printer, RefreshCw, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import type { ReportDataset, ReportKey, ReportOverview } from '../../types/reports';
import { formatThaiDateTime } from '../../utils/date';
import { breakdownWidth, reportCell, reportSearchText } from './reportDisplay';

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

export function ReportCenterPage() {
  const { hasPermission } = useAuth();
  const [rangeDays, setRangeDays] = useState(30);
  const [activeKey, setActiveKey] = useState<ReportKey>('service-desk');
  const [search, setSearch] = useState('');

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
    queryKey: ['reports', activeKey, rangeDays],
    queryFn: () => apiFetch<ReportDataset>(`/api/v1/reports/${activeKey}?rangeDays=${rangeDays}`),
    enabled: definitions.some((item) => item.key === activeKey),
  });

  const rows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('th');
    if (!query) return reportQuery.data?.rows ?? [];
    return (reportQuery.data?.rows ?? []).filter((row) => reportSearchText(row).includes(query));
  }, [reportQuery.data?.rows, search]);

  const csvMutation = useMutation({
    mutationFn: () => apiFetch<{ filename: string; csv: string }>(`/api/v1/reports/${activeKey}/exports/csv`, {
      method: 'POST', body: JSON.stringify({ rangeDays }),
    }),
    onSuccess: ({ filename, csv }) => downloadCsv(filename, csv),
  });
  const printMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/reports/${activeKey}/exports/print`, {
      method: 'POST', body: JSON.stringify({ rangeDays }),
    }),
    onSuccess: () => window.print(),
  });
  const pdfMutation = useMutation({
    mutationFn: () => apiFetch<{ filename: string; pdfBase64: string }>(`/api/v1/reports/${activeKey}/exports/pdf`, {
      method: 'POST', body: JSON.stringify({ rangeDays }),
    }),
    onSuccess: ({ filename, pdfBase64 }) => downloadPdf(filename, pdfBase64),
  });

  return (
    <div className="space-y-5" data-testid="report-center-page">
      <div className="flex flex-wrap items-start justify-between gap-3" data-print-hide>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">Report Center</h1>
          <p className="mt-1 text-sm text-slate-500">รายงานมาตรฐานรวมสำหรับบริการ สินทรัพย์ ความมั่นคง และธรรมาภิบาล</p>
        </div>
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
                        <Button size="sm" variant="outline" data-testid="report-print" isLoading={printMutation.isPending} onClick={() => printMutation.mutate()}><Printer className="h-4 w-4" />พิมพ์</Button>
                        <Button size="sm" variant="outline" data-testid="report-pdf" isLoading={pdfMutation.isPending} onClick={() => pdfMutation.mutate()}><FileDown className="h-4 w-4" />ดาวน์โหลด PDF</Button>
                      </div>
                      {pdfMutation.isError && <p className="text-xs text-red-600">{errorText(pdfMutation.error)}</p>}
                    </div>
                  )}
                </CardBody>
              </Card>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {reportQuery.data.metrics.map((metric) => <StatCard key={metric.label} icon={<BarChart3 className="h-5 w-5" />} {...metric} />)}
              </div>

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
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">{rows.map((row, index) => <tr key={String(row.id ?? row.code ?? index)} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">{reportQuery.data.columns.map((column) => <td key={column.key} className="max-w-[260px] whitespace-nowrap px-4 py-3 text-slate-700 dark:text-slate-200" title={reportCell(row[column.key])}>{reportCell(row[column.key])}</td>)}</tr>)}</tbody>
                  </DataTable>
                  {!rows.length && <p className="p-8 text-center text-sm text-slate-400">ไม่พบข้อมูลในช่วงเวลาหรือคำค้นนี้</p>}
                </div>
              </Card>

              {(csvMutation.isError || printMutation.isError) && <p className="text-sm text-red-600" data-print-hide>{errorText(csvMutation.error ?? printMutation.error)}</p>}
            </section>
          )}
        </>
      )}
    </div>
  );
}
