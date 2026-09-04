import { BookOpen, Loader2, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError } from '../../services/apiClient';
import { publicTicketApiFetch } from '../../services/publicTicketApiClient';
import { LineEmptyState } from './LinePortalChrome';
import type { LineKnowledgeData } from './types';

/**
 * คลังวิธีแก้เบื้องต้น — อ่านจาก endpoint สาธารณะเดียวกับหน้า /report
 * ไม่ต้องใช้ LINE session เพราะบทความเปิดให้ทุกคนอ่านอยู่แล้ว
 */
export function LineKnowledgeTab() {
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [query, setQuery] = useState({ search: '', categoryId: '' });
  const [data, setData] = useState<LineKnowledgeData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.categoryId) params.set('categoryId', query.categoryId);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    setError(null);
    setData(null);
    void publicTicketApiFetch<LineKnowledgeData>(`/api/v1/public/knowledge${suffix}`)
      .then(setData)
      .catch((loadError) => setError(loadError instanceof ApiError ? loadError.message : 'โหลดวิธีแก้เบื้องต้นไม่สำเร็จ'));
  }, [query]);

  return (
    <div className="flex flex-col pb-4">
      <header className="sticky top-0 z-20 border-b border-hairline bg-white/95 px-4 pb-3 pt-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <h1 className="text-sm font-bold text-slate-900 dark:text-slate-100">วิธีแก้เบื้องต้น</h1>
        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">ลองแก้ด้วยตัวเองก่อนแจ้งซ่อม</p>
      </header>

      <form
        className="flex flex-col gap-2 px-4 pt-3"
        onSubmit={(event) => { event.preventDefault(); setQuery({ search: search.trim(), categoryId }); }}
      >
        <label>
          <span className="sr-only">ค้นหา</span>
          <input
            className="w-full rounded-card border border-hairline bg-white px-3 py-2.5 text-[13px] text-slate-800 placeholder:text-slate-400 focus:border-primary-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            maxLength={120}
            placeholder="ค้นหาอาการหรือวิธีแก้"
          />
        </label>
        <div className="flex gap-2">
          <label className="flex-1">
            <span className="sr-only">ประเภทปัญหา</span>
            <select
              className="w-full rounded-card border border-hairline bg-white px-3 py-2.5 text-[13px] text-slate-800 focus:border-primary-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">ทุกประเภทปัญหา</option>
              {(data?.categories ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
          <button
            type="submit"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-card bg-primary-700 px-4 text-[13px] font-bold text-white transition hover:bg-primary-800"
          >
            <Search className="h-4 w-4" aria-hidden="true" /> ค้นหา
          </button>
        </div>
      </form>

      <div className="px-4 pt-3">
        {error && (
          <p className="rounded-card border border-danger-200 bg-danger-50 px-4 py-3 text-[13px] text-danger-700 dark:border-danger-800 dark:bg-danger-900/30 dark:text-danger-200" role="alert">
            {error}
          </p>
        )}
        {!data && !error && (
          <div className="flex justify-center py-10" role="status">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-label="กำลังโหลด" />
          </div>
        )}
        {data && data.articles.length === 0 && (
          <LineEmptyState
            icon={BookOpen}
            title="ไม่พบวิธีแก้ที่ตรงกับการค้นหา"
            description="ลองใช้คำค้นอื่น หรือแจ้งซ่อมเพื่อให้ทีม IT ช่วยตรวจสอบ"
          />
        )}
        {data && data.articles.length > 0 && (
          <ul className="flex flex-col gap-2">
            {data.articles.map((article) => (
              <li key={article.id}>
                <details className="group rounded-card border border-hairline bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900">
                  <summary className="cursor-pointer list-none">
                    <span className="block text-[13px] font-bold leading-5 text-slate-800 dark:text-slate-100">{article.title}</span>
                    <span className="mt-1 block text-[11px] text-slate-400 dark:text-slate-500">
                      {article.article_code} · {article.category ?? 'ไม่ระบุประเภท'}
                    </span>
                    {article.symptom && (
                      <span className="mt-1.5 block text-[12px] leading-5 text-slate-600 dark:text-slate-300">อาการ: {article.symptom}</span>
                    )}
                    <span className="mt-1.5 block text-[11px] font-semibold text-primary-700 group-open:hidden dark:text-primary-300">ดูวิธีแก้</span>
                  </summary>
                  <div className="mt-3 border-t border-hairline pt-3 dark:border-slate-700">
                    <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">วิธีแก้</p>
                    <p className="mt-1 whitespace-pre-wrap text-[13px] leading-6 text-slate-700 dark:text-slate-200">{article.solution}</p>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
