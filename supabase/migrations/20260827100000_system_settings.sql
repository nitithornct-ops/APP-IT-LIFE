-- Phase 6 Module 22: System Settings.
-- Secrets (LINE tokens, OAuth secrets, service keys) are intentionally excluded and remain deployment-managed.
create table if not exists public.system_settings (
  key text primary key check (key ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  value text not null default '',
  description text not null,
  group_key text not null,
  value_type text not null default 'text' check (value_type in ('text','textarea','boolean','number','time','url','enum','csv')),
  min_value numeric,
  max_value numeric,
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  is_editable boolean not null default true,
  support_status text not null default 'prepared' check (support_status in ('active','prepared','deferred','external')),
  sort_order integer not null default 0,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint system_settings_range_valid check (min_value is null or max_value is null or max_value >= min_value)
);

create index if not exists system_settings_group_sort_idx on public.system_settings (group_key, sort_order, key);
drop trigger if exists trg_system_settings_set_updated_at on public.system_settings;
create trigger trg_system_settings_set_updated_at before update on public.system_settings for each row execute function public.set_updated_at();

alter table public.system_settings enable row level security;
drop policy if exists system_settings_select_with_permission on public.system_settings;
create policy system_settings_select_with_permission on public.system_settings for select to authenticated using (public.has_permission('setting.view'));
drop policy if exists system_settings_update_with_permission on public.system_settings;
create policy system_settings_update_with_permission on public.system_settings for update to authenticated
  using (public.has_permission('setting.manage') and is_editable)
  with check (public.has_permission('setting.manage') and is_editable);

insert into public.permissions (key, module_key, action, description, status) values
  ('setting.view', 'setting', 'view', 'ดูการตั้งค่าระบบที่ไม่ใช่ความลับ', 'active'),
  ('setting.manage', 'setting', 'manage', 'แก้ไขการตั้งค่าระบบผ่าน allowlist', 'active')
on conflict (key) do update set description = excluded.description, status = excluded.status;

insert into public.role_permissions (role_id, permission_id, effect)
select r.id, p.id, 'allow'
from public.roles r cross join public.permissions p
where r.key in ('super_admin','it_admin') and p.key in ('setting.view','setting.manage')
on conflict (role_id, permission_id) do update set effect = 'allow';

insert into public.system_settings
  (key, value, description, group_key, value_type, min_value, max_value, options, is_editable, support_status, sort_order)
values
  ('ORG_NAME','กองทุนประกันชีวิต','ชื่อองค์กรที่แสดงในระบบ','General','text',null,null,'[]',true,'active',10),
  ('NOTIFY_LINE_ENABLED','false','เปิด/ปิด LINE Messaging API; ต้องตั้ง secret ที่ deployment ก่อน','Notification','boolean',null,null,'[]',false,'deferred',100),
  ('NOTIFY_PRIMARY_CHANNEL','LINE','ช่องทางแจ้งเตือนหลักของระบบ','Notification','enum',null,null,'["LINE"]',false,'deferred',110),
  ('NOTIFY_LEAD_DAYS','30','จำนวนวันแจ้งเตือนล่วงหน้า','Notification','number',1,365,'[]',true,'active',120),
  ('LINE_QUEUE_MAX_ATTEMPTS','5','จำนวนครั้งสูงสุดที่คิว LINE retry ก่อนเป็น DEAD','Notification','number',1,10,'[]',true,'prepared',130),
  ('REVIEW_CYCLE_DAYS','180','รอบทบทวนสิทธิ์และข้อมูลสำคัญ','Governance','number',1,1095,'[]',true,'active',200),
  ('INCIDENT_DPO_ESCALATION_HOURS','4','กรอบเวลาภายในสำหรับส่งเหตุข้อมูลส่วนบุคคลให้ DPO คัดกรอง','Governance','number',1,24,'[]',true,'prepared',210),
  ('LOGIN_MAX_FAILS_5MIN','10','จำนวนครั้งที่ล็อกอินผิดก่อนพัก 5 นาที','Security','number',5,30,'[]',false,'external',300),
  ('PASSWORD_HASH_ITERATIONS','20000','การ hash รหัสผ่านจัดการโดย Supabase Auth','Security','number',1000,20000,'[]',false,'external',310),
  ('ADMIN_MFA_ENABLED','false','MFA ของผู้ดูแลจัดการผ่าน Supabase Auth/Identity Provider','Security','boolean',null,null,'[]',false,'external',320),
  ('ATTACHMENT_DOWNLOAD_MAX_MB','10','ขนาดไฟล์สูงสุดที่ดาวน์โหลดผ่านระบบได้ต่อครั้ง (MB)','Security','number',1,15,'[]',true,'active',330),
  ('LINE_LOGIN_ENABLED','false','เปิด LINE Login หลังตั้ง Channel ID/Secret/Callback ที่ deployment','LINE Login','boolean',null,null,'[]',false,'deferred',400),
  ('LINE_REQUIRE_EMPLOYEE_LINK','false','บังคับให้ LINE ผูกกับรหัสพนักงานก่อนใช้งาน','LINE Login','boolean',null,null,'[]',true,'prepared',410),
  ('LINE_AUTO_APPROVE_EMPLOYEE_LINK','false','อนุมัติการผูก Employee Code อัตโนมัติ','LINE Login','boolean',null,null,'[]',true,'prepared',420),
  ('LINE_SESSION_HOURS','24','อายุ session ของผู้ใช้ LINE (ชั่วโมง)','LINE Login','number',1,720,'[]',true,'prepared',430),
  ('PUBLIC_TICKET_ENABLED','false','เปิดหน้าแจ้งซ่อมสาธารณะเมื่อ public intake พร้อมใช้งาน','Public Helpdesk','boolean',null,null,'[]',false,'deferred',500),
  ('PUBLIC_TICKET_REQUIRE_LINE','false','บังคับ LINE Login ก่อนส่ง Ticket สาธารณะ','Public Helpdesk','boolean',null,null,'[]',true,'prepared',510),
  ('PUBLIC_TICKET_MAX_FILES','5','จำนวนไฟล์แนบสูงสุดต่อ Ticket','Public Helpdesk','number',1,5,'[]',true,'prepared',520),
  ('PUBLIC_TICKET_MAX_FILE_MB','10','ขนาดไฟล์แนบสูงสุดต่อไฟล์ (MB)','Public Helpdesk','number',1,15,'[]',true,'prepared',530),
  ('PUBLIC_TICKET_MAX_TOTAL_MB','20','ขนาดไฟล์แนบรวมสูงสุดต่อ Ticket (MB)','Public Helpdesk','number',1,50,'[]',true,'prepared',540),
  ('PUBLIC_TICKET_MAX_PER_HOUR','3','จำนวน Ticket สูงสุดต่ออุปกรณ์ต่อชั่วโมง','Public Helpdesk','number',1,20,'[]',true,'prepared',550),
  ('PUBLIC_TICKET_MAX_PER_DAY','8','จำนวน Ticket สูงสุดต่ออุปกรณ์ต่อวัน','Public Helpdesk','number',1,50,'[]',true,'prepared',560),
  ('PUBLIC_TICKET_GLOBAL_MAX_PER_HOUR','60','จำนวน Ticket สาธารณะรวมสูงสุดต่อชั่วโมง','Public Helpdesk','number',10,1000,'[]',true,'prepared',570),
  ('PUBLIC_TICKET_GLOBAL_MAX_PER_DAY','300','จำนวน Ticket สาธารณะรวมสูงสุดต่อวัน','Public Helpdesk','number',20,5000,'[]',true,'prepared',580),
  ('PUBLIC_TICKET_EMAIL_OTP_ENABLED','false','เปิด Email OTP สำหรับดู Ticket สาธารณะหลายรายการ','Public Helpdesk','boolean',null,null,'[]',true,'prepared',590),
  ('PUBLIC_TICKET_ALLOWED_EMAIL_DOMAINS','','โดเมนอีเมลที่อนุญาต คั่นด้วย comma; เว้นว่างคือทุกโดเมน','Public Helpdesk','csv',null,null,'[]',true,'prepared',600),
  ('PUBLIC_TICKET_CONSENT_REQUIRED','true','บังคับยอมรับ Privacy Notice ก่อนส่ง Ticket สาธารณะ','Privacy / PDPA','boolean',null,null,'[]',true,'prepared',700),
  ('PUBLIC_PRIVACY_NOTICE_VERSION','2026-07-08','เวอร์ชัน Privacy Notice','Privacy / PDPA','text',null,null,'[]',true,'prepared',710),
  ('PUBLIC_PRIVACY_NOTICE_TEXT','ระบบใช้ข้อมูลผู้แจ้งเพื่อรับเรื่อง ติดต่อกลับ ดำเนินการแจ้งซ่อม แจ้งสถานะ และเก็บหลักฐานตามนโยบายองค์กร','ข้อความสรุป Privacy Notice','Privacy / PDPA','textarea',null,null,'[]',true,'prepared',720),
  ('PUBLIC_PRIVACY_NOTICE_URL','','ลิงก์ประกาศความเป็นส่วนตัวฉบับเต็ม (HTTPS)','Privacy / PDPA','url',null,null,'[]',true,'prepared',730),
  ('PUBLIC_PRIVACY_DPO_CONTACT','DPO / ส่วนงาน IT','ช่องทางติดต่อผู้ดูแลข้อมูลส่วนบุคคล','Privacy / PDPA','text',null,null,'[]',true,'prepared',740),
  ('AUTO_BACKUP_ENABLED','false','เปิด System Snapshot อัตโนมัติเมื่อ scheduler พร้อม','Backup / Recovery','boolean',null,null,'[]',false,'deferred',800),
  ('AUTO_RESTORE_DRILL_ENABLED','false','เปิด Restore drill อัตโนมัติเมื่อ sandbox พร้อม','Backup / Recovery','boolean',null,null,'[]',false,'deferred',810),
  ('BACKUP_RETENTION_DAYS','90','อายุ Snapshot ก่อนลบตามนโยบาย','Backup / Recovery','number',7,3650,'[]',true,'prepared',820),
  ('RESTORE_SANDBOX_RETENTION_DAYS','30','อายุ Sandbox จาก Restore drill','Backup / Recovery','number',7,3650,'[]',true,'prepared',830),
  ('BACKUP_HEALTH_MAX_HOURS','30','จำนวนชั่วโมงสูงสุดที่ยอมให้ไม่มี backup health ใหม่','Backup / Recovery','number',1,168,'[]',true,'prepared',840),
  ('RETENTION_MODE','DRY_RUN','DRY_RUN ตรวจอย่างเดียว; ENFORCE ดำเนินการตาม Policy','Retention / PDPA','enum',null,null,'["DRY_RUN","ENFORCE"]',true,'active',900),
  ('LINE_SESSION_RETENTION_DAYS','30','อายุ session LINE ที่หมดอายุหรือถูกเพิกถอน','Retention / PDPA','number',1,3650,'[]',true,'prepared',910),
  ('NOTIFICATION_LOG_RETENTION_DAYS','365','อายุ Notification Log','Retention / PDPA','number',30,3650,'[]',true,'prepared',920),
  ('NOTIFICATION_QUEUE_RETENTION_DAYS','90','อายุคิวแจ้งเตือนที่ส่งแล้วหรือเป็น DEAD','Retention / PDPA','number',7,3650,'[]',true,'prepared',930),
  ('TICKET_PII_RETENTION_DAYS','730','อายุ Ticket ที่ปิดแล้วก่อน anonymize ข้อมูลผู้แจ้ง','Retention / PDPA','number',30,36500,'[]',true,'prepared',940),
  ('SERVICE_REQUEST_PII_RETENTION_DAYS','730','อายุ Service Request ก่อน anonymize ข้อมูลผู้ขอ','Retention / PDPA','number',30,36500,'[]',true,'prepared',950),
  ('WORKFLOW_PII_RETENTION_DAYS','730','อายุ Workflow ที่สิ้นสุดก่อน anonymize ผู้เกี่ยวข้อง','Retention / PDPA','number',30,36500,'[]',true,'prepared',960),
  ('ATTACHMENT_RETENTION_DAYS','730','อายุไฟล์แนบทั่วไปก่อนเข้าสู่ retention','Retention / PDPA','number',30,36500,'[]',true,'prepared',970),
  ('ATTACHMENT_STAGED_RETENTION_HOURS','72','อายุไฟล์อัปโหลดที่ยังไม่ถูกผูกกับรายการ (ชั่วโมง)','Retention / PDPA','number',1,720,'[]',true,'active',980),
  ('SOFT_DELETE_RETENTION_DAYS','365','อายุรายการในถังขยะก่อนลบถาวร','Retention / PDPA','number',30,36500,'[]',true,'prepared',990),
  ('RETENTION_TRASH_EVIDENCE','false','อนุญาตย้ายหลักฐาน Ticket ที่พ้น retention เข้าถังขยะ','Retention / PDPA','boolean',null,null,'[]',true,'prepared',1000),
  ('SLA_BUSINESS_START','08:30','เวลาเริ่มงาน HH:mm','Ticket SLA','time',null,null,'[]',true,'prepared',1100),
  ('SLA_BUSINESS_END','17:30','เวลาสิ้นสุดงาน HH:mm','Ticket SLA','time',null,null,'[]',true,'prepared',1110),
  ('SLA_BUSINESS_DAYS','1,2,3,4,5','วันทำการ 0=อาทิตย์ ถึง 6=เสาร์','Ticket SLA','csv',null,null,'[]',true,'prepared',1120),
  ('SLA_HOLIDAYS','','วันหยุด yyyy-mm-dd คั่นด้วย comma','Ticket SLA','csv',null,null,'[]',true,'prepared',1130),
  ('LIVE_HEALTH_PUBLIC_URL','','URL สาธารณะสำหรับตรวจ Live Health (HTTPS)','Live Health','url',null,null,'[]',true,'prepared',1200)
on conflict (key) do update set
  description = excluded.description,
  group_key = excluded.group_key,
  value_type = excluded.value_type,
  min_value = excluded.min_value,
  max_value = excluded.max_value,
  options = excluded.options,
  is_editable = excluded.is_editable,
  support_status = excluded.support_status,
  sort_order = excluded.sort_order;
