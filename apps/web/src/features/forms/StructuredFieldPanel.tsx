import { useMemo } from 'react';
import { type FormFieldDefinition } from '../../types/forms';

const fieldClass = 'mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white';

function visible(field: FormFieldDefinition, values: Record<string, unknown>): boolean {
  if (!field.condition) return true;
  const actual = values[field.condition.fieldKey] == null ? '' : String(values[field.condition.fieldKey]);
  const expected = field.condition.value ?? '';
  if (field.condition.operator === 'equals') return actual === expected;
  if (field.condition.operator === 'not_equals') return actual !== expected;
  if (field.condition.operator === 'contains') return actual.toLowerCase().includes(expected.toLowerCase());
  return actual.trim().length > 0;
}

export function StructuredFieldPanel({ schema, values, onChange, readOnly = false }: { schema: FormFieldDefinition[]; values: Record<string, unknown>; onChange: (values: Record<string, unknown>) => void; readOnly?: boolean }) {
  const visibleFields = useMemo(() => schema.filter((field) => visible(field, values)), [schema, values]);
  if (!schema.length) return null;
  const setValue = (key: string, value: unknown) => onChange({ ...values, [key]: value });
  return <section className="rounded-xl border border-primary-200 bg-primary-50/60 p-4 dark:border-primary-900 dark:bg-primary-950/20" data-testid="structured-field-panel">
    <div><h3 className="font-bold text-slate-900 dark:text-white">ข้อมูลแบบ Structured</h3><p className="text-xs text-slate-500">ฟิลด์ที่เป็น Required และเงื่อนไขจะแสดงตาม Schema ของ Template</p></div>
    <div className="mt-4 grid gap-4 md:grid-cols-2">{visibleFields.map((field) => <label key={field.key} className={`text-sm font-semibold ${field.type === 'textarea' ? 'md:col-span-2' : ''}`}>
      <span>{field.label}{field.required && <span className="ml-1 text-red-600">*</span>}</span>
      {field.helpText && <span className="mt-1 block text-xs font-normal text-slate-500">{field.helpText}</span>}
      {field.type === 'textarea' && <textarea disabled={readOnly} rows={3} value={String(values[field.key] ?? '')} onChange={(event) => setValue(field.key, event.target.value)} className={fieldClass} />}
      {field.type === 'select' && <select disabled={readOnly} value={String(values[field.key] ?? '')} onChange={(event) => setValue(field.key, event.target.value)} className={fieldClass}><option value="">— เลือก —</option>{(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}</select>}
      {field.type === 'checkbox' && <span className="mt-2 flex items-center gap-2"><input type="checkbox" disabled={readOnly} checked={values[field.key] === true} onChange={(event) => setValue(field.key, event.target.checked)} /><span className="text-sm font-normal">ยืนยันรายการนี้</span></span>}
      {(field.type === 'text' || field.type === 'number' || field.type === 'date' || field.type === 'acknowledgement' || field.type === 'signature') && <input type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} disabled={readOnly} value={String(values[field.key] ?? '')} onChange={(event) => setValue(field.key, event.target.value)} className={fieldClass} />}
    </label>)}</div>
  </section>;
}
