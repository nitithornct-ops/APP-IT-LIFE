import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ClipboardList, Layers, PencilLine, ShieldCheck, Users2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { KpiStrip } from '../../components/ui/KpiStrip';
import { LoadingState } from '../../components/ui/AsyncState';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { QueryError } from '../../components/ui/QueryError';
import { Toast } from '../../components/ui/Toast';
import { ApiError, apiFetch } from '../../services/apiClient';
import type {
  SkillMatrixResponse,
  SkillMatrixTechnician,
  TechnicianSkillProfile,
} from '../../types/technicianSkills';
import { formatThaiDate } from '../../utils/date';
import { COVERAGE_RISK_DISPLAY, numberOrDash, skillChipClass, skillChipText, skillLevelLabel } from './skillDisplay';

/**
 * ตารางทักษะช่าง (design handoff หัวข้อ 3h)
 *
 * ระบบไม่มีข้อมูลทักษะมาก่อน ตาราง technician_skills จึงเริ่มจากว่างเปล่า — หน้านี้ต้องอ่านออกทั้ง
 * ตอนที่ยังไม่มีใครประเมิน (ทุกช่องเป็น “—”) และตอนที่ประเมินครบแล้ว โดยไม่เดาค่าแทนผู้ประเมิน
 *
 * ค่าที่ช่วยตัดสินใจจริงคือ "หมวดไหนไม่มีคนรับงาน" ไม่ใช่คะแนนเฉลี่ยรวม จึงยกความเสี่ยงรายหมวด
 * ขึ้นมาไว้เหนือตาราง
 */
export function TechnicianSkillMatrixPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<SkillMatrixTechnician | null>(null);
  const [toast, setToast] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const query = useQuery({
    queryKey: ['technician-skills', 'matrix'],
    queryFn: () => apiFetch<SkillMatrixResponse>('/api/v1/technician-skills/matrix'),
  });

  const data = query.data;
  const kpiItems = useMemo(() => {
    if (!data) return [];
    return [
      { key: 'technicians', label: 'เจ้าหน้าที่ในตาราง', value: data.summary.technicianCount, icon: <Users2 className="h-4 w-4" />, note: 'ตามบทบาทที่แก้ไข Ticket ได้' },
      { key: 'coverage', label: 'ประเมินแล้ว', value: numberOrDash(data.summary.coveragePercent, '%'), icon: <ShieldCheck className="h-4 w-4" />, note: `${data.summary.assessedCells}/${data.summary.totalCells} ช่อง` },
      { key: 'uncovered', label: 'หมวดที่ไม่มีผู้รับงาน', value: data.summary.uncoveredCategories, icon: <AlertTriangle className="h-4 w-4" />, note: 'ยังไม่มีใครทำเองได้' },
      { key: 'single', label: 'หมวดที่พึ่งพาคนเดียว', value: data.summary.singlePointCategories, icon: <Layers className="h-4 w-4" />, note: 'ไม่มีคนรับงานสำรอง' },
      { key: 'at-risk', label: 'งานค้างในหมวดเสี่ยง', value: data.workloadAvailable ? data.summary.openTicketsAtRisk : '—', icon: <ClipboardList className="h-4 w-4" />, note: data.workloadAvailable ? 'Ticket ที่ยังไม่ปิด' : 'ต้องมีสิทธิ์ ticket.view_all' },
    ];
  }, [data]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="บุคลากร / ทักษะช่าง"
        title="ตารางทักษะช่าง"
        description="ระดับความสามารถของเจ้าหน้าที่ต่อหมวดหมู่งาน ใช้ตรวจว่ามีคนรับงานแต่ละหมวดจริงหรือไม่ก่อนมอบหมาย"
        leading={<Layers className="h-4 w-4" aria-hidden="true" />}
        meta={data?.lastAssessedAt ? <Badge variant="secondary">ประเมินล่าสุด {formatThaiDate(data.lastAssessedAt)}</Badge> : undefined}
      />

      {query.isLoading && <LoadingState label="กำลังโหลดตารางทักษะ" rows={6} />}
      {query.isError && <QueryError error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} />}

      {data && (
        <>
          <KpiStrip items={kpiItems} label="สรุปความครอบคลุมของทักษะ" />

          {data.workloadSampled && (
            <p className="flex items-start gap-2 rounded-[8px] border border-warning-100 bg-warning-50 px-3 py-2.5 text-[11.5px] leading-5 text-warning-700 dark:border-warning-700 dark:bg-warning-700/20 dark:text-warning-100" role="status">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Ticket ที่เปิดค้างมีมากกว่าที่ระบบสแกนได้ในครั้งเดียว ตัวเลขภาระงานในหน้านี้จึงต่ำกว่าความจริง ส่วนระดับทักษะยังครบถ้วน
            </p>
          )}

          {data.categories.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Layers className="h-7 w-7" aria-hidden="true" />}
                title="ยังไม่มีหมวดหมู่งานให้ประเมิน"
                description="ตารางทักษะอ้างอิงหมวดหมู่ Ticket ที่เปิดใช้งานอยู่ กรุณาเพิ่มหมวดหมู่ใน Master Data ก่อน"
                action={<a href="/admin/master-data" className="inline-flex min-h-9 items-center rounded-[7px] border border-hairline-control bg-white px-3 text-xs font-semibold text-primary-700 dark:border-white/[.12] dark:bg-white/[.04] dark:text-primary-300">ไปที่ Master Data</a>}
              />
            </Card>
          ) : (
            <>
              <CoveragePanel data={data} />
              <MatrixTable data={data} onEdit={data.canManage ? setEditing : undefined} />
            </>
          )}
        </>
      )}

      {editing && data && (
        <Modal
          title={`ประเมินทักษะ · ${editing.name}`}
          description="ระบุระดับที่ประเมินได้จริงเท่านั้น หมวดที่ยังไม่ได้ประเมินให้คงค่า “ยังไม่ประเมิน” ไว้"
          size="lg"
          onClose={() => setEditing(null)}
          testId="technician-skill-edit-dialog"
        >
          <AssessmentForm
            technician={editing}
            categories={data.categories}
            levels={data.levels}
            onClose={() => setEditing(null)}
            onSaved={(message) => {
              setToast({ tone: 'success', message });
              void queryClient.invalidateQueries({ queryKey: ['technician-skills'] });
            }}
            onFailed={(message) => setToast({ tone: 'error', message })}
          />
        </Modal>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}

function CoveragePanel({ data }: { data: SkillMatrixResponse }) {
  const atRisk = data.coverage.filter((item) => item.risk !== 'covered');
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary-600" aria-hidden="true" />ความครอบคลุมรายหมวดหมู่</span>
        <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">นับเฉพาะผู้ที่ประเมินแล้วว่าทำงานได้ด้วยตนเอง (ระดับ 2 ขึ้นไป)</span>
      </CardHeader>
      <CardBody>
        {atRisk.length === 0 ? (
          <p className="text-[12px] text-success-700 dark:text-success-100">ทุกหมวดหมู่มีเจ้าหน้าที่ที่ทำงานได้เองอย่างน้อยสองคน</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {atRisk.map((item) => {
              const display = COVERAGE_RISK_DISPLAY[item.risk];
              return (
                <li key={item.categoryId} className="rounded-[8px] border border-hairline px-3 py-2.5 dark:border-white/[.08]">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 truncate text-[12.5px] font-semibold text-ink-heading dark:text-slate-100">{item.name}</span>
                    <Badge variant={display.badge}>{display.label}</Badge>
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400">{display.hint}</p>
                  <p className="mt-1.5 font-mono text-[10.5px] text-slate-400 dark:text-slate-500">
                    ประเมินแล้ว {item.assessed} คน · ทำเองได้ {item.independent} คน
                    {data.workloadAvailable && ` · งานค้าง ${item.openTickets}`}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function MatrixTable({ data, onEdit }: { data: SkillMatrixResponse; onEdit?: (technician: SkillMatrixTechnician) => void }) {
  // 132px สำหรับคอลัมน์ชื่อ แล้วแบ่งที่เหลือให้หมวดหมู่เท่า ๆ กันตาม design handoff
  const columns = `minmax(132px,1.4fr) repeat(${data.categories.length}, minmax(72px, 1fr))${onEdit ? ' 92px' : ''}`;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2"><Layers className="h-4 w-4 text-primary-600" aria-hidden="true" />ตารางทักษะ</span>
        <span className="flex flex-wrap items-center gap-2 text-[10.5px] font-normal text-slate-500 dark:text-slate-400">
          {data.levels.map((level) => (
            <span key={level.level} className="inline-flex items-center gap-1">
              <span className={`grid h-4 w-5 place-items-center rounded-[4px] font-mono text-[9px] font-bold ${skillChipClass(level.level)}`}>{level.level}</span>
              {level.short}
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <span className={`grid h-4 w-5 place-items-center rounded-[4px] font-mono text-[9px] font-bold ${skillChipClass(null)}`}>—</span>
            ยังไม่ประเมิน
          </span>
        </span>
      </CardHeader>

      {data.technicians.length === 0 ? (
        <EmptyState
          icon={<Users2 className="h-7 w-7" aria-hidden="true" />}
          title="ยังไม่มีเจ้าหน้าที่ในตาราง"
          description="ตารางนี้แสดงบัญชีที่บทบาทอนุญาตให้แก้ไข Ticket กรุณากำหนดบทบาทให้ผู้ใช้ก่อน"
          action={<a href="/admin/users" className="inline-flex min-h-9 items-center rounded-[7px] border border-hairline-control bg-white px-3 text-xs font-semibold text-primary-700 dark:border-white/[.12] dark:bg-white/[.04] dark:text-primary-300">จัดการผู้ใช้งาน</a>}
        />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid items-end gap-px border-b border-hairline bg-slate-50/60 px-3 py-2 dark:border-white/[.08] dark:bg-white/[.03]" style={{ gridTemplateColumns: columns }}>
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">เจ้าหน้าที่</span>
              {data.categories.map((category) => (
                <span key={category.id} className="truncate text-center text-[10.5px] font-semibold text-slate-500 dark:text-slate-400" title={category.name}>{category.name}</span>
              ))}
              {onEdit && <span className="text-right text-[10.5px] font-semibold text-slate-500 dark:text-slate-400">ประเมิน</span>}
            </div>

            {data.technicians.map((technician) => (
              <div
                key={technician.id}
                className="grid items-center gap-px border-b border-hairline-row px-3 py-2 last:border-0 dark:border-white/[.07]"
                style={{ gridTemplateColumns: columns }}
              >
                <span className="min-w-0 pr-2">
                  <span className="block truncate text-[12.5px] font-semibold text-ink-heading dark:text-slate-100">{technician.name}</span>
                  <span className="block truncate font-mono text-[10px] text-slate-400 dark:text-slate-500">
                    {data.workloadAvailable
                      ? `งานค้าง ${technician.openTickets}${technician.overdueTickets ? ` · เกินกำหนด ${technician.overdueTickets}` : ''}`
                      : `ประเมินแล้ว ${technician.assessedCount}/${data.categories.length}`}
                  </span>
                </span>

                {technician.cells.map((cell) => (
                  <span key={cell.categoryId} className="flex justify-center">
                    <span
                      className={`grid h-7 w-9 place-items-center rounded-[6px] font-mono text-[13px] font-bold ${skillChipClass(cell.level)}`}
                      title={`${skillLevelLabel(data.levels, cell.level)}${cell.note ? ` · ${cell.note}` : ''}`}
                    >
                      {skillChipText(cell.level)}
                      <span className="sr-only">{skillLevelLabel(data.levels, cell.level)}</span>
                    </span>
                  </span>
                ))}

                {onEdit && (
                  <span className="flex justify-end">
                    <Button size="sm" variant="outline" onClick={() => onEdit(technician)} aria-label={`ประเมินทักษะของ ${technician.name}`}>
                      <PencilLine className="h-3.5 w-3.5" aria-hidden="true" />ประเมิน
                    </Button>
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function AssessmentForm({
  technician,
  categories,
  levels,
  onClose,
  onSaved,
  onFailed,
}: {
  technician: SkillMatrixTechnician;
  categories: SkillMatrixResponse['categories'];
  levels: SkillMatrixResponse['levels'];
  onClose: () => void;
  onSaved: (message: string) => void;
  onFailed: (message: string) => void;
}) {
  const [draft, setDraft] = useState(() =>
    Object.fromEntries(technician.cells.map((cell) => [cell.categoryId, { level: cell.level, note: cell.note ?? '' }])),
  );

  const mutation = useMutation({
    mutationFn: (payload: { skills: Array<{ categoryId: string; level: number | null; note?: string }> }) =>
      apiFetch<TechnicianSkillProfile>(`/api/v1/technician-skills/${technician.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      onSaved(`บันทึกผลประเมินของ ${technician.name} แล้ว`);
      onClose();
    },
    onError: (error: unknown) => {
      onFailed(error instanceof ApiError || error instanceof Error ? error.message : 'บันทึกผลประเมินไม่สำเร็จ');
    },
  });

  const submit = () => {
    mutation.mutate({
      skills: categories.map((category) => ({
        categoryId: category.id,
        level: draft[category.id]?.level ?? null,
        note: draft[category.id]?.note?.trim() || undefined,
      })),
    });
  };

  return (
    <div className="px-5 py-5">
      <ul className="space-y-2">
        {categories.map((category) => {
          const entry = draft[category.id] ?? { level: null, note: '' };
          return (
            <li key={category.id} className="rounded-[8px] border border-hairline px-3 py-2.5 dark:border-white/[.08]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[12.5px] font-semibold text-ink-heading dark:text-slate-100">{category.name}</span>
                <div className="flex items-center gap-1" role="group" aria-label={`ระดับทักษะหมวด ${category.name}`}>
                  {[null, 1, 2, 3].map((level) => {
                    const selected = entry.level === level;
                    return (
                      <button
                        key={String(level)}
                        type="button"
                        onClick={() => setDraft((current) => ({ ...current, [category.id]: { ...entry, level } }))}
                        aria-pressed={selected}
                        title={skillLevelLabel(levels, level)}
                        className={`grid h-9 w-10 place-items-center rounded-[6px] border font-mono text-[13px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${
                          selected ? `border-primary-600 ${skillChipClass(level)}` : 'border-hairline-control text-slate-400 hover:border-primary-300 dark:border-white/[.12] dark:text-slate-500'
                        }`}
                      >
                        {skillChipText(level)}
                        <span className="sr-only">{skillLevelLabel(levels, level)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <input
                type="text"
                value={entry.note}
                maxLength={300}
                onChange={(event) => setDraft((current) => ({ ...current, [category.id]: { ...entry, note: event.target.value } }))}
                placeholder="บันทึกการประเมิน (ไม่บังคับ) เช่น อุปกรณ์หรืองานที่เคยรับผิดชอบ"
                aria-label={`บันทึกการประเมินหมวด ${category.name}`}
                className="mt-2 w-full rounded-[7px] border border-hairline-control px-2.5 py-1.5 text-[11.5px] text-slate-700 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-white/[.12] dark:bg-white/[.04] dark:text-slate-200"
              />
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
        เลือก “—” เพื่อถอนผลประเมินของหมวดนั้นกลับไปเป็นยังไม่ประเมิน ระบบบันทึกผู้ประเมินและเวลาไว้ใน Audit Log ทุกครั้ง
      </p>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>ยกเลิก</Button>
        <Button onClick={submit} isLoading={mutation.isPending}>บันทึกผลประเมิน</Button>
      </div>
    </div>
  );
}
