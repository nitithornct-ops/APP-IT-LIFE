type Row = Record<string, unknown>;

/** Bound each source until report aggregation and filtering can be done in the database. */
const REPORT_MAX_SOURCE_ROWS = 5000;
const REPORT_PAGE_SIZE = 500;

type ReportPage = { data: unknown; count: number | null; error: { message: string } | null };

/** A safe, user-facing explanation that the requested dataset was not complete. */
export class IncompleteRowsError extends Error {}

// Fail closed when a complete dataset cannot be assembled.
export async function loadReportPages(label: string, fetchPage: (start: number, end: number) => PromiseLike<ReportPage>): Promise<Row[]> {
  const rows: Row[] = [];
  const ids = new Set<string>();
  let expected: number | null = null;
  do {
    const page = await fetchPage(rows.length, rows.length + REPORT_PAGE_SIZE - 1);
    if (page.error) throw new IncompleteRowsError(`ไม่สามารถโหลดข้อมูล ${label} ได้ กรุณาลองใหม่`);
    if (page.count === null) throw new IncompleteRowsError(`ไม่สามารถยืนยันจำนวนข้อมูล ${label} ได้`);
    if (expected !== null && page.count !== expected) throw new IncompleteRowsError(`ข้อมูล ${label} เปลี่ยนระหว่างสร้างรายงาน กรุณาลองใหม่`);
    expected = page.count;
    if (expected > REPORT_MAX_SOURCE_ROWS) throw new IncompleteRowsError(`ข้อมูล ${label} มี ${expected} รายการ เกินเพดาน ${REPORT_MAX_SOURCE_ROWS} รายการต่อแหล่งข้อมูล กรุณาปรับตัวกรองถ้ามี หรือติดต่อผู้ดูแลระบบ`);
    if (!Array.isArray(page.data) || (page.data.length === 0 && rows.length < expected)) throw new IncompleteRowsError(`ข้อมูล ${label} ไม่ครบ กรุณาลองใหม่`);
    for (const row of page.data as Row[]) {
      const id = String(row.id ?? '');
      if (!id || ids.has(id)) throw new IncompleteRowsError(`ข้อมูล ${label} เปลี่ยนระหว่างสร้างรายงาน กรุณาลองใหม่`);
      ids.add(id);
      rows.push(row);
    }
  } while (rows.length < expected);
  if (rows.length !== expected) throw new IncompleteRowsError(`ข้อมูล ${label} ไม่ครบ กรุณาลองใหม่`);
  return rows;
}
