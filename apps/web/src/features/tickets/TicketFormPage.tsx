import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, CircleDot, Clock3, Loader2, MinusCircle, Printer } from 'lucide-react';
import { useEffect, useMemo, useState, type FocusEvent, type MouseEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { TicketFormDocument, TicketFormFlowState } from '../../types/tickets';
import { sanitizeFormHtml } from '../../utils/formHtml';

const flowAppearance: Record<TicketFormFlowState, { icon: typeof CheckCircle2; className: string; label: string }> = {
  complete: { icon: CheckCircle2, className: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200', label: 'เสร็จแล้ว' },
  current: { icon: CircleDot, className: 'border-primary-300 bg-primary-50 text-primary-800 ring-2 ring-primary-200 dark:border-primary-700 dark:bg-primary-950/40 dark:text-primary-200 dark:ring-primary-900', label: 'กำลังดำเนินการ' },
  pending: { icon: Clock3, className: 'border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400', label: 'รอดำเนินการ' },
  not_required: { icon: MinusCircle, className: 'border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-500', label: 'ไม่ใช้ในงานนี้' },
};

function checkedGlyphIndices(html: string): number[] {
  const indices: number[] = [];
  let index = 0;
  html.replace(/[☐☑]/g, (glyph) => {
    if (glyph === '☑') indices.push(index);
    index += 1;
    return glyph;
  });
  return indices;
}

function renderTicketFormFields(html: string, checkedItems: number[], textValues: Record<string, string>, editable: boolean): string {
  if (typeof DOMParser === 'undefined') return html;
  const documentNode = new DOMParser().parseFromString(html, 'text/html');
  const checked = new Set(checkedItems);
  let checkIndex = 0;
  let textIndex = 0;
  const walker = documentNode.createTreeWalker(documentNode.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  textNodes.forEach((textNode) => {
    const value = textNode.nodeValue ?? '';
    if (!/[☐☑—]/.test(value)) return;
    const fragment = documentNode.createDocumentFragment();
    value.split(/([☐☑—])/g).forEach((part) => {
      if (!part) return;
      if (part === '☐' || part === '☑') {
        const currentIndex = checkIndex;
        checkIndex += 1;
        const isChecked = checked.has(currentIndex);
        const element = documentNode.createElement(editable ? 'button' : 'span');
        element.className = `ticket-form-checkbox${editable ? '' : ' ticket-form-checkbox-readonly'}`;
        element.textContent = isChecked ? '☑' : '☐';
        if (editable) {
          element.setAttribute('type', 'button');
          element.setAttribute('role', 'checkbox');
          element.setAttribute('aria-checked', String(isChecked));
          element.setAttribute('aria-label', `${isChecked ? 'ยกเลิกเครื่องหมาย' : 'ทำเครื่องหมาย'} รายการที่ ${currentIndex + 1}`);
          element.dataset.ticketCheckIndex = String(currentIndex);
        } else {
          element.setAttribute('aria-hidden', 'true');
        }
        fragment.append(element);
        return;
      }
      if (part === '—') {
        const currentIndex = textIndex;
        textIndex += 1;
        const element = documentNode.createElement('span');
        element.className = `ticket-form-text-field${editable ? '' : ' ticket-form-text-field-readonly'}`;
        element.textContent = textValues[String(currentIndex)] || '—';
        if (editable) {
          element.contentEditable = 'true';
          element.setAttribute('role', 'textbox');
          element.setAttribute('aria-label', `กรอกข้อความช่องที่ ${currentIndex + 1}`);
          element.setAttribute('spellcheck', 'true');
          element.dataset.ticketTextIndex = String(currentIndex);
        }
        fragment.append(element);
        return;
      }
      fragment.append(documentNode.createTextNode(part));
    });
    textNode.replaceWith(fragment);
  });
  return documentNode.body.innerHTML;
}

export function TicketFormPage() {
  const { id } = useParams<{ id: string }>();
  const [checkedItems, setCheckedItems] = useState<number[]>([]);
  const [textValues, setTextValues] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState('');
  const formQuery = useQuery({
    queryKey: ['tickets', id, 'form-document'],
    queryFn: () => apiFetch<TicketFormDocument>(`/api/v1/tickets/${id}/form-document`),
    enabled: Boolean(id),
  });
  const document = formQuery.data;
  const documentKey = document ? `${document.ticketId}:${document.template.id}:${document.template.version}` : '';
  const safeContentHtml = useMemo(() => sanitizeFormHtml(document?.contentHtml ?? ''), [document?.contentHtml]);

  useEffect(() => {
    if (!document) return;
    setCheckedItems(document.checkmarks ?? checkedGlyphIndices(safeContentHtml));
    setTextValues(document.textValues ?? {});
    setSaveError('');
  }, [documentKey, document, safeContentHtml]);

  const saveFormState = useMutation({
    mutationFn: (state: { indices: number[]; textValues: Record<string, string> }) => apiFetch<{ indices: number[]; textValues: Record<string, string> }>(`/api/v1/tickets/${id}/form-checkmarks`, {
      method: 'PATCH',
      body: JSON.stringify({
        templateId: document!.template.id,
        templateVersion: document!.template.version,
        indices: state.indices,
        textValues: state.textValues,
      }),
    }),
    scope: { id: `ticket-form-checkmarks-${id ?? ''}` },
    onSuccess: () => setSaveError(''),
    onError: (error) => setSaveError(error instanceof ApiError && error.code === 'TICKET_FORM_CHECKMARKS_UPDATE_FAILED'
      ? 'ฐานข้อมูลยังไม่พร้อมบันทึกแบบฟอร์ม กรุณาใช้ migration ล่าสุดแล้วลองอีกครั้ง'
      : 'แสดงข้อมูลแล้ว แต่บันทึกแบบฟอร์มไม่สำเร็จ กรุณาลองอีกครั้ง'),
  });

  const interactiveFormHtml = useMemo(
    () => renderTicketFormFields(safeContentHtml, checkedItems, textValues, Boolean(document?.canEditCheckmarks)),
    [checkedItems, document?.canEditCheckmarks, safeContentHtml, textValues],
  );

  function toggleCheckmark(event: MouseEvent<HTMLElement>) {
    if (!document?.canEditCheckmarks) return;
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-ticket-check-index]');
    if (!button) return;
    const index = Number(button.dataset.ticketCheckIndex);
    if (!Number.isInteger(index)) return;
    const next = checkedItems.includes(index)
      ? checkedItems.filter((item) => item !== index)
      : [...checkedItems, index].sort((left, right) => left - right);
    setCheckedItems(next);
    setSaveError('');
    saveFormState.mutate({ indices: next, textValues });
  }

  function selectBlankText(event: FocusEvent<HTMLElement>) {
    const field = (event.target as HTMLElement).closest<HTMLElement>('[data-ticket-text-index]');
    if (!field || field.textContent !== '—') return;
    const range = window.document.createRange();
    range.selectNodeContents(field);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function saveTextField(event: FocusEvent<HTMLElement>) {
    if (!document?.canEditCheckmarks) return;
    const field = (event.target as HTMLElement).closest<HTMLElement>('[data-ticket-text-index]');
    if (!field) return;
    const index = field.dataset.ticketTextIndex;
    if (index === undefined) return;
    const value = (field.textContent ?? '').trim().replace(/^—$/, '');
    const next = { ...textValues };
    if (value) next[index] = value;
    else delete next[index];
    setTextValues(next);
    setSaveError('');
    saveFormState.mutate({ indices: checkedItems, textValues: next });
  }

  if (formQuery.isLoading) return <div className="flex justify-center py-24" role="status"><Loader2 className="h-8 w-8 animate-spin text-primary-600" /></div>;
  if (!document) return <p className="py-20 text-center text-sm text-slate-500">ไม่พบแบบฟอร์ม Ticket นี้ หรือท่านไม่มีสิทธิ์เข้าถึง</p>;

  return <div className="ticket-form-screen space-y-4">
    <div className="ticket-form-actions flex flex-wrap items-center justify-between gap-3">
      <Link to={`/tickets/${document.ticketId}`} className="inline-flex items-center gap-1 text-sm font-semibold text-primary-700 hover:underline dark:text-primary-300"><ArrowLeft className="h-4 w-4" />กลับไป Ticket</Link>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{document.ticketStatus}</Badge>
        <Button onClick={() => window.print()}><Printer className="h-4 w-4" />พิมพ์ / บันทึก PDF</Button>
      </div>
    </div>

    <section className="ticket-form-actions rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800" aria-label="ขั้นตอนแบบฟอร์ม Ticket">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-extrabold text-slate-900 dark:text-white">Flow ตามส่วนของแบบฟอร์ม</p>
          <p className="mt-1 text-xs text-slate-500">{document.template.code} · {document.template.name} · v{document.template.version}</p>
        </div>
        {document.issueForm && <Badge variant="info">{document.issueForm.formNo}</Badge>}
      </div>
      <ol className="mt-4 grid gap-2 md:grid-cols-5">
        {document.flow.map((step) => {
          const appearance = flowAppearance[step.state];
          const Icon = appearance.icon;
          return <li key={step.section} className={`rounded-lg border p-3 ${appearance.className}`} aria-current={step.state === 'current' ? 'step' : undefined}>
            <div className="flex items-center gap-2"><Icon className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="text-xs font-bold">ส่วนที่ {step.section}</span></div>
            <p className="mt-2 text-xs font-extrabold">{step.title}</p>
            <p className="mt-1 text-[11px] leading-4 opacity-80">{step.detail}</p>
            <span className="sr-only">{appearance.label}</span>
          </li>;
        })}
      </ol>
      {document.canEditCheckmarks && <p className="mt-3 text-xs text-slate-500">คลิกช่อง ☐ เพื่อทำเครื่องหมาย หรือคลิกขีด — เพื่อพิมพ์ข้อความ ระบบจะบันทึกกับ Ticket ใบนี้</p>}
      {saveFormState.isPending && <p className="mt-2 text-xs font-semibold text-primary-700" role="status">กำลังบันทึกแบบฟอร์ม...</p>}
      {saveError && <p className="mt-2 text-xs font-semibold text-rose-600" role="alert">{saveError}</p>}
    </section>

    <article id="form-print-area" className="ticket-print-page mx-auto w-full max-w-[210mm] overflow-hidden bg-white text-slate-900 shadow-sm" data-testid="ticket-form-page" onClick={toggleCheckmark} onFocus={selectBlankText} onBlur={saveTextField}>
      <div className="form-document shadow-none" dangerouslySetInnerHTML={{ __html: interactiveFormHtml }} />
    </article>
  </div>;
}
