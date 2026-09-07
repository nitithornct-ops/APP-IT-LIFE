import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, CircleDot, Clock3, Eye, Loader2, MinusCircle, PenLine, Printer, RotateCcw, Save, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type MouseEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { WordLikeEditor } from '../forms/WordLikeEditor';
import { ApiError, apiFetch, showToast } from '../../services/apiClient';
import type { TicketFormDocument, TicketFormFlowState } from '../../types/tickets';
import { sanitizeFormHtml } from '../../utils/formHtml';
import { effectiveMarginMm, pageGeometry, paginateElement } from './formPagination';

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

/**
 * ความสูงที่ block หนึ่งกินบนกระดาษ = กรอบของตัวเอง + ระยะขอบบนล่าง
 *
 * getBoundingClientRect ไม่นับ margin ทำให้หน้าแรกเคยล้นออกนอก A4 ไป 56px เพราะระยะห่าง
 * ระหว่างหัวข้อกับย่อหน้าหายไปจากการคำนวณทั้งหมด (พบตอนวัดจริงในเบราว์เซอร์)
 *
 * margin ของ block ที่ติดกันจะยุบรวมกันจริง ๆ บนหน้ากระดาษ การบวกตรง ๆ แบบนี้จึงนับเกินเล็กน้อย
 * ซึ่งเป็นทิศทางที่ปลอดภัย — หน้าอาจว่างกว่าที่ควรนิดหน่อย แต่ไม่มีทางล้นออกนอกกระดาษ
 */
function measureBlockHeight(element: HTMLElement): number {
  const style = window.getComputedStyle(element);
  return element.getBoundingClientRect().height
    + (Number.parseFloat(style.marginTop) || 0)
    + (Number.parseFloat(style.marginBottom) || 0);
}

type FormMode = 'view' | 'edit';

export function TicketFormPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  /**
   * เครื่องหมายและข้อความที่ผู้ใช้เพิ่งแก้ เก็บคู่กับ documentKey แทนที่จะ sync ผ่าน useEffect
   * ค่าเริ่มต้นจึงมาจากเอกสารตั้งแต่ render แรก ไม่มีจังหวะที่ช่องติ๊กกะพริบเป็นว่างก่อนแล้วค่อยเติม
   * และเมื่อเปลี่ยนไปเอกสารคนละฉบับ ค่าที่ค้างอยู่จะถูกทิ้งเองโดยไม่ต้องล้างด้วยมือ
   */
  const [edits, setEdits] = useState<{ key: string; indices: number[]; textValues: Record<string, string> } | null>(null);
  const [saveError, setSaveError] = useState('');
  const [mode, setMode] = useState<FormMode>('view');
  const [draftHtml, setDraftHtml] = useState('');
  const [pages, setPages] = useState<string[]>([]);
  const measureRef = useRef<HTMLDivElement>(null);

  const formQuery = useQuery({
    queryKey: ['tickets', id, 'form-document'],
    queryFn: () => apiFetch<TicketFormDocument>(`/api/v1/tickets/${id}/form-document`),
    enabled: Boolean(id),
  });
  const formDocument = formQuery.data;
  const documentKey = formDocument ? `${formDocument.ticketId}:${formDocument.template.id}:${formDocument.template.version}` : '';
  const safeContentHtml = useMemo(() => sanitizeFormHtml(formDocument?.contentHtml ?? ''), [formDocument?.contentHtml]);

  const activeEdits = edits?.key === documentKey ? edits : null;
  /**
   * ต้อง memo ไว้ทั้งคู่ ไม่ใช่คำนวณสด ๆ ทุก render — ค่า fallback เป็น object/array ที่สร้างใหม่
   * ทุกครั้ง ซึ่งจะทำให้ interactiveFormHtml เปลี่ยน identity ทุก render แล้วสั่งจัดหน้าใหม่ไม่จบ
   */
  const checkedItems = useMemo(
    () => activeEdits?.indices ?? formDocument?.checkmarks ?? checkedGlyphIndices(safeContentHtml),
    [activeEdits, formDocument?.checkmarks, safeContentHtml],
  );
  const textValues = useMemo(
    () => activeEdits?.textValues ?? formDocument?.textValues ?? {},
    [activeEdits, formDocument?.textValues],
  );

  const saveFormState = useMutation({
    mutationFn: (state: { indices: number[]; textValues: Record<string, string> }) => apiFetch<{ indices: number[]; textValues: Record<string, string> }>(`/api/v1/tickets/${id}/form-checkmarks`, {
      method: 'PATCH',
      body: JSON.stringify({
        templateId: formDocument!.template.id,
        templateVersion: formDocument!.template.version,
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

  const saveContent = useMutation({
    mutationFn: (contentHtml: string) => apiFetch<{ contentHtml: string; isCustomized: boolean }>(`/api/v1/tickets/${id}/form-content`, {
      method: 'PATCH',
      body: JSON.stringify({ contentHtml }),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tickets', id, 'form-document'] });
      setMode('view');
      showToast('success', 'บันทึกแบบฟอร์มของ Ticket ใบนี้แล้ว');
    },
  });

  const resetContent = useMutation({
    mutationFn: () => apiFetch<{ isCustomized: boolean }>(`/api/v1/tickets/${id}/form-content`, { method: 'DELETE' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tickets', id, 'form-document'] });
      setMode('view');
      showToast('success', 'คืนแบบฟอร์มกลับไปใช้แม่แบบแล้ว');
    },
  });

  const interactiveFormHtml = useMemo(
    () => renderTicketFormFields(safeContentHtml, checkedItems, textValues, Boolean(formDocument?.canEditCheckmarks)),
    [checkedItems, formDocument?.canEditCheckmarks, safeContentHtml, textValues],
  );

  const geometry = useMemo(() => {
    const settings = formDocument?.pageSettings ?? {};
    return pageGeometry(settings.size ?? 'A4', settings.orientation ?? 'portrait', effectiveMarginMm(settings.marginMm));
  }, [formDocument?.pageSettings]);

  /**
   * จัดหน้าจากความสูงจริงของเนื้อหา โดยวัดในกล่องที่ซ่อนไว้นอกจอแต่ยังถูก layout จริง
   * (visibility:hidden ไม่ใช่ display:none ซึ่งจะทำให้ทุกความสูงเป็น 0)
   *
   * ไม่รอรูปหรือฟอนต์ก่อนจัดหน้ารอบแรก เพราะจะทำให้หน้าจอว่างค้างเมื่อรูปโหลดช้าหรือโหลดไม่ขึ้น
   * แต่จัดใหม่อีกครั้งเมื่อรูปหรือฟอนต์พร้อม ผลลัพธ์จึงถูกต้องโดยไม่ต้องแลกกับการรอ
   */
  useEffect(() => {
    if (!interactiveFormHtml) {
      setPages([]);
      return;
    }
    let cancelled = false;

    const measure = () => {
      const host = measureRef.current;
      if (cancelled || !host) return;
      host.innerHTML = interactiveFormHtml;
      const result = paginateElement(host, {
        pageHeightPx: geometry.contentHeightPx,
        measureHeight: measureBlockHeight,
      });
      // ล้างทันทีหลังวัดเสร็จ ไม่ทิ้งสำเนาของเอกสารทั้งใบไว้ใน DOM ให้กินหน่วยความจำและ
      // ให้เครื่องมือค้นหา element เจอปุ่มกับช่องกรอกซ้ำสองชุด
      host.innerHTML = '';
      if (!cancelled) setPages(result.pages);
    };

    measure();

    /**
     * รูปที่ยังโหลดไม่เสร็จมีความสูง 0 ตอนวัด การจัดหน้ารอบแรกจึงอาจคลาดเคลื่อน
     * โหลดรูปไว้ล่วงหน้าแล้ววัดซ้ำอีกรอบเดียวเมื่อครบ — ไม่ใช่ผูก event กับรูปในหน้า
     * ซึ่งจะวัดใหม่ทุกครั้งที่ re-render จนวนไปมา
     */
    const sources = [...new Set(
      Array.from(new DOMParser().parseFromString(interactiveFormHtml, 'text/html').images)
        .map((image) => image.getAttribute('src') ?? '')
        .filter(Boolean),
    )];
    if (sources.length > 0) {
      void Promise.all(sources.map((source) => new Promise<void>((resolve) => {
        const image = new Image();
        image.onload = () => resolve();
        image.onerror = () => resolve();
        image.src = source;
      }))).then(measure);
    }
    const fonts = document.fonts;
    if (fonts) void fonts.ready.then(measure).catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [geometry.contentHeightPx, interactiveFormHtml]);

  const startEditing = useCallback(() => {
    setDraftHtml(safeContentHtml);
    setMode('edit');
  }, [safeContentHtml]);

  function toggleCheckmark(event: MouseEvent<HTMLElement>) {
    if (!formDocument?.canEditCheckmarks) return;
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-ticket-check-index]');
    if (!button) return;
    const index = Number(button.dataset.ticketCheckIndex);
    if (!Number.isInteger(index)) return;
    const next = checkedItems.includes(index)
      ? checkedItems.filter((item) => item !== index)
      : [...checkedItems, index].sort((left, right) => left - right);
    setEdits({ key: documentKey, indices: next, textValues });
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
    if (!formDocument?.canEditCheckmarks) return;
    const field = (event.target as HTMLElement).closest<HTMLElement>('[data-ticket-text-index]');
    if (!field) return;
    const index = field.dataset.ticketTextIndex;
    if (index === undefined) return;
    const value = (field.textContent ?? '').trim().replace(/^—$/, '');
    const next = { ...textValues };
    if (value) next[index] = value;
    else delete next[index];
    setEdits({ key: documentKey, indices: checkedItems, textValues: next });
    setSaveError('');
    saveFormState.mutate({ indices: checkedItems, textValues: next });
  }

  if (formQuery.isLoading) return <div className="flex justify-center py-24" role="status"><Loader2 className="h-8 w-8 animate-spin text-primary-600" /></div>;
  if (!formDocument) return <p className="py-20 text-center text-sm text-slate-500">ไม่พบแบบฟอร์ม Ticket นี้ หรือท่านไม่มีสิทธิ์เข้าถึง</p>;

  const sheetStyle = {
    '--form-page-width': `${geometry.widthPx}px`,
    '--form-page-height': `${geometry.heightPx}px`,
    '--form-page-margin': `${geometry.marginPx}px`,
  } as React.CSSProperties;
  const isBusy = saveContent.isPending || resetContent.isPending;

  return <div className="ticket-form-screen space-y-4">
    <div className="ticket-form-actions flex flex-wrap items-center justify-between gap-3">
      <Link to={`/tickets/${formDocument.ticketId}`} className="inline-flex items-center gap-1 text-sm font-semibold text-primary-700 hover:underline dark:text-primary-300"><ArrowLeft className="h-4 w-4" />กลับไป Ticket</Link>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{formDocument.ticketStatus}</Badge>
        {formDocument.isCustomized && <Badge variant="warning">แก้ไขเฉพาะใบนี้</Badge>}
        {mode === 'view' ? <>
          {formDocument.canEditContent && <Button variant="outline" onClick={startEditing}><PenLine className="h-4 w-4" />แก้ไขและจัดรูป</Button>}
          <Button onClick={() => window.print()}><Printer className="h-4 w-4" />พิมพ์ / บันทึก PDF</Button>
        </> : <>
          <Button variant="ghost" onClick={() => setMode('view')} disabled={isBusy}><X className="h-4 w-4" />ยกเลิก</Button>
          {formDocument.isCustomized && <Button variant="outline" onClick={() => resetContent.mutate()} isLoading={resetContent.isPending} disabled={isBusy}><RotateCcw className="h-4 w-4" />คืนค่าจากแม่แบบ</Button>}
          <Button onClick={() => saveContent.mutate(sanitizeFormHtml(draftHtml))} isLoading={saveContent.isPending} disabled={isBusy}><Save className="h-4 w-4" />บันทึกแบบฟอร์ม</Button>
        </>}
      </div>
    </div>

    <section className="ticket-form-actions rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800" aria-label="ขั้นตอนแบบฟอร์ม Ticket">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-extrabold text-slate-900 dark:text-white">Flow ตามส่วนของแบบฟอร์ม</p>
          <p className="mt-1 text-xs text-slate-500">{formDocument.template.code} · {formDocument.template.name} · v{formDocument.template.version}</p>
        </div>
        {formDocument.issueForm && <Badge variant="info">{formDocument.issueForm.formNo}</Badge>}
      </div>
      <ol className="mt-4 grid gap-2 md:grid-cols-5">
        {formDocument.flow.map((step) => {
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
      {mode === 'view' && formDocument.canEditCheckmarks && <p className="mt-3 text-xs text-slate-500">คลิกช่อง ☐ เพื่อทำเครื่องหมาย หรือคลิกขีด — เพื่อพิมพ์ข้อความ ระบบจะบันทึกกับ Ticket ใบนี้</p>}
      {mode === 'edit' && <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
        แก้ไขได้ทั้งข้อความ ตาราง และรูปภาพ ใช้ปุ่มกรรไกรบนแถบเครื่องมือเพื่อสั่งขึ้นหน้ากระดาษใหม่
        เมื่อบันทึกแล้ว แบบฟอร์มของ Ticket ใบนี้จะหยุดอัปเดตตามข้อมูล Ticket และแม่แบบ จนกว่าจะกดคืนค่าจากแม่แบบ
      </p>}
      {saveFormState.isPending && <p className="mt-2 text-xs font-semibold text-primary-700" role="status">กำลังบันทึกแบบฟอร์ม...</p>}
      {saveError && <p className="mt-2 text-xs font-semibold text-rose-600" role="alert">{saveError}</p>}
      {(saveContent.isError || resetContent.isError) && <p className="mt-2 text-xs font-semibold text-rose-600" role="alert">บันทึกเอกสารไม่สำเร็จ กรุณาลองอีกครั้ง</p>}
    </section>

    {/* กล่องวัดความสูง อยู่นอกจอแต่ถูกจัด layout จริง จึงให้ความสูงที่ใช้ตัดหน้าได้ถูกต้อง */}
    <div
      ref={measureRef}
      aria-hidden="true"
      data-print-hide
      className="form-document"
      style={{ position: 'fixed', left: '-10000px', top: 0, width: `${geometry.contentWidthPx}px`, minHeight: 0, padding: 0, visibility: 'hidden' }}
    />

    {mode === 'edit'
      ? <WordLikeEditor value={draftHtml} onChange={setDraftHtml} fileName={`${formDocument.ticketNo}-form`} />
      : <div
        id="form-print-area"
        data-testid="ticket-form-page"
        className="form-page-stack flex flex-col items-center gap-6"
        onClick={toggleCheckmark}
        onFocus={selectBlankText}
        onBlur={saveTextField}
      >
        {pages.map((pageHtml, index) => <article
          key={index}
          data-testid="ticket-form-sheet"
          aria-label={`หน้า ${index + 1} จาก ${pages.length}`}
          className="ticket-print-page form-document form-page-sheet bg-white text-slate-900 shadow-sm"
          style={sheetStyle}
          dangerouslySetInnerHTML={{ __html: pageHtml }}
        />)}
        {pages.length > 0 && <p data-print-hide className="ticket-form-actions text-xs text-slate-500">
          <Eye className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
          แบ่งเป็น {pages.length} หน้า ขนาด {formDocument.pageSettings?.size ?? 'A4'} — สิ่งที่เห็นตรงกับที่จะพิมพ์ออกมา
        </p>}
      </div>}
  </div>;
}
