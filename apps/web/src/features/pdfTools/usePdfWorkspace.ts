import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createWorkPages,
  imageToPdfBytes,
  normalizeAngle,
  readPdfSource,
  type PdfSource,
  type WorkPage,
} from './pdfDocumentEngine';
import { imageFileToPngBytes, isImageFile, isPdfFile, readFileBytes } from './pdfBrowser';
import type { ThumbnailRenderer } from './pdfThumbnails';

/**
 * สถานะของพื้นที่ทำงานเดียวที่ใช้ร่วมกันทุกเครื่องมือในหน้า PDF
 *
 * ทั้งการรวมไฟล์ แยกไฟล์ ลบหน้า สลับลำดับ และหมุนหน้า คือ "รายการหน้า" ชุดเดียวที่ถูกแก้ต่างวิธีกัน
 * เก็บไว้ที่เดียวจึงไม่ต้องมีสถานะซ้ำต่อเครื่องมือ และผู้ใช้ไม่ต้องเลือกไฟล์ใหม่ทุกครั้งที่สลับแท็บ
 */

/** ความกว้างของภาพย่อบนจอ (px) — ตรงกับความกว้างการ์ดใน PdfToolsPage */
const THUMBNAIL_WIDTH = 148;

/** รวมภาพย่อหลายหน้าก่อนสั่ง re-render หนึ่งครั้ง ไม่งั้นไฟล์ร้อยหน้าจะทำให้หน้าจอกระตุก */
const THUMBNAIL_FLUSH_SIZE = 6;

export type ThumbnailMap = Record<string, string>;

/** คีย์ของภาพย่อผูกกับหน้าในไฟล์ต้นทาง ไม่ผูกกับการ์ด เพราะหน้าที่ทำสำเนาใช้ภาพย่อใบเดียวกันได้ */
export function thumbnailKey(sourceId: string, sourceIndex: number): string {
  return `${sourceId}:${sourceIndex}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่รู้จัก';
}

export interface PdfWorkspace {
  sources: PdfSource[];
  pages: WorkPage[];
  thumbnails: ThumbnailMap;
  /** true เมื่อ pdf.js โหลดไม่สำเร็จ — หน้ายังใช้งานได้ครบ แค่ไม่มีภาพย่อ */
  previewUnavailable: boolean;
  isLoadingFiles: boolean;
  loadErrors: string[];
  canUndo: boolean;
  addFiles: (files: File[]) => Promise<void>;
  rotatePages: (pageIds: readonly string[], delta: number) => void;
  removePages: (pageIds: readonly string[]) => void;
  duplicatePages: (pageIds: readonly string[]) => void;
  movePage: (pageId: string, offset: number) => void;
  reorderPage: (pageId: string, targetIndex: number) => void;
  reversePages: () => void;
  undo: () => void;
  reset: () => void;
  dismissErrors: () => void;
}

export function usePdfWorkspace(): PdfWorkspace {
  const [sources, setSources] = useState<PdfSource[]>([]);
  const [pages, setPages] = useState<WorkPage[]>([]);
  const [thumbnails, setThumbnails] = useState<ThumbnailMap>({});
  const [previewUnavailable, setPreviewUnavailable] = useState(false);
  const [isLoadingFiles, setLoadingFiles] = useState(false);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  /** เก็บแค่ความลึกไว้ให้ปุ่มย้อนกลับรู้ว่ากดได้ไหม ตัวประวัติจริงอยู่ใน historyRef */
  const [historyDepth, setHistoryDepth] = useState(0);

  const sourceSeq = useRef(0);
  const pageSeq = useRef(0);
  const renderers = useRef(new Map<string, ThumbnailRenderer>());
  const alive = useRef(true);
  /** เงาของ pages และประวัติย้อนกลับ ไว้อ่านค่าล่าสุดนอก render — ดูเหตุผลที่ commit() */
  const pagesRef = useRef<WorkPage[]>([]);
  const historyRef = useRef<WorkPage[][]>([]);

  useEffect(() => {
    alive.current = true;
    const openRenderers = renderers.current;
    return () => {
      alive.current = false;
      for (const renderer of openRenderers.values()) renderer.destroy();
      openRenderers.clear();
    };
  }, []);

  const nextPageId = useCallback(() => `page-${(pageSeq.current += 1)}`, []);

  /** เขียนรายการหน้าใหม่พร้อมเก็บสถานะก่อนแก้ไว้ให้ปุ่มย้อนกลับ จำกัดความลึกไว้ไม่ให้กินหน่วยความจำ
   *
   * คำนวณค่าถัดไปจาก pagesRef ไม่ใช่ในฟังก์ชัน updater ของ setPages เพราะ React เรียก updater
   * ซ้ำสองครั้งใน StrictMode ถ้าเก็บประวัติไว้ข้างใน ทุกคำสั่งจะดันประวัติซ้ำ แล้วปุ่มย้อนกลับ
   * ครั้งแรกจะดูเหมือนไม่ทำอะไร
   */
  const commit = useCallback((update: (current: WorkPage[]) => WorkPage[]) => {
    const current = pagesRef.current;
    const next = update(current);
    if (next === current) return;
    pagesRef.current = next;
    historyRef.current = [...historyRef.current.slice(-19), current];
    setHistoryDepth(historyRef.current.length);
    setPages(next);
  }, []);

  const renderThumbnails = useCallback(async (source: PdfSource) => {
    let renderer: ThumbnailRenderer;
    try {
      const { createThumbnailRenderer } = await import('./pdfThumbnails');
      if (!alive.current) return;
      renderer = await createThumbnailRenderer(source.bytes);
    } catch {
      if (alive.current) setPreviewUnavailable(true);
      return;
    }
    if (!alive.current) {
      renderer.destroy();
      return;
    }
    renderers.current.set(source.id, renderer);

    let buffer: ThumbnailMap = {};
    const flush = () => {
      if (Object.keys(buffer).length === 0) return;
      const pending = buffer;
      buffer = {};
      setThumbnails((current) => ({ ...current, ...pending }));
    };

    for (let index = 0; index < source.pageCount; index += 1) {
      if (!alive.current || !renderers.current.has(source.id)) break;
      try {
        buffer[thumbnailKey(source.id, index)] = await renderer.render(index, THUMBNAIL_WIDTH);
      } catch {
        // หน้าที่วาดไม่ได้จะแสดงเป็นการ์ดว่างพร้อมเลขหน้า ไม่ควรทำให้ทั้งไฟล์ใช้ไม่ได้
      }
      if (Object.keys(buffer).length >= THUMBNAIL_FLUSH_SIZE) flush();
    }
    if (alive.current) flush();
  }, []);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setLoadingFiles(true);
      setLoadErrors([]);
      const errors: string[] = [];
      const added: PdfSource[] = [];
      const appended: WorkPage[] = [];

      for (const file of files) {
        try {
          const id = `source-${(sourceSeq.current += 1)}`;
          let bytes: Uint8Array;
          if (isPdfFile(file)) {
            bytes = await readFileBytes(file);
          } else if (isImageFile(file)) {
            bytes = await imageToPdfBytes(await imageFileToPngBytes(file), 'a4');
          } else {
            errors.push(`ข้ามไฟล์ "${file.name}" — รับเฉพาะไฟล์ PDF และรูปภาพ`);
            continue;
          }
          const source = await readPdfSource(id, file.name, bytes);
          added.push(source);
          appended.push(...createWorkPages(source, nextPageId));
        } catch (error) {
          errors.push(messageOf(error));
        }
      }

      if (!alive.current) return;
      if (added.length > 0) {
        setSources((current) => [...current, ...added]);
        // การเพิ่มไฟล์ไม่เข้าประวัติย้อนกลับ ผู้ใช้ที่อยากเอาออกใช้ปุ่มลบหน้าหรือเริ่มใหม่แทน
        pagesRef.current = [...pagesRef.current, ...appended];
        setPages(pagesRef.current);
        for (const source of added) void renderThumbnails(source);
      }
      setLoadErrors(errors);
      setLoadingFiles(false);
    },
    [nextPageId, renderThumbnails],
  );

  const rotatePages = useCallback(
    (pageIds: readonly string[], delta: number) => {
      if (pageIds.length === 0) return;
      const targets = new Set(pageIds);
      commit((current) =>
        current.map((page) =>
          targets.has(page.id) ? { ...page, rotation: normalizeAngle(page.rotation + delta) } : page,
        ),
      );
    },
    [commit],
  );

  const removePages = useCallback(
    (pageIds: readonly string[]) => {
      if (pageIds.length === 0) return;
      const targets = new Set(pageIds);
      commit((current) => current.filter((page) => !targets.has(page.id)));
    },
    [commit],
  );

  const duplicatePages = useCallback(
    (pageIds: readonly string[]) => {
      if (pageIds.length === 0) return;
      const targets = new Set(pageIds);
      commit((current) =>
        current.flatMap((page) => (targets.has(page.id) ? [page, { ...page, id: nextPageId() }] : [page])),
      );
    },
    [commit, nextPageId],
  );

  const movePage = useCallback(
    (pageId: string, offset: number) => {
      commit((current) => {
        const from = current.findIndex((page) => page.id === pageId);
        if (from < 0) return current;
        const to = Math.min(current.length - 1, Math.max(0, from + offset));
        if (to === from) return current;
        const next = [...current];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    },
    [commit],
  );

  const reorderPage = useCallback(
    (pageId: string, targetIndex: number) => {
      commit((current) => {
        const from = current.findIndex((page) => page.id === pageId);
        if (from < 0) return current;
        const to = Math.min(current.length - 1, Math.max(0, targetIndex));
        if (to === from) return current;
        const next = [...current];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    },
    [commit],
  );

  const reversePages = useCallback(() => {
    commit((current) => (current.length < 2 ? current : [...current].reverse()));
  }, [commit]);

  const undo = useCallback(() => {
    const stack = historyRef.current;
    if (stack.length === 0) return;
    const previous = stack[stack.length - 1];
    historyRef.current = stack.slice(0, -1);
    pagesRef.current = previous;
    setHistoryDepth(historyRef.current.length);
    setPages(previous);
  }, []);

  const reset = useCallback(() => {
    for (const renderer of renderers.current.values()) renderer.destroy();
    renderers.current.clear();
    setSources([]);
    pagesRef.current = [];
    setPages([]);
    setThumbnails({});
    historyRef.current = [];
    setHistoryDepth(0);
    setLoadErrors([]);
  }, []);

  const dismissErrors = useCallback(() => setLoadErrors([]), []);

  return {
    sources,
    pages,
    thumbnails,
    previewUnavailable,
    isLoadingFiles,
    loadErrors,
    canUndo: historyDepth > 0,
    addFiles,
    rotatePages,
    removePages,
    duplicatePages,
    movePage,
    reorderPage,
    reversePages,
    undo,
    reset,
    dismissErrors,
  };
}
