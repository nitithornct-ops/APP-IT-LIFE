# Security Policy

ไฟล์นี้ตั้งใจให้เป็น public เพื่อกำหนดวิธีรายงานช่องโหว่และขอบเขตข้อมูลที่อนุญาตให้เก็บใน repository สาธารณะ เอกสารเชิงปฏิบัติการที่ระบุระบบจริงจะไม่เก็บไว้ที่นี่

## การรายงานช่องโหว่

ห้ามเปิด public issue หรือ pull request ที่มีรายละเอียดช่องโหว่ credential ข้อมูลส่วนบุคคล หรือข้อมูลจากระบบจริง

ให้รายงานผ่านช่องทางส่วนตัวของผู้ดูแล repository หรือช่องทางความปลอดภัยภายในขององค์กร โดยระบุ:

- ผลกระทบที่คาดว่าจะเกิดขึ้น
- ขั้นตอนทำซ้ำที่ใช้เฉพาะข้อมูลสังเคราะห์หรือข้อมูลที่ลบส่วนสำคัญแล้ว
- รุ่น/commit ที่กระทบ และแนวทางแก้ไขหากมี

## ข้อมูลที่ห้าม commit

- password, API key, token, cookie/session, private key, service-account key หรือ connection string
- ค่า environment จริง ไฟล์ `.env`, `.env.local`, `.dev.vars` และไฟล์สำรอง
- ข้อมูลส่วนบุคคล Ticket ไฟล์แนบ log, export, database dump หรือ screenshot จากระบบจริง
- internal URL, private IP, project/account ID, deployment ID, ชื่อ environment หรือรายละเอียดที่ช่วยระบุระบบ production

ไฟล์ตัวอย่างต้องมีเฉพาะชื่อ variable หรือ placeholder ที่ใช้งานจริงไม่ได้

## เมื่อพบข้อมูลรั่ว

1. แจ้งผู้ดูแลผ่านช่องทางส่วนตัวทันที และห้ามคัดลอกค่าไปใส่ public issue
2. ยกเลิกหรือหมุน credential ผ่านผู้มีอำนาจ ไม่รอเพียงลบไฟล์ออกจาก commit ใหม่
3. ตรวจ history และ artifact ที่เกี่ยวข้อง แล้วดำเนินการตาม incident procedure ภายใน

การลบหรือเพิ่มชื่อไฟล์ใน `.gitignore` ไม่ได้ลบข้อมูลที่มีอยู่ใน Git history แล้ว
