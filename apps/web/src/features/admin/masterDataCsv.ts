export interface ParsedMasterDataCsvRow {
  code: string;
  name: string;
  status?: 'active' | 'inactive';
  effectiveDate?: string;
  sortOrder?: number;
}

function parseCsvCells(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (character === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1;
      row.push(cell.trim());
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }

  if (quoted) throw new Error('CSV มีเครื่องหมายอัญประกาศไม่ครบ');
  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function headerKey(value: string): string {
  return value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function valueAt(row: string[], headers: Map<string, number>, ...names: string[]): string {
  for (const name of names) {
    const index = headers.get(headerKey(name));
    if (index !== undefined) return row[index] ?? '';
  }
  return '';
}

export function parseMasterDataCsv(text: string): ParsedMasterDataCsvRow[] {
  const rows = parseCsvCells(text);
  if (rows.length < 2) throw new Error('CSV ต้องมีหัวตารางและข้อมูลอย่างน้อย 1 แถว');
  const headers = new Map(rows[0].map((value, index) => [headerKey(value), index]));
  const hasCode = ['code', 'รหัส'].some((name) => headers.has(headerKey(name)));
  const hasName = ['name', 'ชื่อ', 'nameth', 'ชื่อภาษาไทย'].some((name) => headers.has(headerKey(name)));
  if (!hasCode || !hasName) throw new Error('CSV ต้องมีคอลัมน์ Code และ Name');

  return rows.slice(1).map((row, index) => {
    const code = valueAt(row, headers, 'code', 'รหัส').toUpperCase();
    const name = valueAt(row, headers, 'name', 'ชื่อ', 'name_th', 'ชื่อภาษาไทย');
    const statusValue = valueAt(row, headers, 'status', 'สถานะ').toLowerCase();
    const effectiveDate = valueAt(row, headers, 'effective_date', 'effectiveDate', 'วันที่มีผล') || undefined;
    const sortValue = valueAt(row, headers, 'sort_order', 'sortOrder', 'ลำดับ');
    const sortOrder = sortValue ? Number(sortValue) : undefined;
    if (!code || !name) throw new Error(`แถวที่ ${index + 2} ต้องมี Code และ Name`);
    if (statusValue && !['active', 'inactive', 'ใช้งาน', 'ระงับ'].includes(statusValue)) throw new Error(`สถานะในแถวที่ ${index + 2} ไม่ถูกต้อง`);
    if (effectiveDate && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) throw new Error(`วันที่ในแถวที่ ${index + 2} ต้องเป็น YYYY-MM-DD`);
    if (sortValue && (!Number.isInteger(sortOrder) || (sortOrder ?? -1) < 0)) throw new Error(`Sort Order ในแถวที่ ${index + 2} ต้องเป็นเลขจำนวนเต็ม`);
    return {
      code,
      name,
      status: statusValue === 'inactive' || statusValue === 'ระงับ' ? 'inactive' : 'active',
      effectiveDate,
      sortOrder,
    };
  });
}
