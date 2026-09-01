import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { hasPermission } from '../middleware/permission';
import type { AppEnv } from '../types';
import { ok } from '../utils/response';
import { cleanSearch } from '../utils/search';
import { zodValidationHook } from '../utils/validation';
import { searchQuerySchema } from '../validators/search';

/**
 * ค้นหาข้ามโมดูลสำหรับกล่องค้นหาด่วน (Ctrl+K)
 *
 * เดิมกล่องนั้นค้นได้แค่ "ชื่อเมนู" ผู้ใช้ที่ถือกระดาษที่เขียนว่า TCK-1042 อยู่ในมือจึงต้องเดาเองว่า
 * เลขนี้อยู่โมดูลไหน แล้วเปิดหน้านั้นไปค้นซ้ำอีกที ทั้งที่รู้เลขที่ของสิ่งที่ตามหาอยู่แล้ว
 */
export const searchRoute = new Hono<AppEnv>();
searchRoute.use('*', requireAuth);

/** จำนวนผลต่อโมดูล — กล่องค้นหาด่วนมีไว้ให้กระโดดไปให้ถูกที่ ไม่ใช่แทนหน้ารายการ */
const RESULTS_PER_MODULE = 5;

export interface SearchResultItem {
  id: string;
  title: string;
  subtitle: string;
  path: string;
}

export interface SearchResultGroup {
  module: string;
  label: string;
  items: SearchResultItem[];
}

searchRoute.get('/', zValidator('query', searchQuerySchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const safe = cleanSearch(c.req.valid('query').q);
  if (!safe) return c.json(ok(reqId, { groups: [] as SearchResultGroup[] }));

  /**
   * ตรวจสิทธิ์ก่อนค้น ไม่พึ่ง RLS อย่างเดียว
   *
   * RLS ของบางตารางกว้างกว่าสิทธิ์ที่หน้าเว็บใช้จริง (route ของ Asset และ Incident บังคับ
   * permission ไว้อีกชั้นหนึ่ง) ถ้าที่นี่ค้นโดยไม่ตรวจ กล่องค้นหาจะกลายเป็นทางลัดที่เห็น
   * ของที่เปิดหน้าตรง ๆ ไม่ได้
   *
   * Ticket ไม่มี permission ระดับ route — RLS (tickets_select_participant_or_staff) เป็นตัวตัดสิน
   * ว่าใครเห็นใบไหน ซึ่งตรงกับหน้ารายการอยู่แล้ว
   */
  const [canViewAsset, canViewIncident] = await Promise.all([
    hasPermission(c, 'asset.view'),
    hasPermission(c, 'incident.view'),
  ]);

  const [tickets, assets, incidents] = await Promise.all([
    supabase
      .from('tickets')
      .select('id, ticket_no, title, status, requester_name_snapshot')
      .or(`ticket_no.ilike.%${safe}%,title.ilike.%${safe}%,requester_name_snapshot.ilike.%${safe}%`)
      .order('created_at', { ascending: false })
      .limit(RESULTS_PER_MODULE),
    canViewAsset
      ? supabase
        .from('assets')
        .select('id, asset_code, name, status, location')
        .or(`asset_code.ilike.%${safe}%,name.ilike.%${safe}%,serial_number.ilike.%${safe}%`)
        .order('asset_code', { ascending: true })
        .limit(RESULTS_PER_MODULE)
      : null,
    canViewIncident
      ? supabase
        .from('incidents')
        .select('id, incident_number, title, status, severity')
        .is('archived_at', null)
        .or(`incident_number.ilike.%${safe}%,title.ilike.%${safe}%`)
        .order('report_date', { ascending: false })
        .limit(RESULTS_PER_MODULE)
      : null,
  ]);

  const groups: SearchResultGroup[] = [];

  // ตารางที่ query ล้มจะถูกข้ามไปเงียบ ๆ เพราะกล่องค้นหาด่วนที่พังทั้งกล่องเพราะโมดูลเดียวมีปัญหา
  // แย่กว่ากล่องที่คืนผลของโมดูลที่ยังใช้ได้
  const ticketRows = (tickets?.data ?? []) as Record<string, unknown>[];
  if (ticketRows.length > 0) {
    groups.push({
      module: 'ticket',
      label: 'ใบงาน',
      items: ticketRows.map((row) => ({
        id: String(row.id),
        title: `${String(row.ticket_no ?? '')} · ${String(row.title ?? '')}`.trim(),
        subtitle: [row.status, row.requester_name_snapshot].filter(Boolean).map(String).join(' · '),
        path: `/tickets/${String(row.id)}`,
      })),
    });
  }

  const assetRows = (assets?.data ?? []) as Record<string, unknown>[];
  if (assetRows.length > 0) {
    groups.push({
      module: 'asset',
      label: 'ทรัพย์สิน',
      items: assetRows.map((row) => ({
        id: String(row.id),
        title: `${String(row.asset_code ?? '')} · ${String(row.name ?? '')}`.trim(),
        subtitle: [row.status, row.location].filter(Boolean).map(String).join(' · '),
        path: `/assets/${String(row.id)}`,
      })),
    });
  }

  const incidentRows = (incidents?.data ?? []) as Record<string, unknown>[];
  if (incidentRows.length > 0) {
    groups.push({
      module: 'incident',
      label: 'Incident',
      items: incidentRows.map((row) => ({
        id: String(row.id),
        title: `${String(row.incident_number ?? '')} · ${String(row.title ?? '')}`.trim(),
        subtitle: [row.status, row.severity].filter(Boolean).map(String).join(' · '),
        path: `/incidents/${String(row.id)}`,
      })),
    });
  }

  return c.json(ok(reqId, { groups }));
});
