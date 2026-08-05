# Gap Analysis — ISMS Governance System v1.7.1

วันที่ตรวจ: 20 กรกฎาคม 2569

## ขอบเขตและหลักฐานที่ตรวจ

- Source ปัจจุบัน 39 ไฟล์ `.gs` และ 28 ไฟล์ `.html`
- `DB_SCHEMA`, `SHEETS`, `MODULE_ACCESS` ใน `Config.gs`
- API allowlist และ session authorization ใน `Auth.gs`
- Client/server wiring ใน `Index.html`, `JavaScript.html` และ `PublicTicket.html`
- Setup, migration, seed และ trigger ใน `Setup.gs`
- ชุดตรวจ static ใน `scripts/validate-project.js`

การตรวจรอบนี้ไม่เชื่อมต่อหรือเขียน Google Sheets/Drive Production และไม่ถือว่าการมี
ชื่อ field ใน Schema เท่ากับมี workflow สมบูรณ์

## สถานะภาพรวม

| Capability | สถานะ | หลักฐาน/ช่องว่าง |
|---|---|---|
| Core auth, session, MFA, RBAC | ใช้งานได้ | Session ฝั่ง server, API allowlist, role/module guard และ audit denied มี implementation |
| Standard API response | ปรับแล้ว v1.7.1 | รองรับ `success/message/data/errorCode/timestamp` และ legacy `ok/error` |
| Help Desk / Ticket / SLA | ใช้งานได้ | Ticket lifecycle, worklog, category, SLA, outsource และ Ticket → Incident |
| Incident และ regulatory notification | ใช้งานได้ | Incident workflow และการประเมิน/บันทึกการแจ้งหน่วยงานกำกับ |
| Asset / License / Inventory / PM | ใช้งานได้ | มีทะเบียน วงจรยืมคืน การซ่อม PM license และ stock ledger |
| Risk / Compliance / CAPA | ใช้งานได้บางส่วน | มี Risk, legal register, obligation, assessment และ corrective action; ยังไม่มี audit engagement/plan/finding แยกเป็นโมดูล |
| Privacy / PDPA | เพิ่มแล้วใน v1.8.0 | มี RoPA, consent evidence, DSR, data classification, destruction, retention และ incident notification; breach clock ใช้ RegulatoryNotifications ใน Incident |
| Problem Management | ยังขาด | มี KB และ Incident แต่ไม่มี Problem record, RCA, known error และ relation หลาย Incident → Problem |
| Service Catalog / Request | ยังขาด | Ticket category ไม่ใช่ catalog item ที่มี entitlement, approval และ fulfillment workflow |
| CMDB | ยังขาด | Asset มีข้อมูล configuration บางส่วน แต่ไม่มี CI type, relationship และ impact dependency graph |
| Vulnerability / Patch | ใช้งานได้บางส่วน | Asset มี PatchStatus/PatchDate; ยังไม่มี finding, CVE/CVSS, remediation SLA, exception และ verification lifecycle |
| Policy / Document Control | ใช้งานได้บางส่วน | มี GovernanceDocuments, PolicyMapping และ acknowledgement; ยังขาด approval/version supersede/distribution workflow เต็มรูปแบบ |
| Change / Release | ใช้งานได้บางส่วน | มี request-test-approve-deploy/rollback; ยังขาด release package และ post-implementation review ที่มี gate ชัดเจน |
| Vendor / Contract / Cloud / AI | ใช้งานได้บางส่วน | มี registers และ assessment พื้นฐาน; contract renewal/evidence/exit plan ยังไม่เป็น workflow ครบวงจร |
| Awareness / Training | ใช้งานได้ | มี plan, record, quiz, acknowledgement และ completion |
| Backup / Restore / BCP | ใช้งานได้ | มี snapshot, checksum, sandbox restore, drill, retention และ triggers |
| Automated QA | ใช้งานได้บางส่วน | Static syntax/wiring/contract checks และ in-app smoke checks; ยังไม่มี isolated unit/integration runner สำหรับ GAS services |

## ความเสี่ยงที่ต้องจัดการต่อ

1. **P0 — ทดสอบกับ Deployment จริง:** ต้องรัน `setupSystem()`, Tester/QA, permission matrix,
   snapshot/restore sandbox และ LINE/Trigger checks ในบัญชีปลายทางก่อน Go-live
2. **P0 — Dependency tooling:** `npm audit` รายงาน moderate 3 และ high 1 ใน toolchain;
   ต้องประเมินการอัปเกรด `@google/clasp` แยก branch เพราะ `--force` อาจ breaking
3. **P1 — Problem/Vulnerability:** เพิ่ม RCA/known error และ vulnerability remediation lifecycle
4. **P1 — Audit management:** แยก audit plan, scope, finding, owner, due date, evidence และ closure
5. **P2 — CMDB/Service catalog:** ทำหลัง master data/owner และ asset identifiers สะอาดแล้ว

## ลำดับพัฒนาที่แนะนำ

1. ทำ Production verification และ export backup ก่อน migration ทุกครั้ง
2. เพิ่ม Problem + Known Error เชื่อม Ticket/Incident/KB
3. เพิ่ม Vulnerability + remediation/exception/verification
4. เพิ่ม Audit engagement/finding/CAPA linkage
5. เพิ่ม CMDB relationship และ Service Catalog หลัง identifiers มีคุณภาพเพียงพอ

## Acceptance ของการแก้รอบ 1.7.1

- Response ใหม่และเก่าทำงานร่วมกัน
- ทุก `google.script.run` มี success/failure handler
- ไม่มีการเปลี่ยนชื่อหรือลบ column
- ไม่มี seed/sample data ถูกเขียนลง Production จากการตรวจในเครื่อง
- `npm run validate` ต้องผ่านก่อน `clasp push` และก่อน deploy
