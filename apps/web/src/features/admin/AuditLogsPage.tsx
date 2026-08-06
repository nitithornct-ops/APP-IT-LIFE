import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { apiFetch } from '../../services/apiClient';
import type { AuditLogItem, PaginatedResult } from '../../types/admin';
import { formatThaiDate } from '../../utils/date';

const resultStyles: Record<AuditLogItem['result'], string> = {
  success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  fail: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  denied: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

export function AuditLogsPage() {
  const [page, setPage] = useState(1);

  const logsQuery = useQuery({
    queryKey: ['admin', 'audit-logs', page],
    queryFn: () => apiFetch<PaginatedResult<AuditLogItem>>(`/api/v1/audit-logs?page=${page}&pageSize=20`),
  });

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-800 dark:text-slate-100">Audit Log</h1>

      {logsQuery.isLoading && (
        <div className="flex justify-center py-10" role="status">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
        </div>
      )}

      {logsQuery.data && logsQuery.data.items.length === 0 && (
        <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">ยังไม่มีข้อมูล Audit Log</p>
      )}

      {logsQuery.data && logsQuery.data.items.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2">เวลา</th>
                <th className="px-4 py-2">ผู้กระทำ</th>
                <th className="px-4 py-2">การกระทำ</th>
                <th className="px-4 py-2">โมดูล</th>
                <th className="px-4 py-2">ผลลัพธ์</th>
              </tr>
            </thead>
            <tbody>
              {logsQuery.data.items.map((log) => (
                <tr key={log.id} className="border-t border-slate-100 dark:border-slate-700">
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">
                    {formatThaiDate(log.created_at, 'd MMMM yyyy HH:mm')} น.
                  </td>
                  <td className="px-4 py-2 text-slate-700 dark:text-slate-300">{log.actor_email ?? '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">{log.action}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{log.module}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${resultStyles[log.result]}`}>
                      {log.result}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {logsQuery.data && logsQuery.data.pagination.totalPages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-3 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40 dark:border-slate-600"
          >
            ก่อนหน้า
          </button>
          <span className="text-slate-500 dark:text-slate-400">
            หน้า {logsQuery.data.pagination.page} / {logsQuery.data.pagination.totalPages}
          </span>
          <button
            type="button"
            disabled={page >= logsQuery.data.pagination.totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40 dark:border-slate-600"
          >
            ถัดไป
          </button>
        </div>
      )}
    </div>
  );
}
