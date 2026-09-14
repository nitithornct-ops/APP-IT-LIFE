import { toCsv } from '@itlife/shared';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission, requirePermission } from '../middleware/permission';
import { writeAuditLog } from '../services/auditService';
import { sendNotification } from '../services/notificationService';
import type { AppEnv } from '../types';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import {
  accessCertificationDecisionsSchema,
  accessCertificationEscalationSchema,
  accessCertificationSignOffSchema,
  createAccessCertificationCampaignSchema,
} from '../validators/accessCertificationCampaigns';

export const accessCertificationCampaignsRoute = new Hono<AppEnv>();
accessCertificationCampaignsRoute.use('*', requireAuth);

const CAN_VIEW_CAMPAIGNS = ['access_registry.manage', 'access_registry.review', 'audit.view'];
const CAN_DECIDE_CAMPAIGNS = ['access_registry.manage', 'access_registry.review'];

type CampaignStatus = 'open' | 'overdue' | 'completed' | 'cancelled';

interface CampaignDbRow {
  id: string;
  campaign_code: string;
  name: string;
  system_id: string | null;
  reviewer_id: string;
  due_date: string;
  status: Exclude<CampaignStatus, 'overdue'>;
  evidence_snapshot: Record<string, unknown>;
  signed_off_by: string | null;
  signed_off_at: string | null;
  sign_off_note: string | null;
  escalated_to: string | null;
  escalated_at: string | null;
  escalation_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  reviewer: { id: string; full_name: string; email: string } | null;
  system: { id: string; name: string } | null;
}

interface CampaignItemDbRow {
  id: string;
  campaign_id: string;
  registry_id: string | null;
  user_id: string | null;
  system_id: string;
  access_item_id: string | null;
  access_level: string | null;
  permission_actions: string[];
  data_classification: string | null;
  privileged_access: boolean;
  evidence_snapshot: Record<string, unknown>;
  status: 'pending' | 'approved' | 'revoked';
  decision_note: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  user: { full_name: string; email: string } | null;
  system: { name: string } | null;
  access_control_item: { kind: string; code: string; name: string } | null;
}

interface CampaignStats {
  totalUsers: number;
  totalEntitlements: number;
  approved: number;
  revoked: number;
  pending: number;
  completionPercentage: number;
}

type CampaignPayload = Omit<CampaignDbRow, 'status'> & {
  status: CampaignStatus;
  is_overdue: boolean;
  stats: CampaignStats;
  items?: CampaignItemDbRow[];
};

function isOverdue(campaign: Pick<CampaignDbRow, 'status' | 'due_date'>): boolean {
  return campaign.status === 'open' && campaign.due_date < new Date().toISOString().slice(0, 10);
}

function campaignStats(items: CampaignItemDbRow[]): CampaignStats {
  const totalEntitlements = items.length;
  const approved = items.filter((item) => item.status === 'approved').length;
  const revoked = items.filter((item) => item.status === 'revoked').length;
  const pending = items.filter((item) => item.status === 'pending').length;
  const totalUsers = new Set(items.map((item) => item.user_id ?? String(item.evidence_snapshot.userId ?? ''))).size;
  return {
    totalUsers,
    totalEntitlements,
    approved,
    revoked,
    pending,
    completionPercentage: totalEntitlements === 0 ? 0 : Math.round(((approved + revoked) / totalEntitlements) * 100),
  };
}

function decorateCampaign(campaign: CampaignDbRow, items: CampaignItemDbRow[], includeItems = false): CampaignPayload {
  const overdue = isOverdue(campaign);
  return {
    ...campaign,
    status: overdue ? 'overdue' : campaign.status,
    is_overdue: overdue,
    stats: campaignStats(items),
    ...(includeItems ? { items } : {}),
  };
}

async function loadCampaign(c: Context<AppEnv>, id: string, includeItems = true) {
  const supabase = c.get('supabase');
  const { data: campaign, error: campaignError } = await supabase
    .from('access_certification_campaigns')
    .select('*, reviewer:profiles!access_certification_campaigns_reviewer_id_fkey(id, full_name, email), system:access_systems(id, name)')
    .eq('id', id)
    .maybeSingle();
  if (campaignError) return { error: campaignError };
  if (!campaign) return { campaign: null };

  const { data: itemData, error: itemError } = await supabase
    .from('access_certification_items')
    .select('*, user:profiles!access_certification_items_user_id_fkey(full_name, email), system:access_systems(name), access_control_item:access_control_items!access_certification_items_access_item_id_fkey(kind, code, name)')
    .eq('campaign_id', id)
    .order('created_at', { ascending: true });
  if (itemError) return { error: itemError };

  return {
    campaign: decorateCampaign(
      campaign as unknown as CampaignDbRow,
      (itemData ?? []) as unknown as CampaignItemDbRow[],
      includeItems,
    ),
  };
}

accessCertificationCampaignsRoute.get('/options', requirePermission('access_registry.manage'), async (c) => {
  const reqId = c.get('requestId');
  const supabase = createAdminClient(c.env);
  const [{ data: systems, error: systemsError }, { data: reviewers, error: reviewersError }] = await Promise.all([
    supabase.from('access_systems').select('id, name, status').eq('status', 'active').order('name', { ascending: true }),
    supabase.from('profiles').select('id, full_name, email, status').eq('status', 'active').order('full_name', { ascending: true }).limit(1000),
  ]);
  if (systemsError || reviewersError) return c.json(fail(reqId, 'ACCESS_CERTIFICATION_OPTIONS_FAILED', 'ดึงข้อมูลสำหรับเปิด Campaign ไม่สำเร็จ'), 400);
  return c.json(ok(reqId, { systems: systems ?? [], reviewers: reviewers ?? [] }));
});

accessCertificationCampaignsRoute.get('/', requireAnyPermission(CAN_VIEW_CAMPAIGNS), async (c) => {
  const reqId = c.get('requestId');
  const supabase = c.get('supabase');
  const { data: campaigns, error: campaignError } = await supabase
    .from('access_certification_campaigns')
    .select('*, reviewer:profiles!access_certification_campaigns_reviewer_id_fkey(id, full_name, email), system:access_systems(id, name)')
    .order('created_at', { ascending: false });
  if (campaignError) return dbFailJson(c, 'ACCESS_CERTIFICATION_LIST_FAILED', campaignError, 'ดึงรายการ Access Certification Campaign ไม่สำเร็จ');

  const ids = (campaigns ?? []).map((campaign) => campaign.id as string);
  const { data: itemData, error: itemError } = ids.length
    ? await supabase.from('access_certification_items').select('id, campaign_id, user_id, status, evidence_snapshot').in('campaign_id', ids)
    : { data: [], error: null };
  if (itemError) return dbFailJson(c, 'ACCESS_CERTIFICATION_ITEMS_LIST_FAILED', itemError, 'ดึงสรุปผลการทบทวนไม่สำเร็จ');

  const itemsByCampaign = new Map<string, CampaignItemDbRow[]>();
  for (const item of (itemData ?? []) as unknown as CampaignItemDbRow[]) {
    const list = itemsByCampaign.get(item.campaign_id) ?? [];
    list.push(item);
    itemsByCampaign.set(item.campaign_id, list);
  }
  const result = (campaigns ?? []).map((campaign) => decorateCampaign(
    campaign as unknown as CampaignDbRow,
    itemsByCampaign.get(campaign.id as string) ?? [],
  ));
  return c.json(ok(reqId, result));
});

accessCertificationCampaignsRoute.post(
  '/',
  requirePermission('access_registry.manage'),
  zValidator('json', createAccessCertificationCampaignSchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const body = c.req.valid('json');
    const { data: campaignId, error } = await c.get('supabase').rpc('create_access_certification_campaign', {
      p_campaign_code: body.code,
      p_name: body.name,
      p_system_id: body.systemId ?? null,
      p_reviewer_id: body.reviewerId,
      p_due_date: body.dueDate,
    });
    if (error) return dbFailJson(c, 'ACCESS_CERTIFICATION_CREATE_FAILED', error, 'เปิด Access Certification Campaign ไม่สำเร็จ');

    const loaded = await loadCampaign(c, String(campaignId), true);
    if (loaded.error) return dbFailJson(c, 'ACCESS_CERTIFICATION_LOAD_FAILED', loaded.error, 'เปิด Campaign แล้วแต่โหลดข้อมูลไม่สำเร็จ');
    if (!loaded.campaign) return c.json(fail(reqId, 'ACCESS_CERTIFICATION_NOT_FOUND', 'ไม่พบ Campaign ที่สร้าง'), 404);
    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'CREATE_ACCESS_CERTIFICATION_CAMPAIGN',
      module: 'access_certification',
      targetTable: 'access_certification_campaigns',
      targetId: String(campaignId),
      detail: { campaignCode: body.code, systemId: body.systemId ?? null, reviewerId: body.reviewerId, dueDate: body.dueDate, itemCount: loaded.campaign.stats.totalEntitlements },
      requestId: reqId,
    });
    return c.json(ok(reqId, loaded.campaign), 201);
  },
);

accessCertificationCampaignsRoute.get('/:id/export', requireAnyPermission(CAN_VIEW_CAMPAIGNS), async (c) => {
  const reqId = c.get('requestId');
  const id = c.req.param('id');
  const loaded = await loadCampaign(c, id, true);
  if (loaded.error) return dbFailJson(c, 'ACCESS_CERTIFICATION_EXPORT_LOAD_FAILED', loaded.error, 'โหลดข้อมูลเพื่อ Export ไม่สำเร็จ');
  if (!loaded.campaign) return c.json(fail(reqId, 'ACCESS_CERTIFICATION_NOT_FOUND', 'ไม่พบ Campaign ที่ระบุ'), 404);

  const campaign = loaded.campaign;
  const rows: Array<Array<string | number | boolean | null>> = [
    ['Campaign', 'Campaign Code', 'System', 'Reviewer', 'Due Date', 'Campaign Status', 'User', 'User Email', 'RBAC Item', 'Access Level', 'Actions', 'Classification', 'Privileged', 'Registry Status', 'Decision', 'Decision Note', 'Decided At', 'Grant Date', 'Next Review Due'],
    ...(campaign.items ?? []).map((item) => {
      const snapshot = item.evidence_snapshot ?? {};
      return [
        campaign.name,
        campaign.campaign_code,
        campaign.system?.name ?? String(snapshot.systemName ?? 'ทุกระบบ'),
        campaign.reviewer?.full_name ?? '—',
        campaign.due_date,
        campaign.status,
        item.user?.full_name ?? String(snapshot.userName ?? '—'),
        item.user?.email ?? String(snapshot.userEmail ?? '—'),
        item.access_control_item?.name ?? String(snapshot.accessItemName ?? item.access_level ?? '—'),
        item.access_level ?? String(snapshot.accessLevel ?? '—'),
        item.permission_actions.join(', ') || String(snapshot.permissionActions ?? '—'),
        item.data_classification ?? String(snapshot.dataClassification ?? '—'),
        item.privileged_access,
        String(snapshot.registryStatus ?? '—'),
        item.status,
        item.decision_note,
        item.decided_at,
        String(snapshot.grantDate ?? '—'),
        String(snapshot.nextReviewDue ?? '—'),
      ];
    }),
  ];
  const filename = `access-certification-${campaign.campaign_code.toLowerCase()}.csv`;
  return c.json(ok(reqId, { filename, csv: toCsv(rows), rowCount: rows.length - 1 }));
});

accessCertificationCampaignsRoute.get('/:id', requireAnyPermission(CAN_VIEW_CAMPAIGNS), async (c) => {
  const reqId = c.get('requestId');
  const loaded = await loadCampaign(c, c.req.param('id'), true);
  if (loaded.error) return dbFailJson(c, 'ACCESS_CERTIFICATION_LOAD_FAILED', loaded.error, 'ดึงรายละเอียด Campaign ไม่สำเร็จ');
  if (!loaded.campaign) return c.json(fail(reqId, 'ACCESS_CERTIFICATION_NOT_FOUND', 'ไม่พบ Campaign ที่ระบุ'), 404);
  return c.json(ok(reqId, loaded.campaign));
});

accessCertificationCampaignsRoute.post(
  '/:id/decisions',
  requireAnyPermission(CAN_DECIDE_CAMPAIGNS),
  zValidator('json', accessCertificationDecisionsSchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const body = c.req.valid('json');
    const { data, error } = await c.get('supabase').rpc('decide_access_certification_items', {
      p_campaign_id: c.req.param('id'),
      p_decisions: body.decisions.map((decision) => ({ item_id: decision.itemId, decision_status: decision.status, decision_note: decision.note ?? null })),
    });
    if (error) return dbFailJson(c, 'ACCESS_CERTIFICATION_DECISION_FAILED', error, 'บันทึกผล Bulk Approve/Revoke ไม่สำเร็จ');
    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'DECIDE_ACCESS_CERTIFICATION_ITEMS',
      module: 'access_certification',
      targetTable: 'access_certification_campaigns',
      targetId: c.req.param('id'),
      detail: { decisions: body.decisions.length, result: data },
      requestId: reqId,
    });
    return c.json(ok(reqId, data));
  },
);

accessCertificationCampaignsRoute.post(
  '/:id/sign-off',
  requireAnyPermission(CAN_DECIDE_CAMPAIGNS),
  zValidator('json', accessCertificationSignOffSchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const body = c.req.valid('json');
    const { data, error } = await c.get('supabase').rpc('sign_off_access_certification_campaign', {
      p_campaign_id: c.req.param('id'),
      p_note: body.note ?? null,
    });
    if (error) return dbFailJson(c, 'ACCESS_CERTIFICATION_SIGNOFF_FAILED', error, 'ลงนามรับรอง Campaign ไม่สำเร็จ');
    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'SIGN_OFF_ACCESS_CERTIFICATION_CAMPAIGN',
      module: 'access_certification',
      targetTable: 'access_certification_campaigns',
      targetId: c.req.param('id'),
      detail: { note: body.note ?? null },
      requestId: reqId,
    });
    return c.json(ok(reqId, data));
  },
);

accessCertificationCampaignsRoute.post(
  '/:id/escalate',
  requirePermission('access_registry.manage'),
  zValidator('json', accessCertificationEscalationSchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const body = c.req.valid('json');
    const { data, error } = await c.get('supabase').rpc('escalate_access_certification_campaign', {
      p_campaign_id: c.req.param('id'),
      p_reason: body.reason,
    });
    if (error) return dbFailJson(c, 'ACCESS_CERTIFICATION_ESCALATION_FAILED', error, 'Escalate Campaign ไม่สำเร็จ');
    const escalation = data as { reviewerId?: string } | null;
    if (escalation?.reviewerId) {
      try {
        await sendNotification(c.env, {
          recipientId: escalation.reviewerId,
          type: 'access_certification_escalated',
          title: 'มี Access Certification Campaign เกินกำหนด',
          body: `Campaign ${c.req.param('id')} ถูก Escalate เพื่อขอการทบทวนสิทธิ์`,
          link: '/admin/access-registry',
        });
      } catch (notificationError) {
        console.error(JSON.stringify({ requestId: reqId, code: 'ACCESS_CERTIFICATION_ESCALATION_NOTIFICATION_FAILED', error: String(notificationError) }));
      }
    }
    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'ESCALATE_ACCESS_CERTIFICATION_CAMPAIGN',
      module: 'access_certification',
      targetTable: 'access_certification_campaigns',
      targetId: c.req.param('id'),
      detail: { reason: body.reason, result: data },
      requestId: reqId,
    });
    return c.json(ok(reqId, data));
  },
);
