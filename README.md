# LIFE IT Smart Service Center

เว็บแอปพลิเคชันสำหรับบริหารงานบริการเทคโนโลยีสารสนเทศ ครอบคลุมกระบวนการรับแจ้ง ติดตามงาน ทรัพย์สิน รายงาน และการควบคุมสิทธิ์ตามบทบาท

## ขอบเขตของ Public Repository

Repository นี้เก็บเฉพาะ source code และเอกสารสำหรับการพัฒนาที่เผยแพร่ได้ ไม่มีข้อมูลผู้ใช้ ข้อมูล Ticket ไฟล์แนบ credential, secret, URL ภายใน หรือ identifier ของ production

รายละเอียดการติดตั้งระบบจริง แผนผังเครือข่าย รายชื่อบัญชี แผนกู้คืน และคู่มือ incident response ต้องเก็บในระบบเอกสารภายในที่ควบคุมสิทธิ์

## พัฒนาในเครื่อง

ข้อกำหนดเบื้องต้น: Node.js 20+ และ npm 10+

```bash
npm install

cp apps/web/.env.example apps/web/.env.local
cp apps/api/.dev.vars.example apps/api/.dev.vars

npm run dev:api
npm run dev:web
```

ใช้ค่าของ development/test เท่านั้น และห้าม commit ไฟล์ environment ที่มีค่าจริง

## ตรวจสอบก่อนส่งการเปลี่ยนแปลง

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

การรายงานช่องโหว่และกฎการจัดการข้อมูลอ่อนไหวอยู่ใน [SECURITY.md](SECURITY.md)
