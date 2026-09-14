export type FormFieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox' | 'acknowledgement' | 'signature';

export interface FormFieldDefinition {
  key: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  options?: string[];
  helpText?: string;
  condition?: { fieldKey: string; operator: 'equals' | 'not_equals' | 'contains' | 'not_empty'; value?: string };
}

function textValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return value == null ? '' : String(value);
}

export function isFieldVisible(field: FormFieldDefinition, values: Record<string, unknown>): boolean {
  const condition = field.condition;
  if (!condition) return true;
  const actual = textValue(values[condition.fieldKey]);
  const expected = condition.value ?? '';
  switch (condition.operator) {
    case 'equals': return actual === expected;
    case 'not_equals': return actual !== expected;
    case 'contains': return actual.toLowerCase().includes(expected.toLowerCase());
    case 'not_empty': return actual.trim().length > 0;
  }
}

export function missingRequiredFields(schema: unknown, values: Record<string, unknown>): FormFieldDefinition[] {
  if (!Array.isArray(schema)) return [];
  return schema.filter((item): item is FormFieldDefinition => {
    if (!item || typeof item !== 'object') return false;
    const field = item as Partial<FormFieldDefinition>;
    if (typeof field.key !== 'string' || typeof field.label !== 'string' || field.required !== true) return false;
    if (!isFieldVisible(field as FormFieldDefinition, values)) return false;
    const value = values[field.key];
    if (field.type === 'checkbox') return value !== true;
    return textValue(value).trim().length === 0;
  });
}

/** Canonical enough for evidence hashes: object key order is stable and arrays keep their order. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export async function sha256Hex(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(value)));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
