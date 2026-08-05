/**
 * ตรวจสอบสิทธิ์จากรายการ permission key ที่ผู้ใช้มี — ใช้ร่วมกันทั้ง Frontend (ซ่อน/ปิดเมนู)
 * และเป็นรูปแบบเดียวกับที่ Backend ใช้ตรวจซ้ำ (Backend ต้องตรวจจาก Database เสมอ ไม่เชื่อค่าจาก Frontend)
 */
export function hasPermission(userPermissionKeys: readonly string[], required: string): boolean {
  return userPermissionKeys.includes(required);
}

export function hasAnyPermission(userPermissionKeys: readonly string[], required: readonly string[]): boolean {
  return required.some((key) => userPermissionKeys.includes(key));
}

export function hasAllPermissions(userPermissionKeys: readonly string[], required: readonly string[]): boolean {
  return required.every((key) => userPermissionKeys.includes(key));
}
