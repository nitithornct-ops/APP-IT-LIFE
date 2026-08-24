import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BarChart3, CalendarClock, ClipboardList, Gauge, Layers, Star } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { LoadingState } from '../../components/ui/AsyncState';
import { QueryError } from '../../components/ui/QueryError';
import { apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import type { TechnicianSkillProfile } from '../../types/technicianSkills';
import { formatThaiDate } from '../../utils/date';
import { numberOrDash, skillChipClass, skillChipText, skillLevelLabel } from './skillDisplay';

/**
 * แผงทักษะ ภาระงาน และผลงานย้อนหลังของเจ้าหน้าที่หนึ่งคน (design handoff หัวข้อ 3h)
 *
 * ทุกช่องมาจาก API จริง ถ้ายังไม่มีใครประเมินก็แสดง "—" พร้อมบอกว่าใครเป็นผู้ประเมิน แทนการเติม
 * คะแนนสมมติให้ตารางดูเต็ม และคอลัมน์ภาระงานจะซ่อนเมื่อผู้ใช้ไม่มีสิทธิ์เห็นงานของคนนั้นจริง ๆ
 */
export function TechnicianSkillPanel({ technicianId }: { technicianId?: string }) {
  const { hasPermission } = useAuth();
  const scope = technicianId ?? 'me';
  const query = useQuery({
    queryKey: ['technician-skills', scope],
    queryFn: () => apiFetch<TechnicianSkillProfile>(`/api/v1/technician-skills/${scope}`),
  });

  if (query.isLoading) {
    return (
      <Card>
        <CardHeader className="flex items-center gap-2"><Layers className="h-4 w-4 text-primary-600" aria-hidden="true" />Skill matrix</CardHeader>
        <LoadingState label="กำลังโหลดตารางทักษะ" rows={3} />
      </Card>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Card>
        <CardHeader className="flex items-center gap-2"><Layers className="h-4 w-4 text-primary-600" aria-hidden="true" />Skill matrix</CardHeader>
        <QueryError error={query.error} title="โหลดตารางทักษะไม่สำเร็จ" onRetry={() => void query.refetch()} isRetrying={query.isFetching} />
      </Card>
    );
  }

  const profile = query.data;
  const canManage = profile.canManage && hasPermission('technician_skill.manage');

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2"><Layers className="h-4 w-4 text-primary-600" aria-hidden="true" />Skill matrix</span>
          <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">
            ประเมินแล้ว {profile.assessedCount}/{profile.skills.length} หมวด
            {profile.lastAssessedAt && ` · ล่าสุด ${formatThaiDate(profile.lastAssessedAt)}`}
          </span>
        </CardHeader>
        <CardBody className="space-y-3">
          {profile.skills.length === 0 ? (
            <p className="rounded-[10px] border border-hairline bg-slate-50 px-3 py-4 text-xs leading-5 text-slate-500 dark:border-white/[.08] dark:bg-white/[.03] dark:text-slate-400">
              ยังไม่มีหมวดหมู่งานที่เปิดใช้งานในระบบ ตารางทักษะจึงยังไม่มีคอลัมน์ให้ประเมิน
            </p>
          ) : (
            <>
              <ul className="space-y-1.5">
                {profile.skills.map((skill) => (
                  <li key={skill.categoryId} className="flex items-center gap-3 rounded-[8px] border border-hairline px-2.5 py-2 dark:border-white/[.08]">
                    <span
                      className={`grid h-7 w-9 shrink-0 place-items-center rounded-[6px] font-mono text-[13px] font-bold ${skillChipClass(skill.level)}`}
                      title={skillLevelLabel(profile.levels, skill.level)}
                    >
                      {skillChipText(skill.level)}
                      <span className="sr-only">{skillLevelLabel(profile.levels, skill.level)}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-semibold text-ink-heading dark:text-slate-100">{skill.name}</span>
                      <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">
                        {skill.note || skillLevelLabel(profile.levels, skill.level)}
                      </span>
                    </span>
                    {profile.workloadAvailable && skill.openTickets > 0 && (
                      <Badge variant={skill.level === null ? 'warning' : 'secondary'}>งานค้าง {skill.openTickets}</Badge>
                    )}
                  </li>
                ))}
              </ul>

              {profile.assessedCount === 0 && (
                <p className="rounded-[10px] border border-warning-100 bg-warning-50 px-3 py-2.5 text-[11.5px] leading-5 text-warning-700 dark:border-warning-700 dark:bg-warning-700/20 dark:text-warning-100">
                  ยังไม่มีการประเมินระดับทักษะของบัญชีนี้ ระบบจึงแสดง “—” ทุกหมวดตามจริง
                  {canManage && <> ผู้ดูแลบันทึกผลประเมินได้ที่ <Link to="/admin/technician-skills" className="font-bold underline">ตารางทักษะช่าง</Link></>}
                </p>
              )}

              {profile.workloadAvailable && profile.workload.unassessedCategories > 0 && (
                <p className="flex items-start gap-2 rounded-[10px] border border-warning-100 bg-warning-50 px-3 py-2.5 text-[11.5px] leading-5 text-warning-700 dark:border-warning-700 dark:bg-warning-700/20 dark:text-warning-100">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  ถืองานค้างอยู่ {profile.workload.unassessedCategories} หมวดที่ยังไม่เคยถูกประเมิน
                </p>
              )}
            </>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex items-center gap-2"><ClipboardList className="h-4 w-4 text-primary-600" aria-hidden="true" />งานที่ถืออยู่</CardHeader>
          <CardBody>
            {!profile.workloadAvailable ? (
              <p className="text-[11.5px] leading-5 text-slate-500 dark:text-slate-400">
                ต้องมีสิทธิ์ดู Ticket ทั้งองค์กร (ticket.view_all) จึงจะเห็นภาระงานของเจ้าหน้าที่คนอื่นได้
              </p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <Metric icon={<ClipboardList className="h-3.5 w-3.5" />} label="งานค้าง" value={profile.workload.open} />
                  <Metric icon={<AlertTriangle className="h-3.5 w-3.5" />} label="เกินกำหนด" value={profile.workload.overdue} tone={profile.workload.overdue ? 'danger' : 'default'} />
                  <Metric icon={<CalendarClock className="h-3.5 w-3.5" />} label="ครบกำหนดวันนี้" value={profile.workload.dueToday} tone={profile.workload.dueToday ? 'warning' : 'default'} />
                </div>
                {profile.workload.byStatus.length ? (
                  <ul className="mt-3 space-y-1.5">
                    {profile.workload.byStatus.map((item) => (
                      <li key={item.label} className="flex items-center justify-between gap-3 text-[11.5px]">
                        <span className="min-w-0 truncate text-slate-600 dark:text-slate-300">{item.label}</span>
                        <span className="font-mono font-bold text-ink-heading dark:text-slate-100">{item.value}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-[11.5px] text-slate-500 dark:text-slate-400">ไม่มี Ticket ที่ยังเปิดค้างอยู่</p>
                )}
              </>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary-600" aria-hidden="true" />ผลงาน 6 เดือน</CardHeader>
          <CardBody>
            {!profile.workloadAvailable ? (
              <p className="text-[11.5px] leading-5 text-slate-500 dark:text-slate-400">
                ต้องมีสิทธิ์ดู Ticket ทั้งองค์กร (ticket.view_all) จึงจะเห็นผลงานย้อนหลังของเจ้าหน้าที่คนอื่นได้
              </p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <Metric icon={<ClipboardList className="h-3.5 w-3.5" />} label="ปิดงานแล้ว" value={profile.performance.closedTotal} />
                  <Metric icon={<Gauge className="h-3.5 w-3.5" />} label="ทันกำหนด" value={numberOrDash(profile.performance.slaPercent, '%')} />
                  <Metric icon={<Star className="h-3.5 w-3.5" />} label={`คะแนน (${profile.performance.ratedCount})`} value={numberOrDash(profile.performance.averageRating)} />
                </div>
                <PerformanceChart months={profile.performance.months} />
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Metric({ icon, label, value, tone = 'default' }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone?: 'default' | 'warning' | 'danger' }) {
  const toneClass = tone === 'danger'
    ? 'text-danger-700 dark:text-danger-100'
    : tone === 'warning'
      ? 'text-warning-700 dark:text-warning-100'
      : 'text-ink-heading dark:text-slate-100';
  return (
    <div className="rounded-[8px] border border-hairline px-2.5 py-2 dark:border-white/[.08]">
      <span className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">{icon}<span className="truncate">{label}</span></span>
      <span className={`mt-1 block font-mono text-[17px] font-bold leading-none ${toneClass}`}>{value}</span>
    </div>
  );
}

/** แท่งกราฟตามจำนวนงานที่ปิดจริงต่อเดือน — เดือนที่ไม่มีงานคือแท่งสูงศูนย์ ไม่ใช่ช่องว่าง */
function PerformanceChart({ months }: { months: TechnicianSkillProfile['performance']['months'] }) {
  const maximum = Math.max(1, ...months.map((month) => month.closed));
  const summary = months.map((month) => `${month.label} ปิด ${month.closed} งาน`).join(', ');

  return (
    <div className="mt-4">
      <div className="flex h-24 items-end gap-2" role="img" aria-label={`งานที่ปิดต่อเดือน: ${summary}`}>
        {months.map((month) => (
          <div key={month.key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span className="font-mono text-[10px] font-semibold text-slate-500 dark:text-slate-400">{month.closed}</span>
            <span
              className="w-full rounded-t-[4px] bg-primary-500/85 dark:bg-primary-500/70"
              style={{ height: `${Math.max(2, Math.round((month.closed / maximum) * 100))}%` }}
              title={`${month.label}: ปิด ${month.closed} งาน · ทันกำหนด ${numberOrDash(month.slaPercent, '%')} · คะแนน ${numberOrDash(month.averageRating)}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-2">
        {months.map((month) => (
          <span key={month.key} className="min-w-0 flex-1 truncate text-center text-[10px] text-slate-400 dark:text-slate-500">{month.label}</span>
        ))}
      </div>
    </div>
  );
}
