import type { SupabaseClient } from '@supabase/supabase-js';
import { Hono } from 'hono';
import { z } from 'zod';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { hasPermission } from '../middleware/permission';
import { writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';

export const MASTER_DATA_KINDS = [
  'department',
  'position',
  'ticket_category',
  'asset_category',
  'access_system',
  'cause_code',
] as const;

export type MasterDataKind = (typeof MASTER_DATA_KINDS)[number];

const kindSchema = z.enum(MASTER_DATA_KINDS);
const mergeSchema = z.object({
  targetId: z.string().uuid(),
  reason: z.string().trim().min(3).max(1000),
});

const importRowSchema = z.object({
  code: z.string().trim().min(2).max(50),
  name: z.string().trim().min(1).max(200),
  status: z.enum(['active', 'inactive']).default('active'),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(100),
});

const importSchema = z.object({
  kind: kindSchema,
  rows: z.array(importRowSchema).min(1).max(1000),
});

const PERMISSION_BY_KIND: Record<MasterDataKind, string> = {
  department: 'department.manage',
  position: 'position.manage',
  ticket_category: 'ticket_category.manage',
  asset_category: 'asset_category.manage',
  access_system: 'access_system.manage',
  cause_code: 'cause_code.manage',
};

const SOURCE_BY_KIND: Record<MasterDataKind, { table: string; path: string; label: string }> = {
  department: { table: 'departments', path: '/api/v1/departments', label: 'หน่วยงาน' },
  position: { table: 'positions', path: '/api/v1/positions', label: 'ตำแหน่ง' },
  ticket_category: { table: 'ticket_categories', path: '/api/v1/ticket-categories', label: 'หมวด Ticket' },
  asset_category: { table: 'asset_categories', path: '/api/v1/asset-categories', label: 'หมวด Asset' },
  access_system: { table: 'access_systems', path: '/api/v1/access-systems', label: 'ระบบงาน' },
  cause_code: { table: 'ticket_cause_codes', path: '/api/v1/cause-codes', label: 'รหัสสาเหตุ' },
};

interface UsageDefinition {
  kind: MasterDataKind;
  column: string;
  table: string;
  label: string;
}

const USAGE_DEFINITIONS: UsageDefinition[] = [
  { kind: 'department', table: 'profiles', column: 'department_id', label: 'ผู้ใช้' },
  { kind: 'department', table: 'employees', column: 'department_id', label: 'พนักงาน' },
  { kind: 'department', table: 'departments', column: 'parent_department_id', label: 'หน่วยงานย่อย' },
  { kind: 'department', table: 'approval_groups', column: 'department_id', label: 'Approval Groups' },
  { kind: 'department', table: 'service_catalog', column: 'fulfillment_group_id', label: 'Service Catalog' },
  { kind: 'department', table: 'service_requests', column: 'assigned_group_id', label: 'Service Requests' },
  { kind: 'department', table: 'service_request_tasks', column: 'owner_group_id', label: 'Service Tasks' },
  { kind: 'department', table: 'assets', column: 'department_id', label: 'Assets' },
  { kind: 'department', table: 'tickets', column: 'department_id', label: 'Tickets' },
  { kind: 'position', table: 'profiles', column: 'position_id', label: 'ผู้ใช้' },
  { kind: 'position', table: 'employees', column: 'position_id', label: 'พนักงาน' },
  { kind: 'ticket_category', table: 'tickets', column: 'category_id', label: 'Tickets' },
  { kind: 'ticket_category', table: 'knowledge_articles', column: 'category_id', label: 'Knowledge Base' },
  { kind: 'ticket_category', table: 'ticket_subcategories', column: 'category_id', label: 'Subcategories' },
  { kind: 'ticket_category', table: 'technician_skills', column: 'category_id', label: 'ทักษะช่าง' },
  { kind: 'ticket_category', table: 'ticket_cause_codes', column: 'category_id', label: 'รหัสสาเหตุ' },
  { kind: 'asset_category', table: 'assets', column: 'category_id', label: 'Assets' },
  { kind: 'access_system', table: 'access_requests', column: 'system_id', label: 'Access Requests' },
  { kind: 'access_system', table: 'user_access_registry', column: 'system_id', label: 'Access Registry' },
  { kind: 'access_system', table: 'access_control_items', column: 'system_id', label: 'RBAC Items' },
  { kind: 'access_system', table: 'access_certification_campaigns', column: 'system_id', label: 'Certification Campaigns' },
  { kind: 'access_system', table: 'access_certification_items', column: 'system_id', label: 'Certification Items' },
  { kind: 'cause_code', table: 'tickets', column: 'cause_code_id', label: 'Tickets' },
];

interface UsageItem {
  key: string;
  label: string;
  count: number;
}

interface RegistryRow {
  id: string;
  kind: MasterDataKind;
  kind_label: string;
  source_table: string;
  source_path: string;
  permission: string;
  code: string;
  name: string;
  status: 'active' | 'inactive';
  effective_date: string;
  sort_order: number;
  used_by: UsageItem[];
  used_by_count: number;
  created_at: string;
}

const KIND_LABELS: Record<MasterDataKind, string> = {
  department: 'หน่วยงาน',
  position: 'ตำแหน่ง',
  ticket_category: 'หมวด Ticket',
  asset_category: 'หมวด Asset',
  access_system: 'ระบบงาน',
  cause_code: 'รหัสสาเหตุ',
};

function codeOf(row: Record<string, unknown>, kind: MasterDataKind): string {
  if (kind === 'asset_category') return String(row.code ?? row.code_prefix ?? '');
  if (kind === 'cause_code') return String(row.code ?? '');
  return String(row.code ?? '');
}

function nameOf(row: Record<string, unknown>, kind: MasterDataKind): string {
  if (kind === 'department' || kind === 'position') return String(row.name_th ?? '');
  return String(row.name ?? '');
}

function statusOf(row: Record<string, unknown>, kind: MasterDataKind): 'active' | 'inactive' {
  if (kind === 'cause_code') return row.is_active === false ? 'inactive' : 'active';
  return row.status === 'inactive' ? 'inactive' : 'active';
}

function idKey(kind: MasterDataKind, id: string): string {
  return `${kind}:${id}`;
}

async function readUsage(client: SupabaseClient): Promise<Map<string, UsageItem[]>> {
  const usage = new Map<string, UsageItem[]>();
  const results = await Promise.all(USAGE_DEFINITIONS.map(async (definition) => {
    const { data, error } = await client.from(definition.table).select(definition.column);
    if (error) throw error;
    return { definition, rows: (data ?? []) as unknown as Array<Record<string, unknown>> };
  }));

  for (const { definition, rows } of results) {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const id = row[definition.column];
      if (typeof id !== 'string' || !id) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const [id, count] of counts) {
      const key = idKey(definition.kind, id);
      const current = usage.get(key) ?? [];
      current.push({ key: `${definition.table}.${definition.column}`, label: definition.label, count });
      usage.set(key, current);
    }
  }
  return usage;
}

export const masterDataRegistryRoute = new Hono<AppEnv>();
masterDataRegistryRoute.use('*', requireAuth);

masterDataRegistryRoute.get('/', async (c) => {
  const requestId = c.get('requestId');
  const admin = createAdminClient(c.env);
  let queries: Array<{ kind: MasterDataKind; rows: Array<Record<string, unknown>> }>;
  try {
    queries = await Promise.all(MASTER_DATA_KINDS.map(async (kind) => {
      const source = SOURCE_BY_KIND[kind];
      const { data, error } = await admin.from(source.table).select('*');
      if (error) throw error;
      return { kind, rows: (data ?? []) as unknown as Array<Record<string, unknown>> };
    }));
  } catch (error) {
    return dbFailJson(c, 'MASTER_DATA_REGISTRY_FAILED', error as { message?: string; code?: string; details?: string; hint?: string });
  }

  let usage: Map<string, UsageItem[]>;
  try {
    usage = await readUsage(admin);
  } catch (error) {
    return dbFailJson(c, 'MASTER_DATA_USAGE_FAILED', error as { message?: string; code?: string; details?: string; hint?: string });
  }

  const rows: RegistryRow[] = queries.flatMap(({ kind, rows: sourceRows }) => sourceRows.map((row) => {
    const id = String(row.id);
    const usedBy = usage.get(idKey(kind, id)) ?? [];
    return {
      id,
      kind,
      kind_label: KIND_LABELS[kind],
      source_table: SOURCE_BY_KIND[kind].table,
      source_path: SOURCE_BY_KIND[kind].path,
      permission: PERMISSION_BY_KIND[kind],
      code: codeOf(row, kind),
      name: nameOf(row, kind),
      status: statusOf(row, kind),
      effective_date: String(row.effective_date ?? row.created_at ?? ''),
      sort_order: Number(row.sort_order ?? 100),
      used_by: usedBy,
      used_by_count: usedBy.reduce((sum, item) => sum + item.count, 0),
      created_at: String(row.created_at ?? ''),
    };
  }));

  rows.sort((left, right) => left.sort_order - right.sort_order || left.kind_label.localeCompare(right.kind_label, 'th') || left.name.localeCompare(right.name, 'th'));
  return c.json(ok(requestId, rows));
});

masterDataRegistryRoute.post('/import', async (c) => {
  const requestId = c.get('requestId');
  const parsed = await c.req.json().catch(() => null);
  const body = importSchema.safeParse(parsed);
  if (!body.success) return c.json(fail(requestId, 'MASTER_DATA_IMPORT_INVALID', 'ไฟล์นำเข้าไม่ถูกต้อง กรุณาตรวจสอบ Code, Name และรูปแบบวันที่'), 400);

  const { kind, rows } = body.data;
  const permission = PERMISSION_BY_KIND[kind];
  if (!(await hasPermission(c, permission))) return c.json(fail(requestId, 'PERMISSION_DENIED', 'ท่านไม่มีสิทธิ์นำเข้า Master Data ชนิดนี้'), 403);

  const source = SOURCE_BY_KIND[kind];
  const admin = createAdminClient(c.env);
  const records = rows.map((row) => {
    const base = {
      code: row.code.toUpperCase(),
      effective_date: row.effectiveDate ?? new Date().toISOString().slice(0, 10),
      sort_order: row.sortOrder,
      updated_by: c.get('userId'),
      created_by: c.get('userId'),
    } as Record<string, unknown>;

    if (kind === 'department' || kind === 'position') {
      return { ...base, name_th: row.name, status: row.status, ...(kind === 'department' ? { parent_department_id: null } : {}) };
    }
    const named = { ...base, name: row.name, status: row.status };
    if (kind === 'asset_category') return { ...named, code_prefix: row.code.toUpperCase() };
    if (kind === 'cause_code') return { ...named, description: null, category_id: null, is_active: row.status === 'active' };
    return named;
  });

  const { data, error } = await admin.from(source.table).upsert(records, { onConflict: 'code' }).select('id, code');
  if (error) return dbFailJson(c, 'MASTER_DATA_IMPORT_FAILED', error, 'นำเข้า Master Data ไม่สำเร็จ กรุณาตรวจสอบรหัสซ้ำหรือข้อมูลที่อ้างอิงอยู่');

  await writeAuditLog(c.env, {
    actorId: c.get('userId'),
    actorEmail: c.get('userEmail'),
    action: 'IMPORT',
    module: 'master-data',
    targetTable: source.table,
    detail: { kind, count: rows.length, codes: rows.map((row) => row.code.toUpperCase()) },
    requestId,
  });

  return c.json(ok(requestId, { kind, importedCount: data?.length ?? rows.length }));
});

masterDataRegistryRoute.post('/:kind/:id/merge', async (c) => {
  const requestId = c.get('requestId');
  const kindResult = kindSchema.safeParse(c.req.param('kind'));
  const sourceIdResult = z.string().uuid().safeParse(c.req.param('id'));
  if (!kindResult.success || !sourceIdResult.success) return c.json(fail(requestId, 'MASTER_DATA_TARGET_INVALID', 'ไม่พบชนิดหรือรายการ Master Data ที่ระบุ'), 400);

  const parsed = mergeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(fail(requestId, 'MASTER_DATA_MERGE_INVALID', 'กรุณาเลือกรายการปลายทางและระบุเหตุผลอย่างน้อย 3 ตัวอักษร'), 400);

  const kind = kindResult.data;
  const sourceId = sourceIdResult.data;
  const permission = PERMISSION_BY_KIND[kind];
  if (!(await hasPermission(c, permission))) return c.json(fail(requestId, 'PERMISSION_DENIED', 'ท่านไม่มีสิทธิ์รวมรายการ Master Data ชนิดนี้'), 403);
  if (sourceId === parsed.data.targetId) return c.json(fail(requestId, 'MASTER_DATA_MERGE_SELF', 'รายการต้นทางและปลายทางต้องไม่ใช่รายการเดียวกัน'), 400);

  const admin = createAdminClient(c.env);
  const { data, error } = await admin.rpc('merge_master_data', {
    kind_input: kind,
    source_id_input: sourceId,
    target_id_input: parsed.data.targetId,
    actor_id_input: c.get('userId'),
    actor_email_input: c.get('userEmail'),
    reason_input: parsed.data.reason,
    request_id_input: requestId,
  });
  if (error) {
    if (error.message.includes('MASTER_DATA_MERGE_CONFLICT')) return c.json(fail(requestId, 'MASTER_DATA_MERGE_CONFLICT', 'รวมรายการไม่ได้ เพราะรายการปลายทางมีข้อมูลย่อยรหัสเดียวกันอยู่แล้ว'), 409);
    if (error.message.includes('MASTER_DATA_NOT_FOUND')) return c.json(fail(requestId, 'MASTER_DATA_NOT_FOUND', 'ไม่พบรายการ Master Data ต้นทางหรือปลายทาง'), 404);
    return dbFailJson(c, 'MASTER_DATA_MERGE_FAILED', error, 'รวมรายการ Master Data ไม่สำเร็จ');
  }

  return c.json(ok(requestId, data));
});

masterDataRegistryRoute.get('/:kind/:id/audit-history', async (c) => {
  const requestId = c.get('requestId');
  const kindResult = kindSchema.safeParse(c.req.param('kind'));
  const idResult = z.string().uuid().safeParse(c.req.param('id'));
  if (!kindResult.success || !idResult.success) return c.json(fail(requestId, 'MASTER_DATA_TARGET_INVALID', 'ไม่พบรายการ Master Data ที่ระบุ'), 400);
  if (!(await hasPermission(c, 'audit.view'))) return c.json(fail(requestId, 'PERMISSION_DENIED', 'ท่านไม่มีสิทธิ์ดู Audit History'), 403);

  const source = SOURCE_BY_KIND[kindResult.data];
  const { data, error } = await c.get('supabase')
    .from('audit_logs')
    .select('id, action, module, target_table, target_id, actor_email, detail, result, request_id, created_at')
    .eq('target_table', source.table)
    .eq('target_id', idResult.data)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return dbFailJson(c, 'MASTER_DATA_AUDIT_HISTORY_FAILED', error);
  return c.json(ok(requestId, data ?? []));
});
