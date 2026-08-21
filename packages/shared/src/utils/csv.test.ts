import { describe, expect, it } from 'vitest';
import { csvCell, csvRow, toCsv } from './csv';

describe('csvCell', () => {
  it('ครอบทุกค่าด้วยเครื่องหมายคำพูดและ escape คำพูดซ้อน', () => {
    expect(csvCell('ปกติ')).toBe('"ปกติ"');
    expect(csvCell('เขา "พูด" ว่า')).toBe('"เขา ""พูด"" ว่า"');
  });

  it('แปลงค่าว่างและ null เป็นเซลล์ว่าง', () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
    expect(csvCell('')).toBe('""');
  });

  it('กัน formula injection ทุกอักขระนำหน้าที่ Excel ตีความเป็นสูตร', () => {
    expect(csvCell('=cmd|\' /C calc\'!A0')).toBe('"\'=cmd|\' /C calc\'!A0"');
    expect(csvCell('+1+1')).toBe('"\'+1+1"');
    expect(csvCell('-1+1')).toBe('"\'-1+1"');
    expect(csvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
    expect(csvCell('\t=1+1')).toBe('"\'\t=1+1"');
  });

  it('ไม่แตะค่าที่มีอักขระสูตรอยู่กลางข้อความ', () => {
    expect(csvCell('A=B')).toBe('"A=B"');
  });

  it('รองรับตัวเลขและ boolean', () => {
    expect(csvCell(0)).toBe('"0"');
    expect(csvCell(false)).toBe('"false"');
  });
});

describe('csvRow / toCsv', () => {
  it('ต่อเซลล์ด้วยจุลภาคและต่อแถวด้วย CRLF', () => {
    expect(csvRow(['a', 'b'])).toBe('"a","b"');
    expect(toCsv([['หัวข้อ'], ['=1+1']])).toBe('"หัวข้อ"\r\n"\'=1+1"');
  });
});
