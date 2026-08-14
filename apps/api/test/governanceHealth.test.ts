import { describe, expect, it } from 'vitest';
import { evaluateHealthSnapshot } from '../src/services/governanceHealth';

/**
 * ปุ่มตรวจสุขภาพระบบเคยบันทึก status = 'PASS' ตายตัวพร้อม detail ที่แต่งขึ้น โดยไม่เคยตรวจอะไรจริง
 * แถวเหล่านั้นคือ "หลักฐานการควบคุม" ที่ผู้ตรวจสอบภายนอกใช้อ้างอิง — จึงเท่ากับสร้างหลักฐานเท็จ
 * (พบตอน Pre-production QA audit 2026-08-13)
 *
 * ข้อกำหนดที่เทสต์ชุดนี้ยึดไว้: ไม่มีเส้นทางใดที่ให้ผล PASS โดยไม่มีข้อมูลจริงรองรับ
 */

const healthy = {
  checkedAt: '2026-08-13T10:00:00Z',
  database: { reachable: true, serverTime: '2026-08-13T10:00:00Z' },
  rls: { totalTables: 108, enabledTables: 108, unprotectedTables: [], policyCount: 240 },
  settings: { requiredPresent: 4, requiredExpected: 4 },
};

describe('evaluateHealthSnapshot', () => {
  it('passes only when every table has RLS and the required settings exist', () => {
    const result = evaluateHealthSnapshot(healthy);
    expect(result.status).toBe('PASS');
    expect(result.evidence.findings).toEqual([]);
    expect(result.evidence.rls).toMatchObject({ totalTables: 108, enabledTables: 108, policyCount: 240 });
  });

  it('fails when any table is left without RLS, and names the tables', () => {
    const result = evaluateHealthSnapshot({
      ...healthy,
      rls: { ...healthy.rls, enabledTables: 106, unprotectedTables: ['leaky_table', 'other_table'] },
    });
    expect(result.status).toBe('FAIL');
    expect(result.evidence.rls).toMatchObject({ unprotectedTables: ['leaky_table', 'other_table'] });
    expect(String(result.evidence.findings)).toContain('2 ตาราง');
  });

  it('fails when no RLS policy exists at all', () => {
    const result = evaluateHealthSnapshot({ ...healthy, rls: { ...healthy.rls, policyCount: 0 } });
    expect(result.status).toBe('FAIL');
  });

  it('warns — not passes — when a required setting is missing', () => {
    const result = evaluateHealthSnapshot({ ...healthy, settings: { requiredPresent: 3, requiredExpected: 4 } });
    expect(result.status).toBe('WARN');
    expect(String(result.evidence.findings)).toContain('3/4');
  });

  it('fails when the database returned an error instead of a snapshot', () => {
    const result = evaluateHealthSnapshot(null, 'function public.governance_health_snapshot() does not exist');
    expect(result.status).toBe('FAIL');
    expect(String(result.evidence.reason)).toContain('does not exist');
  });

  it('fails when the snapshot is absent, rather than assuming everything is fine', () => {
    expect(evaluateHealthSnapshot(null).status).toBe('FAIL');
    expect(evaluateHealthSnapshot(undefined).status).toBe('FAIL');
    expect(evaluateHealthSnapshot('unexpected').status).toBe('FAIL');
  });

  it('fails when the catalog reported no tables at all, which means the read did not work', () => {
    const result = evaluateHealthSnapshot({ ...healthy, rls: { totalTables: 0, enabledTables: 0, unprotectedTables: [], policyCount: 0 } });
    expect(result.status).toBe('FAIL');
  });

  it('marks the record as automated so a fabricated manual entry is distinguishable', () => {
    expect(evaluateHealthSnapshot(healthy).evidence.automated).toBe(true);
    expect(evaluateHealthSnapshot(null).evidence.automated).toBe(true);
  });
});
