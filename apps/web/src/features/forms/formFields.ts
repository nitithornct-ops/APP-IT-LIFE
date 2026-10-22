import type { FormFieldDefinition } from '../../types/forms';

export function isFormFieldVisible(field: FormFieldDefinition, values: Record<string, unknown>): boolean {
  if (!field.condition) return true;
  const actual = values[field.condition.fieldKey] == null ? '' : String(values[field.condition.fieldKey]);
  const expected = field.condition.value ?? '';
  if (field.condition.operator === 'equals') return actual === expected;
  if (field.condition.operator === 'not_equals') return actual !== expected;
  if (field.condition.operator === 'contains') return actual.toLowerCase().includes(expected.toLowerCase());
  return actual.trim().length > 0;
}
