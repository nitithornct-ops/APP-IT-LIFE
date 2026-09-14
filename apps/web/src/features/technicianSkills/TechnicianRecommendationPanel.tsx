import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Gauge, MapPin, Sparkles } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { apiFetch } from '../../services/apiClient';
import type { TechnicianSkillRecommendationResponse } from '../../types/technicianSkills';

const AVAILABILITY_DISPLAY = {
  available: { label: 'พร้อมรับงาน', variant: 'success' as const },
  limited: { label: 'พร้อมแบบจำกัด', variant: 'warning' as const },
  unavailable: { label: 'ไม่พร้อม', variant: 'danger' as const },
};

export function TechnicianRecommendationPanel({
  categoryId,
  location,
  productTechnology,
  enabled,
  selectedAssigneeId,
  onSelect,
}: {
  categoryId: string | null;
  location: string | null;
  productTechnology: string | null;
  enabled: boolean;
  selectedAssigneeId?: string;
  onSelect: (technicianId: string) => void;
}) {
  const query = useQuery({
    queryKey: ['technician-recommendations', categoryId, location, productTechnology],
    enabled: enabled && Boolean(categoryId),
    queryFn: () => {
      const params = new URLSearchParams({ categoryId: categoryId! });
      if (location?.trim()) params.set('location', location.trim());
      if (productTechnology?.trim()) params.set('productTechnology', productTechnology.trim());
      return apiFetch<TechnicianSkillRecommendationResponse>(`/api/v1/technician-skills/recommendations?${params.toString()}`, undefined, { silent: true });
    },
  });

  if (!enabled || !categoryId) return null;

  return (
    <div className="rounded-[9px] border border-primary-200 bg-primary-50/60 p-3 dark:border-primary-800 dark:bg-primary-950/20" data-testid="technician-recommendations">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary-700 dark:text-primary-300" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-xs font-bold text-primary-900 dark:text-primary-100">แนะนำผู้เหมาะสมกับงาน</p>
          <p className="mt-0.5 text-[11px] leading-4 text-primary-800/75 dark:text-primary-200/75">ใช้ Skill, Proficiency, Availability และ Current workload เพื่อช่วยจัดอันดับ — ผู้มอบหมายต้องเลือกเอง</p>
        </div>
      </div>

      {query.isLoading && <p className="mt-3 text-[11.5px] text-slate-600 dark:text-slate-300">กำลังวิเคราะห์ผู้รับงานที่เหมาะสม...</p>}
      {query.isError && <p className="mt-3 text-[11.5px] text-warning-700 dark:text-warning-200">โหลดคำแนะนำไม่สำเร็จ แต่ยังเลือกผู้รับผิดชอบจากรายการด้านล่างได้</p>}

      {query.data && (
        <>
          {query.data.workloadSampled && (
            <p className="mt-3 flex items-start gap-1.5 text-[10.5px] leading-4 text-warning-700 dark:text-warning-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ภาระงานมีมากกว่าจำนวนที่ระบบสแกนได้ในครั้งเดียว อันดับนี้อาจต่ำกว่าความจริง
            </p>
          )}

          {query.data.recommendations.length ? (
            <div className="mt-3 space-y-2">
              {query.data.recommendations.map((candidate) => {
                const availability = AVAILABILITY_DISPLAY[candidate.availability];
                const selected = candidate.technicianId === selectedAssigneeId;
                return (
                  <button
                    key={candidate.technicianId}
                    type="button"
                    className={`w-full rounded-[8px] border bg-white p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 dark:bg-white/[.05] ${selected ? 'border-primary-600 ring-1 ring-primary-500' : 'border-hairline hover:border-primary-300 dark:border-white/[.1]'}`}
                    onClick={() => onSelect(candidate.technicianId)}
                    aria-pressed={selected}
                    aria-label={`เลือก ${candidate.name} เป็นผู้รับผิดชอบ`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate text-[12.5px] font-bold text-ink-heading dark:text-slate-100">{candidate.name}</span>
                      <span className="shrink-0 font-mono text-[11px] font-bold text-primary-700 dark:text-primary-300">{candidate.score}/100</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge variant="primary"><Gauge className="h-3 w-3" aria-hidden="true" />Proficiency {candidate.proficiency}/5</Badge>
                      <Badge variant={availability.variant}>{availability.label}</Badge>
                      <Badge variant={candidate.workload.overdue ? 'danger' : 'secondary'}>งานค้าง {candidate.workload.open}{candidate.workload.overdue ? ` · เกินกำหนด ${candidate.workload.overdue}` : ''}</Badge>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-slate-600 dark:text-slate-300">
                      {candidate.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden="true" />{candidate.location}</span>}
                      {candidate.certification && <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" aria-hidden="true" />{candidate.certification}{candidate.certificationExpiry ? ` · หมดอายุ ${candidate.certificationExpiry}` : ''}</span>}
                    </div>
                    <p className="mt-1.5 text-[10.5px] leading-4 text-slate-500 dark:text-slate-400">{candidate.reasons.join(' · ')}</p>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-3 rounded-[7px] border border-warning-200 bg-warning-50 px-2.5 py-2 text-[11px] leading-4 text-warning-800 dark:border-warning-800 dark:bg-warning-950/30 dark:text-warning-200">
              ยังไม่มีผู้ที่ผ่านเงื่อนไข Proficiency ขั้นต่ำและพร้อมรับงานในหมวดนี้ กรุณาตรวจสอบ Skill Matrix หรือพิจารณามอบหมายเป็นกรณีพิเศษ
            </div>
          )}

          <p className="mt-3 text-[10px] leading-4 text-slate-500 dark:text-slate-400">พิจารณาความเร่งด่วน บริบทหน้างาน และการตัดสินใจของหัวหน้างานร่วมด้วย ระบบจะไม่ Auto Assign</p>
        </>
      )}
    </div>
  );
}
