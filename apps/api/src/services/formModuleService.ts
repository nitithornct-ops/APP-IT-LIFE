import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

export const FORM_MODULE_KEYS = ['ticket', 'incident', 'change', 'contract', 'audit', 'risk', 'service_request', 'asset_borrow', 'custom'] as const;
export type FormModuleKey = (typeof FORM_MODULE_KEYS)[number];

export const FORM_MODULES: ReadonlyArray<{
  key: FormModuleKey;
  label: string;
  description: string;
  legacyTemplateCode: string;
}> = [
  {
    key: 'ticket',
    label: 'Ticket / งานแจ้งซ่อม',
    description: 'แบบฟอร์มหลักที่เติมข้อมูลจาก Ticket และใช้พิมพ์เอกสารงาน',
    legacyTemplateCode: 'IT-ERP-ISSUE',
  },
  {
    key: 'asset_borrow',
    label: 'ยืม / คืน Asset',
    description: 'แบบฟอร์มหลักสำหรับรายการยืมทรัพย์สิน',
    legacyTemplateCode: 'ASSET-BORROW',
  },
  { key: 'incident', label: 'Incident / เหตุการณ์', description: 'แบบฟอร์มสำหรับการจัดการ Incident', legacyTemplateCode: 'FORM-INCIDENT' },
  { key: 'change', label: 'Change / การเปลี่ยนแปลง', description: 'แบบฟอร์มสำหรับ Change Request', legacyTemplateCode: 'FORM-CHANGE' },
  { key: 'contract', label: 'Contract / สัญญา', description: 'แบบฟอร์มสำหรับ Contract', legacyTemplateCode: 'FORM-CONTRACT' },
  { key: 'audit', label: 'Audit / การตรวจสอบ', description: 'แบบฟอร์มสำหรับ Audit', legacyTemplateCode: 'FORM-AUDIT' },
  { key: 'risk', label: 'Risk / ความเสี่ยง', description: 'แบบฟอร์มสำหรับ Governance Risk', legacyTemplateCode: 'FORM-RISK' },
  { key: 'service_request', label: 'Service Request / คำขอบริการ', description: 'แบบฟอร์มสำหรับ Service Request', legacyTemplateCode: 'FORM-SERVICE-REQUEST' },
  { key: 'custom', label: 'Custom / Generic', description: 'แบบฟอร์มกลางที่ผูกกับ Record ใดก็ได้', legacyTemplateCode: 'FORM-CUSTOM' },
];

/** Resolve the module default while retaining a safe fallback for older databases. */
export async function resolveFormModuleTemplate<T extends Record<string, unknown>>(
  client: SupabaseClient,
  moduleKey: FormModuleKey,
  select: string,
  publishedOnly = false,
): Promise<{ data: T | null; error: PostgrestError | Error | null }> {
  const module = FORM_MODULES.find((item) => item.key === moduleKey);
  if (!module) return { data: null, error: new Error(`Unsupported form module: ${moduleKey}`) };

  const binding = await client
    .from('form_module_bindings')
    .select('template_id')
    .eq('module_key', moduleKey)
    .maybeSingle();
  if (binding.error) return { data: null, error: binding.error };

  let query = publishedOnly
    ? client.from('form_templates').select(select).eq('status', 'Published')
    : client.from('form_templates').select(select).neq('status', 'Archived');
  query = binding.data?.template_id
    ? query.eq('id', binding.data.template_id)
    : query.eq('template_code', module.legacyTemplateCode);
  const result = await query.maybeSingle();
  return { data: result.data as T | null, error: result.error };
}
