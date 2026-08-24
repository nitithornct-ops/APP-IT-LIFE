import { describe, expect, it } from 'vitest';
import { buildSkillMatrix, buildTechnicianSkillProfile } from '../src/services/technicianSkillService';
import { saveTechnicianSkillsSchema } from '../src/validators/technicianSkills';

const CATEGORIES = [
  { id: 'cat-net', name: 'เครือข่าย' },
  { id: 'cat-pc', name: 'คอมพิวเตอร์' },
  { id: 'cat-db', name: 'ฐานข้อมูล' },
];

const TECHNICIANS = [
  { id: 'tech-1', full_name: 'วรุณ ทองแท้', email: 'warun@life.local' },
  { id: 'tech-2', full_name: 'สมชาย ใจดี', email: 'somchai@life.local' },
];

const NOW = new Date('2026-08-23T10:00:00.000Z');

describe('technician skill matrix', () => {
  it('shows an empty assessment as a gap instead of level zero', () => {
    const matrix = buildSkillMatrix({ categories: CATEGORIES, technicians: TECHNICIANS, skills: [], openTickets: [], now: NOW });

    expect(matrix.summary).toMatchObject({ technicianCount: 2, categoryCount: 3, assessedCells: 0, totalCells: 6, coveragePercent: 0 });
    expect(matrix.technicians[0].cells.map((cell) => cell.level)).toEqual([null, null, null]);
    expect(matrix.technicians[0].averageLevel).toBeNull();
    expect(matrix.lastAssessedAt).toBeNull();
    // ทุกหมวดยังไม่มีใครทำเองได้ ต้องขึ้นเป็นความเสี่ยง ไม่ใช่ผ่านเงียบ ๆ
    expect(matrix.coverage.every((item) => item.risk === 'uncovered')).toBe(true);
    expect(matrix.summary.uncoveredCategories).toBe(3);
  });

  it('maps real assessments onto the category grid and grades coverage risk', () => {
    const matrix = buildSkillMatrix({
      categories: CATEGORIES,
      technicians: TECHNICIANS,
      skills: [
        { technician_id: 'tech-1', category_id: 'cat-net', level: 3, note: 'ดูแล Core Switch', assessed_at: '2026-08-01T00:00:00.000Z' },
        { technician_id: 'tech-1', category_id: 'cat-pc', level: 2, note: null, assessed_at: '2026-08-05T00:00:00.000Z' },
        { technician_id: 'tech-2', category_id: 'cat-net', level: 1, note: null, assessed_at: '2026-08-03T00:00:00.000Z' },
      ],
      openTickets: [
        { assignee_id: 'tech-1', category_id: 'cat-net', status: 'กำลังดำเนินการ', due_at: '2026-08-20T00:00:00.000Z' },
        { assignee_id: 'tech-2', category_id: 'cat-db', status: 'ใหม่', due_at: '2026-08-30T00:00:00.000Z' },
        { assignee_id: null, category_id: 'cat-db', status: 'ใหม่', due_at: null },
      ],
      now: NOW,
    });

    const first = matrix.technicians.find((technician) => technician.id === 'tech-1')!;
    expect(first.cells.map((cell) => cell.level)).toEqual([3, 2, null]);
    expect(first.assessedCount).toBe(2);
    expect(first.averageLevel).toBe(2.5);
    expect(first.openTickets).toBe(1);
    expect(first.overdueTickets).toBe(1);

    // tech-2 ถือ Ticket หมวดฐานข้อมูลอยู่ทั้งที่ยังไม่เคยถูกประเมินหมวดนั้น
    const second = matrix.technicians.find((technician) => technician.id === 'tech-2')!;
    expect(second.unassessedOpenCategories).toBe(1);

    const network = matrix.coverage.find((item) => item.categoryId === 'cat-net')!;
    expect(network).toMatchObject({ assessed: 2, independent: 1, expert: 1, risk: 'single', openTickets: 1 });
    const database = matrix.coverage.find((item) => item.categoryId === 'cat-db')!;
    expect(database).toMatchObject({ assessed: 0, independent: 0, risk: 'uncovered', openTickets: 2 });

    expect(matrix.summary).toMatchObject({ assessedCells: 3, totalCells: 6, coveragePercent: 50, uncoveredCategories: 1, singlePointCategories: 2 });
    expect(matrix.summary.openTicketsAtRisk).toBe(3);
    expect(matrix.lastAssessedAt).toBe('2026-08-05T00:00:00.000Z');
  });

  it('ignores rows whose level is outside the 1-3 scale the table allows', () => {
    const matrix = buildSkillMatrix({
      categories: CATEGORIES,
      technicians: TECHNICIANS,
      skills: [
        { technician_id: 'tech-1', category_id: 'cat-net', level: 0, note: null, assessed_at: null },
        { technician_id: 'tech-1', category_id: 'cat-pc', level: 9, note: null, assessed_at: null },
      ],
      openTickets: [],
      now: NOW,
    });

    expect(matrix.summary.assessedCells).toBe(0);
  });

  it('sorts the roster by how much of it has actually been assessed', () => {
    const matrix = buildSkillMatrix({
      categories: CATEGORIES,
      technicians: TECHNICIANS,
      skills: [{ technician_id: 'tech-2', category_id: 'cat-db', level: 2, note: null, assessed_at: '2026-08-02T00:00:00.000Z' }],
      openTickets: [],
      now: NOW,
    });

    expect(matrix.technicians.map((technician) => technician.id)).toEqual(['tech-2', 'tech-1']);
  });
});

describe('technician skill profile', () => {
  it('reports every category, keeping unassessed ones visible as null', () => {
    const profile = buildTechnicianSkillProfile({
      technicianId: 'tech-1',
      categories: CATEGORIES,
      skills: [
        { technician_id: 'tech-1', category_id: 'cat-net', level: 3, note: 'ดูแล Core Switch', assessed_at: '2026-08-01T00:00:00.000Z' },
        { technician_id: 'tech-2', category_id: 'cat-pc', level: 2, note: null, assessed_at: '2026-08-04T00:00:00.000Z' },
      ],
      openTickets: [],
      closedTickets: [],
      now: NOW,
    });

    expect(profile.skills).toHaveLength(3);
    expect(profile.skills.find((skill) => skill.categoryId === 'cat-net')).toMatchObject({ level: 3, note: 'ดูแล Core Switch' });
    // ผลประเมินของคนอื่นต้องไม่รั่วเข้ามาในโปรไฟล์นี้
    expect(profile.skills.find((skill) => skill.categoryId === 'cat-pc')!.level).toBeNull();
    expect(profile.assessedCount).toBe(1);
    expect(profile.averageLevel).toBe(3);
  });

  it('summarises the workload actually held by this technician', () => {
    const profile = buildTechnicianSkillProfile({
      technicianId: 'tech-1',
      categories: CATEGORIES,
      skills: [],
      openTickets: [
        { assignee_id: 'tech-1', category_id: 'cat-net', status: 'กำลังดำเนินการ', due_at: '2026-08-20T00:00:00.000Z' },
        { assignee_id: 'tech-1', category_id: 'cat-net', status: 'กำลังดำเนินการ', due_at: '2026-08-23T16:00:00.000Z' },
        { assignee_id: 'tech-1', category_id: 'cat-pc', status: 'รออะไหล่', due_at: null },
        { assignee_id: 'tech-2', category_id: 'cat-db', status: 'ใหม่', due_at: null },
      ],
      closedTickets: [],
      now: NOW,
    });

    expect(profile.workload).toMatchObject({ open: 3, overdue: 1, dueToday: 1, unassessedCategories: 2 });
    expect(profile.workload.byStatus).toEqual([
      { label: 'กำลังดำเนินการ', value: 2 },
      { label: 'รออะไหล่', value: 1 },
    ]);
  });

  it('builds six months of closed-work history from real ticket outcomes', () => {
    const profile = buildTechnicianSkillProfile({
      technicianId: 'tech-1',
      categories: CATEGORIES,
      skills: [],
      openTickets: [],
      closedTickets: [
        { assignee_id: 'tech-1', status: 'ปิดงาน', resolved_at: '2026-08-10T03:00:00.000Z', due_at: '2026-08-12T03:00:00.000Z', rating: 5 },
        { assignee_id: 'tech-1', status: 'ปิดงาน', resolved_at: '2026-08-11T03:00:00.000Z', due_at: '2026-08-09T03:00:00.000Z', rating: 3 },
        { assignee_id: 'tech-1', status: 'เสร็จสิ้น', closed_at: '2026-07-15T03:00:00.000Z', due_at: null, rating: null },
        // ยกเลิก/ยกระดับ ไม่ใช่ผลงาน และงานของคนอื่นต้องไม่ถูกนับ
        { assignee_id: 'tech-1', status: 'ยกเลิก', resolved_at: '2026-08-12T03:00:00.000Z', due_at: '2026-08-20T03:00:00.000Z', rating: 5 },
        { assignee_id: 'tech-2', status: 'ปิดงาน', resolved_at: '2026-08-12T03:00:00.000Z', due_at: '2026-08-20T03:00:00.000Z', rating: 5 },
        // เก่ากว่าหน้าต่าง 6 เดือน
        { assignee_id: 'tech-1', status: 'ปิดงาน', resolved_at: '2025-12-01T03:00:00.000Z', due_at: null, rating: 5 },
      ],
      now: NOW,
    });

    expect(profile.performance.months.map((month) => month.key)).toEqual(['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']);
    const august = profile.performance.months.at(-1)!;
    expect(august).toMatchObject({ closed: 2, slaMet: 1, slaPercent: 50, averageRating: 4 });
    const july = profile.performance.months.at(-2)!;
    // ไม่มีกำหนดเวลาให้เทียบ จึงไม่มีเปอร์เซ็นต์ SLA แทนที่จะรายงาน 0% หรือ 100%
    expect(july).toMatchObject({ closed: 1, slaPercent: null, averageRating: null });

    expect(profile.performance).toMatchObject({ closedTotal: 3, slaPercent: 50, averageRating: 4, ratedCount: 2 });
  });

  it('returns an all-empty profile when nothing has been recorded yet', () => {
    const profile = buildTechnicianSkillProfile({
      technicianId: 'tech-1',
      categories: [],
      skills: [],
      openTickets: [],
      closedTickets: [],
      now: NOW,
    });

    expect(profile.skills).toEqual([]);
    expect(profile.averageLevel).toBeNull();
    expect(profile.workload).toMatchObject({ open: 0, overdue: 0, dueToday: 0 });
    expect(profile.performance.months).toHaveLength(6);
    expect(profile.performance.slaPercent).toBeNull();
    expect(profile.performance.averageRating).toBeNull();
  });
});

describe('technician skill payload validation', () => {
  const categoryId = '11111111-1111-4111-8111-111111111111';

  it('accepts levels 1-3 and an explicit null that withdraws an assessment', () => {
    expect(saveTechnicianSkillsSchema.safeParse({ skills: [{ categoryId, level: 3 }] }).success).toBe(true);
    expect(saveTechnicianSkillsSchema.safeParse({ skills: [{ categoryId, level: null }] }).success).toBe(true);
  });

  it('rejects levels outside the scale, duplicate categories, and empty payloads', () => {
    expect(saveTechnicianSkillsSchema.safeParse({ skills: [{ categoryId, level: 0 }] }).success).toBe(false);
    expect(saveTechnicianSkillsSchema.safeParse({ skills: [{ categoryId, level: 4 }] }).success).toBe(false);
    expect(saveTechnicianSkillsSchema.safeParse({ skills: [{ categoryId, level: 2.5 }] }).success).toBe(false);
    expect(saveTechnicianSkillsSchema.safeParse({ skills: [] }).success).toBe(false);
    expect(
      saveTechnicianSkillsSchema.safeParse({ skills: [{ categoryId, level: 1 }, { categoryId, level: 2 }] }).success,
    ).toBe(false);
  });
});
