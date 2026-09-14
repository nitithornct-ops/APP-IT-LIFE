import { Plus, Trash2 } from 'lucide-react';
import { type FormFieldDefinition, type FormFieldType } from '../../types/forms';

const fieldClass = 'mt-1 min-h-9 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none focus:border-primary-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white';

function nextKey(fields: FormFieldDefinition[]): string {
  let index = fields.length + 1;
  while (fields.some((field) => field.key === `field_${index}`)) index += 1;
  return `field_${index}`;
}

export function FieldSchemaBuilder({ value, onChange, readOnly = false }: { value: FormFieldDefinition[]; onChange: (value: FormFieldDefinition[]) => void; readOnly?: boolean }) {
  const addField = () => onChange([...value, { key: nextKey(value), label: `Field ${value.length + 1}`, type: 'text', required: false }]);
  const update = (index: number, patch: Partial<FormFieldDefinition>) => onChange(value.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field));
  const remove = (index: number) => onChange(value.filter((_, fieldIndex) => fieldIndex !== index));

  return <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800" data-testid="field-schema-builder">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="font-bold text-slate-900 dark:text-white">Structured Field Schema</h3><p className="text-xs text-slate-500">กำหนดชนิดข้อมูล, Required และเงื่อนไขการแสดงผลแยกจาก HTML</p></div>
      {!readOnly && <button type="button" onClick={addField} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-primary-300 px-3 text-sm font-semibold text-primary-700 hover:bg-primary-50 dark:border-primary-700 dark:text-primary-200"><Plus className="h-4 w-4" />เพิ่ม Field</button>}
    </div>
    {!value.length ? <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-500 dark:bg-slate-900">ยังไม่มี Structured Field — เอกสารนี้ยังใช้ HTML/Placeholder ได้ตามเดิม</p> : <div className="mt-4 space-y-3">{value.map((field, index) => <div key={`${field.key}-${index}`} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="grid gap-3 md:grid-cols-[1.1fr_1.4fr_1fr_auto]">
        <label className="text-xs font-semibold">Field key<input disabled={readOnly} value={field.key} onChange={(event) => update(index, { key: event.target.value.replace(/[^a-zA-Z0-9_]/g, '_') })} className={fieldClass} /></label>
        <label className="text-xs font-semibold">Label<input disabled={readOnly} value={field.label} onChange={(event) => update(index, { label: event.target.value })} className={fieldClass} /></label>
        <label className="text-xs font-semibold">ชนิดข้อมูล<select disabled={readOnly} value={field.type} onChange={(event) => update(index, { type: event.target.value as FormFieldType })} className={fieldClass}><option value="text">ข้อความสั้น</option><option value="textarea">ข้อความหลายบรรทัด</option><option value="number">ตัวเลข</option><option value="date">วันที่</option><option value="select">ตัวเลือก</option><option value="checkbox">Checkbox</option><option value="acknowledgement">Acknowledgement</option><option value="signature">Signature</option></select></label>
        {!readOnly && <button type="button" aria-label={`ลบ ${field.label}`} onClick={() => remove(index)} className="mt-5 inline-flex h-9 w-9 items-center justify-center rounded-lg text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>}
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" disabled={readOnly} checked={field.required} onChange={(event) => update(index, { required: event.target.checked })} />Required field</label>
        <label className="text-xs font-semibold md:col-span-2">ตัวเลือก (คั่นด้วย comma){field.type === 'select' && <input disabled={readOnly} value={(field.options ?? []).join(', ')} onChange={(event) => update(index, { options: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} className={fieldClass} placeholder="เช่น High, Medium, Low" />}</label>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_1.3fr]">
        <label className="text-xs font-semibold">แสดงเมื่อ Field<select disabled={readOnly} value={field.condition?.fieldKey ?? ''} onChange={(event) => update(index, { condition: event.target.value ? { fieldKey: event.target.value, operator: field.condition?.operator ?? 'equals', value: field.condition?.value ?? '' } : undefined })} className={fieldClass}><option value="">แสดงเสมอ</option>{value.filter((candidate) => candidate.key !== field.key).map((candidate) => <option key={candidate.key} value={candidate.key}>{candidate.label}</option>)}</select></label>
        <label className="text-xs font-semibold">เงื่อนไข{field.condition && <select disabled={readOnly} value={field.condition.operator} onChange={(event) => update(index, { condition: { ...field.condition!, operator: event.target.value as NonNullable<FormFieldDefinition['condition']>['operator'] } })} className={fieldClass}><option value="equals">เท่ากับ</option><option value="not_equals">ไม่เท่ากับ</option><option value="contains">มีข้อความ</option><option value="not_empty">ไม่ว่าง</option></select>}</label>
        <label className="text-xs font-semibold">ค่าที่ใช้เปรียบเทียบ{field.condition && field.condition.operator !== 'not_empty' && <input disabled={readOnly} value={field.condition.value ?? ''} onChange={(event) => update(index, { condition: { ...field.condition!, value: event.target.value } })} className={fieldClass} />}</label>
      </div>
      <label className="mt-3 block text-xs font-semibold">คำแนะนำเพิ่มเติม<input disabled={readOnly} value={field.helpText ?? ''} onChange={(event) => update(index, { helpText: event.target.value })} className={fieldClass} /></label>
    </div>)}</div>}
  </section>;
}
