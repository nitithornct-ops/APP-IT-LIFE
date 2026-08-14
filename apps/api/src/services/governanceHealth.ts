/**
 * แปลงผลดิบจาก public.governance_health_snapshot() เป็นสถานะ PASS/WARN/FAIL พร้อมหลักฐาน
 *
 * เดิมปุ่มตรวจสุขภาพระบบบันทึก status = 'PASS' ตายตัวพร้อม detail ที่แต่งขึ้นเอง โดยไม่เคยตรวจอะไรจริง
 * แถวเหล่านั้นถูกใช้เป็นหลักฐานการควบคุมให้ผู้ตรวจสอบภายนอก จึงเท่ากับระบบผลิตหลักฐานเท็จ
 * (พบตอน Pre-production QA audit 2026-08-13)
 *
 * กติกาสำคัญ: เรียกฟังก์ชันไม่สำเร็จ = FAIL เสมอ ห้ามตีความว่า "ไม่มีปัญหา"
 */

export type HealthStatus = 'PASS' | 'WARN' | 'FAIL';

export interface HealthEvidence {
  status: HealthStatus;
  evidence: Record<string, unknown>;
}

interface RlsFacts {
  totalTables?: number;
  enabledTables?: number;
  unprotectedTables?: unknown;
  policyCount?: number;
}

interface Snapshot {
  checkedAt?: string;
  database?: { reachable?: boolean; serverTime?: string };
  rls?: RlsFacts;
  settings?: { requiredPresent?: number; requiredExpected?: number };
}

export function evaluateHealthSnapshot(raw: unknown, errorMessage?: string): HealthEvidence {
  if (errorMessage || !raw || typeof raw !== 'object') {
    return {
      status: 'FAIL',
      evidence: {
        outcome: 'ตรวจสุขภาพระบบไม่สำเร็จ',
        reason: errorMessage ?? 'ฐานข้อมูลไม่ได้คืนผลการตรวจ',
        automated: true,
      },
    };
  }

  const snapshot = raw as Snapshot;
  const rls = snapshot.rls ?? {};
  const totalTables = Number(rls.totalTables ?? 0);
  const enabledTables = Number(rls.enabledTables ?? 0);
  const unprotected = Array.isArray(rls.unprotectedTables) ? (rls.unprotectedTables as string[]) : [];
  const policyCount = Number(rls.policyCount ?? 0);
  const requiredPresent = Number(snapshot.settings?.requiredPresent ?? 0);
  const requiredExpected = Number(snapshot.settings?.requiredExpected ?? 0);

  const findings: string[] = [];
  if (totalTables === 0) findings.push('อ่านรายการตารางไม่ได้');
  if (unprotected.length > 0) findings.push(`มี ${unprotected.length} ตารางที่ยังไม่เปิด RLS`);
  if (policyCount === 0 && totalTables > 0) findings.push('ไม่พบ RLS policy ในสคีมา public');
  if (requiredExpected > 0 && requiredPresent < requiredExpected) {
    findings.push(`ค่าตั้งค่าที่จำเป็นมีไม่ครบ (${requiredPresent}/${requiredExpected})`);
  }

  // ตารางที่ไม่มี RLS คือช่องเปิดของข้อมูล ถือเป็น FAIL ส่วนค่าตั้งค่าไม่ครบเป็นเพียงคำเตือน
  const status: HealthStatus =
    totalTables === 0 || unprotected.length > 0 || (policyCount === 0 && totalTables > 0)
      ? 'FAIL'
      : findings.length > 0
        ? 'WARN'
        : 'PASS';

  return {
    status,
    evidence: {
      automated: true,
      checkedAt: snapshot.checkedAt ?? null,
      database: { reachable: true, serverTime: snapshot.database?.serverTime ?? null },
      rls: { totalTables, enabledTables, policyCount, unprotectedTables: unprotected },
      settings: { requiredPresent, requiredExpected },
      findings,
    },
  };
}
