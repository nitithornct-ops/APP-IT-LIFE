# 3. ตาราง Mapping: Feature ของระบบ ↔ ข้อกำหนดนโยบาย

ใช้สำหรับนำเสนอผู้บริหาร/ผู้ตรวจสอบ เพื่อยืนยัน traceability ว่าระบบตอบข้อกำหนดข้อใดของนโยบาย

- **P1** = นโยบายความมั่นคงปลอดภัยทางสารสนเทศ ฉบับปรับปรุงปี 2569
- **P2** = ประมวลแนวปฏิบัติด้านการรักษาความมั่นคงปลอดภัยไซเบอร์ ประจำปี พ.ศ. 2569

> ตารางนี้ถูก seed ลง Sheet `PolicyMapping` อัตโนมัติด้วย `setupSystem()` และใช้คำนวณสุขภาพมาตรการควบคุมใน Audit Evidence Center ส่วน Legal Compliance ใช้ Assessment ในโมดูลกฎหมายและการปฏิบัติตาม

| โมดูล | Feature หลัก | เอกสาร | ข้อกำหนด/หมวด |
|---|---|---|---|
| Dashboard | สรุปสถานะ compliance ทุกหมวด, รายการใกล้ครบกำหนด, Incident เปิด | P1+P2 | ภาพรวมทุกหมวด |
| Task / งานของฉัน | จดงานส่วนตัว, ความสำคัญ, ความคืบหน้า, กำหนดส่ง และแจ้งเตือนงานใกล้ครบ | สนับสนุนการปฏิบัติงาน | การติดตามงานส่วนบุคคล |
| Help Desk / Ticket | เปิด Ticket, คัดแยก + SLA, มอบหมายผู้รับผิดชอบ, ปิดงาน หรือยกระดับเป็น Incident | P1+P2 | การรับแจ้งเหตุ/บันทึกหลักฐาน/การตอบสนองต่อเหตุการณ์ |
| Asset Register | ทะเบียน Server/Network/Software + License + Patch | P2 | หมวด 1 + การควบคุมการเข้าถึงเครื่องแม่ข่าย |
| Data Classification | ระดับชั้นความลับ + workflow ขออนุมัติทำลายข้อมูล | P2 | หมวด 4 |
| Access/RBAC | Workflow คำขอสิทธิ์ → อนุมัติ → IT ดำเนินการ + ทบทวนสิทธิ์ตามรอบ + ระงับเมื่อพ้นสภาพ | P1 | การกำหนดอำนาจหน้าที่ + หมวด 3, 5 |
| Change Management | Request → Impact → Test → Approve → Deploy + rollback plan | P1 | การควบคุมการพัฒนา/แก้ไขระบบ |
| Backup & BCP/DR | บันทึกผลสำรอง/กู้คืน + ทะเบียนแผนฉุกเฉิน | P2 | การสำรองข้อมูล + หมวด 6-7 |
| Logging & Monitoring | ทะเบียน Log + บันทึกผลตรวจสอบ + Anomaly | P2 | หมวด 12 |
| Incident Response | แจ้งเหตุ → DPO คัดกรอง → ประเมินหน้าที่แจ้ง สคส./เจ้าของข้อมูล/สกมช./หน่วยงานกำกับ → เก็บเลขรับเรื่องและหลักฐาน → ปิดเคส | P2 | การตอบสนองต่อเหตุการณ์ + หมวด 13 |
| Vendor Register | สัญญา + วันหมดอายุ + ผลประเมิน/ตรวจรับ | P1 | การควบคุมผู้ให้บริการภายนอก |
| AI Register | AI ที่อนุญาต + ประเภทข้อมูลที่อนุญาต/ห้าม + ช่องทางรายงาน | P2 | หมวด 9 |
| Cloud Register | Cloud ที่อนุญาต + ระดับข้อมูล + หลักฐานอนุมัติ/สำรอง/ถ่ายโอน | P2 | หมวด 10 |
| Awareness Training | แผนอบรมรายไตรมาส + บันทึกผู้เข้า + e-sign รับทราบนโยบาย | P2 | หมวด 11 |
| Audit Evidence Center | รวมหลักฐานทุกโมดูล + ค้น/กรอง + Export PDF/Excel + สุขภาพมาตรการควบคุม | P1+P2 | ทุกหมวด |
| Notification Engine | Time-driven trigger แจ้งเตือนวันครบกำหนดล่วงหน้า | P1+P2 | ทุกหมวด |
| Audit Trail | บันทึก ใคร/ทำอะไร/เมื่อไร/กับข้อมูลใด (แยก Sheet ป้องกันแก้ไข) | P1+P2 | สนับสนุนทุกหมวด |
| Legal Compliance | ทะเบียนกฎหมาย → ข้อกำหนด → หลักฐาน → Assessment → CAPA | P1+P2 | ธรรมาภิบาลกฎหมาย |
| Privacy / PDPA | RoPA, lawful basis, DPIA, consent/withdrawal และ Data Subject Request | P1+P2 | PDPA และธรรมาภิบาลข้อมูล |
| Problem / Known Error | วิเคราะห์ปัญหาซ้ำ/RCA เชื่อม Ticket, Incident, Known Error และ KB | P1+P2 | การปรับปรุงอย่างต่อเนื่อง |
| Vulnerability | CVE/CVSS, remediation, exception, due date และ independent verification | P2 | การจัดการช่องโหว่ |
| Audit Management | Audit engagement, finding, action plan, evidence และ independent closure | P1+P2 | การตรวจสอบภายใน |
| CMDB / Relationship Map | ทะเบียน CI, Criticality/RPO/RTO และความสัมพันธ์กับ Asset/Vendor/Contract/Cloud/Backup/Incident/Change | P1+P2 | Asset และ Configuration Management |
| Service Catalog / Request Fulfilment | นิยามบริการ, dynamic form, eligibility, SLA, approval, checklist, workflow และเงื่อนไขปิดงาน | P1+P2 | การให้บริการและควบคุมการเข้าถึง |
| Workflow / Approval Engine (`MAP-022`) | ลำดับ/ANY/ALL/QUORUM, version snapshot, SoD, delegation, reminder, escalation และ timeline | P1+P2 | การแบ่งแยกหน้าที่และหลักฐานการอนุมัติ |
| Attachment Registry (`MAP-023`) | private storage, row-level access, checksum, legal hold, retention และ download audit | P1+P2 | การควบคุมหลักฐานและการเข้าถึงข้อมูล |
| Integration Outbox (`MAP-024`) | เชื่อม Service Request กับ Access/Ticket/Asset/Change แบบ idempotent, retry และตรวจ provenance ได้ | P1+P2 | ความถูกต้องครบถ้วนของธุรกรรมข้ามโมดูล |

## การ map สิทธิ์ตามบทบาท (Segregation of Duties / Least Privilege)

| โมดูล | User | Approver | IT Admin | Executive | DPO |
|---|:--:|:--:|:--:|:--:|:--:|
| Dashboard | ✔ | ✔ | ✔ | ✔ | ✔ |
| Task / งานของฉัน | ✏️ เฉพาะของตน | ✏️ เฉพาะของตน | ✏️ เฉพาะของตน | ✏️ เฉพาะของตน | ✏️ เฉพาะของตน |
| Help Desk / Ticket | ✏️ เปิด Ticket | ✏️ คัดแยก/ยกระดับ | ✏️ จัดการ | 👁 | – |
| Service Catalog / คำขอบริการ | ✏️ ขอ/ยืนยันของตน | ✏️ ขอ + อนุมัติเมื่อเป็น exact assignee | ✏️ Catalog/มอบหมาย/ดำเนินการ + อนุมัติเมื่อเป็น exact assignee | ✏️ ขอ/ยืนยันของตน + อนุมัติเมื่อเป็น exact assignee | ✏️ ขอ/ยืนยันของตน + อนุมัติเมื่อเป็น exact assignee |
| Workflow / งานอนุมัติ | 👁 ของตน/ที่ได้รับมอบหมาย + ยกเลิกของตน | ✏️ พิจารณา/มอบหมายรายการที่ได้รับ | ✏️ ทุก workflow + definition/automation/permission admin | ✏️ ของตน/ที่ได้รับมอบหมาย + มองเห็นทั้งหมดตาม action permission | ✏️ ของตน/ที่ได้รับมอบหมาย |
| Asset | – | – | ✏️ | 👁 | – |
| CMDB / Relationship Map | – | 👁 | ✏️ | 👁 | 👁 |
| Data Classification | – | – | ✏️ | 👁 | 👁 |
| Privacy / PDPA | – | – | ✏️ | 👁 | ✏️ |
| Problem / Known Error | – | 👁 | ✏️ | 👁 | – |
| Vulnerability | – | – | ✏️ | 👁 | 👁 |
| Audit Management | – | – | ✏️ | 👁 | 👁 |
| Legal Compliance | – | 👁 | ✏️ | 👁 | ✏️ |
| Access/RBAC | ✏️ ยื่นคำขอ | ✏️ อนุมัติ | ✏️ ดำเนินการ | 👁 | – |
| Change Mgmt | – | ✏️ | ✏️ | 👁 | – |
| Backup/BCP | – | – | ✏️ | 👁 | – |
| Logging | – | – | ✏️ | 👁 | – |
| Incident | ✏️ แจ้งเหตุ | 👁 หน่วยงานตน | ✏️ จัดการ/ปิดเคส | 👁 | ✏️ เคสข้อมูลส่วนบุคคล |
| Vendor | – | – | ✏️ | 👁 | – |
| AI / Cloud | 👁 | 👁 | ✏️ | 👁 | 👁 |
| Awareness | ✏️ ลงชื่อ | ✔ | ✏️ จัดการ | 👁 | ✔ |
| Audit Evidence | – | – | ✔ | ✔ | – |
| Notification Settings | – | – | ✔ | – | – |
| Audit Trail | – | – | 👁 | 👁 | – |

✏️ = แก้ไข/ดำเนินการได้ · 👁 = อ่านอย่างเดียว · ✔ = ใช้งานตามบทบาท · – = ไม่มีสิทธิ์

> สิทธิ์เหล่านี้กำหนดใน `Config.gs > MODULE_ACCESS` และ **ตรวจซ้ำที่ฝั่ง Server ทุกครั้ง** ผ่าน `requireModule()` / `requireRole()` ไม่ใช่แค่ซ่อนเมนู

> Service Request อนุมัติจาก exact assignee/อีเมล `Approver` ที่ snapshot ไว้ในคำขอ ไม่ได้อนุญาตจากชื่อ role เพียงอย่างเดียว; บัญชีต้อง Active, มี `workflow.approve` และผู้ขออนุมัติตนเองไม่ได้

### สิทธิ์ระดับ action ใน v1.11

`MODULE_ACCESS` เป็นด่านระดับโมดูล ส่วน `ActionPermissions`, `RoleActionPermissions` และ `UserPermissionOverrides` เป็นด่านระดับ action:

- Workflow: view own/assigned/all, start, approve, delegate, cancel own, manage/admin และ run automation
- Attachment: view/download/upload, delete own/any และ manage/admin
- Integration: view/enqueue/execute/retry และ manage/admin

unknown/inactive permission ถูกปฏิเสธ, user override ที่ active มี precedence เหนือ role mapping และ `DENY` ชนะเมื่อมีผลขัดแย้ง การอนุมัติจริงยังตรวจ row-level assignment/ownership และ Separation of Duties อีกชั้น ไม่ได้อนุญาตจาก role/action เพียงอย่างเดียว

> Mapping `MAP-022`–`MAP-024` ถูก seed แบบ idempotent ด้วย `setupSystem()` ของ Schema 13; Production seed ยังเป็น **Pending deployment** จนกว่าจะมี rollout evidence
