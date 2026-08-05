# 6. SETUP — LINE Login + LINE OA สำหรับระบบแจ้งซ่อม

เอกสารนี้ใช้สำหรับเตรียมและเปิดใช้งานการระบุตัวผู้แจ้งด้วย LINE, ดู Ticket ของตนเองโดยไม่ใช้ Email OTP
และรับการแจ้งเตือนสถานะรายบุคคลผ่าน LINE OA

> สถานะของ source ปัจจุบัน: เพิ่ม LINE Login, session แบบเก็บเฉพาะ hash, การผูก EmployeeCode,
> Ticket ของ LINE และการ Push สถานะรายบุคคลแล้ว ขั้นตอนที่ยังต้องทำโดยผู้ดูแลคือสร้าง/เชื่อม Channel,
> ใส่ Script Properties, รัน migration และ Deploy เวอร์ชันใหม่

---

## 1) รูปแบบระบบที่แนะนำ

```text
ผู้ใช้
  │
  ├─ เพิ่มเพื่อน LINE OA
  │
  ├─ กด Rich Menu: แจ้งซ่อม / สถานะของฉัน
  │
  ▼
LINE Login หรือ LINE MINI App
  │  ส่ง ID token ให้ Server ตรวจสอบ
  ▼
App_LIFE (Apps Script Web App)
  │
  ├─ LineUsers       ผูก LINE userId กับรหัสพนักงาน
  ├─ Tickets         เก็บเจ้าของ Ticket เป็น LINE userId
  ├─ Ticket_Worklogs เก็บประวัติการดำเนินงาน
  └─ Messaging API   Push สถานะกลับไปยังเจ้าของ Ticket
```

ระยะเริ่มต้นไม่ต้องเปิด Webhook และยังไม่ต้องทำแชตบอต ผู้ใช้สามารถแจ้งซ่อมจากหน้าแบบฟอร์มที่เปิดผ่าน
Rich Menu ใน LINE และรับ Push Message รายบุคคลได้ก่อน

---

## 2) ข้อมูลที่ต้องเตรียม

เตรียมรายการต่อไปนี้โดยยังไม่ต้องนำค่าความลับมาใส่ใน source code

| รายการ | ได้จาก | ใช้เมื่อ |
|---|---|---|
| Provider ขององค์กร | LINE Developers Console | ทุกระยะ |
| LINE Official Account | LINE Official Account Manager | ทุกระยะ |
| Messaging API Channel | เปิด Messaging API ให้ OA | ทุกระยะ |
| Channel access token | Messaging API tab | ส่ง Push Message |
| Messaging API channel secret | Basic settings | Webhook ระยะหลัง |
| LINE Login channel ID | LINE Login channel | Login |
| LINE Login channel secret | LINE Login channel | Login |
| Apps Script `/exec` URL | Apps Script deployment | Endpoint/Callback |
| Privacy Policy URL | เว็บไซต์หรือเอกสารขององค์กร | ก่อน Publish |
| Terms of Use URL | เว็บไซต์หรือเอกสารขององค์กร | ก่อน Publish |

> LINE Login, Messaging API และ LINE MINI App ที่ต้องการเชื่อมกันต้องอยู่ภายใต้ **Provider เดียวกัน**
> เพื่อให้ LINE userId ของบุคคลเดียวกันตรงกัน และเพื่อใช้ Add friend option ได้
>
> เอกสารอ้างอิง:  
> https://developers.line.biz/en/docs/line-developers-console/best-practices-for-provider-and-channel-management/

---

## 3) ตรวจสอบหรือสร้าง LINE OA และ Messaging API

1. เข้า https://manager.line.biz/
2. เลือก LINE Official Account ของหน่วยงาน
3. เปิด **Settings → Messaging API**
4. หากยังไม่เปิด ให้กด **Enable Messaging API**
5. เลือก Provider ขององค์กรให้ถูกต้อง
6. เข้า https://developers.line.biz/console/
7. เปิด Provider เดียวกัน และตรวจว่ามี Messaging API Channel ของ OA
8. เปิดแท็บ **Messaging API**
9. ออก Channel access token ตามชนิดที่องค์กรเลือกใช้
10. เก็บ token ไว้ใน Password Manager หรือ Secret Store ชั่วคราว ห้ามส่งในแชตหรือฝังใน HTML

เอกสารอ้างอิง:  
https://developers.line.biz/en/docs/messaging-api/getting-started/

---

## 4) สร้าง LINE Login Channel

1. เข้า https://developers.line.biz/console/
2. เลือก **Provider เดียวกับ LINE OA**
3. กด **Create a new channel**
4. เลือก **LINE Login**
5. กำหนด:
   - Channel name: `App_LIFE Help Desk`
   - App types: `Web app`
   - Region: `Thailand`
   - Email address: อีเมลผู้ดูแลระบบ
   - Privacy Policy URL: URL นโยบายความเป็นส่วนตัวของหน่วยงาน
   - Terms of Use URL: URL ข้อกำหนดการใช้งาน
6. สร้าง Channel และบันทึก:
   - Channel ID
   - Channel secret
7. ที่ **Basic settings → Linked LINE Official Account** เลือก OA ที่เตรียมไว้
8. ยังไม่ต้องขอสิทธิ์ Email เพราะระบบจะใช้เพียง `openid` และ `profile`

ระหว่างสถานะ `Developing` เฉพาะ Admin/Tester ของ Channel เท่านั้นที่ Login ได้ หลังทดสอบครบจึงเปลี่ยนเป็น
`Published`

เอกสารอ้างอิง:  
https://developers.line.biz/en/docs/line-login/getting-started/

---

## 5) เตรียม Apps Script Web App URL

ใช้ Deployment URL ที่ลงท้ายด้วย `/exec` เท่านั้น ตัวอย่าง:

```text
https://script.google.com/macros/s/DEPLOYMENT_ID/exec
```

กำหนด URL สำหรับ LINE ดังนี้:

```text
หน้า LINE:
https://script.google.com/macros/s/DEPLOYMENT_ID/exec?page=line

Callback:
https://script.google.com/macros/s/DEPLOYMENT_ID/exec?page=line-callback
```

นำ Callback URL ไปเพิ่มใน:

```text
LINE Developers Console
→ LINE Login Channel
→ LINE Login
→ Callback URL
```

ค่าที่ตั้งใน LINE Console และค่าที่ source ส่งเป็น `redirect_uri` ต้องตรงกันทุกตัวอักษร รวม query string และ
ตัวพิมพ์เล็ก/ใหญ่

---

## 6) ตั้ง Script Properties

เปิด Apps Script แล้วไปที่:

```text
Project Settings
→ Script Properties
→ Add script property
```

### จำเป็นสำหรับระยะ LINE Login + Push รายบุคคล

| Key | ค่า |
|---|---|
| `NOTIFY_LINE_ENABLED` | `true` |
| `LINE_CHANNEL_ACCESS_TOKEN` | Channel access token ของ Messaging API |
| `LINE_LOGIN_ENABLED` | ตั้ง `true` หลังใส่ค่าด้านล่างครบ |
| `LINE_LOGIN_CHANNEL_ID` | Channel ID ของ LINE Login |
| `LINE_LOGIN_CHANNEL_SECRET` | Channel secret ของ LINE Login |
| `LINE_LOGIN_CALLBACK_URL` | URL `.../exec?page=line-callback` |
| `LINE_REQUIRE_EMPLOYEE_LINK` | `true` ถ้าบังคับผูกกับ EmployeeCode; ค่าเริ่มต้น `false` |
| `LINE_AUTO_APPROVE_EMPLOYEE_LINK` | แนะนำ `false` เพื่อให้ Admin ตรวจสอบก่อน |
| `LINE_SESSION_HOURS` | อายุ session; ค่าแนะนำ `24` |
| `LINE_SESSION_SECRET` | `setupSystem()` สร้างให้อัตโนมัติ; ไม่ต้องนำออกมาแสดง |

`PUBLIC_TICKET_EMAIL_OTP_ENABLED=false` อยู่ในชีต `Settings` ไม่ต้องใส่ใน Script Properties

### คงไว้สำหรับแจ้งทีม IT

| Key | ค่า |
|---|---|
| `LINE_DEFAULT_TO` | userId/groupId ห้องกลางของทีม IT |

`LINE_DEFAULT_TO` ใช้สำหรับแจ้งทีม IT เท่านั้น ห้ามใช้เป็นปลายทางแจ้งสถานะของผู้แจ้งซ่อมทุกคน

### เตรียมไว้สำหรับ Webhook/แชตบอตในระยะหลัง

| Key | ค่า |
|---|---|
| `LINE_CHANNEL_SECRET` | Messaging API channel secret |
| `LINE_WEBHOOK_GATEWAY_SECRET` | Shared secret ระหว่าง Gateway กับ Apps Script |

> ห้ามสร้างฟังก์ชัน client ที่อ่านค่าความลับเหล่านี้ และห้ามส่งค่า token/secret กลับไปยัง HTML

---

## 7) Schema ที่ source เพิ่มไว้แล้ว — ผู้ดูแลต้องรัน migration

`Config.gs` มี Schema ต่อไปนี้แล้ว ไม่ต้องเพิ่มคอลัมน์ด้วยมือ

### Sheet `LineUsers`

```text
LineUserID
DisplayName
PictureURL
EmployeeCode
FullName
Department
LinkStatus
FriendStatus
LastLoginAt
Timestamp
CreatedBy
LastUpdatedBy
LastUpdatedAt
```

ค่าของ `LinkStatus` ที่แนะนำ:

```text
Pending
Active
Suspended
Unlinked
```

### เพิ่มท้าย Sheet `Tickets`

```text
RequesterIdentityType
RequesterLineUserID
SourceChannel
```

ค่าตัวอย่าง:

```text
RequesterIdentityType = LINE
SourceChannel = LINE_OA
```

### เพิ่มท้าย Sheet `Ticket_Worklogs`

```text
ActorIdentityType
ActorLineUserID
```

หลังแก้ `DB_SCHEMA` แล้ว:

1. เปิด Apps Script Editor
2. เลือกฟังก์ชัน `setupSystem`
3. กด **Run**
4. ตรวจว่า Sheet/คอลัมน์ใหม่ถูกเพิ่ม
5. ตรวจว่าข้อมูล Ticket เดิมยังอยู่ครบ

`setupSystem()` ของโครงการนี้เพิ่มคอลัมน์ที่ขาดแบบไม่ทำลายข้อมูลเดิม แต่ควรสำรอง Spreadsheet ก่อน migration
ทุกครั้ง

---

## 8) ฟังก์ชันที่มีใน source แล้ว

### ไฟล์ `LineAuth.gs`

```text
getLineLoginBootstrapPublic()
createLineLoginUrlPublic()
completeLineLoginCallback_()
exchangeLineAuthorizationCode_()
verifyLineIdToken_()
createLineSession_()
requireLineSession_()
requireActiveLineSession_()
linkLineEmployeePublic()
logoutLinePublic()
```

ข้อกำหนด:

- สร้าง `state` ใหม่ทุกครั้ง
- ตรวจ `state` ตอน Callback
- ใช้ `nonce`
- แนะนำให้ใช้ PKCE
- แลก authorization code และตรวจ ID token ฝั่ง Server
- ใช้ค่า `sub` จาก ID token เป็น LINE userId
- ห้ามเชื่อ `lineUserId`, `displayName` หรือ `employeeCode` ที่ client ส่งมาโดยไม่ตรวจสอบ
- Session ต้องมีเวลาหมดอายุ

เอกสารอ้างอิง:  
https://developers.line.biz/en/docs/line-login/security-checklist/  
https://developers.line.biz/en/docs/line-login/integrate-pkce/

### เพิ่มใน `Module_Ticket.gs`

```text
submitTicketLine(sessionToken, form)
listMyTicketsLine(sessionToken)
trackTicketLine(sessionToken, ticketId)
submitTicketFeedbackLine(sessionToken, ticketId, rating, comment)
```

กติกาสำคัญ:

- ทุกฟังก์ชันต้องเรียก `requireLineSession_()` ก่อน
- ใช้ LINE userId จาก Session เท่านั้น
- ห้ามรับ LINE userId จาก form แล้วนำไปค้น Ticket โดยตรง
- `listMyTicketsLine()` ต้องคืนเฉพาะ Ticket ที่ `RequesterLineUserID` ตรงกับ Session
- Email OTP สาธารณะปิดโดยค่าเริ่มต้น (`PUBLIC_TICKET_EMAIL_OTP_ENABLED=false`)

### ปรับ `Notification.gs`

ใช้ฟังก์ชันที่มีอยู่:

```text
sendLinePushDetailed_(message, requesterLineUserId)
```

เพิ่มฟังก์ชันแยก:

```text
notifyTicketRequesterLine_(ticket, message)
notifyTicketTeam_(ticket, message)
```

โดย:

- `notifyTicketRequesterLine_()` ส่งไป `ticket.RequesterLineUserID`
- `notifyTicketTeam_()` ส่งไป `LINE_DEFAULT_TO`
- ห้ามใช้ปลายทางกลางแทนผู้แจ้ง

### ปรับ `PublicTicket.html`

- เพิ่มปุ่ม `เข้าสู่ระบบด้วย LINE`
- แสดงรูปและชื่อหลัง Login สำเร็จ
- ไม่แสดงช่องอีเมลในหน้า public; ใช้ LINE หรือเลข Ticket + รหัสติดตาม
- ครั้งแรกให้ผูกบัญชีกับรหัสพนักงาน
- แสดงสถานะ `Pending` ระหว่างรอ Admin อนุมัติ
- หน้า `สถานะของฉัน` เรียก `listMyTicketsLine()`
- หากไม่ Login ให้ใช้เลข Ticket + รหัสติดตามเท่านั้น; ถ้าต้องการดูหลายรายการให้ Login ด้วย LINE

### ปรับ `Code.gs`

เพิ่ม route:

```text
?page=line
?page=line-callback
```

ระยะแรกยังไม่ต้องเพิ่ม `doPost()` สำหรับ LINE webhook

---

## 9) การผูก LINE กับพนักงาน

LINE userId ยืนยันว่าเป็น LINE บัญชีเดิม แต่ไม่ได้ยืนยันชื่อจริงหรือสถานะพนักงานโดยอัตโนมัติ

แนวทางที่แนะนำ:

1. ผู้ใช้ Login LINE ครั้งแรก
2. ระบบรับ LINE userId และชื่อโปรไฟล์จาก ID token ที่ตรวจสอบแล้ว
3. ผู้ใช้กรอกรหัสพนักงาน
4. ระบบค้นรหัสพนักงานจากทะเบียนที่องค์กรกำหนด
5. หากข้อมูลตรง ให้ตั้ง `LinkStatus=Active`
6. หากตรวจอัตโนมัติไม่ได้ ให้ตั้ง `LinkStatus=Pending`
7. IT Admin ตรวจและอนุมัติจากหลังบ้าน
8. หลังอนุมัติ ผู้ใช้ไม่ต้องกรอกรหัสพนักงานอีก

ห้ามใช้ `DisplayName` เป็นตัวระบุตัวบุคคล เพราะผู้ใช้เปลี่ยนชื่อและใช้ชื่อซ้ำกันได้

---

## 10) ตั้ง Rich Menu

สร้าง Rich Menu ใน LINE Official Account Manager หรือ Messaging API โดยแนะนำอย่างน้อย 4 เมนู:

| เมนู | Action |
|---|---|
| แจ้งซ่อม | เปิด `.../exec?page=line&mode=report` |
| สถานะของฉัน | เปิด `.../exec?page=line&mode=status` |
| วิธีแก้เบื้องต้น | เปิด `.../exec?page=line&mode=kb` |
| ติดต่อ IT | ส่งข้อความหรือโทรหา Help Desk |

ก่อนเปิดใช้จริงให้ทดสอบลิงก์จาก LINE บน:

- Android
- iPhone
- LINE Desktop
- Browser ภายนอก

---

## 11) Deploy

1. เปิด Apps Script
2. กด **Deploy → Manage deployments**
3. เลือก Web App เดิม
4. กด **Edit**
5. เลือก **New version**
6. ตั้ง:
   - Execute as: `Me`
   - Who has access: `Anyone`
7. กด **Deploy**
8. ยืนยันว่า `/exec` URL ยังตรงกับ Callback URL ใน LINE Console
9. หาก Deployment ID เปลี่ยน ต้องแก้:
   - LINE Login Callback URL
   - `LINE_LOGIN_CALLBACK_URL`
   - Rich Menu URL
   - LINE MINI App Endpoint URL ถ้ามี

---

## 12) Test Checklist ก่อนเปิดจริง

### Identity

- [ ] Login ผ่าน LINE ได้
- [ ] ระบบขอเฉพาะ `openid profile`
- [ ] Server ตรวจ ID token สำเร็จ
- [ ] LINE userId ไม่ได้มาจากค่าที่ client สร้างเอง
- [ ] ผู้ใช้คนเดิม Login ซ้ำแล้วได้บัญชีเดิม
- [ ] ผู้ใช้คนละคนได้คนละบัญชี
- [ ] ไม่ใช้ DisplayName เป็น Primary Key

### Ticket

- [ ] สร้าง Ticket จาก LINE ได้
- [ ] Ticket บันทึก `RequesterLineUserID`
- [ ] Ticket เดิมยังเปิดดูได้ด้วยเลข Ticket + รหัสติดตาม
- [ ] ผู้ใช้ A มองไม่เห็น Ticket ของผู้ใช้ B
- [ ] ผู้ใช้ที่ `Pending/Suspended` สร้างหรือดู Ticket ไม่ได้ตามนโยบาย
- [ ] แนบรูปและไฟล์ได้ตาม limit เดิม
- [ ] Worklog แสดงช่องทาง LINE ถูกต้อง

### Notification

- [ ] เปิด Ticket แล้วทีม IT ได้รับข้อความ
- [ ] เปลี่ยนสถานะแล้วผู้แจ้งที่ถูกต้องได้รับ Push
- [ ] ผู้แจ้งคนอื่นไม่ได้รับข้อความ
- [ ] ปิดงานแล้วผู้แจ้งได้รับผลดำเนินการและลิงก์ประเมิน
- [ ] การส่งล้มเหลวถูกบันทึกใน `NotificationLog`
- [ ] กรณีผู้ใช้บล็อก OA ระบบไม่ถือว่าผู้ใช้ได้รับข้อความแล้ว

### Security

- [ ] Channel access token ไม่อยู่ใน HTML/JavaScript
- [ ] Channel secret ไม่อยู่ใน HTML/JavaScript
- [ ] Script Properties ไม่ถูกส่งกลับ client
- [ ] `state`, `nonce` และ Session มีวันหมดอายุ
- [ ] มี Audit Log สำหรับ Login, Link, Unlink, Create Ticket และ Feedback
- [ ] Sheet `LineUsers` จำกัดสิทธิ์เฉพาะผู้ดูแลที่จำเป็น
- [ ] หน้า Public Helpdesk แสดง Privacy Notice และบังคับ consent ก่อนส่ง Ticket
- [ ] Settings กลุ่ม `Privacy / PDPA` มี `PUBLIC_TICKET_CONSENT_REQUIRED=true`, `PUBLIC_PRIVACY_NOTICE_VERSION`, `PUBLIC_PRIVACY_NOTICE_TEXT` และ `PUBLIC_PRIVACY_DPO_CONTACT`
- [ ] ผู้ดูแลปรับ `PUBLIC_PRIVACY_NOTICE_URL` เป็น HTTPS URL ของประกาศฉบับเต็ม หากองค์กรมีเอกสารประกาศแยก

---

## 13) LINE MINI App — ทำหลัง LINE Login Web ผ่านแล้ว

เมื่อ flow LINE Login Web ทำงานครบ ให้สร้าง LINE MINI App Channel ภายใต้ Provider เดิม:

1. เลือก Region `Thailand`
2. กำหนด Endpoint URL เป็น `.../exec?page=line`
3. เชื่อม LINE OA
4. กำหนด Scope เท่าที่จำเป็น
5. ทดสอบบน Development Channel
6. ใช้ Permanent Link ของ MINI App ใน Rich Menu
7. เผยแพร่เป็น unverified MINI App หรือยื่น verified ตามสถานะ Provider ขององค์กร

ประเทศไทยสามารถ Publish unverified MINI App ได้ตั้งแต่ 11 มีนาคม 2026 ส่วน verified MINI App
ยังต้องอยู่ภายใต้ certified provider

เอกสารอ้างอิง:  
https://developers.line.biz/en/news/2026/03/11/line-mini-app/  
https://developers.line.biz/en/docs/line-mini-app/develop/develop-overview/

> Apps Script HtmlService มี redirect/iframe ของ Google ควรทดสอบ `liff.init()` และการกลับจาก Login
> บนอุปกรณ์จริงก่อนประกาศใช้งาน หากพบปัญหา ให้ย้ายเฉพาะหน้า LINE ไป Cloud Run/Firebase Hosting
> และคง business logic/Sheet ไว้ใน App_LIFE

---

## 14) Webhook/แชตบอต — ระยะหลัง

หากต้องการให้ผู้ใช้พิมพ์ `แจ้งซ่อม` ในห้องแชตแล้วบอตถามทีละข้อ ต้องเพิ่ม Gateway:

```text
LINE Platform
  │ POST + x-line-signature
  ▼
Cloud Run / Cloud Functions
  │ ตรวจ signature จาก raw body
  │ กัน event ซ้ำ
  │ ตอบ HTTP 200 โดยเร็ว
  ▼
App_LIFE / Apps Script
```

ไม่ควรให้ LINE webhook เข้าสู่ Apps Script โดยตรงใน production เพราะ LINE กำหนดให้ตรวจ
`x-line-signature` จาก request header ขณะที่ event object มาตรฐานของ Apps Script Web App
ไม่มี request headers ให้ใช้งาน

เอกสารอ้างอิง:  
https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/  
https://developers.google.com/apps-script/guides/web

---

## 15) ปัญหาที่พบบ่อย

| อาการ | จุดตรวจ |
|---|---|
| Admin Login ได้ แต่พนักงาน Login ไม่ได้ | LINE Login Channel ยังเป็น `Developing` หรือผู้ใช้ไม่ใช่ Tester |
| `redirect_uri` error | Callback URL ไม่ตรงกับค่าที่ลงทะเบียนทุกตัวอักษร |
| คนเดียวกันได้ userId ไม่ตรงระหว่าง Login/OA | Channel อยู่คนละ Provider |
| LINE API ตอบ 200 แต่ผู้ใช้ไม่ได้รับข้อความ | ผู้ใช้ยังไม่เพิ่มเพื่อน OA หรือบล็อก OA |
| แก้โค้ดแล้วหน้าเดิมยังทำงาน | ยังไม่ได้ Deploy New version |
| Ticket ทุกคนถูกส่งไปห้อง IT | ยังใช้ `LINE_DEFAULT_TO` แทน `RequesterLineUserID` |
| ผู้ใช้มองเห็น Ticket คนอื่น | Server เชื่อ userId จาก client หรือไม่ได้กรองด้วย Session |
| LINE Verify webhook ไม่ผ่านหรือไม่ปลอดภัย | ใช้ Apps Script รับ webhook ตรง ควรผ่าน Gateway ที่ตรวจ signature |

---

## 16) Rollback

หากต้องปิด LINE Login ชั่วคราว:

1. ซ่อนปุ่ม LINE Login และ Rich Menu ที่เกี่ยวข้อง
2. ให้ผู้ใช้ติดตามด้วยเลข Ticket + รหัสติดตามที่ได้รับตอนแจ้งซ่อม
3. ตั้ง `NOTIFY_LINE_ENABLED=false` เฉพาะกรณีต้องหยุดส่ง LINE ทั้งระบบ
4. ไม่ลบคอลัมน์ LINE ออกจาก Ticket เดิม
5. ไม่ลบ `LineUsers` จนกว่าจะผ่านนโยบาย retention/PDPA
6. Revoke Channel access token หากสงสัยว่ารั่วไหล
7. ตรวจ `NotificationLog` และ `AuditTrail` เพื่อหาขอบเขตผลกระทบ
