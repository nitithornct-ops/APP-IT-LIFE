# การใช้ clasp push อัปโหลดโค้ดขึ้น Google Apps Script

ติดตั้ง clasp ไว้แล้ว (local devDependency v2.5.0) พร้อมสคริปต์ใน `package.json`
เรียกได้ทั้ง `npx clasp ...` หรือ `npm run ...`

## ตั้งค่าครั้งแรก (ทำครั้งเดียว)

1. **เปิด Apps Script API ของบัญชี** — ไปที่ https://script.google.com/home/usersettings แล้วเปิดสวิตช์ **Google Apps Script API** เป็น ON

2. **เข้าสู่ระบบ Google**
   ```
   npm run login
   ```
   จะเปิดเบราว์เซอร์ให้อนุญาตสิทธิ์ (เก็บ token ไว้ที่ `~/.clasprc.json` — ถูก .gitignore แล้ว)

3. **ใส่ Script ID** ลงในไฟล์ `.clasp.json` (แก้ค่า `PUT_YOUR_APPS_SCRIPT_ID_HERE`)
   - หา Script ID ได้ที่: GAS editor → ⚙️ **Project Settings** → หัวข้อ **IDs** → คัดลอก **Script ID**
   - หรือดูจาก URL: `script.google.com/home/projects/`**`<SCRIPT_ID>`**`/edit`

## อัปโหลดโค้ด (ใช้ประจำ)

- ดูว่าจะ push ไฟล์ไหนบ้าง (ไม่ต้อง login ก็ได้):
  ```
  npm run status
  ```
- push ทับทั้งโปรเจกต์ (แนะนำสำหรับครั้งแรกเพื่อล้างไฟล์เก่าที่ค้าง เช่น DELETE_COLS):
  ```
  npm run pushf
  ```
  > `clasp push` จะทำให้ไฟล์บน GAS **ตรงกับในเครื่องเป๊ะ** — ไฟล์เก่าที่ไม่มีในเครื่อง (ต้นเหตุ error `DELETE_COLS has already been declared`) จะถูกลบออกให้อัตโนมัติ

- push แบบปกติ (ถามยืนยันก่อน):
  ```
  npm run push
  ```
- push อัตโนมัติทุกครั้งที่แก้ไฟล์:
  ```
  npm run watch
  ```

## หลัง push — ต้อง Deploy เวอร์ชันใหม่เสมอ
push แค่ทำให้โค้ดล่าสุดอยู่บน GAS แต่ Web App ที่เผยแพร่ยังเป็นเวอร์ชันเดิม
เปิด GAS editor → **Deploy → Manage deployments** → แก้ deployment เดิม → เลือก **New version** → **Deploy**
(หรือสั่ง `npm run deploy` เพื่อสร้าง deployment ใหม่)

## คำสั่งอื่น
| คำสั่ง | ทำอะไร |
|---|---|
| `npm run open` | เปิดโปรเจกต์ใน GAS editor |
| `npm run pull` | ดึงโค้ดจาก GAS ลงเครื่อง (ทับไฟล์ในเครื่อง — ระวัง) |
| `npm run versions` | ดูรายการเวอร์ชัน |
