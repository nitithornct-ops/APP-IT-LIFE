import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

export const FORM_MODULE_KEYS = ['ticket', 'asset_borrow'] as const;
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
