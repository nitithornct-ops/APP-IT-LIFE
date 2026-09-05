/**
 * กติกาการเชื่อมบัญชี LINE เข้ากับโปรไฟล์ในระบบ — เจ้าของเดียวของเงื่อนไขเหล่านี้
 *
 * แยกออกมาจาก routes/line.ts เพราะทั้งเส้นทางที่ผู้ใช้เชื่อมเองและเส้นทางที่ผู้ดูแลกดให้
 * ต้องตัดสินด้วยกติกาชุดเดียวกัน ถ้าปล่อยให้แต่ละ endpoint เขียนเงื่อนไขเอง
 * สองเส้นทางจะค่อย ๆ ห่างกันจนการแจ้งเตือนไปถึงคนละคนโดยไม่มีใครรู้
 */

export interface SelfLinkCandidate {
  /** โปรไฟล์ในระบบของผู้ที่กำลังขอเชื่อม (มาจาก Supabase JWT) */
  userId: string;
  profileStatus: string | null;
  /** สถานะและการเชื่อมปัจจุบันของบัญชี LINE ที่เพิ่งพิสูจน์ตัวตนผ่าน LINE Login */
  lineLinkStatus: string | null;
  lineLinkedUserId: string | null;
  /** มีบัญชี LINE ใบอื่นถือโปรไฟล์นี้อยู่แล้วหรือไม่ — ระบบบังคับหนึ่งต่อหนึ่ง */
  otherLineAccountLinked: boolean;
}

export type SelfLinkDecision =
  | { outcome: 'link' }
  | { outcome: 'already-linked' }
  | { outcome: 'reject'; code: string; message: string };

export function decideSelfLink(candidate: SelfLinkCandidate): SelfLinkDecision {
  if (candidate.profileStatus !== 'active') {
    return {
      outcome: 'reject',
      code: 'LINE_PROFILE_INACTIVE',
      message: 'เชื่อม LINE ได้เฉพาะบัญชีผู้ใช้สถานะ Active กรุณาติดต่อส่วนงาน IT',
    };
  }
  if (candidate.lineLinkStatus === 'Suspended') {
    return {
      outcome: 'reject',
      code: 'LINE_ACCOUNT_SUSPENDED',
      message: 'บัญชี LINE นี้ถูกระงับ กรุณาติดต่อส่วนงาน IT',
    };
  }
  if (candidate.lineLinkedUserId === candidate.userId) {
    return { outcome: 'already-linked' };
  }
  // การเชื่อมที่ผู้ดูแลตั้งไว้ต้องไม่ถูกย้ายเงียบ ๆ ด้วยการล็อกอิน LINE ครั้งใหม่ — กติกาเดียวกับที่
  // /callback ยึดไว้ตอน upsert ไม่เช่นนั้นผู้รับการแจ้งเตือนจะเปลี่ยนโดยไม่มีร่องรอยให้ตรวจ
  if (candidate.lineLinkedUserId) {
    return {
      outcome: 'reject',
      code: 'LINE_ACCOUNT_LINKED_ELSEWHERE',
      message: 'บัญชี LINE นี้ถูกเชื่อมกับผู้ใช้อื่นในระบบแล้ว กรุณาติดต่อส่วนงาน IT',
    };
  }
  if (candidate.otherLineAccountLinked) {
    return {
      outcome: 'reject',
      code: 'LINE_PROFILE_ALREADY_LINKED',
      message: 'บัญชีผู้ใช้ของท่านเชื่อมกับ LINE อื่นอยู่แล้ว กรุณายกเลิกการเชื่อมเดิมก่อน',
    };
  }
  return { outcome: 'link' };
}
