import {
  CalendarDays,
  Check,
  Download,
  Eraser,
  FilePenLine,
  LockKeyhole,
  MousePointer2,
  Plus,
  Square,
  Type,
  X,
} from 'lucide-react';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { PDFDocumentProxy, PageViewport } from 'pdfjs-dist/types/src/pdf';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { showToast } from '../../services/apiClient';
import { downloadBytes, renderTextStamp } from './pdfBrowser';
import { buildPdf, type PdfSource, type WorkPage } from './pdfDocumentEngine';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface PdfFormEditorProps {
  sources: readonly PdfSource[];
  pages: readonly WorkPage[];
  filename: string;
}

type FieldKind = 'text' | 'checkbox' | 'date' | 'signature';

interface PdfField {
  id: string;
  pageIndex: number;
  kind: FieldKind;
  x: number;
  y: number;
  width: number;
  height: number;
  value: string;
  checked: boolean;
}

interface PageView {
  pageIndex: number;
  width: number;
  height: number;
  viewport: PageViewport;
}

const FIELD_LABELS: Record<FieldKind, string> = {
  text: 'ข้อความ',
  checkbox: 'เช็กบ็อกซ์',
  date: 'วันที่',
  signature: 'ลายเซ็น/ชื่อ',
};

const FIELD_ICONS: Record<FieldKind, typeof Type> = {
  text: Type,
  checkbox: Square,
  date: CalendarDays,
  signature: FilePenLine,
};

function outputName(filename: string, suffix: string): string {
  const base = filename.replace(/\.pdf$/i, '') || 'document';
  return `${base}-${suffix}.pdf`;
}

function fieldSize(kind: FieldKind, pageWidth: number): { width: number; height: number } {
  if (kind === 'checkbox') return { width: Math.min(24, pageWidth * 0.08), height: Math.min(24, pageWidth * 0.08) };
  if (kind === 'signature') return { width: Math.min(190, pageWidth * 0.42), height: 34 };
  return { width: Math.min(190, pageWidth * 0.42), height: 28 };
}

function viewportRectangle(viewport: PageViewport, field: PdfField): { left: number; top: number; width: number; height: number } {
  const first = viewport.convertToViewportPoint(field.x, field.y);
  const second = viewport.convertToViewportPoint(field.x + field.width, field.y + field.height);
  const left = Math.min(Number(first[0]), Number(second[0]));
  const top = Math.min(Number(first[1]), Number(second[1]));
  return {
    left,
    top,
    width: Math.abs(Number(second[0]) - Number(first[0])),
    height: Math.abs(Number(second[1]) - Number(first[1])),
  };
}

function pdfRectangle(
  viewport: PageViewport,
  left: number,
  top: number,
  width: number,
  height: number,
): Pick<PdfField, 'x' | 'y' | 'width' | 'height'> {
  const first = viewport.convertToPdfPoint(left, top);
  const second = viewport.convertToPdfPoint(left + width, top + height);
  const x = Math.min(Number(first[0]), Number(second[0]));
  const y = Math.min(Number(first[1]), Number(second[1]));
  return {
    x,
    y,
    width: Math.abs(Number(second[0]) - Number(first[0])),
    height: Math.abs(Number(second[1]) - Number(first[1])),
  };
}

function isPdfSafeText(value: string): boolean {
  return Array.from(value).every((character) => (character.codePointAt(0) ?? 0) <= 0xff);
}

async function drawTextValue(document: PDFDocument, pageIndex: number, field: PdfField, value: string): Promise<void> {
  const trimmed = value.trim();
  if (!trimmed) return;

  const pngBytes = await renderTextStamp(trimmed, {
    fontSize: Math.max(8, Math.min(16, field.height * 0.58)),
    color: '#111827',
    bold: field.kind === 'signature',
  });
  const image = await document.embedPng(pngBytes);
  const supersample = 3;
  const naturalWidth = image.width / supersample;
  const naturalHeight = image.height / supersample;
  const scale = Math.min(1, (field.width - 6) / naturalWidth, (field.height - 4) / naturalHeight);
  const width = Math.max(1, naturalWidth * scale);
  const height = Math.max(1, naturalHeight * scale);
  const page = document.getPage(pageIndex);
  page.drawImage(image, {
    x: field.x + 3,
    y: field.y + (field.height - height) / 2,
    width,
    height,
  });
}

function drawCheckboxValue(document: PDFDocument, pageIndex: number, field: PdfField): void {
  if (!field.checked) return;
  const page = document.getPage(pageIndex);
  const inset = Math.max(2, field.width * 0.2);
  page.drawLine({
    start: { x: field.x + inset, y: field.y + field.height * 0.48 },
    end: { x: field.x + field.width * 0.45, y: field.y + inset },
    thickness: Math.max(1.2, field.width * 0.08),
    color: rgb(0.06, 0.09, 0.16),
  });
  page.drawLine({
    start: { x: field.x + field.width * 0.45, y: field.y + inset },
    end: { x: field.x + field.width - inset, y: field.y + field.height - inset },
    thickness: Math.max(1.2, field.width * 0.08),
    color: rgb(0.06, 0.09, 0.16),
  });
}

export function PdfFormEditor({ sources, pages, filename }: PdfFormEditorProps) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>());
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const fieldSequence = useRef(0);
  const [baseBytes, setBaseBytes] = useState<Uint8Array | null>(null);
  const [pageViews, setPageViews] = useState<PageView[]>([]);
  const [fields, setFields] = useState<PdfField[]>([]);
  const [activeTool, setActiveTool] = useState<FieldKind | null>(null);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [viewerWidth, setViewerWidth] = useState(900);
  const [isLoading, setLoading] = useState(true);
  const [isExporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pageSignature = useMemo(
    () => pages.map((page) => `${page.id}:${page.sourceId}:${page.sourceIndex}:${page.rotation}`).join('|'),
    [pages],
  );

  useEffect(() => {
    const element = viewerRef.current;
    if (!element) return;

    const updateWidth = () => setViewerWidth(Math.max(320, element.clientWidth));
    updateWidth();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const previous = pdfRef.current;
    pdfRef.current = null;
    if (previous) void previous.cleanup();
    setPageViews([]);
    setBaseBytes(null);
    setFields([]);
    setSelectedFieldId(null);
    setLoading(true);
    setError(null);

    if (pages.length === 0) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const load = async () => {
      try {
        const bytes = await buildPdf(sources, pages);
        const loadingTask = pdfjs.getDocument({ data: bytes.slice() });
        const document = await loadingTask.promise;
        if (cancelled) {
          await document.cleanup();
          return;
        }
        pdfRef.current = document;
        setBaseBytes(bytes);
        setLoading(false);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'เปิดเอกสาร PDF ไม่สำเร็จ');
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
      const current = pdfRef.current;
      pdfRef.current = null;
      if (current) void current.cleanup();
    };
  }, [pageSignature, pages, sources]);

  useEffect(() => {
    const document = pdfRef.current;
    if (!document) return;
    let cancelled = false;

    const readPageViews = async () => {
      const next: PageView[] = [];
      for (let pageIndex = 0; pageIndex < document.numPages; pageIndex += 1) {
        const page = await document.getPage(pageIndex + 1);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(1.35, Math.max(0.55, (viewerWidth - 32) / baseViewport.width));
        next.push({
          pageIndex,
          width: baseViewport.width * scale,
          height: baseViewport.height * scale,
          viewport: page.getViewport({ scale }),
        });
      }
      if (!cancelled) setPageViews(next);
    };

    void readPageViews().catch((renderError) => {
      if (!cancelled) setError(renderError instanceof Error ? renderError.message : 'เตรียมหน้า PDF ไม่สำเร็จ');
    });
    return () => {
      cancelled = true;
    };
  }, [viewerWidth, baseBytes]);

  useEffect(() => {
    const document = pdfRef.current;
    if (!document || pageViews.length === 0) return;
    let cancelled = false;
    const renderPages = async () => {
      const deviceScale = Math.min(2, window.devicePixelRatio || 1);
      for (const view of pageViews) {
        const canvas = canvasRefs.current.get(view.pageIndex);
        if (!canvas) continue;
        const page = await document.getPage(view.pageIndex + 1);
        canvas.width = Math.ceil(view.width * deviceScale);
        canvas.height = Math.ceil(view.height * deviceScale);
        canvas.style.width = `${view.width}px`;
        canvas.style.height = `${view.height}px`;
        const context = canvas.getContext('2d');
        if (!context) continue;
        const task = page.render({
          canvas,
          canvasContext: context,
          viewport: view.viewport,
          transform: deviceScale === 1 ? undefined : [deviceScale, 0, 0, deviceScale, 0, 0],
        });
        await task.promise;
        if (cancelled) return;
      }
    };

    void renderPages().catch((renderError) => {
      if (!cancelled) setError(renderError instanceof Error ? renderError.message : 'แสดงหน้า PDF ไม่สำเร็จ');
    });
    return () => {
      cancelled = true;
    };
  }, [pageViews]);

  const setCanvasRef = useCallback((pageIndex: number, canvas: HTMLCanvasElement | null) => {
    if (canvas) canvasRefs.current.set(pageIndex, canvas);
    else canvasRefs.current.delete(pageIndex);
  }, []);

  const updateField = (fieldId: string, update: Partial<PdfField>) => {
    setFields((current) => current.map((field) => (field.id === fieldId ? { ...field, ...update } : field)));
  };

  const placeField = (event: MouseEvent<HTMLDivElement>, view: PageView) => {
    if (!activeTool) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const size = fieldSize(activeTool, view.viewport.width);
    const left = Math.min(Math.max(8, event.clientX - bounds.left - size.width / 2), view.width - size.width - 8);
    const top = Math.min(Math.max(8, event.clientY - bounds.top - size.height / 2), view.height - size.height - 8);
    const rectangle = pdfRectangle(view.viewport, left, top, size.width, size.height);
    const field: PdfField = {
      id: `field-${(fieldSequence.current += 1)}`,
      pageIndex: view.pageIndex,
      kind: activeTool,
      ...rectangle,
      value: '',
      checked: false,
    };
    setFields((current) => [...current, field]);
    setSelectedFieldId(field.id);
    setActiveTool(null);
  };

  const removeSelectedField = () => {
    if (!selectedFieldId) return;
    setFields((current) => current.filter((field) => field.id !== selectedFieldId));
    setSelectedFieldId(null);
  };

  const saveDocument = async (flatten: boolean) => {
    if (!baseBytes) return;
    setExporting(true);
    try {
      const document = await PDFDocument.load(baseBytes, { ignoreEncryption: true });
      if (flatten) {
        for (const field of fields) {
          if (field.kind === 'checkbox') drawCheckboxValue(document, field.pageIndex, field);
          else await drawTextValue(document, field.pageIndex, field, field.value);
        }
      } else {
        const form = document.getForm();
        const font = await document.embedFont(StandardFonts.Helvetica);
        for (const field of fields) {
          const page = document.getPage(field.pageIndex);
          const options = {
            x: field.x,
            y: field.y,
            width: field.width,
            height: field.height,
            borderWidth: 0,
            textColor: rgb(0.06, 0.09, 0.16),
            font,
          };
          if (field.kind === 'checkbox') {
            const checkbox = form.createCheckBox(`free-${field.id}`);
            checkbox.addToPage(page, options);
            if (field.checked) checkbox.check();
          } else {
            const textField = form.createTextField(`free-${field.id}`);
            textField.setFontSize(Math.max(8, Math.min(16, field.height * 0.58)));
            textField.addToPage(page, options);
            if (isPdfSafeText(field.value)) textField.setText(field.value);
            else await drawTextValue(document, field.pageIndex, field, field.value);
            textField.updateAppearances(font);
          }
        }
      }
      const bytes = await document.save();
      downloadBytes(new Uint8Array(bytes), outputName(filename, flatten ? 'กรอกเสร็จแล้ว-ล็อกแบบฟอร์ม' : 'ฉบับแก้ไข'));
      showToast('success', flatten ? 'ส่งออก PDF และล็อกแบบฟอร์มแล้ว' : 'บันทึก PDF ฉบับแก้ไขแล้ว');
    } catch (saveError) {
      showToast('error', saveError instanceof Error ? saveError.message : 'บันทึก PDF ไม่สำเร็จ');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card id="pdf-panel-editor" role="tabpanel" aria-labelledby="pdf-tab-editor">
      <CardBody className="space-y-3 p-0">
        <div className="border-b border-hairline-row px-4 py-3 dark:border-white/[.07]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-bold text-ink-heading dark:text-[#e8eef9]">
                <FilePenLine className="h-4 w-4 text-primary-600" aria-hidden="true" />
                แก้ไขแบบฟอร์มในระบบ — โหมดฟรี
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                PDF ต้นฉบับจะไม่ถูกขยับหรือแก้โครงสร้าง คลิกเครื่องมือแล้วคลิกตำแหน่งบนเอกสารเพื่อวางช่องกรอก
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={removeSelectedField}
                disabled={!selectedFieldId || isLoading || isExporting}
              >
                <Eraser className="h-4 w-4" aria-hidden="true" /> ลบช่องที่เลือก
              </Button>
              <Button variant="outline" size="sm" onClick={() => void saveDocument(false)} disabled={!baseBytes || isLoading || isExporting}>
                <Download className="h-4 w-4" aria-hidden="true" /> บันทึกฉบับแก้ไข
              </Button>
              <Button size="sm" onClick={() => void saveDocument(true)} disabled={!baseBytes || isLoading || isExporting}>
                <LockKeyhole className="h-4 w-4" aria-hidden="true" /> ส่งออกและล็อกฟอร์ม
              </Button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="เครื่องมือเพิ่มช่องกรอก">
            <span className="mr-1 inline-flex items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> เพิ่มช่อง:
            </span>
            {(Object.keys(FIELD_LABELS) as FieldKind[]).map((kind) => {
              const Icon = FIELD_ICONS[kind];
              const active = activeTool === kind;
              return (
                <Button
                  key={kind}
                  variant={active ? 'primary' : 'outline'}
                  size="sm"
                  aria-pressed={active}
                  onClick={() => setActiveTool(active ? null : kind)}
                  disabled={isLoading || isExporting || pageViews.length === 0}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" /> {FIELD_LABELS[kind]}
                </Button>
              );
            })}
            {activeTool && (
              <span className="inline-flex items-center gap-1 text-xs text-primary-700 dark:text-primary-300">
                <MousePointer2 className="h-3.5 w-3.5" aria-hidden="true" /> คลิกบนหน้า PDF เพื่อวาง “{FIELD_LABELS[activeTool]}”
                <button
                  type="button"
                  className="ml-1 rounded p-0.5 hover:bg-slate-100 dark:hover:bg-white/10"
                  onClick={() => setActiveTool(null)}
                  aria-label="ยกเลิกการวางช่อง"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </span>
            )}
          </div>
        </div>

        {error && (
          <div className="mx-4 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:border-danger-700 dark:bg-danger-900/20 dark:text-danger-200">
            {error}
          </div>
        )}

        <div ref={viewerRef} className="min-h-[620px] overflow-auto bg-slate-100 px-3 py-5 dark:bg-slate-950">
          {isLoading && <p className="py-16 text-center text-sm text-slate-500">กำลังเตรียมเอกสาร…</p>}
          {!isLoading && pageViews.length === 0 && !error && (
            <p className="py-16 text-center text-sm text-slate-500">กรุณาเพิ่มไฟล์ PDF ก่อนเริ่มแก้ไขแบบฟอร์ม</p>
          )}
          <div className="mx-auto flex max-w-[980px] flex-col items-center gap-5">
            {pageViews.map((view) => (
              <div
                key={view.pageIndex}
                className="relative shrink-0 bg-white shadow-lg"
                style={{ width: view.width, height: view.height, cursor: activeTool ? 'crosshair' : 'default' }}
                onClick={(event) => placeField(event, view)}
                onPointerDown={() => {
                  if (!activeTool) setSelectedFieldId(null);
                }}
              >
                <canvas ref={(canvas) => setCanvasRef(view.pageIndex, canvas)} className="pointer-events-none block" />
                {fields
                  .filter((field) => field.pageIndex === view.pageIndex)
                  .map((field) => {
                    const rectangle = viewportRectangle(view.viewport, field);
                    const selected = selectedFieldId === field.id;
                    return (
                      <div
                        key={field.id}
                        className={`absolute rounded border ${selected ? 'border-primary-600 ring-2 ring-primary-500/30' : 'border-primary-400/70'} bg-primary-50/80 p-0.5 dark:bg-primary-900/30`}
                        style={{ left: rectangle.left, top: rectangle.top, width: rectangle.width, height: rectangle.height }}
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          setSelectedFieldId(field.id);
                        }}
                      >
                        {field.kind === 'checkbox' ? (
                          <label className="flex h-full w-full cursor-pointer items-center justify-center">
                            <input
                              type="checkbox"
                              aria-label={FIELD_LABELS[field.kind]}
                              checked={field.checked}
                              onChange={(event) => updateField(field.id, { checked: event.target.checked })}
                              className="h-4 w-4 rounded border-slate-400 text-primary-600 focus:ring-primary-500"
                            />
                            {field.checked && <Check className="pointer-events-none absolute h-4 w-4 text-primary-700" aria-hidden="true" />}
                          </label>
                        ) : (
                          <input
                            type={field.kind === 'date' ? 'date' : 'text'}
                            aria-label={FIELD_LABELS[field.kind]}
                            placeholder={FIELD_LABELS[field.kind]}
                            value={field.value}
                            onChange={(event) => updateField(field.id, { value: event.target.value })}
                            className="h-full w-full border-0 bg-transparent px-1 text-xs text-slate-900 outline-none placeholder:text-primary-700/60 dark:text-white"
                          />
                        )}
                      </div>
                    );
                  })}
              </div>
            ))}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
