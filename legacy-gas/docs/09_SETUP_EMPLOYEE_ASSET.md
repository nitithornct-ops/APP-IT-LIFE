# ตั้งค่าโมดูลพนักงานและทรัพย์สินที่ครอบครอง

## เริ่มใช้งาน

1. อัปโหลดโค้ด Apps Script ชุดเดียวกันให้ครบทุกไฟล์
2. รัน `setupSystem()` หนึ่งครั้ง เพื่อสร้าง/เติมคอลัมน์ใน `Employees`, `EmployeeAssignments` และ `AssetRegister`
3. Deploy เวอร์ชันใหม่ แล้วเข้าสู่หลังบ้านด้วยบัญชี ITAdmin
4. เปิดเมนู **พนักงานและทรัพย์สิน**

`setupSystem()` เติมเฉพาะชีต/คอลัมน์ที่ขาด ไม่ล้างข้อมูลเดิม

## การย้ายข้อมูลจากตารางเดิม

ตารางเดิมที่เป็นหนึ่งแถวกว้างมากควรแยกเป็นสองส่วน:

| ข้อมูลเดิม | ปลายทาง |
|---|---|
| Emp_code, คำนำหน้า, ชื่อ, นามสกุล, ชื่อเล่น | `Employees` |
| คำนำหน้า(อังกฤษ), Name, Lastname | `Employees` |
| ตำแหน่ง, Department, Username_AD, UPN, Email, Status | `Employees` |
| Category, Name_Device, IP Address - DHCP, Producer, รุ่น, MAC Address, เลขครุภัณฑ์, S/N, OS System | `EmployeeAssignments` หนึ่งรายการ |
| Hardware: Monitor, iPad, โทรศัพท์มือถือ | แยกเป็น `EmployeeAssignments` คนละรายการ |
| Software: Office H&B 2019, Acrobat Pro, Adobe Creative Cloud | แยกเป็น `EmployeeAssignments` ประเภท Software คนละรายการ |
| IP-Phone Yealink: รหัสครุภัณฑ์, S/N, MAC Address, เบอร์ติดต่อ | `EmployeeAssignments` ประเภท IP Phone Yealink |
| Printer: รหัสครุภัณฑ์, S/N, MAC Address | `EmployeeAssignments` ประเภท Printer |
| Scanner_user, Scan_Folder | `EmployeeAssignments` ประเภท Scanner |
| No. | ไม่ต้องย้าย เพราะหน้ารายการสร้างลำดับให้อัตโนมัติ |

ถ้าทรัพย์สินมีอยู่ใน `AssetRegister` ให้เลือก **เชื่อมกับ Asset Register** ในฟอร์มรับมอบ เพื่อไม่ให้เกิดทะเบียนซ้ำและให้เจ้าของใน Asset อัปเดตตามพนักงาน

## สิทธิ์

- ITAdmin: เพิ่ม/แก้ไขพนักงาน รับมอบ คืน และเปลี่ยนสถานะ
- Executive: อ่านข้อมูล
- User และบทบาทอื่น: ไม่เห็นโมดูลนี้

ข้อมูลรหัสผ่านไม่อยู่ในโมดูลนี้และห้ามนำเข้าจากไฟล์รายชื่อพนักงาน
