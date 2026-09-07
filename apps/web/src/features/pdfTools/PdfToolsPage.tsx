import {
  Copy,
  Download,
  FilePlus2,
  FileStack,
  Layers,
  RotateCcw,
  RotateCw,
  Scissors,
  Stamp,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { KpiStrip } from '../../components/ui/KpiStrip';
import { PageHeader } from '../../components/ui/PageHeader';
import { showToast } from '../../services/apiClient';
import { cn } from '../../utils/cn';
import { downloadBytes } from './pdfBrowser';
import {
  buildPdf,
  outputFileName,
  planSplitByRanges,
  planSplitEveryN,
  type SplitPart,
  type StampPosition,
  type WorkPage,
} from './pdfDocumentEngine';
import { PdfPageCard } from './PdfPageCard';
import {
  buildStampOptions,
  DEFAULT_PAGE_LABEL,
  DEFAULT_WATERMARK,
  previewPageLabel,
  type PageLabelFormat,
} from './pdfStamps';
import { thumbnailKey, usePdfWorkspace } from './usePdfWorkspace';

/**
 * เครื่องมือจัดการ PDF — รวม แยก จัดเรียง หมุน ลบหน้า แปลงรูปเป็น PDF และใส่ลายน้ำ/เลขหน้า
 *
 * ทุกอย่างทำงานในเบราว์เซอร์ของผู้ใช้ ไม่มีการอัปโหลดไฟล์ไปที่ server หรือ Supabase Storage
 * จึงใช้กับเอกสารที่ยังไม่ควรออกจากเครื่องได้ และเป็นเหตุผลที่หน้านี้ไม่ผูกกับ permission ของโมดูลใด
 */

type ToolTab = 'organize' | 'stamp' | 'split';

const TABS: { key: ToolTab; label: string }[] = [
  { key: 'organize', label: 'จัดการหน้า' },
  { key: 'stamp', label: 'ลายน้ำและเลขหน้า' },
  { key: 'split', label: 'แยกไฟล์' },
];

const LABEL_POSITIONS: { value: StampPosition; label: string }[] = [
  { value: 'bottom-center', label: 'ล่างกลาง' },
  { value: 'bottom-right', label: 'ล่างขวา' },
  { value: 'bottom-left', label: 'ล่างซ้าย' },
  { value: 'top-center', label: 'บนกลาง' },
  { value: 'top-right', label: 'บนขวา' },
];

const LABEL_FORMATS: { value: PageLabelFormat; label: string }[] = [
  { value: 'number_of_total', label: '1 / 10' },
  { value: 'number', label: '1' },
  { value: 'thai', label: 'หน้า 1 จาก 10' },
];

const fieldClass =
  'mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-white';
const labelClass = 'block text-xs font-semibold text-slate-600 dark:text-slate-300';

const ACCEPTED_FILES = '.pdf,application/pdf,image/jpeg,image/png,image/webp,image/gif,image/bmp';

/** เว้นจังหวะระหว่างไฟล์ตอนแยกหลายไฟล์ เบราว์เซอร์บางตัวจะบล็อกดาวน์โหลดที่ยิงติดกันเกินไป */
const DOWNLOAD_GAP_MS = 350;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
}

export function PdfToolsPage() {
  const workspace = usePdfWorkspace();
  const { pages, sources } = workspace;

  const [tab, setTab] = useState<ToolTab>('organize');
  const [selected, setSelected] = useState<string[]>([]);
  const [watermark, setWatermark] = useState(DEFAULT_WATERMARK);
  const [pageLabel, setPageLabel] = useState(DEFAULT_PAGE_LABEL);
  const [splitMode, setSplitMode] = useState<'every' | 'ranges'>('every');
  const [splitSize, setSplitSize] = useState(1);
  const [splitRanges, setSplitRanges] = useState('');
  const [isBusy, setBusy] = useState(false);
  const [isDropping, setDropping] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // หน้าที่ถูกลบไปแล้วต้องหลุดจากรายการที่เลือกด้วย ไม่งั้นปุ่ม "บันทึกเฉพาะที่เลือก" จะนับเกินจริง
  useEffect(() => {
    setSelected((current) => {
      const alive = new Set(pages.map((page) => page.id));
      const next = current.filter((id) => alive.has(id));
      return next.length === current.length ? current : next;
    });
  }, [pages]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedPages = useMemo(() => pages.filter((page) => selectedSet.has(page.id)), [pages, selectedSet]);
  const sourceNames = useMemo(() => new Map(sources.map((source) => [source.id, source.name])), [sources]);
  const baseName = sources[0]?.name ?? 'document';
  const rotatedCount = useMemo(() => pages.filter((page) => page.rotation !== 0).length, [pages]);

  const splitPlan = useMemo((): { parts: SplitPart[]; error: string | null } => {
    if (pages.length === 0) return { parts: [], error: null };
    try {
      const parts =
        splitMode === 'every' ? planSplitEveryN(pages.length, splitSize) : planSplitByRanges(splitRanges, pages.length);
      return { parts, error: null };
    } catch (error) {
      return { parts: [], error: messageOf(error) };
    }
  }, [pages.length, splitMode, splitRanges, splitSize]);

  const handleFiles = useCallback(
    async (fileList: FileList | null) => {
      const files = Array.from(fileList ?? []);
      if (files.length === 0) return;
      await workspace.addFiles(files);
    },
    [workspace],
  );

  const toggleSelected = useCallback((pageId: string) => {
    setSelected((current) =>
      current.includes(pageId) ? current.filter((id) => id !== pageId) : [...current, pageId],
    );
  }, []);

  const exportPages = useCallback(
    async (target: readonly WorkPage[], suffix: string) => {
      if (target.length === 0) {
        showToast('error', 'ยังไม่มีหน้าเอกสารให้บันทึก');
        return;
      }
      setBusy(true);
      try {
        const options = await buildStampOptions(watermark, pageLabel, target.length);
        const bytes = await buildPdf(sources, target, options);
        downloadBytes(bytes, outputFileName(baseName, suffix));
        showToast('success', `บันทึกไฟล์ PDF ${target.length} หน้าแล้ว`);
      } catch (error) {
        showToast('error', messageOf(error));
      } finally {
        setBusy(false);
      }
    },
    [baseName, pageLabel, sources, watermark],
  );

  const exportSplit = useCallback(async () => {
    const parts = splitPlan.parts;
    if (parts.length === 0) {
      showToast('error', splitPlan.error ?? 'ยังไม่มีหน้าเอกสารให้แยก');
      return;
    }
    setBusy(true);
    try {
      for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index];
        const target = part.indices.map((pageIndex) => pages[pageIndex]).filter(Boolean);
        const options = await buildStampOptions(watermark, pageLabel, target.length);
        const bytes = await buildPdf(sources, target, options);
        downloadBytes(bytes, outputFileName(baseName, `ส่วนที่-${index + 1}`));
        if (index < parts.length - 1) await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_GAP_MS));
      }
      showToast('success', `แยกออกเป็น ${parts.length} ไฟล์แล้ว`);
    } catch (error) {
      showToast('error', messageOf(error));
    } finally {
      setBusy(false);
    }
  }, [baseName, pageLabel, pages, sources, splitPlan, watermark]);

  const onCardDragStart = (index: number) => (event: DragEvent<HTMLLIElement>) => {
    setDragIndex(index);
    event.dataTransfer.effectAllowed = 'move';
    // Firefox ไม่เริ่มลากเลยถ้าไม่ได้ตั้งข้อมูลไว้อย่างน้อยหนึ่งชนิด
    event.dataTransfer.setData('text/plain', String(index));
  };

  const onCardDragOver = (index: number) => (event: DragEvent<HTMLLIElement>) => {
    if (dragIndex === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropIndex(index);
  };

  const onCardDrop = (index: number) => (event: DragEvent<HTMLLIElement>) => {
    event.preventDefault();
    if (dragIndex !== null && dragIndex !== index) workspace.reorderPage(pages[dragIndex].id, index);
    setDragIndex(null);
    setDropIndex(null);
  };

  const onCardDragEnd = () => {
    setDragIndex(null);
    setDropIndex(null);
  };

  const kpiItems = [
    { key: 'files', label: 'ไฟล์ที่เปิดอยู่', value: sources.length },
    { key: 'pages', label: 'หน้าทั้งหมด', value: pages.length },
    {
      key: 'selected',
      label: 'เลือกไว้',
      value: selected.length,
      onClick: () => setSelected(selected.length === pages.length ? [] : pages.map((page) => page.id)),
      active: selected.length > 0,
    },
    { key: 'rotated', label: 'หน้าที่หมุนแล้ว', value: rotatedCount },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="พื้นที่ทำงาน / เครื่องมือ PDF"
        title="เครื่องมือจัดการ PDF"
        description="รวม แยก จัดเรียง หมุน ลบหน้า แปลงรูปเป็น PDF และใส่ลายน้ำ โดยไฟล์ไม่ถูกอัปโหลดออกจากเครื่องของคุณ"
        leading={<FileStack className="h-4 w-4" aria-hidden="true" />}
        meta={<Badge variant="success">ประมวลผลในเครื่อง ไม่ส่งไฟล์ขึ้นระบบ</Badge>}
        secondaryActions={
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={workspace.isLoadingFiles}>
            <FilePlus2 className="h-4 w-4" aria-hidden="true" /> เพิ่มไฟล์
          </Button>
        }
        primaryAction={
          <Button onClick={() => void exportPages(pages, 'แก้ไขแล้ว')} disabled={pages.length === 0} isLoading={isBusy}>
            <Download className="h-4 w-4" aria-hidden="true" /> บันทึก PDF
          </Button>
        }
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPTED_FILES}
        className="hidden"
        aria-label="เลือกไฟล์ PDF หรือรูปภาพ"
        onChange={(event) => {
          void handleFiles(event.target.files);
          event.target.value = '';
        }}
      />

      {pages.length > 0 && <KpiStrip items={kpiItems} />}

      {workspace.loadErrors.length > 0 && (
        <Card className="border-danger-200 dark:border-danger-700">
          <CardBody className="flex items-start justify-between gap-3">
            <ul className="list-inside list-disc space-y-1 text-sm text-danger-700 dark:text-danger-200">
              {workspace.loadErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
            <Button variant="ghost" size="sm" onClick={workspace.dismissErrors}>
              ปิด
            </Button>
          </CardBody>
        </Card>
      )}

      <div
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          setDropping(false);
          void handleFiles(event.dataTransfer.files);
        }}
        className={cn(
          'rounded-card border-2 border-dashed text-center transition-colors',
          // ย่อแถบวางไฟล์ทันทีที่มีหน้าแล้ว ไม่งั้นตารางหน้ากับปุ่มบันทึกจะถูกดันตกจอไปตลอด
          pages.length === 0 ? 'px-4 py-6' : 'flex flex-wrap items-center justify-center gap-3 px-4 py-3',
          isDropping
            ? 'border-primary-500 bg-primary-50/60 dark:bg-primary-900/20'
            : 'border-hairline-control bg-white dark:border-white/[.12] dark:bg-white/[.02]',
        )}
      >
        {pages.length === 0 ? (
          <>
            <Upload className="mx-auto h-6 w-6 text-primary-600 dark:text-primary-300" aria-hidden="true" />
            <p className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              ลากไฟล์ PDF หรือรูปภาพมาวางที่นี่
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              เพิ่มได้หลายไฟล์พร้อมกัน ทุกหน้าจะต่อกันในพื้นที่ทำงานเดียว รูปภาพจะถูกแปลงเป็นหน้า A4 อัตโนมัติ
            </p>
            <div className="mt-3">
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} isLoading={workspace.isLoadingFiles}>
                เลือกไฟล์จากเครื่อง
              </Button>
            </div>
          </>
        ) : (
          <>
            <Upload className="h-4 w-4 text-primary-600 dark:text-primary-300" aria-hidden="true" />
            <span className="text-xs text-slate-500 dark:text-slate-400">
              ลากไฟล์เพิ่มมาวางที่นี่เพื่อต่อท้ายพื้นที่ทำงาน
            </span>
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} isLoading={workspace.isLoadingFiles}>
              เลือกไฟล์จากเครื่อง
            </Button>
          </>
        )}
      </div>

      {pages.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileStack className="h-7 w-7" aria-hidden="true" />}
            title="ยังไม่มีไฟล์ในพื้นที่ทำงาน"
            description="เพิ่มไฟล์ PDF หรือรูปภาพก่อน แล้วจึงจัดเรียงหน้า ใส่ลายน้ำ หรือแยกไฟล์ได้จากหน้าเดียวกันนี้"
            action={
              <Button size="sm" onClick={() => fileInputRef.current?.click()}>
                <FilePlus2 className="h-4 w-4" aria-hidden="true" /> เพิ่มไฟล์
              </Button>
            }
          />
        </Card>
      ) : (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="เครื่องมือจัดการ PDF">
            {TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                id={`pdf-tab-${item.key}`}
                aria-selected={tab === item.key}
                aria-controls={`pdf-panel-${item.key}`}
                onClick={() => setTab(item.key)}
                className={cn(
                  'rounded-lg px-4 py-2 text-sm font-semibold',
                  tab === item.key
                    ? 'bg-primary-700 text-white'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === 'organize' && (
            <Card id="pdf-panel-organize" role="tabpanel" aria-labelledby="pdf-tab-organize">
              <CardHeader className="flex flex-wrap items-center justify-between gap-2">
                <span>ลำดับหน้าในไฟล์ผลลัพธ์</span>
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                  ลากการ์ดเพื่อสลับลำดับ หรือใช้ปุ่มลูกศรบนการ์ด
                </span>
              </CardHeader>
              <CardBody className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelected(selected.length === pages.length ? [] : pages.map((page) => page.id))}
                  >
                    {selected.length === pages.length ? 'ล้างการเลือก' : 'เลือกทุกหน้า'}
                  </Button>
                  <Button variant="outline" size="sm" disabled={selectedPages.length === 0} onClick={() => workspace.rotatePages(selected, -90)}>
                    <RotateCcw className="h-4 w-4" aria-hidden="true" /> หมุนซ้าย
                  </Button>
                  <Button variant="outline" size="sm" disabled={selectedPages.length === 0} onClick={() => workspace.rotatePages(selected, 90)}>
                    <RotateCw className="h-4 w-4" aria-hidden="true" /> หมุนขวา
                  </Button>
                  <Button variant="outline" size="sm" disabled={selectedPages.length === 0} onClick={() => workspace.duplicatePages(selected)}>
                    <Copy className="h-4 w-4" aria-hidden="true" /> ทำสำเนา
                  </Button>
                  <Button variant="outline" size="sm" disabled={selectedPages.length === 0} onClick={() => workspace.removePages(selected)}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" /> ลบที่เลือก
                  </Button>
                  <Button variant="outline" size="sm" disabled={pages.length < 2} onClick={workspace.reversePages}>
                    <Layers className="h-4 w-4" aria-hidden="true" /> กลับลำดับทั้งหมด
                  </Button>
                  <Button variant="ghost" size="sm" disabled={!workspace.canUndo} onClick={workspace.undo}>
                    <Undo2 className="h-4 w-4" aria-hidden="true" /> ย้อนกลับ
                  </Button>
                  <Button variant="ghost" size="sm" onClick={workspace.reset}>
                    เริ่มใหม่
                  </Button>
                </div>

                <ul className="flex flex-wrap gap-3">
                  {pages.map((page, index) => (
                    <PdfPageCard
                      key={page.id}
                      page={page}
                      index={index}
                      total={pages.length}
                      sourceName={sourceNames.get(page.sourceId) ?? 'ไม่ทราบชื่อไฟล์'}
                      thumbnail={workspace.thumbnails[thumbnailKey(page.sourceId, page.sourceIndex)]}
                      previewUnavailable={workspace.previewUnavailable}
                      selected={selectedSet.has(page.id)}
                      onToggle={() => toggleSelected(page.id)}
                      onRotate={(delta) => workspace.rotatePages([page.id], delta)}
                      onDuplicate={() => workspace.duplicatePages([page.id])}
                      onDelete={() => workspace.removePages([page.id])}
                      onMove={(offset) => workspace.movePage(page.id, offset)}
                      onDragStart={onCardDragStart(index)}
                      onDragOver={onCardDragOver(index)}
                      onDrop={onCardDrop(index)}
                      onDragEnd={onCardDragEnd}
                      isDropTarget={dropIndex === index && dragIndex !== index}
                    />
                  ))}
                </ul>

                <div className="flex flex-wrap items-center gap-2 border-t border-hairline-row pt-3 dark:border-white/[.07]">
                  <Button onClick={() => void exportPages(pages, 'แก้ไขแล้ว')} isLoading={isBusy}>
                    <Download className="h-4 w-4" aria-hidden="true" /> บันทึกทั้งหมด ({pages.length} หน้า)
                  </Button>
                  <Button
                    variant="outline"
                    disabled={selectedPages.length === 0}
                    onClick={() => void exportPages(selectedPages, 'เฉพาะที่เลือก')}
                    isLoading={isBusy}
                  >
                    <Download className="h-4 w-4" aria-hidden="true" /> บันทึกเฉพาะที่เลือก ({selectedPages.length} หน้า)
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}

          {tab === 'stamp' && (
            <Card id="pdf-panel-stamp" role="tabpanel" aria-labelledby="pdf-tab-stamp">
              <CardHeader className="flex items-center gap-2">
                <Stamp className="h-4 w-4" aria-hidden="true" /> ลายน้ำและเลขหน้า
              </CardHeader>
              <CardBody className="space-y-5">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  ค่าที่ตั้งไว้จะถูกใส่ให้ทุกหน้าตอนกดบันทึก ทั้งจากแท็บจัดการหน้าและแท็บแยกไฟล์
                </p>

                <fieldset className="space-y-3">
                  <label className="flex items-center gap-2 text-sm font-bold text-ink-heading dark:text-[#e8eef9]">
                    <input
                      type="checkbox"
                      checked={watermark.enabled}
                      onChange={(event) => setWatermark({ ...watermark, enabled: event.target.checked })}
                      className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                    />
                    ใส่ลายน้ำข้อความ
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <label className={labelClass}>
                      ข้อความ
                      <input
                        type="text"
                        className={fieldClass}
                        value={watermark.text}
                        disabled={!watermark.enabled}
                        onChange={(event) => setWatermark({ ...watermark, text: event.target.value })}
                      />
                    </label>
                    <label className={labelClass}>
                      ความกว้างเทียบกับหน้า ({watermark.sizePercent}%)
                      <input
                        type="range"
                        min={10}
                        max={100}
                        step={5}
                        className="mt-3 w-full accent-primary-600"
                        value={watermark.sizePercent}
                        disabled={!watermark.enabled}
                        onChange={(event) => setWatermark({ ...watermark, sizePercent: Number(event.target.value) })}
                      />
                    </label>
                    <label className={labelClass}>
                      ความทึบ ({watermark.opacityPercent}%)
                      <input
                        type="range"
                        min={5}
                        max={100}
                        step={5}
                        className="mt-3 w-full accent-primary-600"
                        value={watermark.opacityPercent}
                        disabled={!watermark.enabled}
                        onChange={(event) => setWatermark({ ...watermark, opacityPercent: Number(event.target.value) })}
                      />
                    </label>
                    <label className={labelClass}>
                      มุมเอียง ({watermark.angle}°)
                      <input
                        type="range"
                        min={0}
                        max={90}
                        step={5}
                        className="mt-3 w-full accent-primary-600"
                        value={watermark.angle}
                        disabled={!watermark.enabled}
                        onChange={(event) => setWatermark({ ...watermark, angle: Number(event.target.value) })}
                      />
                    </label>
                    <label className={labelClass}>
                      สี
                      <input
                        type="color"
                        className={cn(fieldClass, 'h-10 p-1')}
                        value={watermark.color}
                        disabled={!watermark.enabled}
                        onChange={(event) => setWatermark({ ...watermark, color: event.target.value })}
                      />
                    </label>
                    <label className="flex items-center gap-2 self-end pb-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={watermark.bold}
                        disabled={!watermark.enabled}
                        onChange={(event) => setWatermark({ ...watermark, bold: event.target.checked })}
                        className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                      />
                      ตัวหนา
                    </label>
                  </div>
                </fieldset>

                <fieldset className="space-y-3 border-t border-hairline-row pt-4 dark:border-white/[.07]">
                  <label className="flex items-center gap-2 text-sm font-bold text-ink-heading dark:text-[#e8eef9]">
                    <input
                      type="checkbox"
                      checked={pageLabel.enabled}
                      onChange={(event) => setPageLabel({ ...pageLabel, enabled: event.target.checked })}
                      className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                    />
                    ใส่เลขหน้า
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className={labelClass}>
                      รูปแบบ
                      <select
                        className={fieldClass}
                        value={pageLabel.format}
                        disabled={!pageLabel.enabled}
                        onChange={(event) => setPageLabel({ ...pageLabel, format: event.target.value as PageLabelFormat })}
                      >
                        {LABEL_FORMATS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={labelClass}>
                      ตำแหน่ง
                      <select
                        className={fieldClass}
                        value={pageLabel.position}
                        disabled={!pageLabel.enabled}
                        onChange={(event) => setPageLabel({ ...pageLabel, position: event.target.value as StampPosition })}
                      >
                        {LABEL_POSITIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={labelClass}>
                      เริ่มนับที่หน้า
                      <input
                        type="number"
                        min={1}
                        className={fieldClass}
                        value={pageLabel.startNumber}
                        disabled={!pageLabel.enabled}
                        onChange={(event) =>
                          setPageLabel({ ...pageLabel, startNumber: Math.max(1, Number(event.target.value) || 1) })
                        }
                      />
                    </label>
                    <label className={labelClass}>
                      ขนาดตัวอักษร (pt)
                      <input
                        type="number"
                        min={6}
                        max={36}
                        className={fieldClass}
                        value={pageLabel.fontSizePt}
                        disabled={!pageLabel.enabled}
                        onChange={(event) =>
                          setPageLabel({ ...pageLabel, fontSizePt: Math.min(36, Math.max(6, Number(event.target.value) || 11)) })
                        }
                      />
                    </label>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    ตัวอย่างหน้าแรก: <span className="font-semibold">{previewPageLabel(pageLabel, pages.length)}</span>
                  </p>
                </fieldset>

                <div className="border-t border-hairline-row pt-3 dark:border-white/[.07]">
                  <Button onClick={() => void exportPages(pages, 'ลายน้ำ')} isLoading={isBusy}>
                    <Download className="h-4 w-4" aria-hidden="true" /> บันทึก PDF พร้อมลายน้ำ
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}

          {tab === 'split' && (
            <Card id="pdf-panel-split" role="tabpanel" aria-labelledby="pdf-tab-split">
              <CardHeader className="flex items-center gap-2">
                <Scissors className="h-4 w-4" aria-hidden="true" /> แยกเป็นหลายไฟล์
              </CardHeader>
              <CardBody className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className={labelClass}>
                    วิธีแยก
                    <select
                      className={fieldClass}
                      value={splitMode}
                      onChange={(event) => setSplitMode(event.target.value as 'every' | 'ranges')}
                    >
                      <option value="every">แบ่งเท่า ๆ กันทุก N หน้า</option>
                      <option value="ranges">กำหนดช่วงหน้าเอง</option>
                    </select>
                  </label>
                  {splitMode === 'every' ? (
                    <label className={labelClass}>
                      จำนวนหน้าต่อไฟล์
                      <input
                        type="number"
                        min={1}
                        max={Math.max(1, pages.length)}
                        className={fieldClass}
                        value={splitSize}
                        onChange={(event) => setSplitSize(Math.max(1, Number(event.target.value) || 1))}
                      />
                    </label>
                  ) : (
                    <label className={labelClass}>
                      ช่วงหน้า (คั่นด้วยจุลภาค เช่น 1-3, 4, 5-8)
                      <input
                        type="text"
                        className={fieldClass}
                        value={splitRanges}
                        placeholder={`1-${Math.min(3, pages.length)}, ${Math.min(4, pages.length)}`}
                        onChange={(event) => setSplitRanges(event.target.value)}
                      />
                    </label>
                  )}
                </div>

                {splitPlan.error ? (
                  <p className="text-sm text-danger-700 dark:text-danger-200">{splitPlan.error}</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {splitPlan.parts.map((part, index) => (
                      <li key={`${part.label}-${index}`}>
                        <Badge variant="info">
                          ไฟล์ {index + 1}: {part.label} ({part.indices.length} หน้า)
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="border-t border-hairline-row pt-3 dark:border-white/[.07]">
                  <Button onClick={() => void exportSplit()} disabled={splitPlan.parts.length === 0} isLoading={isBusy}>
                    <Scissors className="h-4 w-4" aria-hidden="true" /> ดาวน์โหลด {splitPlan.parts.length} ไฟล์
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}
        </section>
      )}
    </div>
  );
}
