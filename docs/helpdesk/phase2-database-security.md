# Help Desk — Phase 2 Database & Security

Phase 2 ต่อเติมโมดูล Ticket เดิมแบบ backward compatible และไม่สร้างตารางซ้ำกับ User, Department, Asset,
Notification, Attachment, Audit หรือ Knowledge Base

## Schema decision

| Requirement | Implementation |
|---|---|
| Ticket | ขยาย `tickets`; ไม่สร้าง `helpdesk_tickets` |
| Ticket number | `ticket_number_counters` + `allocate_ticket_number()` + insert trigger |
| Category | ใช้ `ticket_categories`; เพิ่ม `sort_order` |
| Subcategory | เพิ่ม `ticket_subcategories` |
| Priority | เพิ่ม `ticket_priorities`; `ticket_value` map ค่าไทยเดิมกับ code LOW–URGENT |
| Status/workflow | เพิ่ม `ticket_statuses` และ `ticket_status_transitions` |
| SLA | เพิ่ม `ticket_sla_policies`, fields บน `tickets` และ append-only `ticket_sla_events` |
| Comment/internal note/worklog/timeline | ขยาย `ticket_worklogs` เป็น unified ledger ด้วย `entry_type` |
| Attachment | ใช้ private `file_attachments`/Storage เดิม |
| Asset | `tickets.asset_id -> assets.id` |
| Knowledge Base | `knowledge_articles.source_ticket_id -> tickets.id` |
| Satisfaction | ใช้ `tickets.rating/feedback/feedback_at` เดิม; DB guard ให้ requester เท่านั้น |
| Audit/notification | ใช้ service เดิม; action-level integration ทำใน Phase 3–6 |

ชื่อ compatibility ที่เก็บไว้:

- `tickets.acknowledged_at` ทำหน้าที่ accepted time
- `tickets.due_at` ทำหน้าที่ resolution due time
- priority/status ภาษาไทยเดิมยังเป็นค่าที่ API/UI ใช้; master tables เพิ่ม stable English code

## Ticket fields ที่เพิ่ม

`ticket_no`, `department_id`, `subcategory_id`, `asset_id`, `room`, `building`, `started_at`, `first_response_at`,
`root_cause`, `sla_policy_id`, `sla_paused_at`, `sla_paused_minutes`, `deleted_at`

Indexes ครอบคลุม ticket number, requester/assignee เดิม, department, subcategory, asset, status + due date, created date
และ full-text search สำหรับ ticket number/title/description

## Security controls

1. Ticket number สร้างที่ database ด้วย atomic upsert ต่อปี พ.ศ.; client ระบุเลขเองไม่ได้
2. `ticket.view` ไม่ให้สิทธิ์เห็นทั้งองค์กร; RLS ใช้ requester/assignee หรือ `ticket.view_all`
3. requester update policy เดิมถูกเสริมด้วย trigger ให้แก้ได้เฉพาะ satisfaction fields
4. ผู้ให้คะแนนต้องเป็น requester และ Ticket ต้อง RESOLVED/CLOSED; คะแนนที่ส่งแล้วแก้ไม่ได้
5. assignee ต้องเป็น active profile ที่มี `ticket.update` หรือ `ticket.assign`
6. status transition ต้องอยู่ในตาราง transition และ permission ถูกตรวจซ้ำใน DB
7. internal note ไม่ผ่าน RLS ไปยัง requester
8. requester เพิ่มได้เฉพาะ public `comment` ของ Ticket ตนเองที่ยังไม่ปิด
9. counters และ permission helper ภายในถูก revoke จาก `anon`/`authenticated`
10. SLA event/worklog เป็น append-only ไม่มี update/delete policy
11. Attachment participant policy เปลี่ยนจาก `ticket.view` เป็น `ticket.view_all`
12. ไม่มี secret หรือ service-role key เพิ่มใน source code

## Seed data

- 4 priorities: LOW, MEDIUM, HIGH, URGENT
- 10 statuses รวม 8 สถานะหลักและ compatibility statuses สำหรับ Outsource/Incident
- 4 SLA policies: 8 ชม./3 วันทำการ, 4 ชม./2 วันทำการ, 2 ชม./1 วันทำการ, 30 นาที/4 ชม.
- 10 หมวดหมู่เริ่มต้นที่รวมรายการใกล้เคียงเพื่อให้หน้าจอไม่รก; Admin เพิ่ม/ปิด/เรียงลำดับได้
- permissions ใหม่: `ticket.view_all`, `ticket.comment`, `ticket.internal_note`, `ticket.worklog`,
  `ticket.settings.manage`

Seed เป็น idempotent และไม่มี DROP/DELETE/reset

## Known boundary for later phases

- `business_hours_only` และเวลานโยบายถูกเก็บแล้ว แต่ calculation ที่ข้ามวันหยุด/นอกเวลาทำการเป็น Phase 5
- API ปัจจุบันยังใช้ transition map ใน TypeScript ควบคู่ DB; Phase 4 ควรอ่าน allowed transitions จาก DB เพื่อลด drift
- Comment/internal note/worklog endpoints และ UI tabs เป็น Phase 4
- Notification/audit trigger ต่อ action ทำผ่าน services เดิมใน Phase 3–6
- Production migration ยังไม่ถูกรัน; ต้อง backup, review และ environment approval ก่อน `supabase db push`

## Verification

`supabase/tests/helpdeskFoundation.test.ts` ครอบคลุม:

- seed priority/status/category/SLA
- Ticket number uniqueness/format
- Ticket visibility ระหว่าง User สองคนที่มี role `user` เหมือนกัน
- requester mass-assignment rejection
- public comment และ internal-note isolation
- assignee permission
- status transition และ resolution requirement

