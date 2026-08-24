import { zValidator } from '@hono/zod-validator';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Hono, type Context } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { hasPermission, requirePermission } from '../middleware/permission';
import { writeAuditLog } from '../services/auditService';
import {
  buildSkillMatrix,
  buildTechnicianSkillProfile,
  SKILL_LEVELS,
  type SkillMatrixResponse,
  type TechnicianSkillProfile,
} from '../services/technicianSkillService';
import type { AppEnv } from '../types';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import { saveTechnicianSkillsSchema } from '../validators/technicianSkills';

/**
 * Technician Skill Matrix — ระดับทักษะของเจ้าหน้าที่ต่อหมวดหมู่ Ticket
 *
 * ตาราง technician_skills เพิ่งเพิ่มใน migration 20260916100000 เพราะ schema เดิมไม่มีที่เก็บระดับ
 * ทักษะเลย (ดูเหตุผลเต็มในหัวไฟล์ migration) ระบบจึงเริ่มต้นด้วยตารางว่าง — หน้าจอต้องแสดง
 * "ยังไม่ประเมิน" ตามจริงจนกว่าผู้ดูแลจะบันทึกผลประเมินเข้ามา
 */
export const technicianSkillsRoute = new Hono<AppEnv>();
technicianSkillsRoute.use('*', requireAuth);

const SKILL_SELECT = 'technician_id, category_id, level, note, assessed_at';
const OPEN_TICKET_SELECT = 'assignee_id, category_id, status, due_at';
const CLOSED_TICKET_SELECT = 'assignee_id, category_id, status, due_at, resolved_at, closed_at, rating';
/** สถานะปลายทางของ Ticket — ชุดเดียวกับที่ dashboard/analytics ใช้กรอง "งานที่ยังไม่ปิด" */
const TERMINAL_TICKET_STATUSES = '(เสร็จสิ้น,ปิดงาน,ยกเลิก,ยกระดับเป็น Incident)';
const MAX_TICKET_ROWS = 5000;
const MAX_ROSTER_SIZE = 500;
/** จำนวน id ต่อหนึ่งคำขอ ให้ query string สั้นพอที่ proxy ทุกชั้นรับได้ */
const ROSTER_FETCH_CHUNK = 100;

type Row = Record<string, unknown>;

/** ย้อนหลังกี่เดือนในกราฟผลงาน — ตรงกับ mockup "กราฟผลงาน 6 เดือน" */
const PERFORMANCE_MONTHS = 6;

function performanceWindowStart(now: Date): string {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (PERFORMANCE_MONTHS - 1), 1));
  // เผื่อ 1 วันให้ครอบคลุมต้นเดือนตามเวลาไทย (UTC+7) ซึ่งเริ่มก่อนเที่ยงคืน UTC
  start.setUTCDate(start.getUTCDate() - 1);
  return start.toISOString();
}

async function loadCategories(supabase: SupabaseClient) {
  return supabase.from('ticket_categories').select('id, name').eq('status', 'active').order('name');
}

/**
 * รายชื่อเจ้าหน้าที่ที่ควรอยู่ในตาราง — คนที่ "บทบาทอนุญาตให้แก้ไข Ticket" ตาม RBAC จริง
 * ไม่ใช่รายชื่อผู้ใช้ทั้งองค์กร (ผู้แจ้งงานทั่วไปไม่ควรถูกประเมินทักษะช่าง) และไม่ใช่รายการที่
 * hard-code ไว้ในโค้ด — ถ้าองค์กรเปลี่ยนว่าบทบาทไหนทำงานซ่อม ตารางนี้เปลี่ยนตามทันที
 *
 * รวมคนที่เคยถูกประเมินไว้แล้วเสมอ ถึงแม้บทบาทจะถูกถอดภายหลัง มิฉะนั้นผลประเมินที่บันทึกไว้จะหายไป
 * จากหน้าจอโดยที่ข้อมูลยังอยู่ในฐานข้อมูล
 *
 * ใช้ Admin client เพราะ RLS ของ profiles ให้เห็นเฉพาะแถวตนเอง (เว้นแต่มี user.manage) แต่ผู้ที่มี
 * technician_skill.view ไม่จำเป็นต้องมีสิทธิ์จัดการบัญชีผู้ใช้ — สิทธิ์ถูกตรวจที่ middleware แล้ว
 */
async function loadTechnicianRoster(
  admin: SupabaseClient,
  assessedTechnicianIds: string[],
): Promise<{ rows: Row[]; error?: unknown }> {
  const permissionResult = await admin.from('permissions').select('id').eq('key', 'ticket.update').maybeSingle();
  if (permissionResult.error) return { rows: [], error: permissionResult.error };

  const roleUserIds: string[] = [];
  const permissionId = permissionResult.data?.id;
  if (permissionId) {
    const rolePermissionResult = await admin
      .from('role_permissions')
      .select('role_id')
      .eq('permission_id', permissionId)
      .eq('effect', 'allow');
    if (rolePermissionResult.error) return { rows: [], error: rolePermissionResult.error };

    const roleIds = (rolePermissionResult.data ?? []).map((row: Row) => String(row.role_id));
    if (roleIds.length) {
      const userRoleResult = await admin.from('user_roles').select('user_id').in('role_id', roleIds);
      if (userRoleResult.error) return { rows: [], error: userRoleResult.error };
      for (const row of userRoleResult.data ?? []) roleUserIds.push(String((row as Row).user_id));
    }
  }

  const ids = [...new Set([...roleUserIds, ...assessedTechnicianIds])].slice(0, MAX_ROSTER_SIZE);
  if (!ids.length) return { rows: [] };

  /*
   * ดึงทีละชุดเพราะ PostgREST รับตัวกรอง in.() มาทาง query string — รายชื่อยาว ๆ จะทำให้ URL
   * ทะลุลิมิตของ proxy แล้วล้มทั้งหน้าจอ ซึ่งจะเกิดเฉพาะกับองค์กรที่มีเจ้าหน้าที่เยอะ
   * (ประมาณ 200 คนขึ้นไป) จึงเป็นข้อผิดพลาดที่ไม่มีทางเจอตอนทดสอบด้วยข้อมูลชุดเล็ก
   */
  const rows: Row[] = [];
  for (let start = 0; start < ids.length; start += ROSTER_FETCH_CHUNK) {
    const profilesResult = await admin
      .from('profiles')
      .select('id, full_name, email')
      .in('id', ids.slice(start, start + ROSTER_FETCH_CHUNK))
      .eq('status', 'active');
    if (profilesResult.error) return { rows: [], error: profilesResult.error };
    rows.push(...((profilesResult.data ?? []) as Row[]));
  }
  return { rows: rows.sort((a, b) => String(a.full_name ?? '').localeCompare(String(b.full_name ?? ''), 'th')) };
}

/**
 * Ticket ที่ยังไม่ปิดทั้งองค์กร ใช้เติมคอลัมน์ภาระงาน
 *
 * เรียกเฉพาะเมื่อผู้ใช้มี ticket.view_all เท่านั้น — ผู้ที่ไม่มีสิทธิ์นี้จะเห็นเฉพาะงานของตนเองตาม RLS
 * ซึ่งจะทำให้ช่างคนอื่นดูเหมือนไม่มีงานค้างเลย หน้าจอจึงต้องบอกว่า "ดูภาระงานไม่ได้" ตรง ๆ
 * แทนการแสดงเลข 0 ที่ผิด
 */
async function loadOpenTickets(supabase: SupabaseClient, technicianId?: string) {
  let query = supabase
    .from('tickets')
    .select(OPEN_TICKET_SELECT, { count: 'exact' })
    .is('deleted_at', null)
    .not('status', 'in', TERMINAL_TICKET_STATUSES)
    .limit(MAX_TICKET_ROWS);
  if (technicianId) query = query.eq('assignee_id', technicianId);
  return query;
}

/**
 * งานที่ปิดแล้วในหน้าต่างผลงาน — กรองด้วย "เวลาที่ปิด" ไม่ใช่เวลาที่เปิด
 * งานที่เปิดไว้นานแล้วเพิ่งปิดเดือนนี้ก็คือผลงานของเดือนนี้ ถ้ากรองด้วย created_at จะหายไปทั้งใบ
 */
async function loadClosedTickets(supabase: SupabaseClient, technicianId: string, now: Date) {
  const windowStart = performanceWindowStart(now);
  return supabase
    .from('tickets')
    .select(CLOSED_TICKET_SELECT)
    .is('deleted_at', null)
    .eq('assignee_id', technicianId)
    .or(`resolved_at.gte.${windowStart},closed_at.gte.${windowStart}`)
    .limit(MAX_TICKET_ROWS);
}

interface MatrixPayload extends SkillMatrixResponse {
  levels: typeof SKILL_LEVELS;
  workloadAvailable: boolean;
  /** true เมื่อ Ticket ที่เปิดค้างมีมากกว่าที่สแกนได้ในครั้งเดียว ตัวเลขภาระงานจึงต่ำกว่าความจริง */
  workloadSampled: boolean;
  canManage: boolean;
  generatedAt: string;
}

technicianSkillsRoute.get('/matrix', requirePermission('technician_skill.view'), async (c) => {
  const supabase = c.get('supabase');
  const admin = createAdminClient(c.env);
  const reqId = c.get('requestId');
  const now = new Date();

  const [categoriesResult, skillsResult, canSeeAllTickets, canManage] = await Promise.all([
    loadCategories(supabase),
    admin.from('technician_skills').select(SKILL_SELECT).limit(MAX_ROSTER_SIZE * 50),
    hasPermission(c, 'ticket.view_all'),
    hasPermission(c, 'technician_skill.manage'),
  ]);
  if (categoriesResult.error) return dbFailJson(c, 'TICKET_CATEGORIES_LOAD_FAILED', categoriesResult.error, 'โหลดหมวดหมู่งานไม่สำเร็จ');
  if (skillsResult.error) return dbFailJson(c, 'TECHNICIAN_SKILLS_LOAD_FAILED', skillsResult.error, 'โหลดตารางทักษะไม่สำเร็จ');

  const skills = (skillsResult.data ?? []) as Row[];
  const roster = await loadTechnicianRoster(admin, skills.map((row) => String(row.technician_id)));
  if (roster.error) return dbFailJson(c, 'TECHNICIAN_ROSTER_LOAD_FAILED', roster.error, 'โหลดรายชื่อเจ้าหน้าที่ไม่สำเร็จ');

  const openTicketsResult = canSeeAllTickets ? await loadOpenTickets(supabase) : null;
  if (openTicketsResult?.error) return dbFailJson(c, 'TECHNICIAN_WORKLOAD_LOAD_FAILED', openTicketsResult.error, 'โหลดภาระงานไม่สำเร็จ');

  const payload: MatrixPayload = {
    ...buildSkillMatrix({
      categories: (categoriesResult.data ?? []) as Row[],
      technicians: roster.rows,
      skills,
      openTickets: (openTicketsResult?.data ?? []) as Row[],
      now,
    }),
    levels: SKILL_LEVELS,
    workloadAvailable: canSeeAllTickets,
    workloadSampled: (openTicketsResult?.count ?? 0) > (openTicketsResult?.data?.length ?? 0),
    canManage,
    generatedAt: now.toISOString(),
  };
  return c.json(ok(reqId, payload));
});

interface ProfilePayload extends TechnicianSkillProfile {
  levels: typeof SKILL_LEVELS;
  workloadAvailable: boolean;
  canManage: boolean;
  generatedAt: string;
}

/**
 * โปรไฟล์ทักษะของเจ้าหน้าที่หนึ่งคน — ใช้ทั้งหน้า "โปรไฟล์ของฉัน" และแผงรายละเอียดในตาราง
 * workloadAvailable = false เมื่อผู้เรียกดูงานของคนนั้นไม่ได้ตาม RLS หน้าจอจะได้ไม่แสดงเลขศูนย์ปลอม
 */
async function respondWithProfile(
  c: Context<AppEnv>,
  technicianId: string,
  workloadAvailable: boolean,
) {
  const supabase = c.get('supabase');
  const admin = createAdminClient(c.env);
  const reqId = c.get('requestId');
  const now = new Date();

  const [categoriesResult, skillsResult, canManage] = await Promise.all([
    loadCategories(supabase),
    admin.from('technician_skills').select(SKILL_SELECT).eq('technician_id', technicianId),
    hasPermission(c, 'technician_skill.manage'),
  ]);
  if (categoriesResult.error) return dbFailJson(c, 'TICKET_CATEGORIES_LOAD_FAILED', categoriesResult.error, 'โหลดหมวดหมู่งานไม่สำเร็จ');
  if (skillsResult.error) return dbFailJson(c, 'TECHNICIAN_SKILLS_LOAD_FAILED', skillsResult.error, 'โหลดตารางทักษะไม่สำเร็จ');

  const [openResult, closedResult] = workloadAvailable
    ? await Promise.all([loadOpenTickets(supabase, technicianId), loadClosedTickets(supabase, technicianId, now)])
    : [null, null];
  if (openResult?.error) return dbFailJson(c, 'TECHNICIAN_WORKLOAD_LOAD_FAILED', openResult.error, 'โหลดภาระงานไม่สำเร็จ');
  if (closedResult?.error) return dbFailJson(c, 'TECHNICIAN_PERFORMANCE_LOAD_FAILED', closedResult.error, 'โหลดผลงานย้อนหลังไม่สำเร็จ');

  const payload: ProfilePayload = {
    ...buildTechnicianSkillProfile({
      technicianId,
      categories: (categoriesResult.data ?? []) as Row[],
      skills: (skillsResult.data ?? []) as Row[],
      openTickets: (openResult?.data ?? []) as Row[],
      closedTickets: (closedResult?.data ?? []) as Row[],
      now,
      months: PERFORMANCE_MONTHS,
    }),
    levels: SKILL_LEVELS,
    workloadAvailable,
    canManage,
    generatedAt: now.toISOString(),
  };
  return c.json(ok(reqId, payload));
}

/**
 * ทักษะและภาระงานของตนเอง — ไม่ต้องมีสิทธิ์พิเศษ เพราะ RLS ให้เจ้าตัวอ่านผลประเมินของตนเองอยู่แล้ว
 * และ Ticket ที่ตนเองรับผิดชอบก็อ่านได้ตาม policy ของ tickets
 */
technicianSkillsRoute.get('/me', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json(fail(c.get('requestId'), 'UNAUTHORIZED', 'ไม่พบบัญชีผู้ใช้ของคำขอนี้'), 401);
  return respondWithProfile(c, userId, true);
});

technicianSkillsRoute.get('/:technicianId', requirePermission('technician_skill.view'), async (c) => {
  const technicianId = c.req.param('technicianId') ?? '';
  if (!technicianId) return c.json(fail(c.get('requestId'), 'TECHNICIAN_ID_REQUIRED', 'ไม่ได้ระบุเจ้าหน้าที่'), 400);
  const workloadAvailable = technicianId === c.get('userId') || (await hasPermission(c, 'ticket.view_all'));
  return respondWithProfile(c, technicianId, workloadAvailable);
});

/**
 * บันทึกผลประเมินของเจ้าหน้าที่หนึ่งคน — ส่งมาเฉพาะหมวดหมู่ที่ต้องการเปลี่ยน
 * level = null แปลว่า "ถอนผลประเมิน" (ลบแถว) กลับไปเป็น "ยังไม่ประเมิน" ไม่ใช่บันทึกระดับ 0
 */
technicianSkillsRoute.put(
  '/:technicianId',
  requirePermission('technician_skill.manage'),
  zValidator('json', saveTechnicianSkillsSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const admin = createAdminClient(c.env);
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const technicianId = c.req.param('technicianId') ?? '';
    const { skills } = c.req.valid('json');
    if (!technicianId) return c.json(fail(reqId, 'TECHNICIAN_ID_REQUIRED', 'ไม่ได้ระบุเจ้าหน้าที่'), 400);

    const technicianResult = await admin.from('profiles').select('id, status').eq('id', technicianId).maybeSingle();
    if (technicianResult.error) return dbFailJson(c, 'TECHNICIAN_LOAD_FAILED', technicianResult.error, 'ตรวจสอบบัญชีเจ้าหน้าที่ไม่สำเร็จ');
    if (!technicianResult.data) return c.json(fail(reqId, 'TECHNICIAN_NOT_FOUND', 'ไม่พบบัญชีเจ้าหน้าที่คนนี้'), 404);
    if (technicianResult.data.status !== 'active') {
      return c.json(fail(reqId, 'TECHNICIAN_INACTIVE', 'บัญชีนี้ถูกระงับแล้ว จึงบันทึกผลประเมินไม่ได้'), 409);
    }

    const beforeResult = await supabase.from('technician_skills').select(SKILL_SELECT).eq('technician_id', technicianId);
    if (beforeResult.error) return dbFailJson(c, 'TECHNICIAN_SKILLS_LOAD_FAILED', beforeResult.error, 'โหลดผลประเมินเดิมไม่สำเร็จ');

    const assessedAt = new Date().toISOString();
    const upsertRows = skills
      .filter((skill) => skill.level !== null)
      .map((skill) => ({
        technician_id: technicianId,
        category_id: skill.categoryId,
        level: skill.level,
        note: skill.note?.trim() ? skill.note.trim() : null,
        assessed_at: assessedAt,
        assessed_by: actorId ?? null,
        created_by: actorId ?? null,
        updated_by: actorId ?? null,
      }));
    const removedCategoryIds = skills.filter((skill) => skill.level === null).map((skill) => skill.categoryId);

    if (upsertRows.length) {
      const { error } = await supabase
        .from('technician_skills')
        .upsert(upsertRows, { onConflict: 'technician_id,category_id' });
      if (error) return dbFailJson(c, 'TECHNICIAN_SKILLS_SAVE_FAILED', error, 'บันทึกผลประเมินไม่สำเร็จ');
    }
    if (removedCategoryIds.length) {
      const { error } = await supabase
        .from('technician_skills')
        .delete()
        .eq('technician_id', technicianId)
        .in('category_id', removedCategoryIds);
      if (error) return dbFailJson(c, 'TECHNICIAN_SKILLS_DELETE_FAILED', error, 'ถอนผลประเมินไม่สำเร็จ');
    }

    const afterResult = await supabase.from('technician_skills').select(SKILL_SELECT).eq('technician_id', technicianId);
    if (afterResult.error) return dbFailJson(c, 'TECHNICIAN_SKILLS_LOAD_FAILED', afterResult.error, 'อ่านผลประเมินหลังบันทึกไม่สำเร็จ');

    // เก็บเฉพาะ "หมวดไหนเปลี่ยนเป็นระดับใด" ไม่เก็บบันทึกการประเมินซึ่งเป็นข้อความอิสระเกี่ยวกับบุคคล
    const levelsOf = (rows: Row[] | null) =>
      Object.fromEntries((rows ?? []).map((row) => [String(row.category_id), Number(row.level)]));

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'UPDATE',
      module: 'technician_skill',
      targetTable: 'technician_skills',
      targetId: technicianId,
      detail: { technicianId, assessed: upsertRows.length, removed: removedCategoryIds.length },
      before: levelsOf(beforeResult.data as Row[] | null),
      after: levelsOf(afterResult.data as Row[] | null),
      requestId: reqId,
    });

    return respondWithProfile(c, technicianId, technicianId === actorId || (await hasPermission(c, 'ticket.view_all')));
  },
);
