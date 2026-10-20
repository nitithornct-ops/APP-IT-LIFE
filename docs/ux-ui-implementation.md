# LIFE IT UX/UI implementation

อัปเดต 20 ตุลาคม 2569 เตรียมเผยแพร่ผ่าน release PR #79

## ผลที่ทำแล้ว

- ยกเลิกขนาดข้อความที่ขยายชดเชย TH Sarabun New ใน UI กำหนดลำดับ 14/15/16/18/20/26–28px ผ่าน Tailwind และ CSS tokens โดยยังรองรับ A−/A+
- UI ร้องขอ Sukhumvit Set แล้ว fallback เป็น Tahoma/Arial/sans-serif ขณะนี้ **ยังไม่มีไฟล์ Sukhumvit Set สำหรับฝังบนเว็บ** ตรวจฟอนต์ที่แสดง glyph ไทยจริงผ่าน Chromium ได้ Tahoma ไม่ใช่ Sukhumvit Set
- แยก `--font-document` ออกจาก `--font-app` เอกสารยังใช้ TH Sarabun New และรักษาขนาด pt ระยะในเอกสารไม่ขยายตาม UI
- ใช้ระยะชื่อช่อง 8px ช่องกรอก 20px กลุ่มข้อมูล 24–28px การ์ด 20–24px และขอบหน้า 16/32px
- ย้าย form grid 107 จุดมาใช้ `data-ui="form-grid"` ครอบคลุม Ticket/Incident, Service/Access Request, Problem/Change, Tasks/PM, Asset/Inventory/CMDB, Admin, Reports และพอร์ทัล ส่วนประกอบ grid ประเภทปฏิทิน Kanban และเนื้อหาเอกสารไม่ใช้กฎนี้
- ปรับ Card, FilterBar, Button, Modal, DetailLayout และพื้นที่เซลล์ตารางร่วมกัน แผงรายละเอียดเลื่อนตามหน้าเพื่อให้เข้าถึงส่วนท้ายได้เมื่อข้อความโต
- เพิ่ม A−/A+ ในเมนูบัญชีบนมือถือ พร้อมบอกเปอร์เซ็นต์และปิดปุ่มเมื่อถึงขอบระดับ
- SearchableSelect/MultiSelect ใช้ลูกศรและ Enter เลือกผลลัพธ์ได้ อ่านข้อความเต็มได้ และ Escape ปิด dropdown ก่อน Modal
- ปรับปุ่มส่วนกลางให้รับ focus ก่อนเรียก action เพื่อให้การคืน focus จาก Modal ทำงานใน WebKit ด้วย
- รักษา flow เปิด Ticket การลองแนบไฟล์ใหม่ การเก็บร่างเมื่อ request ล้มเหลว และบริบทตัวกรอง/หน้ารายการเมื่อย้อนกลับ
- แก้ print mode ไม่ให้โครงเมนู พื้นหลังแอป หรือพื้นที่ขั้นต่ำของ viewport ติดไปใน PDF หน้าถัดไป

สีสถานะ permission, API contract, SLA และเงื่อนไขธุรกิจไม่ได้เปลี่ยน

## ไฟล์หลัก

| ส่วน | ไฟล์ |
| --- | --- |
| ฟอนต์และพื้นฐาน/พิมพ์ | `apps/web/src/index.css`, `apps/web/tailwind.config.js` |
| Tokens และ shared UI | `apps/web/src/styles/system.css` |
| Shell | `apps/web/src/layouts/AppShell.tsx`, `components/shell/FontSizeControl.tsx`, `Topbar.tsx` |
| ส่วนประกอบ | `components/ui/{Button,Card,Modal,PageTitle,FilterBar,DetailLayout}.tsx` |
| ตาราง | `components/table/DataTable.tsx`, `data-table.css` |
| ตัวเลือกแบบค้นหา | `components/forms/SearchableSelect.tsx`, `SearchableMultiSelect.tsx` |
| ตัวอย่าง Ticket | `features/tickets/TicketsPage.tsx`, `TicketDetailPage.tsx`, `tickets.css` |
| มาตรฐานและไฟล์ฟอนต์ | `docs/ui-patterns.md`, `apps/web/src/assets/fonts/README.md` |
| เพิ่มการตรวจ | `e2e/ux-system.spec.ts`, `e2e/print-typography.spec.ts`, `components/forms/SearchablePickers.test.tsx` |

พาธในตารางส่วนประกอบอ้างอิงจาก `apps/web/src` ดูรายการไฟล์ที่เปลี่ยนใน [release PR #79](https://github.com/nitithornct-ops/APP-IT-LIFE/pull/79/files)

## หลักฐานภาพ

- ดาวน์โหลดภาพตรวจรับ รวม 120% และโหมดมืด จาก artifact `staging-e2e-evidence` ของ [Staging Live E2E](https://github.com/nitithornct-ops/APP-IT-LIFE/actions/workflows/staging-e2e.yml) โดย artifact เก็บไว้ 14 วัน
- รายงานฟอนต์ที่ render จริง: ไฟล์ `rendered-thai-fonts.json` ใต้ผลทดสอบ `ux-system` ใน artifact
- ตัวอย่าง PDF A4 สองหน้า: ไฟล์ `ticket-a4.pdf` ใต้ผลทดสอบ `print-typography` ใน artifact

ภาพและ PDF ใช้ข้อมูลจำลอง ฟอนต์ในภาพหลังแก้เป็น fallback ของเครื่องทดสอบ ต้องตรวจเทียบใหม่เมื่อได้ Sukhumvit Set จริง ภาพก่อน–หลังในเครื่องผู้พัฒนาเป็นหลักฐานเฉพาะเครื่องและไม่ได้รวมใน repository

## ผลตรวจสอบ

| การตรวจ | ผล |
| --- | --- |
| `npm.cmd run typecheck --workspace=apps/web` | ผ่าน |
| `npm.cmd run lint --workspace=apps/web` | ผ่าน |
| `npm.cmd run build --workspace=apps/web` | ผ่าน |
| Unit suite `npm.cmd run test --workspace=apps/web -- --maxWorkers=2 --reporter=verbose` | 524 กรณี / 84 ไฟล์ ผ่าน ก่อนปรับการคืน focus ของปุ่มเพิ่มเติม |
| Unit หลังปรับ focus: Modal, TicketsPage, TicketDetailPage | 25 กรณี ผ่าน |
| Browser acceptance บน Chromium และ WebKit | 36 กรณี ผ่าน |
| รายการ/ฟอร์ม/รายละเอียด Ticket | 390, 768, 1440px; คืนตัวกรอง/หน้าเดิม; keyboard; validation และการคืน focus ผ่าน |
| ข้อความ 120% | ทั้งสองธีมและทั้งสามขนาด ไม่มีหน้าล้นแนวนอน ปุ่มส่งฟอร์มเข้าถึงได้ |
| เก็บร่างเมื่อบันทึกล้มเหลว | ผ่านด้วย response จำลอง 503 |
| Login accessibility และ visual baseline | ผ่าน Chromium ทั้งสามขนาด และ WebKit; ไม่ใช่การรับรอง accessibility ทั้งระบบ |
| LINE Portal / Vendor Form Portal / เมนู shell | ชุด acceptance ผ่าน |
| Word | ทดสอบดาวน์โหลดแม่แบบด้วย browser และ unit ของ HTML export ผ่าน |
| PDF / A4 | 2 หน้า ขนาด A4 page break ตาราง และช่องลายเซ็นครบ; font size คงเดิมเมื่อ A+; เรนเดอร์ PDF จริงตรวจภาพแล้ว |

คำสั่ง browser acceptance ล่าสุด:

```powershell
npm.cmd run test:e2e --workspace=apps/web -- tickets-ux.spec.ts ux-system.spec.ts print-typography.spec.ts public-surfaces.spec.ts formStudio.spec.ts masterForms.spec.ts line-portal.spec.ts shell-navigation.spec.ts quality-gates.spec.ts --workers=2 --output=../../.tmp/ux-ui-acceptance
```

ชุด browser ใช้ข้อมูลจำลองและไม่เขียนฐานข้อมูลจริง WebKit ใช้ fixture replay ผ่าน binding ภายใน test context เพราะการ intercept HTTP/CORS ใน runtime เครื่องนี้ไม่รองรับเหมือน Chromium จึงไม่ได้ใช้ผลชุดนี้รับรองการเชื่อมต่อเครือข่ายจริง

## สิ่งที่ยังค้างและข้อจำกัด

1. ต้องได้รับ Sukhumvit Set ที่อนุญาตให้ฝังบนเว็บ จับคู่น้ำหนักกับไฟล์จริง เพิ่ม `@font-face` แล้วตรวจ glyph ไทยและภาพซ้ำ ดูรายการไฟล์ที่ `assets/fonts/README.md` ห้ามถือว่ารายการนี้เสร็จจากชื่อ font-family
2. ยังไม่ได้ตรวจบน iPhone/Android/แท็บเล็ตจริง หรือ browser zoom 200% จริง ผลปัจจุบันเป็น viewport จำลองและ A−/A+ ถึง 120%
3. ยังไม่ได้เปิดทุก flow ของทุกโมดูลด้วย role และข้อมูลจริง แม้ shared styles และ form grid ถูกนำไปใช้แล้ว Unit suite ไม่แทนการตรวจงานจริงทุกหน้าจอ
4. ยังไม่ได้ตรวจเอกสารจริงทุกแม่แบบใน Microsoft Word หรือเครื่องพิมพ์จริง ตรวจแล้วเฉพาะตัวอย่าง PDF และ contract ส่งออกเดิม

โค้ดและมาตรฐานส่วนกลางพร้อมให้ตรวจในเครื่อง ส่วนการติดตั้ง Sukhumvit Set และการตรวจบนอุปกรณ์/ข้อมูลจริงยังต้องทำต่อก่อนสรุปว่าตรวจรับครบทั้งระบบ
