/** ตรงกับ apps/api/src/services/technicianSkillService.ts — ระดับ null คือ "ยังไม่ประเมิน" ไม่ใช่ 0 */

export type SkillCoverageRisk = 'covered' | 'single' | 'uncovered';

export interface SkillLevelDefinition {
  level: number;
  label: string;
  short: string;
}

export interface SkillMatrixCell {
  categoryId: string;
  level: number | null;
  note: string | null;
  assessedAt: string | null;
  openTickets: number;
}

export interface SkillMatrixTechnician {
  id: string;
  name: string;
  email: string | null;
  cells: SkillMatrixCell[];
  assessedCount: number;
  averageLevel: number | null;
  openTickets: number;
  overdueTickets: number;
  unassessedOpenCategories: number;
}

export interface SkillMatrixCategoryCoverage {
  categoryId: string;
  name: string;
  assessed: number;
  independent: number;
  expert: number;
  openTickets: number;
  risk: SkillCoverageRisk;
}

export interface SkillMatrixResponse {
  categories: Array<{ id: string; name: string }>;
  technicians: SkillMatrixTechnician[];
  coverage: SkillMatrixCategoryCoverage[];
  summary: {
    technicianCount: number;
    categoryCount: number;
    assessedCells: number;
    totalCells: number;
    coveragePercent: number | null;
    uncoveredCategories: number;
    singlePointCategories: number;
    openTicketsAtRisk: number;
  };
  lastAssessedAt: string | null;
  levels: SkillLevelDefinition[];
  /** false เมื่อผู้ใช้ไม่มี ticket.view_all — คอลัมน์ภาระงานจะไม่มีข้อมูลจริงให้แสดง */
  workloadAvailable: boolean;
  /** true เมื่อ Ticket ที่เปิดค้างมีมากกว่าที่สแกนได้ในครั้งเดียว ตัวเลขภาระงานจึงต่ำกว่าความจริง */
  workloadSampled: boolean;
  canManage: boolean;
  generatedAt: string;
}

export interface TechnicianSkillRow {
  categoryId: string;
  name: string;
  level: number | null;
  note: string | null;
  assessedAt: string | null;
  openTickets: number;
}

export interface TechnicianSkillProfile {
  technicianId: string;
  skills: TechnicianSkillRow[];
  assessedCount: number;
  averageLevel: number | null;
  lastAssessedAt: string | null;
  workload: {
    open: number;
    overdue: number;
    dueToday: number;
    unassessedCategories: number;
    byStatus: Array<{ label: string; value: number }>;
  };
  performance: {
    months: Array<{ key: string; label: string; closed: number; slaMet: number; slaPercent: number | null; averageRating: number | null }>;
    closedTotal: number;
    slaPercent: number | null;
    averageRating: number | null;
    ratedCount: number;
  };
  levels: SkillLevelDefinition[];
  workloadAvailable: boolean;
  canManage: boolean;
  generatedAt: string;
}

export interface SaveTechnicianSkillsInput {
  skills: Array<{ categoryId: string; level: number | null; note?: string }>;
}
