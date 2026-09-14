/**
 * Technician Skill Matrix — ประกอบตารางทักษะและภาระงานจริงของเจ้าหน้าที่
 *
 * แยกออกมาเป็นฟังก์ชันบริสุทธิ์เพราะตรรกะ "ครอบคลุมหรือไม่" ตัดสินการมอบหมายงานจริง — หมวดหมู่ที่ไม่มี
 * ใครทำได้ด้วยตนเองเลยคือความเสี่ยงที่หัวหน้างานต้องเห็นก่อนงานเข้า ไม่ใช่ตัวเลขประดับหน้าจอ
 *
 * ทุกตัวเลขในไฟล์นี้มาจากแถวจริง: ระดับทักษะจาก technician_skills, ภาระงานจาก tickets ที่ยังไม่ปิด
 * และผลงานย้อนหลังจาก tickets ที่ปิดแล้ว — ไม่มีค่าเริ่มต้นสมมติให้หน้าจอดูเต็ม
 */

type Row = Record<string, unknown>;

/** ระดับ 1–5 — ที่เดียวที่แปลระดับเป็นคำอธิบายให้ทั้ง matrix และตัวจัดอันดับใช้ร่วมกัน */
export const SKILL_LEVELS = [
  { level: 1, label: 'ช่วยงานภายใต้การกำกับ', short: 'ช่วยงานได้' },
  { level: 2, label: 'ทำงานได้ด้วยตนเอง', short: 'ทำเองได้' },
  { level: 3, label: 'ทำงานได้คล่องและแก้ปัญหาได้', short: 'คล่อง' },
  { level: 4, label: 'เชี่ยวชาญ/แก้ปัญหาซับซ้อนได้', short: 'เชี่ยวชาญ' },
  { level: 5, label: 'ผู้เชี่ยวชาญ/สอนงานและวางมาตรฐานได้', short: 'ผู้เชี่ยวชาญ' },
] as const;

/** ระดับต่ำสุดที่ถือว่ารับงานหมวดนั้นเองได้โดยไม่ต้องมีคนกำกับ */
export const INDEPENDENT_LEVEL = 2;

export const TECHNICIAN_AVAILABILITY = ['available', 'limited', 'unavailable'] as const;
export type TechnicianAvailability = (typeof TECHNICIAN_AVAILABILITY)[number];

export interface SkillMatrixCell {
  categoryId: string;
  level: number | null;
  note: string | null;
  assessedAt: string | null;
  openTickets: number;
  skill?: string | null;
  certification?: string | null;
  certificationExpiry?: string | null;
  productTechnology?: string | null;
  location?: string | null;
  availability?: TechnicianAvailability;
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
  /** ถืองานค้างอยู่ในหมวดที่ยังไม่เคยถูกประเมิน — จุดที่ตารางกับงานจริงไม่ตรงกัน */
  unassessedOpenCategories: number;
}

export interface SkillMatrixCategoryCoverage {
  categoryId: string;
  name: string;
  assessed: number;
  independent: number;
  expert: number;
  openTickets: number;
  risk: 'covered' | 'single' | 'uncovered';
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
}

export interface TechnicianSkillProfile {
  technicianId: string;
  skills: Array<{
    categoryId: string;
    name: string;
    level: number | null;
    note: string | null;
    assessedAt: string | null;
    openTickets: number;
    skill?: string | null;
    certification?: string | null;
    certificationExpiry?: string | null;
    productTechnology?: string | null;
    location?: string | null;
    availability?: TechnicianAvailability;
  }>;
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
}

export interface TechnicianSkillRecommendation {
  technicianId: string;
  name: string;
  email: string | null;
  skill: string | null;
  proficiency: number;
  certification: string | null;
  certificationExpiry: string | null;
  productTechnology: string | null;
  location: string | null;
  availability: TechnicianAvailability;
  workload: { open: number; overdue: number };
  score: number;
  reasons: string[];
}

export interface TechnicianSkillRecommendationResponse {
  recommendations: TechnicianSkillRecommendation[];
  considered: number;
  excluded: { unassessed: number; belowMinimum: number; unavailable: number };
  generatedAt: string;
}

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
/** Ticket ที่ถูกยกเลิกหรือยกระดับไปโมดูลอื่นไม่ใช่ผลงานของช่าง จึงไม่นับในกราฟย้อนหลัง */
const NON_PERFORMANCE_STATUSES = new Set(['ยกเลิก', 'ยกระดับเป็น Incident']);

function text(row: Row, key: string): string {
  const value = row[key];
  return value === null || value === undefined ? '' : String(value);
}

function validDate(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function bangkokParts(instant: Date): { year: number; month: number; day: number } {
  const local = new Date(instant.getTime() + BANGKOK_OFFSET_MS);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth(), day: local.getUTCDate() };
}

function monthKey(instant: Date): string {
  const { year, month } = bangkokParts(instant);
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function dayKey(instant: Date): string {
  const { year, month, day } = bangkokParts(instant);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function average(values: number[], precision = 2): number | null {
  if (!values.length) return null;
  const factor = 10 ** precision;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * factor) / factor;
}

function percent(part: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((part / total) * 1000) / 10;
}

function latestIso(values: Array<string | null>): string | null {
  let latest: string | null = null;
  for (const value of values) {
    if (!value) continue;
    if (!latest || value > latest) latest = value;
  }
  return latest;
}

/** ผลงานของ Ticket หนึ่งใบ: ปิดเมื่อไร และปิดทันกำหนดหรือไม่ (null = ไม่มีกำหนดให้เทียบ) */
function closedOutcome(row: Row): { closedAt: Date; onTime: boolean | null } | null {
  if (NON_PERFORMANCE_STATUSES.has(text(row, 'status'))) return null;
  const closedAt = validDate(row.resolved_at) ?? validDate(row.closed_at);
  if (!closedAt) return null;
  const dueAt = validDate(row.due_at);
  return { closedAt, onTime: dueAt ? closedAt.getTime() <= dueAt.getTime() : null };
}

interface SkillRow {
  technicianId: string;
  categoryId: string;
  level: number;
  note: string | null;
  assessedAt: string | null;
  skill: string | null;
  certification: string | null;
  certificationExpiry: string | null;
  productTechnology: string | null;
  location: string | null;
  availability: TechnicianAvailability;
}

function nullableText(row: Row, key: string): string | null {
  const value = text(row, key).trim();
  return value || null;
}

function availability(value: unknown): TechnicianAvailability {
  return TECHNICIAN_AVAILABILITY.includes(String(value) as TechnicianAvailability)
    ? String(value) as TechnicianAvailability
    : 'available';
}

function normalizeSkills(rows: Row[]): SkillRow[] {
  return rows
    .map((row) => ({
      technicianId: text(row, 'technician_id'),
      categoryId: text(row, 'category_id'),
      level: Number(row.level ?? 0),
      note: row.note ? String(row.note) : null,
      assessedAt: row.assessed_at ? String(row.assessed_at) : null,
      skill: nullableText(row, 'skill'),
      certification: nullableText(row, 'certification'),
      certificationExpiry: row.certification_expiry ? String(row.certification_expiry) : null,
      productTechnology: nullableText(row, 'product_technology'),
      location: nullableText(row, 'location'),
      availability: availability(row.availability),
    }))
    .filter((skill) => skill.technicianId && skill.categoryId && skill.level >= 1 && skill.level <= 5);
}

/** จำนวน Ticket ที่ยังไม่ปิด แยกตาม "ผู้รับผิดชอบ + หมวดหมู่" ใช้ทั้งในตารางและในหน้าโปรไฟล์ */
function countOpenByTechnicianCategory(openTickets: Row[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ticket of openTickets) {
    const assignee = text(ticket, 'assignee_id');
    const category = text(ticket, 'category_id');
    if (!assignee || !category) continue;
    const key = `${assignee}::${category}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function buildSkillMatrix(args: {
  categories: Row[];
  technicians: Row[];
  skills: Row[];
  openTickets: Row[];
  now?: Date;
}): SkillMatrixResponse {
  const now = args.now ?? new Date();
  const categories = args.categories
    .map((row) => ({ id: text(row, 'id'), name: text(row, 'name') || 'ไม่ระบุชื่อหมวดหมู่' }))
    .filter((category) => category.id);
  const skills = normalizeSkills(args.skills);
  const skillByKey = new Map(skills.map((skill) => [`${skill.technicianId}::${skill.categoryId}`, skill]));
  const openByTechnicianCategory = countOpenByTechnicianCategory(args.openTickets);

  const openByTechnician = new Map<string, { open: number; overdue: number }>();
  const openByCategory = new Map<string, number>();
  for (const ticket of args.openTickets) {
    const assignee = text(ticket, 'assignee_id');
    const category = text(ticket, 'category_id');
    if (category) openByCategory.set(category, (openByCategory.get(category) ?? 0) + 1);
    if (!assignee) continue;
    const entry = openByTechnician.get(assignee) ?? { open: 0, overdue: 0 };
    entry.open += 1;
    const dueAt = validDate(ticket.due_at);
    if (dueAt && dueAt.getTime() < now.getTime()) entry.overdue += 1;
    openByTechnician.set(assignee, entry);
  }

  const technicians: SkillMatrixTechnician[] = args.technicians
    .map((row) => {
      const id = text(row, 'id');
      const cells = categories.map((category) => {
        const skill = skillByKey.get(`${id}::${category.id}`);
        return {
          categoryId: category.id,
          level: skill?.level ?? null,
          note: skill?.note ?? null,
          assessedAt: skill?.assessedAt ?? null,
          openTickets: openByTechnicianCategory.get(`${id}::${category.id}`) ?? 0,
          skill: skill?.skill ?? null,
          certification: skill?.certification ?? null,
          certificationExpiry: skill?.certificationExpiry ?? null,
          productTechnology: skill?.productTechnology ?? null,
          location: skill?.location ?? null,
          availability: skill?.availability ?? 'available',
        };
      });
      const assessed = cells.filter((cell) => cell.level !== null);
      const workload = openByTechnician.get(id) ?? { open: 0, overdue: 0 };
      return {
        id,
        name: text(row, 'full_name') || text(row, 'email') || 'ไม่ระบุชื่อ',
        email: row.email ? String(row.email) : null,
        cells,
        assessedCount: assessed.length,
        averageLevel: average(assessed.map((cell) => cell.level as number), 1),
        openTickets: workload.open,
        overdueTickets: workload.overdue,
        unassessedOpenCategories: cells.filter((cell) => cell.level === null && cell.openTickets > 0).length,
      };
    })
    .filter((technician) => technician.id)
    .sort((a, b) => b.assessedCount - a.assessedCount || b.openTickets - a.openTickets || a.name.localeCompare(b.name, 'th'));

  const coverage: SkillMatrixCategoryCoverage[] = categories.map((category) => {
    const levels = technicians.map((technician) => technician.cells.find((cell) => cell.categoryId === category.id)?.level ?? null);
    const independent = levels.filter((level) => level !== null && level >= INDEPENDENT_LEVEL).length;
    return {
      categoryId: category.id,
      name: category.name,
      assessed: levels.filter((level) => level !== null).length,
      independent,
      expert: levels.filter((level) => level === 3).length,
      openTickets: openByCategory.get(category.id) ?? 0,
      risk: independent === 0 ? 'uncovered' : independent === 1 ? 'single' : 'covered',
    };
  });

  const totalCells = technicians.length * categories.length;
  const assessedCells = technicians.reduce((sum, technician) => sum + technician.assessedCount, 0);

  return {
    categories,
    technicians,
    coverage,
    summary: {
      technicianCount: technicians.length,
      categoryCount: categories.length,
      assessedCells,
      totalCells,
      coveragePercent: percent(assessedCells, totalCells),
      uncoveredCategories: coverage.filter((item) => item.risk === 'uncovered').length,
      singlePointCategories: coverage.filter((item) => item.risk === 'single').length,
      openTicketsAtRisk: coverage.filter((item) => item.risk !== 'covered').reduce((sum, item) => sum + item.openTickets, 0),
    },
    lastAssessedAt: latestIso(skills.map((skill) => skill.assessedAt)),
  };
}

export function buildTechnicianSkillProfile(args: {
  technicianId: string;
  categories: Row[];
  skills: Row[];
  openTickets: Row[];
  closedTickets: Row[];
  now?: Date;
  months?: number;
}): TechnicianSkillProfile {
  const now = args.now ?? new Date();
  const monthCount = args.months ?? 6;
  const categories = args.categories
    .map((row) => ({ id: text(row, 'id'), name: text(row, 'name') || 'ไม่ระบุชื่อหมวดหมู่' }))
    .filter((category) => category.id);
  const skills = normalizeSkills(args.skills).filter((skill) => skill.technicianId === args.technicianId);
  const skillByCategory = new Map(skills.map((skill) => [skill.categoryId, skill]));
  const openTickets = args.openTickets.filter((ticket) => text(ticket, 'assignee_id') === args.technicianId);
  const openByCategory = countOpenByTechnicianCategory(openTickets);

  const skillRows = categories.map((category) => {
    const skill = skillByCategory.get(category.id);
    return {
      categoryId: category.id,
      name: category.name,
      level: skill?.level ?? null,
      note: skill?.note ?? null,
      assessedAt: skill?.assessedAt ?? null,
      openTickets: openByCategory.get(`${args.technicianId}::${category.id}`) ?? 0,
      skill: skill?.skill ?? null,
      certification: skill?.certification ?? null,
      certificationExpiry: skill?.certificationExpiry ?? null,
      productTechnology: skill?.productTechnology ?? null,
      location: skill?.location ?? null,
      availability: skill?.availability ?? 'available',
    };
  });

  const statusCounts = new Map<string, number>();
  let overdue = 0;
  let dueToday = 0;
  const todayKey = dayKey(now);
  for (const ticket of openTickets) {
    const status = text(ticket, 'status') || 'ไม่ระบุสถานะ';
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
    const dueAt = validDate(ticket.due_at);
    if (!dueAt) continue;
    if (dueAt.getTime() < now.getTime()) overdue += 1;
    else if (dayKey(dueAt) === todayKey) dueToday += 1;
  }

  // เดือนย้อนหลังเรียงจากเก่าไปใหม่ เพื่อให้กราฟอ่านจากซ้ายไปขวาตามเวลา
  const monthBuckets = Array.from({ length: monthCount }, (_, index) => {
    const { year, month } = bangkokParts(now);
    const target = new Date(Date.UTC(year, month - (monthCount - 1 - index), 1));
    return {
      key: `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}`,
      label: THAI_MONTHS[target.getUTCMonth()],
      closed: 0,
      slaEligible: 0,
      slaMet: 0,
      ratings: [] as number[],
    };
  });
  const bucketByKey = new Map(monthBuckets.map((bucket) => [bucket.key, bucket]));

  for (const ticket of args.closedTickets) {
    if (text(ticket, 'assignee_id') !== args.technicianId) continue;
    const outcome = closedOutcome(ticket);
    if (!outcome) continue;
    const bucket = bucketByKey.get(monthKey(outcome.closedAt));
    if (!bucket) continue;
    bucket.closed += 1;
    if (outcome.onTime !== null) {
      bucket.slaEligible += 1;
      if (outcome.onTime) bucket.slaMet += 1;
    }
    const rating = Number(ticket.rating ?? 0);
    if (rating >= 1 && rating <= 5) bucket.ratings.push(rating);
  }

  const allRatings = monthBuckets.flatMap((bucket) => bucket.ratings);
  const closedTotal = monthBuckets.reduce((sum, bucket) => sum + bucket.closed, 0);
  const slaEligibleTotal = monthBuckets.reduce((sum, bucket) => sum + bucket.slaEligible, 0);
  const slaMetTotal = monthBuckets.reduce((sum, bucket) => sum + bucket.slaMet, 0);
  const assessed = skillRows.filter((row) => row.level !== null);

  return {
    technicianId: args.technicianId,
    skills: skillRows,
    assessedCount: assessed.length,
    averageLevel: average(assessed.map((row) => row.level as number), 1),
    lastAssessedAt: latestIso(skills.map((skill) => skill.assessedAt)),
    workload: {
      open: openTickets.length,
      overdue,
      dueToday,
      unassessedCategories: skillRows.filter((row) => row.level === null && row.openTickets > 0).length,
      byStatus: [...statusCounts]
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'th')),
    },
    performance: {
      months: monthBuckets.map((bucket) => ({
        key: bucket.key,
        label: bucket.label,
        closed: bucket.closed,
        slaMet: bucket.slaMet,
        slaPercent: percent(bucket.slaMet, bucket.slaEligible),
        averageRating: average(bucket.ratings),
      })),
      closedTotal,
      slaPercent: percent(slaMetTotal, slaEligibleTotal),
      averageRating: average(allRatings),
      ratedCount: allRatings.length,
    },
  };
}

function comparable(value: string | null | undefined): string {
  return String(value ?? '').trim().toLocaleLowerCase('th-TH');
}

function matchesSearch(value: string | null, query: string | null | undefined): boolean {
  const normalizedQuery = comparable(query);
  return Boolean(normalizedQuery) && comparable(value).includes(normalizedQuery);
}

function certificationIsCurrent(expiry: string | null, now: Date): boolean {
  if (!expiry) return false;
  const parsed = validDate(`${expiry}T23:59:59Z`);
  return Boolean(parsed && parsed.getTime() >= now.getTime());
}

/**
 * จัดอันดับผู้รับงานจากข้อมูลที่ประเมินจริง โดยไม่เปลี่ยน assignee ให้เอง
 *
 * คะแนนให้น้ำหนัก proficiency/availability ก่อน แล้วหักตามงานค้างและงานเกินกำหนด
 * อย่างชัดเจน เพื่อไม่ให้คนที่เก่งที่สุดแต่กำลังล้นงานถูกดันขึ้นมาโดยอัตโนมัติ
 */
export function buildTechnicianRecommendations(args: {
  categoryId: string;
  technicians: Row[];
  skills: Row[];
  openTickets: Row[];
  location?: string | null;
  productTechnology?: string | null;
  minLevel?: number;
  limit?: number;
  now?: Date;
}): { recommendations: TechnicianSkillRecommendation[]; considered: number; excluded: { unassessed: number; belowMinimum: number; unavailable: number } } {
  const now = args.now ?? new Date();
  const minLevel = Math.min(5, Math.max(1, Math.trunc(args.minLevel ?? 2)));
  const limit = Math.min(10, Math.max(1, Math.trunc(args.limit ?? 5)));
  const skills = normalizeSkills(args.skills);
  const skillByTechnician = new Map(
    skills
      .filter((skill) => skill.categoryId === args.categoryId)
      .map((skill) => [skill.technicianId, skill]),
  );
  const workloadByTechnician = new Map<string, { open: number; overdue: number }>();

  for (const ticket of args.openTickets) {
    const technicianId = text(ticket, 'assignee_id');
    if (!technicianId) continue;
    const current = workloadByTechnician.get(technicianId) ?? { open: 0, overdue: 0 };
    current.open += 1;
    const dueAt = validDate(ticket.due_at);
    if (dueAt && dueAt.getTime() < now.getTime()) current.overdue += 1;
    workloadByTechnician.set(technicianId, current);
  }

  const excluded = { unassessed: 0, belowMinimum: 0, unavailable: 0 };
  const candidates: TechnicianSkillRecommendation[] = [];

  for (const technician of args.technicians) {
    const technicianId = text(technician, 'id');
    if (!technicianId) continue;
    const skill = skillByTechnician.get(technicianId);
    if (!skill) {
      excluded.unassessed += 1;
      continue;
    }
    if (skill.level < minLevel) {
      excluded.belowMinimum += 1;
      continue;
    }
    if (skill.availability === 'unavailable') {
      excluded.unavailable += 1;
      continue;
    }

    const workload = workloadByTechnician.get(technicianId) ?? { open: 0, overdue: 0 };
    const locationMatch = matchesSearch(skill.location, args.location);
    const productMatch = matchesSearch(skill.productTechnology, args.productTechnology);
    const currentCertification = certificationIsCurrent(skill.certificationExpiry, now);
    const availabilityScore = skill.availability === 'available' ? 20 : 8;
    const workloadPenalty = Math.min(workload.open, 12) * 2 + Math.min(workload.overdue, 5) * 5;
    const score = Math.max(0, Math.round(
      skill.level * 10
      + availabilityScore
      + (locationMatch ? 10 : 0)
      + (productMatch ? 10 : 0)
      + (currentCertification ? 5 : 0)
      - workloadPenalty,
    ));
    const reasons = [
      `Proficiency ${skill.level}/5`,
      skill.availability === 'available' ? 'พร้อมรับงาน' : 'พร้อมรับงานแบบจำกัด',
      `งานค้าง ${workload.open}${workload.overdue ? ` · เกินกำหนด ${workload.overdue}` : ''}`,
    ];
    if (locationMatch) reasons.push('ตรงพื้นที่ปฏิบัติงาน');
    if (productMatch) reasons.push('ตรง Product/Technology');
    if (currentCertification) reasons.push('Certification ยังไม่หมดอายุ');
    if (skill.certification && !currentCertification) reasons.push('ตรวจสอบ Certification เพิ่มเติม');

    candidates.push({
      technicianId,
      name: text(technician, 'full_name') || text(technician, 'email') || 'ไม่ระบุชื่อ',
      email: technician.email ? String(technician.email) : null,
      skill: skill.skill,
      proficiency: skill.level,
      certification: skill.certification,
      certificationExpiry: skill.certificationExpiry,
      productTechnology: skill.productTechnology,
      location: skill.location,
      availability: skill.availability,
      workload,
      score,
      reasons,
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.workload.open - b.workload.open || a.workload.overdue - b.workload.overdue || a.name.localeCompare(b.name, 'th'));
  return { recommendations: candidates.slice(0, limit), considered: args.technicians.length, excluded };
}
