/**
 * กติกาการถือครองทรัพย์สิน — เจ้าของเดียวของ "ยืม/มอบหมาย" กับ "คืน"
 *
 * แยกออกมาก่อนเขียน endpoint แบบหลายรายการ ด้วยเหตุผลเดียวกับที่แยก state machine ของ Ticket:
 * ถ้าปล่อยให้เส้นทางทีละชิ้นกับทีละชุดเขียนฟิลด์ที่ต้องอัปเดตเอง สองเส้นทางจะค่อย ๆ ห่างกัน
 * จนมอบหมายทีละชิ้นกับทีละชุดได้ผลไม่ตรงกัน ซึ่งเป็นบั๊กที่หาเจอยากที่สุดประเภทหนึ่ง
 */

/** ทรัพย์สินที่ออกจากทะเบียนใช้งานแล้ว — ห้ามยืม/โอน/ส่งซ่อมต่อ */
export const ASSET_RETIRED_STATUSES = ['จำหน่าย/เลิกใช้', 'สูญหาย'];

/** ที่เก็บตั้งต้นเมื่อคืนของโดยไม่ระบุสถานที่ */
export const ASSET_DEFAULT_RETURN_LOCATION = 'คลัง IT';

export function isAssetRetired(status: unknown): boolean {
  return ASSET_RETIRED_STATUSES.includes(String(status));
}

interface AssignPatchInput {
  toEmployeeId: string;
  /** แผนกของผู้รับ ใช้เมื่อผู้เรียกไม่ได้ระบุแผนกปลายทางมาเอง */
  employeeDepartmentId: string | null;
  departmentId?: string;
  location?: string;
  currentLocation: string | null;
  dueDate?: string;
  actorId: string;
  now: Date;
}

/** ยืม/มอบหมายให้พนักงาน → สถานะ "ใช้งานอยู่" พร้อมบันทึกวันที่เริ่มถือครอง */
export function buildAssignPatch(input: AssignPatchInput): Record<string, unknown> {
  return {
    status: 'ใช้งานอยู่',
    owner_employee_id: input.toEmployeeId,
    department_id: input.departmentId || input.employeeDepartmentId,
    location: input.location || input.currentLocation,
    loan_date: input.now.toISOString().slice(0, 10),
    loan_due_date: input.dueDate || null,
    updated_by: input.actorId,
  };
}

/** คืนของ → กลับเป็น "พร้อมใช้งาน" และล้างผู้ถือครองทั้งหมด ไม่ใช่แค่เปลี่ยนสถานะ */
export function buildReturnPatch(input: { location?: string; actorId: string }): Record<string, unknown> {
  return {
    status: 'พร้อมใช้งาน',
    owner_employee_id: null,
    department_id: null,
    location: input.location || ASSET_DEFAULT_RETURN_LOCATION,
    loan_date: null,
    loan_due_date: null,
    updated_by: input.actorId,
  };
}
