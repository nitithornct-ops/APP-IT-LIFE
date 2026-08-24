import { describe, expect, it } from 'vitest';
import { buildDataset, REPORTS, type Directory } from '../src/routes/reports';

const config = REPORTS['asset-custody'];
const source = config.sources[0]!;
const definition = { key: config.key, label: config.label, description: config.description, sourcePermissions: config.sourcePermissions, sortOrder: config.sortOrder };

const directory: Directory = new Map([
  ['emp-a', { name: 'นายสมชาย ใจดี', code: 'EMP-001', department: 'บัญชี' }],
  ['emp-b', { name: 'นางสาวมาลี รักงาน', code: 'EMP-002', department: 'ไอที' }],
]);

function assignment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'assign-1', employee_id: 'emp-a', category: 'Notebook', item_name: 'Dell Latitude 5440',
    asset_code: null, asset_number: null, serial_number: 'SN-1234', mac_address: null,
    status: 'ครอบครอง', assigned_date: '2026-03-02', returned_date: null,
    created_at: '2026-03-01T02:00:00.000Z', asset: null,
    ...overrides,
  };
}

function dataset(rows: Record<string, unknown>[]) {
  return buildDataset(config, definition, rows.map((row) => source.map(row, directory)), 0);
}

describe('ทะเบียนคุมทรัพย์สินรายพนักงาน', () => {
  it('แปลง uuid พนักงานเป็นชื่อ รหัส และหน่วยงานที่อ่านออก', () => {
    const [row] = dataset([assignment()]).rows;
    expect(row).toMatchObject({
      employeeCode: 'EMP-001', owner: 'นายสมชาย ใจดี', department: 'บัญชี',
      category: 'Notebook', title: 'Dell Latitude 5440', serialNumber: 'SN-1234',
      status: 'ครอบครอง', assignedDate: '2 มี.ค. 2569', returnedDate: '—',
    });
  });

  it('ยึดรหัสจาก Asset Register ก่อน แล้วค่อยถอยไปใช้รหัสที่กรอกเอง', () => {
    const rows = dataset([
      assignment({ id: 'a', category: 'Computer', asset: { asset_code: 'AST-0001' }, asset_code: 'พิมพ์มือ' }),
      assignment({ id: 'b', category: 'Monitor', asset_code: 'LIC-777' }),
      assignment({ id: 'c', category: 'Notebook', asset_number: 'NO-9' }),
    ]).rows;
    expect(rows.map((row) => row.code)).toEqual(['AST-0001', 'LIC-777', 'NO-9']);
  });

  it("นับ 'คืนแล้ว' เป็นรายการที่ปิดแล้ว ไม่ใช่งานค้าง", () => {
    const result = dataset([
      assignment({ id: 'held' }),
      assignment({ id: 'returned', status: 'คืนแล้ว', returned_date: '2026-05-10' }),
      assignment({ id: 'repair', employee_id: 'emp-b', status: 'ส่งซ่อม' }),
      assignment({ id: 'lost', employee_id: 'emp-b', status: 'สูญหาย' }),
    ]);
    expect(result.metrics.map((metric) => [metric.label, metric.value])).toEqual([
      ['รายการที่ถือครองอยู่', 1], ['พนักงานที่ถือครอง', 2], ['อยู่ระหว่างส่งซ่อม', 1], ['แจ้งสูญหาย', 1],
    ]);
    expect(result.alerts).toEqual([
      'มี 1 รายการที่แจ้งสูญหายและยังไม่ได้ปิดเรื่อง',
      'มี 1 รายการอยู่ระหว่างส่งซ่อม ยังไม่กลับไปถึงผู้ถือครอง',
    ]);
  });

  it("นับ 'พนักงานที่ถือครอง' ด้วยนิยามเดียวกับหน้าพนักงาน — ของหายไม่นับว่ายังถือครอง", () => {
    // หน้าพนักงานนับจาก status in ('ครอบครอง','ส่งซ่อม') ที่ routes/employees.ts
    // ถ้ารายงานนับ 'สูญหาย' ด้วย ตัวเลขสองหน้าจะไม่ตรงกันทั้งที่ใช้คำเดียวกัน
    const result = dataset([
      assignment({ id: 'held', employee_id: 'emp-a' }),
      assignment({ id: 'lost-only', employee_id: 'emp-b', status: 'สูญหาย' }),
    ]);
    expect(result.metrics.find((metric) => metric.label === 'พนักงานที่ถือครอง')?.value).toBe(1);
  });

  it('เรียงของทุกชิ้นของคนเดียวกันให้ติดกัน เพื่อให้พิมพ์เป็นใบทะเบียนคุมได้', () => {
    const rows = dataset([
      assignment({ id: '1', employee_id: 'emp-b', category: 'Monitor' }),
      assignment({ id: '2', employee_id: 'emp-a', category: 'Notebook' }),
      assignment({ id: '3', employee_id: 'emp-b', category: 'Computer' }),
    ]).rows;
    expect(rows.map((row) => [row.owner, row.category])).toEqual([
      ['นางสาวมาลี รักงาน', 'Computer'],
      ['นางสาวมาลี รักงาน', 'Monitor'],
      ['นายสมชาย ใจดี', 'Notebook'],
    ]);
  });

  it('ใช้คอลัมน์ของทะเบียนคุมเอง ไม่ใช่คอลัมน์มาตรฐานที่มีช่องครบกำหนด', () => {
    const columns = dataset([assignment()]).columns.map((column) => column.key);
    expect(columns).toEqual(['employeeCode', 'owner', 'department', 'category', 'title', 'code', 'serialNumber', 'status', 'assignedDate', 'returnedDate']);
    expect(columns).not.toContain('dueDate');
  });

  it('ไม่ตกหล่นเมื่อหาพนักงานในทะเบียนชื่อไม่เจอ', () => {
    const [row] = dataset([assignment({ employee_id: 'emp-หาย' })]).rows;
    expect(row).toMatchObject({ owner: '—', employeeCode: '', department: '' });
  });
});
