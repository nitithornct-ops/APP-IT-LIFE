-- Reference repair form: A4, sections 1-2 / sections 3-5, image links.
-- Publish a new version; preserve existing issue-form snapshots and ticket edits.
with updated_template as (
  update public.form_templates
  set content_html = $form$
<div class="ticket-reference-page">
<p style="text-align:center">{{org_logo}}</p>
<h1 style="text-align:center">แบบฟอร์มการแจ้งปัญหา IT Support และระบบ ERP</h1>
<p style="text-align:right"><strong>เลขที่ Ticket No:</strong> {{ticket_no}}</p>

<h2>ส่วนที่ 1: ข้อมูลผู้แจ้ง และรายละเอียดปัญหา</h2>
<table class="ticket-form-lines"><tbody>
<tr><td><strong>ชื่อ-นามสกุล</strong> {{requester_name}}</td><td><strong>ตำแหน่ง</strong> {{position}}</td></tr>
<tr><td><strong>ส่วนงาน</strong> {{department}}</td><td><strong>เบอร์โทรศัพท์</strong> {{phone}}</td></tr>
<tr><td><strong>วันที่พบปัญหา</strong> {{incident_date}}</td><td><strong>เวลา</strong> {{incident_time}} น.</td></tr>
</tbody></table>
<p><strong>ประเภทงานที่ขอรับบริการ (โปรดเลือก):</strong></p>
<p><strong>1. ☐ งาน IT Support ทั่วไป</strong><br>
☐ คอมพิวเตอร์/โน้ตบุ๊ก &nbsp; ☐ เครื่องพิมพ์ (Printer) / สแกนเนอร์ &nbsp; ☐ เครือข่าย (Internet/Wi-Fi)<br>
☐ อีเมล / รหัสผ่าน &nbsp; ☐ ซอฟต์แวร์ทั่วไป (Windows, Office) &nbsp; ☐ อื่นๆ —</p>
<p><strong>2. ☐ งานระบบ ERP / ระบบเฉพาะทาง</strong><br>
☐ ระบบ ERP (ระบุ Module: {{erp_module}})<br>
☐ ระบบตรวจสอบสิทธิ์และขอรับเงิน กรมธรรม์ล่วงพ้นอายุความ<br>
☐ อื่นๆ —</p>
<p><strong>ระดับความรุนแรง (ประเมินโดยผู้ใช้งาน):</strong><br>
☐ รุนแรงมาก (ทำงานต่อไม่ได้เลย) &nbsp; ☐ ปานกลาง (กระทบบางส่วน) &nbsp; ☐ น้อย (ความไม่สะดวกเล็กน้อย)</p>
<p><strong>รายละเอียดปัญหาที่พบ / ข้อความ Error ที่แสดง:</strong><br>{{issue_detail}}<br>................................................................................................................................................</p>
<p>☐ มีไฟล์ภาพประกอบ (Screenshot) แนบมาพร้อมเอกสารนี้<br>{{image_attachments}}</p>


<h2>ส่วนที่ 2: การประเมินและดำเนินการโดยงานเทคโนโลยีสารสนเทศ</h2>
<p><strong>วัน/เวลา ที่รับเรื่อง:</strong> {{received_at}} น. &nbsp; <strong>ผู้รับเรื่อง:</strong> {{receiver_name}}</p>
<p><strong>ระดับความสำคัญของงาน (Priority):</strong> ☐ High (ด่วนมาก) &nbsp; ☐ Medium (ปานกลาง) &nbsp; ☐ Low (ทั่วไป)</p>
<p><strong>การดำเนินการ (Action Taken):</strong><br>
☐ ดำเนินการแก้ไขปัญหาโดยเจ้าหน้าที่ IT ภายใน (ข้ามไปปิดงานส่วนที่ 5)<br>
☐ ไม่สามารถแก้ไขปัญหาโดย IT ภายในได้ / ต้องส่งต่อให้ผู้เชี่ยวชาญภายนอก (กรุณากรอกส่วนที่ 3)</p>
<p><strong>เนื่องจาก:</strong> ☐ เป็นข้อผิดพลาดของ Source Code / Bug &nbsp; ☐ ฮาร์ดแวร์เสียหายต้องเคลม<br>
☐ อื่นๆ (ระบุ) {{escalation_reason}}</p>
<p><strong>ส่งต่อผู้รับจ้าง (Vendor/Outsource) Ticket No:</strong> {{vendor_ticket_no}}</p>


</div>
<div class="form-page-break"></div>
<div class="ticket-reference-page">
<h2>ส่วนที่ 3: การแก้ไขปัญหาโดยผู้รับจ้าง (Vendor / Outsource)</h2>
<p><em>*สำหรับกรณีที่ต้องส่งต่อปัญหาให้บริษัทภายนอกแก้ไข (เฉพาะกรณีที่ติ๊กเลือกส่ง Vendor ในส่วนที่ 2)</em></p>
<p><strong>ประเภทงาน (SLA Category):</strong> ☐ Emergency Case &nbsp; ☐ Minor Case &nbsp; ☐ อื่นๆ —</p>
<p><strong>กำหนดแก้ไขปัญหาแล้วเสร็จภายใน</strong> — <strong>วัน</strong> (วันที่คาดว่าจะเสร็จ: {{target_completion_date}})</p>
<table><thead><tr><th>ขั้นตอนการให้บริการ</th><th>Emergency Case</th><th>Minor Case</th><th>เวลาดำเนินการจริง</th></tr></thead><tbody>
<tr><td>รับแจ้งเรื่อง</td><td>ภายใน 1 ชั่วโมง</td><td>ภายใน 1 ชั่วโมง</td><td>{{vendor_received_time}}</td></tr>
<tr><td>แก้ไขเบื้องต้น/Workaround</td><td>ภายใน 4 ชั่วโมง</td><td>ภายใน 1-5 วัน</td><td>{{vendor_workaround_time}}</td></tr>
<tr><td>สรุปและวิเคราะห์สาเหตุ</td><td>ภายใน 24 ชั่วโมง</td><td>ภายใน 2-10 วัน</td><td>{{vendor_analysis_time}}</td></tr>
<tr><td>แก้ไขปัญหาถาวรสำเร็จ</td><td>ภายใน 4 วัน</td><td>ภายใน 5-15 วัน</td><td>{{vendor_resolution_time}}</td></tr>
</tbody></table>
<p><strong>สาเหตุหลักของปัญหา (Root Cause Analysis):</strong><br>{{root_cause}}</p>
<p><strong>วิธีการแก้ไขปัญหา / ป้องกันไม่ให้เกิดซ้ำ:</strong><br>{{resolution_and_prevention}}</p>
<p style="text-align:right">ลงชื่อ {{vendor_signature}}<br>({{vendor_assessor_name}}) ผู้รับจ้าง/Vendor<br>วันที่ {{vendor_signed_date}}</p>

<h2>ส่วนที่ 4: การประเมิน Manday / Credit (สำหรับการ ปรับ/แก้ไข/เพิ่มเติม/ลบ ระบบ)</h2>
<p>☐ ไม่ใช้ Credit (เป็นการแก้ไขข้อผิดพลาด/Bug หรืออยู่ในเงื่อนไขรับประกัน)</p>
<p>☐ มีการใช้ Credit / Manday เนื่องจากเป็นการพัฒนาระบบหรือ Change Request<br>
<strong>ประเภทการดำเนินการ:</strong> ☐ ปรับ (Adjust) &nbsp; ☐ แก้ไข (Edit) &nbsp; ☐ เพิ่มเติม (Add) &nbsp; ☐ ลบ (Delete)</p>
<p><strong>สรุปการใช้ Manday / Credit:</strong></p>
<table class="ticket-form-lines"><tbody>
<tr><td>จำนวน Manday / Credit คงเหลือเริ่มต้น</td><td>{{credit_balance_before}} วัน/เครดิต</td></tr>
<tr><td>ที่ใช้ในครั้งนี้</td><td>{{manday_used}} วันเครดิต</td></tr>
<tr><td>คงเหลือสุทธิ</td><td>{{credit_balance_after}} วันเครดิต</td></tr>
</tbody></table>
<p><strong>หมายเหตุ / รายละเอียดการประเมิน (ถ้ามี):</strong> {{credit_note}}</p>
<table class="ticket-form-lines"><tbody><tr>
<td>ลงชื่อ {{vendor_signature}}<br>({{vendor_assessor_name}})<br>ผู้ประเมิน (Vendor)<br>วันที่ {{vendor_signed_date}}</td>
<td>ลงชื่อ —<br>(นายกรัณย์ทัศ รักษ์ธรรมกิจ)<br>ผู้อนุมัติ<br>วันที่ —</td>
</tr></tbody></table>

<h2>ส่วนที่ 5: ผลการดำเนินงานและการปิดงาน (Results &amp; Sign-off)</h2>
<p><strong>วันที่ซ่อม/แก้ไขแล้วเสร็จจริง:</strong> {{completed_at}} น.</p>
<p><strong>สถานะการซ่อม:</strong> ☐ แก้ไขเรียบร้อยสมบูรณ์ &nbsp; ☐ แก้ไขชั่วคราว (ใช้งานได้ก่อน) &nbsp; ☐ ไม่สามารถแก้ไขได้</p>
<p><strong>รายละเอียดผลการซ่อม/ทดสอบ:</strong><br>{{test_result}}</p>
<p>☐ ผู้แจ้งได้ทำการทดสอบการใช้งานแล้ว ยืนยันว่าปัญหาได้รับการแก้ไขเรียบร้อยแล้ว</p>
<table class="ticket-form-signoff"><tbody><tr>
<td>ผู้แจ้ง<br>ลงชื่อ {{requester_signature}}<br>({{requester_name}})<br>วันที่ {{requester_sign_date}}</td>
<td>เจ้าหน้าที่ IT<br>ลงชื่อ {{it_signature}}<br>({{receiver_name}})<br>วันที่ {{it_sign_date}}</td>
</tr></tbody></table>
</div>
$form$,
      page_settings = coalesce(page_settings, '{}'::jsonb) || '{"size":"A4","orientation":"portrait","marginMm":20}'::jsonb,
      description = 'แบบฟอร์มแจ้งซ่อม 2 หน้า ตามต้นฉบับ พร้อมลิงก์เปิดไฟล์ภาพแนบ',
      current_version = current_version + 1,
      published_at = now(), updated_at = now()
  where template_code = 'IT-ERP-ISSUE'
    and content_html not like '%ticket-reference-page%'
  returning *
)
insert into public.form_template_versions (
  template_id, version, name, description, content_html, page_settings, change_note, created_by
)
select id, current_version, name, description, content_html, page_settings,
  'จัดแบบฟอร์ม A4 สองหน้าตามต้นฉบับ และเพิ่มลิงก์ภาพแนบ', updated_by
from updated_template;
