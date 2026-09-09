# LIFE IT Smart Service Center

ระบบ Web Application สำหรับบริหารงานบริการเทคโนโลยีสารสนเทศ (ITSM) และงานกำกับดูแลด้านเทคโนโลยีขององค์กร โดยรวมงานรับแจ้งปัญหา การให้บริการ งานปฏิบัติการไอที ทรัพย์สิน โครงสร้างพื้นฐาน รายงาน และ Governance ไว้ในระบบเดียว

> **สถานะโครงการ:** Pre-production / migration rehearsal  
> Repository นี้เป็น **public repository** สำหรับ source code และเอกสารทางเทคนิคเท่านั้น ห้ามใช้เป็นที่เก็บข้อมูลจริงของผู้ใช้งาน ข้อมูล Ticket ไฟล์แนบ credentials หรือ secrets ดูแนวทางได้ที่ [SECURITY.md](SECURITY.md)

## ระบบนี้ทำอะไรได้บ้าง

### 1. ศูนย์บริการและกระบวนการ IT

- Dashboard, War Room, ศูนย์งานของฉัน, งานส่วนตัว, checklist และมุมมองปฏิทิน
- Ticket/Help Desk: รับแจ้งปัญหา มอบหมายงาน ติดตามสถานะ SLA, worklog, ความคิดเห็น, บันทึกภายใน, ไฟล์แนบ และประเมินความพึงพอใจ
- Public Ticket Portal: แจ้งซ่อมและติดตามสถานะโดยไม่ต้องมีบัญชีภายใน โดยใช้รหัสติดตามที่ระบบออกให้
- Service Catalog และ Service Request สำหรับคำขอบริการ
- Access Request และทะเบียนสิทธิ์สำหรับคำขอเข้าถึงระบบ
- Incident, Problem / Known Error และ Change Management
- Workflow/Approval สำหรับกระบวนการอนุมัติ
- Knowledge Base สำหรับบทความช่วยเหลือและ self-service
- แบบฟอร์มงานและ Form Studio สำหรับสร้าง/จัดการแบบฟอร์ม

### 2. ทรัพย์สินและการปฏิบัติการไอที

- ทะเบียนทรัพย์สิน การยืม/คืน และการเบิกจ่ายให้บุคลากร
- Inventory และ Software License
- PM / Maintenance และการจัดตารางงานช่าง
- Mobile Field Workflow และการสแกนทรัพย์สินหน้างาน
- CMDB และแผนผังความสัมพันธ์ของ Configuration Items
- Backup & Monitoring
- Vulnerability & Patch Management
- Vendor และ Contract Management
- รายงานและ Audit Log

### 3. Governance และการควบคุมภายใน

Governance Center รองรับงานที่เกี่ยวข้องกับ Data Classification, Compliance, Privacy/PDPA, Risk, AI/Cloud Register, Awareness, Evidence/Audit, Governance Documents, Operational Health และ Integration Outbox โดยการเข้าถึงขึ้นอยู่กับบทบาทและ permission ที่ผู้ดูแลกำหนด

ระบบรองรับ Configurable RBAC เช่น ผู้ดูแลระบบ เจ้าหน้าที่ไอที ช่าง ผู้อนุมัติ ผู้บริหาร ผู้ตรวจสอบ เจ้าหน้าที่คุ้มครองข้อมูลส่วนบุคคล และผู้ใช้งานทั่วไป ทั้งนี้บทบาทจริงและสิทธิ์จริงต้องตรวจสอบจากฐานข้อมูลและการตั้งค่าของแต่ละ deployment

### 4. เครื่องมือที่ทำงานภายในเบราว์เซอร์

PDF Tools สามารถรวม แยก จัดเรียง หมุน ลบหน้า แปลงรูปเป็น PDF และใส่ลายน้ำ/เลขหน้า โดยประมวลผลในเบราว์เซอร์และไม่ส่งไฟล์ไปยัง API หรือ Storage ของระบบ

การเชื่อมต่อ LINE, Google Drive และ Cloudflare Turnstile เป็นความสามารถเสริมที่เปิดใช้ตามการตั้งค่าของสภาพแวดล้อมนั้น ๆ

## สถาปัตยกรรม

```
React + TypeScript + Vite
          │ HTTPS API / authentication
          ▼
Cloudflare Workers + Hono
          │ validation / RBAC / business logic
          ▼
Supabase Auth + PostgreSQL + RLS + Storage
```

องค์ประกอบหลัก:

- **Frontend:** React, TypeScript, Vite, React Router, TanStack Query, Tailwind CSS
- **Backend:** Cloudflare Workers, Hono, Zod และ Supabase JS Client
- **Database/Auth:** Supabase PostgreSQL, Auth, Row Level Security และ Private Storage
- **CI/CD:** GitHub Actions สำหรับตรวจ typecheck, lint, test, build และ deployment ตาม environment

หลักการสำคัญคือ Frontend ไม่ควรเชื่อมต่อฐานข้อมูลโดยตรงเพื่ออ่าน/เขียนข้อมูลธุรกิจ, Backend ต้องตรวจสิทธิ์ซ้ำทุก request, Service Role ต้องอยู่ฝั่ง server เท่านั้น และไฟล์ใน Storage ต้องเข้าผ่านสิทธิ์หรือ signed URL ที่เหมาะสม

## โครงสร้าง Repository

```
├── apps/web/                Frontend ของระบบ
├── apps/api/                Backend API และ business logic
├── packages/shared/         Types, schemas, roles และ permissions ที่ใช้ร่วมกัน
├── packages/migration/      เครื่องมือเตรียมและซ้อมย้ายข้อมูล
├── supabase/                Database migrations และ tests
├── legacy-gas/              Source ระบบ Google Apps Script เดิมสำหรับอ้างอิงการย้ายระบบ
├── docs/                    เอกสารสถาปัตยกรรมและเอกสาร migration
└── .github/workflows/       CI/CD และ quality gates
```

โฟลเดอร์ `docs/`, `legacy-gas/` และ workflow บางส่วนอาจมีรายละเอียดภายในหรือข้อมูลสำหรับการปฏิบัติงาน ไม่ควรถือว่าเป็นเอกสาร public ที่อนุมัติให้เผยแพร่ทั้งหมด โปรดตรวจตาม [SECURITY.md](SECURITY.md) ก่อนเปิด repository ต่อสาธารณะ

## เริ่มต้นใช้งานสำหรับนักพัฒนา

**ข้อกำหนดเบื้องต้น:** Node.js 20+ และ npm 10+

```bash
npm install

cp apps/web/.env.example apps/web/.env.local
cp apps/api/.dev.vars.example apps/api/.dev.vars
# เติมค่าเฉพาะของสภาพแวดล้อมทดสอบในไฟล์ local เท่านั้น

npm run dev:api     # API ที่ http://localhost:8787
npm run dev:web     # Web ที่ http://localhost:5173
```

คำสั่งตรวจสอบที่ใช้บ่อย:

```bash
npm run typecheck
npm run lint
npm run test
npm run test:e2e
npm run build
```

ห้ามนำค่าจริงจาก production, ข้อมูลผู้ใช้งาน, ข้อมูล Ticket, ไฟล์แนบ หรือ secret มาใช้ในตัวอย่างและชุดทดสอบที่ commit เข้าสู่ repository

## ขอบเขตการเข้าถึงข้อมูล

- โมดูลภายในต้องผ่านการ login และ permission ตามบทบาท
- Public Ticket Portal เป็น endpoint ที่เปิดรับจากอินเทอร์เน็ต จึงต้องใช้ validation, rate limiting, anti-bot และการจำกัดไฟล์แนบตามการตั้งค่าของ deployment
- ข้อมูลจริงและไฟล์แนบต้องอยู่ในระบบที่ควบคุมสิทธิ์แยกจาก source repository
- ความปลอดภัยของระบบจริงขึ้นอยู่กับการตั้งค่า secrets, Auth, RLS, Storage, CORS, Cloudflare และการตรวจสอบ deployment อย่างถูกต้อง ไม่ควรสรุปจาก README เพียงอย่างเดียว
