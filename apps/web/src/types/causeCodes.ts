/** ตรงกับ apps/api/src/routes/causeCodes.ts (migration 20260921100000) */

export interface CauseCode {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category_id: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  category: { id: string; name: string } | null;
}

/** บทความ KB ที่สร้างจากใบงาน — ใช้เท่าที่หน้าปิดงานต้องรู้เพื่อพาผู้ใช้ไปต่อ */
export interface CreatedKnowledgeArticle {
  id: string;
  article_code: string;
  title: string;
  status: string;
}
