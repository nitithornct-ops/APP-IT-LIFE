/**
 * Module_Calendar.gs
 * ปฏิทินรวมกำหนดการทั้งระบบ — ดึงวันครบกำหนด/วันสำคัญจากหลายโมดูลมาแสดงบนปฏิทินเดียว
 *
 * หลักการ:
 * - config-driven ผ่าน CAL_SOURCES: เพิ่มแหล่งใหม่ได้โดยเติม 1 บรรทัด
 * - เคารพสิทธิ์: ผู้ใช้เห็นเฉพาะแหล่งของโมดูลที่ตนเข้าถึงได้ (canAccessModule)
 * - ความเป็นส่วนตัว: งานส่วนตัว (task) กรองด้วย OwnerEmail เสมอ
 * - อ่านอย่างเดียว (read-only) — คลิกเพื่อไปยังโมดูลต้นทาง ไม่แก้ไขข้อมูลจากปฏิทินนี้
 */

// date อาจเป็นชื่อคอลัมน์ (string) หรือ function(row) เมื่อมีหลายคอลัมน์สำรอง
var CAL_SOURCES = [
  { module: 'task',        sheet: SHEETS.PERSONAL_TASK,    date: 'DueDate',          color: '#1d4ed8', label: 'งานของฉัน',       owner: true,
    title: function (r) { return r.Title; } },
  { module: 'ticket',      sheet: SHEETS.TICKET,           date: 'DueAt',            color: '#dc2626', label: 'Ticket/SLA',
    skip: function (r) { return isTicketTerminal_(r.Status); }, title: function (r) { return r.Title || r.TicketID; } },
  { module: 'serviceCatalog', sheet: SHEETS.SERVICE_REQUEST, date: 'DueAt',          color: '#2563eb', label: 'Service Request/SLA',
    visible: function (r, u) {
      if (u.role === ROLES.IT_ADMIN) return true;
      var email = String(u.email || '').toLowerCase();
      return String(r.RequesterEmail || '').toLowerCase() === email ||
        String(r.Approver || '').toLowerCase() === email;
    },
    skip: function (r) { return ['ปิดงาน','ปฏิเสธ','ยกเลิก'].indexOf(String(r.Status)) > -1; },
    title: function (r) { return r.ServiceName || r.Summary || r.RequestID; } },
  { module: 'change',      sheet: SHEETS.CHANGE,           date: 'DeployDate',       color: '#7c3aed', label: 'Change/Deploy',
    title: function (r) { return r.Title || r.ChangeID; } },
  { module: 'vendor',      sheet: SHEETS.VENDOR,           date: 'ContractExpiry',   color: '#d97706', label: 'สัญญา Vendor',
    title: function (r) { return r.VendorName; } },
  { module: 'license',     sheet: SHEETS.SOFTWARE_LICENSE, date: 'ExpireDate',       color: '#ea580c', label: 'License หมดอายุ',
    title: function (r) { return r.SoftwareName || r.LicenseID; } },
  { module: 'asset',       sheet: SHEETS.ASSET,            date: 'LicenseExpiry',    color: '#0d9488', label: 'Asset ครบกำหนด',
    skip: function (r) { return isAssetRetired_(r.Status); }, title: function (r) { return r.AssetName || r.AssetID; } },
  { module: 'maintenance', sheet: SHEETS.MAINTENANCE,      color: '#16a34a', label: 'PM/บำรุงรักษา',
    date: function (r) { return r.PlanDate || r.NextDueDate; }, title: function (r) { return r.AssetName || r.AssetID || r.MaintenanceID; } },
  { module: 'access',      sheet: SHEETS.ACCESS_REGISTRY,  date: 'NextReviewDue',    color: '#4f46e5', label: 'ทบทวนสิทธิ์',
    title: function (r) { return r.UserName || r.SystemName; } },
  { module: 'logging',     sheet: SHEETS.LOG_REGISTER,     date: 'NextReviewDue',    color: '#475569', label: 'ทบทวน Log',
    title: function (r) { return r.SystemName || r.LogType; } },
  { module: 'backup',      sheet: SHEETS.BACKUP,           date: 'NextBackupDue',    color: '#0891b2', label: 'สำรองข้อมูล',
    title: function (r) { return r.SystemName; } },
  { module: 'incident',    sheet: SHEETS.INCIDENT,         date: 'DPONotifyDeadline', color: '#b91c1c', label: 'DPO คัดกรองเหตุข้อมูลส่วนบุคคล',
    skip: function (r) { var s = String(r.Status).toLowerCase(); return s === 'closed' || s === 'ปิดเคส'; },
    title: function (r) { return r.Title || r.IncidentID; } }
];

function calVisibleSources_(role) {
  return CAL_SOURCES.filter(function (s) { return canAccessModule(role, s.module); });
}

function calDateVal_(spec, row) {
  var raw = (typeof spec.date === 'function') ? spec.date(row) : row[spec.date];
  if (!raw) return null;
  var d = (raw instanceof Date) ? raw : new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

/** parse 'yyyy-MM-dd' (จาก FullCalendar) เป็น Date เที่ยงคืน; ถ้าไม่มีให้ใช้วันนี้ +offset วัน */
function calRangeDate_(iso, fallbackOffsetDays) {
  if (iso) {
    var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  }
  var d = new Date(); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + (fallbackOffsetDays || 0));
  return d;
}

function calFmtIso_(d) {
  return Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM-dd');
}

/** รายชื่อแหล่งข้อมูลที่ผู้ใช้เห็น (ใช้สร้าง legend/ตัวกรองฝั่งหน้าเว็บ) */
function getCalendarMeta() {
  try {
    var user = requireModule('calendar', false);
    var sources = calVisibleSources_(user.role).map(function (s) {
      return { module: s.module, label: s.label, color: s.color };
    });
    return ok({ sources: sources });
  } catch (e) {
    return fail(e.message);
  }
}

/** เหตุการณ์ในช่วง [startIso, endIso) จากทุกแหล่งที่ผู้ใช้เข้าถึงได้ */
function getCalendarData(startIso, endIso) {
  try {
    var user = requireModule('calendar', false);
    var startT = calRangeDate_(startIso, -90).getTime();
    var endT = calRangeDate_(endIso, 120).getTime();
    var ownerEmail = String(user.email || '').toLowerCase().trim();
    var events = [];

    calVisibleSources_(user.role).forEach(function (spec) {
      safeEach_(spec.sheet, function (r) {
        if (spec.owner && String(r.OwnerEmail || '').toLowerCase().trim() !== ownerEmail) return;
        if (spec.visible && !spec.visible(r, user)) return;
        if (spec.skip && spec.skip(r)) return;
        var d = calDateVal_(spec, r);
        if (!d) return;
        var t = d.getTime();
        if (t < startT || t >= endT) return;
        var name = spec.title(r);
        name = (name == null) ? '' : String(name);
        events.push({
          title: '[' + spec.label + '] ' + name,
          start: calFmtIso_(d),
          allDay: true,
          backgroundColor: spec.color,
          borderColor: spec.color,
          extendedProps: { module: spec.module, label: spec.label, name: name }
        });
      });
    });

    return ok({ events: events });
  } catch (e) {
    return fail(e.message);
  }
}
