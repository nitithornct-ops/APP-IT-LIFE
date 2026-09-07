/**
 * ตัดเอกสารแบบฟอร์มหนึ่งก้อนออกเป็นหน้ากระดาษ A4 ทีละหน้า
 *
 * เดิมหน้าแบบฟอร์ม Ticket แสดงเนื้อหาทั้งหมดเป็นแผ่นเดียวยาว ๆ แล้วปล่อยให้เบราว์เซอร์ตัดหน้าเอง
 * ตอนสั่งพิมพ์ ผู้ใช้จึงไม่มีทางรู้ล่วงหน้าว่าตารางจะขาดกลางหน้าตรงไหน ไฟล์นี้ตัดหน้าเองจาก
 * ความสูงจริงที่วัดจาก DOM สิ่งที่เห็นบนจอกับสิ่งที่ออกจากเครื่องพิมพ์จึงเป็นชุดเดียวกัน
 *
 * ความสูงถูกส่งเข้ามาเป็นฟังก์ชัน (measureHeight) ไม่ได้เรียก offsetHeight ตรง ๆ ในนี้ เพื่อให้
 * ทดสอบตรรกะการจัดหน้าได้ใน jsdom ซึ่งคืนความสูงเป็น 0 เสมอ
 */

/** ชื่อ class ของตัวแบ่งหน้าที่ผู้ใช้สั่งเอง — ต้องตรงกับที่ sanitizeFormHtml ทั้งสองฝั่งอนุญาตไว้ */
export const PAGE_BREAK_CLASS = 'form-page-break';

export const PAGE_BREAK_HTML = `<div class="${PAGE_BREAK_CLASS}"></div>`;

export interface PaginateOptions {
  /** ความสูงของพื้นที่เนื้อหาในหนึ่งหน้า (px) ไม่รวมขอบกระดาษ */
  pageHeightPx: number;
  measureHeight: (element: HTMLElement) => number;
  /**
   * ตารางที่ยาวเกินหนึ่งหน้าจะถูกตัดตามแถวโดยคัดลอกหัวตารางไปทุกหน้า
   * ปิดได้เมื่ออยากให้ตารางอยู่ครบใบเดียวแม้จะล้นหน้า
   */
  splitTables?: boolean;
}

export interface PaginateResult {
  /** HTML ของแต่ละหน้า เรียงตามลำดับหน้า */
  pages: string[];
}

export function isPageBreak(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).classList.contains(PAGE_BREAK_CLASS);
}

/**
 * เอาเฉพาะ element ลูกชั้นบนสุด — ข้อความเปล่า ๆ ที่ไม่ได้ห่อด้วยแท็กจะถูกข้าม
 * แบบฟอร์มในระบบนี้ประกอบจาก p/h2/table ทั้งหมดอยู่แล้ว จึงไม่กระทบเนื้อหาจริง
 */
function blockChildren(root: HTMLElement): HTMLElement[] {
  return Array.from(root.children) as HTMLElement[];
}

function rowsOf(table: HTMLTableElement): HTMLTableRowElement[] {
  return Array.from(table.querySelectorAll<HTMLTableRowElement>(':scope > tbody > tr, :scope > tr'));
}

interface TableSplit {
  parts: HTMLTableElement[];
  /** ความสูงที่ส่วนสุดท้ายใช้ไป ใช้คำนวณว่าหน้าถัดไปยังเหลือที่เท่าไร */
  lastHeightPx: number;
  /** true เมื่อที่ว่างบนหน้าปัจจุบันน้อยเกินกว่าจะวางหัวตารางกับแถวแรกได้ */
  startsOnNewPage: boolean;
}

/**
 * แยกตารางหนึ่งใบเป็นหลายใบตามจำนวนแถวที่ลงในแต่ละหน้าได้ หัวตาราง (thead) ถูกคัดลอกไปทุกใบ
 * เพื่อให้หน้าถัดไปยังอ่านออกว่าคอลัมน์ไหนคืออะไร
 */
function splitTableByRows(
  table: HTMLTableElement,
  firstBudgetPx: number,
  fullBudgetPx: number,
  measureHeight: (element: HTMLElement) => number,
): TableSplit {
  const rows = rowsOf(table);
  if (rows.length < 2) {
    return { parts: [table], lastHeightPx: measureHeight(table), startsOnNewPage: false };
  }

  const head = table.querySelector<HTMLElement>(':scope > thead');
  const headHeightPx = head ? measureHeight(head) : 0;
  const startsOnNewPage = firstBudgetPx < headHeightPx + measureHeight(rows[0]);

  const parts: HTMLTableElement[] = [];
  const bodies: HTMLTableSectionElement[] = [];
  let usedPx = 0;
  let budgetPx = startsOnNewPage ? fullBudgetPx : firstBudgetPx;

  for (const row of rows) {
    const heightPx = measureHeight(row);
    const openBody = bodies[bodies.length - 1];
    // แถวแรกของแต่ละส่วนต้องลงเสมอ ไม่งั้นแถวที่สูงกว่าหนึ่งหน้าจะทำให้วนไม่รู้จบ
    const needsNewPart = !openBody || (openBody.childElementCount > 0 && usedPx + heightPx > budgetPx);
    if (needsNewPart) {
      const clone = table.cloneNode(false) as HTMLTableElement;
      if (head) clone.append(head.cloneNode(true));
      const body = table.ownerDocument.createElement('tbody');
      clone.append(body);
      parts.push(clone);
      bodies.push(body);
      usedPx = headHeightPx;
      if (parts.length > 1) budgetPx = fullBudgetPx;
    }
    bodies[bodies.length - 1].append(row.cloneNode(true));
    usedPx += heightPx;
  }

  return { parts, lastHeightPx: usedPx, startsOnNewPage };
}

/**
 * จัดเนื้อหาใน root ลงหน้ากระดาษ คืน HTML ของแต่ละหน้า
 *
 * root ต้องอยู่ในเอกสารจริงและมีความกว้างเท่ากับพื้นที่เนื้อหาของกระดาษแล้ว เพราะความสูงของ
 * แต่ละ block ขึ้นกับความกว้างที่ใช้ตัดบรรทัด
 */
export function paginateElement(root: HTMLElement, options: PaginateOptions): PaginateResult {
  const { pageHeightPx, measureHeight, splitTables = true } = options;
  const blocks = blockChildren(root);
  if (blocks.length === 0) return { pages: [] };
  if (pageHeightPx <= 0) return { pages: [root.innerHTML] };

  const pages: HTMLElement[][] = [[]];
  let usedPx = 0;

  const currentPage = () => pages[pages.length - 1];
  const startNewPage = () => {
    pages.push([]);
    usedPx = 0;
  };

  for (const block of blocks) {
    if (isPageBreak(block)) {
      // ตัวแบ่งหน้าที่อยู่ต้นเอกสารหรือวางซ้อนกันไม่ควรสร้างหน้าว่างเปล่า
      if (currentPage().length > 0) startNewPage();
      continue;
    }

    const heightPx = measureHeight(block);
    if (usedPx + heightPx <= pageHeightPx) {
      currentPage().push(block);
      usedPx += heightPx;
      continue;
    }

    if (splitTables && block.tagName.toLowerCase() === 'table') {
      const split = splitTableByRows(
        block as HTMLTableElement,
        pageHeightPx - usedPx,
        pageHeightPx,
        measureHeight,
      );
      if (split.parts.length > 1) {
        split.parts.forEach((part, index) => {
          if (index > 0 || (split.startsOnNewPage && currentPage().length > 0)) startNewPage();
          currentPage().push(part);
        });
        usedPx = split.lastHeightPx;
        continue;
      }
    }

    // block เดี่ยวที่สูงเกินหนึ่งหน้าตัดไม่ได้ ให้ขึ้นหน้าใหม่แล้ววางทั้งก้อนไป
    if (currentPage().length > 0) startNewPage();
    currentPage().push(block);
    usedPx = heightPx;
  }

  const rendered = pages
    .filter((page) => page.length > 0)
    .map((page) => page.map((element) => element.outerHTML).join(''));

  return { pages: rendered.length > 0 ? rendered : [root.innerHTML] };
}

/** 1 นิ้ว = 96 พิกเซล CSS ใช้แปลงขนาดกระดาษเป็นพิกเซลบนหน้าจอ */
export const MM_TO_PX = 96 / 25.4;

export interface PageGeometry {
  widthPx: number;
  heightPx: number;
  marginPx: number;
  contentWidthPx: number;
  contentHeightPx: number;
}

/**
 * ขอบกระดาษที่ @page ใช้ตอนพิมพ์ (ดู index.css) — ตอนพิมพ์ padding ของแผ่นถูกถอดออก แล้วให้ @page
 * เป็นคนกำหนดขอบแทน ถ้าแผ่นบนจอมีขอบแคบกว่านี้ เนื้อหาที่เคยพอดีบนจอจะล้นออกนอกหน้ากระดาษ
 */
export const PRINT_PAGE_MARGIN_MM = 10;

/** ขอบที่ใช้จริง — ไม่ยอมให้แคบกว่าขอบของ @page แม้ Form Studio จะตั้งไว้แคบกว่านั้น */
export function effectiveMarginMm(marginMm?: number): number {
  return Math.max(Number.isFinite(marginMm) ? Number(marginMm) : 20, PRINT_PAGE_MARGIN_MM);
}

export function pageGeometry(
  size: 'A4' | 'Letter' = 'A4',
  orientation: 'portrait' | 'landscape' = 'portrait',
  marginMm = 20,
): PageGeometry {
  const [shortMm, longMm] = size === 'Letter' ? [215.9, 279.4] : [210, 297];
  const widthMm = orientation === 'landscape' ? longMm : shortMm;
  const heightMm = orientation === 'landscape' ? shortMm : longMm;
  const widthPx = widthMm * MM_TO_PX;
  const heightPx = heightMm * MM_TO_PX;
  const marginPx = marginMm * MM_TO_PX;
  return {
    widthPx,
    heightPx,
    marginPx,
    contentWidthPx: widthPx - marginPx * 2,
    contentHeightPx: heightPx - marginPx * 2,
  };
}
