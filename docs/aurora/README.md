# Aurora Sky Glass — implementation and verification

วันที่: 29 ตุลาคม 2026 · Branch: `feat/aurora-sky-glass-20261029`

งานนี้แก้ source ของ LIFE IT Smart Service Center ในระบบเดิม ใช้ React/TypeScript/Vite และ component เดิม ไม่เพิ่ม runtime dependency และไม่ deploy production

## Repository audit

- ตรวจ source เริ่มต้นที่ `6dfa75d` และ fetch remote แล้ว เปรียบเทียบ tree กับ `origin/master` (`d5dd65a`) ไม่มี source ต่างกัน แม้ commit IDs ต่างกันจากการ merge
- มี 75 route declarations รวม modal alternatives/redirects และ 66 page source files ดู [route inventory](route-inventory.md) และ [ข้อมูล JSON](route-inventory.json)
- ระบบเดิมมี AppShell, permission-filtered navigation, command palette, reusable table, modal focus trap/unsaved confirmation, page headers และ feedback components อยู่แล้ว จึงใช้ต่อ
- ปัญหาที่พบ: sidebar มืดทั้งระบบ, palette/กราฟแยก hardcode, typography ใช้ชื่อฟอนต์ที่ไม่ได้ bundle, spacing เดสก์ท็อปทับค่ากลาง, ไม่มี density selector, native surfaces บางจุดไม่ใช้ theme และ Vendor Portal ไม่ได้เข้าร่วม public theme

## Design foundation และพฤติกรรมที่เปลี่ยน

- สีฟ้าพื้นหลัง `#F0F9FF`, พื้นรอง `#E8F5FF`, primary `#287DB3`, hover `#206994`, navy `#173E65`, gold `#DAB854`
- เพิ่ม glass/sidebar/glow tokens ทั้ง light และ dark ใช้ glass 72% สำหรับ cards และ blur เฉพาะ shell; tables, input, dropdown และ modal ยังใช้พื้นอ่านง่าย
- Radius กลาง 10/14/16px, shadow และ z-index ใช้ระบบกลางเดิม
- Inter และ Noto Sans Thai weights 400/500/600/700 โฮสต์เป็น WOFF2 ในโปรเจกต์ พร้อมใบอนุญาต OFL; ไม่มี external font request ขณะใช้งาน ดู [font documentation](../../apps/web/src/assets/fonts/README.md)
- UI: body 15px, table/label 14px, note 13px, page title 24–26px ที่ scale ปกติ; A−/A+ ยังทำงานแยกจาก density
- เอกสารใช้ TH Sarabun New และ export font เดิม โดยไม่เปลี่ยน PDF/print templates
- ย้าย native surfaces 52 จุดใน 31 ไฟล์เข้า shared card treatment รวม forms, tasks, inventory, licenses, tickets, admin และ portals; หน้าที่ใช้ component กลางอยู่แล้วรับ tokens ใหม่ผ่าน component เดิม
- ปรับ Dashboard header ให้กระชับ และใช้ semantic theme tokens กับกราฟ แทนสี hardcode
- Sidebar กว้าง 244px/ย่อ 68px, รองรับ mobile drawer/X/Escape/focus containment, active groups และ persistence เดิม
- รายการโปรดย้ายรายการจากกลุ่มเดิมไปกลุ่มโปรด จึงไม่ทำเมนูซ้ำ และยังกรองด้วยสิทธิ์เดิม จำกัด 8 รายการ
- ปุ่มสร้าง Ticket ด่วนเปิดฟอร์มเดิมผ่าน `/tickets?create=1`; ตรวจ `ticket.create` และล้าง parameter เมื่อปิด ไม่เพิ่ม API หรือ workflow ใหม่
- Vendor Portal ใช้ public theme รวม loading/login/MFA/list/detail; ไม่แสดง internal sidebar
- แก้ filter bar ของ Vendor/Contract ที่ล้นจอมือถือ 14px และเปลี่ยน error states ของ Service Catalog, Workflow, Knowledge และ Backup/Monitoring เป็น QueryError กลางพร้อม retry

## Density contract

| Mode | แถวตารางพื้นฐาน | Card padding | Section gap | Control สูงพื้นฐาน |
|---|---:|---:|---:|---:|
| Compact | 36px | 12px | 8px | 36px |
| Standard | 44px | 16px | 12px | 40px |
| Comfortable | 52px | 24px | 20px | 44px |

แถวที่มีข้อความหลายบรรทัดหรือ action จำนวนมากขยายได้ตามเนื้อหา ตัวเลือกอยู่บน topbar ที่จอกว้าง และเมนูบัญชีที่จอแคบ บันทึก `itlife-density`, validate ค่าใน storage และ sync ข้ามแท็บ ไม่เปลี่ยนขนาดตัวอักษร พื้นที่กดบนมือถือ/อุปกรณ์สัมผัสอย่างน้อย 44px; ตารางบนมือถือใช้ card layout เดิม

## Module integration และขอบเขตการตรวจ

Workspace, ITSM, Assets/Infrastructure, Governance/Reporting และ Administration รับ theme ผ่าน AppShell + PageTitle/PageHeader/Card/DataTable/Modal เดิมทั้งหมด รายละเอียดที่มี route/modal/print ยังคงใช้โครงเดิม ดู [inventory](route-inventory.md) เพื่อแยกหน้าที่ใช้ shared patterns กับ native layouts

การรับ theme ผ่าน shared components ไม่ได้เท่ากับยืนยันว่า business workflow ของทุก role ผ่าน live UAT แล้ว หลักฐานการตรวจแยกไว้ดังนี้:

| Check | ผล |
|---|---|
| Baseline root TypeScript / lint | ผ่านทุก workspace ก่อนแก้ |
| Baseline web production build / UI smoke | ผ่าน; smoke 7 กรณี |
| Web unit tests | 88 files / 557 tests ผ่าน |
| หลังเพิ่ม quick create: targeted shell + density unit | 7 tests ผ่าน |
| หลังปรับ error surfaces: targeted feature/shell/density unit | 6 files / 16 tests ผ่าน |
| Chromium existing + Aurora suite | 52 ผ่าน, 30 live-only ข้าม |
| Chromium final shell / pin / quick create / density | 7 ผ่าน |
| Login axe/responsive/screenshot 390/768/1440 | 3 ผ่าน; ปรับ visual baselines ตาม theme ใหม่ |
| Vendor login dark-mode axe (mobile) | ผ่าน |
| WebKit login + Ticket interaction suite | 10 ผ่าน |
| Final all-module recovery / Dashboard / portal / typography | 100 ผ่าน (รวมทุกเมนู 43 รายการ × 2 viewports) |
| Final web typecheck / lint / build / budgets / git diff check | ผ่าน |

ทดสอบจริงแล้ว: mobile drawer/focus return, sidebar collapse, account menu, filters, pagination, list/detail return context, export UI เดิม, unsaved forms, validation, recoverable save failure, three density modes/persistence, actual Thai rendered font และ shell axe checks

Print gate ตรวจฟอนต์/ขนาด heading ที่ไม่เปลี่ยนเมื่อขยาย UI, page breaks, signature และสร้าง PDF A4 2 หน้า (595pt width) ได้ตามเดิม

UI tests ใช้ fixtures เฉพาะใน Playwright ไม่ใส่ข้อมูลจำลองใน runtime application ชุด all-module recovery ยังตรวจว่าปุ่ม retry ส่งคำขอใหม่จริงสำหรับ error surfaces ที่ปรับ

คำสั่งหลัก: `npm.cmd run typecheck --workspace=apps/web`, `npm.cmd run lint --workspace=apps/web`, `npm.cmd run test --workspace=apps/web`, `npm.cmd run build --workspace=apps/web`, `npm.cmd run budget` และ Playwright ตาม project ที่ระบุในตาราง (ใช้ npm.cmd เพื่อหลีกเลี่ยงข้อจำกัด PowerShell script execution policy ของเครื่องนี้)

## Performance

| Metric | ก่อน | หลัง | Budget |
|---|---:|---:|---:|
| Entry JS gzip (Vite report, decimal kB) | 101.76 | ประมาณ 102.76 | 120 KiB |
| Entry CSS gzip | 26.31 kB | ประมาณ 26.8 kB | 30 KiB |
| Largest lazy JS gzip | 209.0 KiB | 209.0 KiB | 210 KiB |
| Largest asset raw | 1.21 MiB | 1.21 MiB | 1.35 MiB |
| UI font assets | ไม่มีฟอนต์ UI bundle | 527,996 bytes รวม 8 faces | โหลดตาม face ที่ใช้ |

Build budget ผ่าน รักษา lazy routes และไม่ใส่ backdrop blur ในตาราง แต่ละ UI font ใช้ `font-display: swap`; [local resource timing](performance/) เก็บจาก Aurora E2E ตัวเลขนี้เป็น local build/resource measurements ไม่ใช่ production Core Web Vitals หรือ benchmark เครือข่ายมือถือ

## Screenshots

- [Before](screenshots/before/) / [After](screenshots/after/) มี desktop/tablet/mobile, light/dark, text scale 120%, list/create/detail, density variants, workflow, War Room, print และ public login
- ภาพแสดงข้อมูล fixture เพื่อไม่เปิดเผยข้อมูลภายใน
- ไม่ได้เก็บ before ของทุก route; before/after ที่เปรียบเทียบตรงกันได้หลัก ๆ คือ Ticket/list/create/detail และ Login

## Remaining verification / deployment notes

- 30 live-only cases ไม่ได้เปิดใช้: ต้องตรวจ staging ด้วยบัญชีและ environment ที่ได้รับอนุญาตก่อน release รวม login/MFA, RBAC/RLS ตาม role, approvals, signing, LINE และ vendor submissions
- Module recovery smoke ตรวจทุกเมนูด้วย API 503 เพื่อยืนยัน shell/error surfaces และไม่เกิด runtime crash; ไม่ใช้แทน success workflow หรือ production data validation
- ไม่ได้เพิ่ม backend capability ใหม่ เช่น scheduled report delivery หรือ API สำหรับ saved reports; คง feature/API เดิมตามข้อกำหนดไม่เปลี่ยน business contracts
- ตรวจ screenshot และรูปแบบเอกสารสำคัญบน staging ตามตัวอย่างจริงก่อน merge
- ไม่มี database migration หรือ secrets ใหม่; rollback ด้วยการย้อน UI changes บน branch นี้
- ใช้ pipeline/approval deployment เดิม ผู้ดำเนินงานต้องอนุมัติ production deployment แยกต่างหาก
- ข้อความเตือน build ของ Zod เรื่อง PURE annotations มีอยู่ใน baseline ไม่ใช่ UI runtime error

ไฟล์ที่เปลี่ยนและหมวดงานดู [changed files](changed-files.md)
