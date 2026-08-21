import { describe, expect, it } from 'vitest';
import { LIST_EXPORT_MAX_ROWS, checkExportSize, exportFileName, listCsv } from '../src/utils/listExport';

interface Row { code: string; name: string; price: number | null }

const columns = [
  { label: 'รหัส', value: (row: Row) => row.code },
  { label: 'ชื่อ', value: (row: Row) => row.name },
  { label: 'ราคา', value: (row: Row) => row.price },
];

describe('listCsv', () => {
  it('ใส่หัวตารางไว้บรรทัดแรกและดึงค่าจากแถวดิบ ไม่ใช่จากข้อความบนหน้าจอ', () => {
    const csv = listCsv(columns, [{ code: 'IT-001', name: 'โน้ตบุ๊ก', price: 25000 }]);
    expect(csv).toBe('"รหัส","ชื่อ","ราคา"\r\n"IT-001","โน้ตบุ๊ก","25000"');
  });

  it('กันสูตรที่ฝังมาในข้อมูลเหมือนกับที่อื่นทั้งระบบ', () => {
    const csv = listCsv(columns, [{ code: '=1+1', name: '@cmd', price: null }]);
    expect(csv).toContain('"\'=1+1"');
    expect(csv).toContain('"\'@cmd"');
    expect(csv).toContain('""');
  });

  it('ได้ไฟล์ที่มีแต่หัวตารางเมื่อไม่มีแถวตรงตัวกรอง แทนที่จะเป็นไฟล์ว่างเปล่า', () => {
    expect(listCsv(columns, [])).toBe('"รหัส","ชื่อ","ราคา"');
  });
});

describe('checkExportSize', () => {
  it('ผ่านเมื่อยังไม่เกินเพดาน', () => {
    expect(checkExportSize(0)).toBeNull();
    expect(checkExportSize(null)).toBeNull();
    expect(checkExportSize(LIST_EXPORT_MAX_ROWS)).toBeNull();
  });

  it('บอกจำนวนที่ตรงตัวกรองกลับไปด้วย ผู้ใช้จะได้รู้ว่าต้องกรองให้แคบลงแค่ไหน', () => {
    const result = checkExportSize(LIST_EXPORT_MAX_ROWS + 1);
    expect(result?.totalRows).toBe(LIST_EXPORT_MAX_ROWS + 1);
    expect(result?.message).toContain('5,001');
    expect(result?.message).toContain('5,000');
  });
});

describe('exportFileName', () => {
  it('ติดวันที่ไว้ในชื่อไฟล์ ไฟล์หลายรอบจะได้ไม่ทับกัน', () => {
    expect(exportFileName('tickets', new Date('2026-08-21T10:00:00Z'))).toBe('tickets-2026-08-21.csv');
  });
});
