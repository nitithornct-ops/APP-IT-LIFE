/**
 * Module_ITAssetExtras.gs
 * โมดูล IT Asset เพิ่มเติมตามชุดเมนู: Borrow/PM/Inventory/License/Reports/Users/Settings/Tester.
 * ใช้ response contract เดิมของ App_LIFE: {ok, data|error}
 */

const BORROW_ACTIONS = ['ยืม/มอบหมาย', 'คืน', 'โอนย้าย', 'ส่งซ่อม'];
const PM_STATUSES = ['วางแผน', 'กำลังดำเนินการ', 'ดำเนินการแล้ว', 'ยกเลิก'];
const PM_RECURRENCES = ['ครั้งเดียว', 'รายเดือน', 'รายไตรมาส', 'รายปี'];
const INVENTORY_TX_TYPES = ['IN', 'OUT'];
const LICENSE_TYPES = ['Perpetual', 'Subscription', 'OEM', 'Volume', 'Per User', 'Per Device', 'อื่นๆ'];
const LICENSE_STATUSES = ['Active', 'Expired', 'Inactive'];
const QA_STATUSES = ['PASS', 'FAIL', 'BLOCKED', 'PENDING'];
const QA_PRIORITIES = ['สูง', 'กลาง', 'ต่ำ'];
const SYSTEM_SETTING_KEYS = [
  'ORG_NAME',
  'NOTIFY_LINE_ENABLED',
  'NOTIFY_PRIMARY_CHANNEL',
  'NOTIFY_LEAD_DAYS',
  'LINE_QUEUE_MAX_ATTEMPTS',
  'REVIEW_CYCLE_DAYS',
  'INCIDENT_DPO_ESCALATION_HOURS',
  'LOGIN_MAX_FAILS_5MIN',
  'PASSWORD_HASH_ITERATIONS',
  'ADMIN_MFA_ENABLED',
  'LINE_LOGIN_ENABLED',
  'LINE_REQUIRE_EMPLOYEE_LINK',
  'LINE_AUTO_APPROVE_EMPLOYEE_LINK',
  'LINE_SESSION_HOURS',
  'PUBLIC_TICKET_ENABLED',
  'PUBLIC_TICKET_REQUIRE_LINE',
  'PUBLIC_TICKET_MAX_FILES',
  'PUBLIC_TICKET_MAX_FILE_MB',
  'PUBLIC_TICKET_MAX_TOTAL_MB',
  'PUBLIC_TICKET_MAX_PER_HOUR',
  'PUBLIC_TICKET_MAX_PER_DAY',
  'PUBLIC_TICKET_GLOBAL_MAX_PER_HOUR',
  'PUBLIC_TICKET_GLOBAL_MAX_PER_DAY',
  'PUBLIC_TICKET_EMAIL_OTP_ENABLED',
  'PUBLIC_TICKET_ALLOWED_EMAIL_DOMAINS',
  'PUBLIC_TICKET_CONSENT_REQUIRED',
  'PUBLIC_PRIVACY_NOTICE_VERSION',
  'PUBLIC_PRIVACY_NOTICE_TEXT',
  'PUBLIC_PRIVACY_NOTICE_URL',
  'PUBLIC_PRIVACY_DPO_CONTACT',
  'AUTO_BACKUP_ENABLED',
  'AUTO_RESTORE_DRILL_ENABLED',
  'BACKUP_RETENTION_DAYS',
  'RESTORE_SANDBOX_RETENTION_DAYS',
  'BACKUP_HEALTH_MAX_HOURS',
  'RETENTION_MODE',
  'LINE_SESSION_RETENTION_DAYS',
  'NOTIFICATION_LOG_RETENTION_DAYS',
  'NOTIFICATION_QUEUE_RETENTION_DAYS',
  'TICKET_PII_RETENTION_DAYS',
  'SERVICE_REQUEST_PII_RETENTION_DAYS',
  'WORKFLOW_PII_RETENTION_DAYS',
  'ATTACHMENT_RETENTION_DAYS',
  'ATTACHMENT_STAGED_RETENTION_HOURS',
  'ATTACHMENT_DOWNLOAD_MAX_MB',
  'SOFT_DELETE_RETENTION_DAYS',
  'RETENTION_TRASH_EVIDENCE',
  'SLA_BUSINESS_START',
  'SLA_BUSINESS_END',
  'SLA_BUSINESS_DAYS',
  'SLA_HOLIDAYS',
  'LIVE_HEALTH_PUBLIC_URL'
];

function getAssetOptions_() {
  try {
    return readSheetObjects_(SHEETS.ASSET).map(function (r) {
      const code = r.AssetCode || r.AssetID;
      return {
        id: r.AssetID,
        code: code,
        name: r.AssetName,
        category: r.Category || r.AssetType || '',
        serial: r.SerialNumber || '',
        label: code + ' - ' + (r.AssetName || ''),
        status: r.Status || '',
        owner: r.OwnerName || r.Owner || '',
        location: r.Location || ''
      };
    });
  } catch (e) {
    return [];
  }
}

function getModuleCatalog_() {
  return [
    { key: 'dashboard', category: 'งานหลัก', label: 'Dashboard', sheet: '', description: 'ภาพรวม KPI และรายการใกล้ครบกำหนด', fields: [] },
    { key: 'ticket', category: 'งานหลัก', label: 'Ticket แจ้งซ่อม', sheet: SHEETS.TICKET, description: 'รายการแจ้งซ่อม, SLA, ผู้รับผิดชอบ และสถานะงาน', fields: ['TicketID', 'Title', 'RequesterName', 'Priority', 'Status', 'DueAt'] },
    { key: 'serviceCatalog', category: 'งานหลัก', label: 'Service Catalog / คำขอบริการ', sheet: SHEETS.SERVICE_REQUEST, description: 'คำขอบริการ การอนุมัติ SLA Checklist และผลดำเนินการ', fields: ['RequestID', 'ServiceName', 'RequesterName', 'Priority', 'Status', 'DueAt'] },
    { key: 'kb', category: 'งานหลัก', label: 'ฐานความรู้ (KB)', sheet: SHEETS.KB, description: 'บทความวิธีแก้ปัญหาแบบ Self-service และสถิติการใช้งาน', fields: ['ArticleID', 'Title', 'Category', 'Status', 'Views', 'Helpful'] },
    { key: 'asset', category: 'งานหลัก', label: 'IT Asset', sheet: SHEETS.ASSET, description: 'ทะเบียนทรัพย์สิน IT, เจ้าของ, สถานที่, License และ Patch', fields: ['AssetID', 'AssetName', 'AssetType', 'Owner', 'Location', 'Status'] },
    { key: 'employees', category: 'ข้อมูลและรายงาน', label: 'พนักงานและทรัพย์สิน', sheet: SHEETS.EMPLOYEES, description: 'รายชื่อพนักงาน บัญชีงาน และทรัพย์สินหรือ Software ที่ครอบครอง', fields: ['EmployeeCode', 'FirstNameTH', 'LastNameTH', 'Position', 'Department', 'Status'] },
    { key: 'borrow', category: 'งานหลัก', label: 'ยืม / คืน Asset', sheet: SHEETS.ASSET_MOVEMENT, description: 'ประวัติการยืม คืน โอนย้าย และส่งซ่อมทรัพย์สิน', fields: ['MovementID', 'AssetName', 'ActionType', 'ToUser', 'ActionDate', 'Status'] },
    { key: 'maintenance', category: 'งานหลัก', label: 'PM / บำรุงรักษา', sheet: SHEETS.MAINTENANCE, description: 'แผน PM, ผลบำรุงรักษา, ช่างผู้รับผิดชอบ และหลักฐาน', fields: ['MaintenanceID', 'AssetName', 'PlanDate', 'ActualDate', 'Status', 'Technician'] },
    { key: 'inventory', category: 'ข้อมูลและรายงาน', label: 'Inventory', sheet: SHEETS.INVENTORY, description: 'คลังวัสดุ/อะไหล่ IT, จำนวนคงเหลือ และจุดสั่งซื้อขั้นต่ำ', fields: ['ItemID', 'ItemName', 'Category', 'StockQty', 'MinQty', 'Status'] },
    { key: 'license', category: 'ข้อมูลและรายงาน', label: 'Software License', sheet: SHEETS.SOFTWARE_LICENSE, description: 'ทะเบียน Software License, จำนวนสิทธิ์, ผู้ใช้งาน และวันหมดอายุ', fields: ['LicenseID', 'SoftwareName', 'LicenseType', 'TotalQty', 'UsedQty', 'ExpireDate'] },
    { key: 'vendor', category: 'ข้อมูลและรายงาน', label: 'Vendor / Contract', sheet: SHEETS.VENDOR, description: 'ผู้ให้บริการภายนอก, สัญญา, วันหมดอายุ และผลประเมิน', fields: ['VendorID', 'VendorName', 'ServiceScope', 'ContractNo', 'ContractExpiry', 'Status'] },
    { key: 'cmdb', category: 'ข้อมูลและรายงาน', label: 'CMDB / Relationship Map', sheet: SHEETS.CONFIG_ITEM, description: 'Configuration Item, Criticality, RPO/RTO และความสัมพันธ์ของระบบ', fields: ['CIID', 'CIName', 'CIType', 'Environment', 'Criticality', 'Status'] },
    { key: 'reports', category: 'ข้อมูลและรายงาน', label: 'Reports', sheet: '', description: 'ศูนย์รวมรายงานจำนวนข้อมูลตามโมดูล', fields: [] },
    { key: 'users', category: 'ระบบ', label: 'Users', sheet: SHEETS.USERS, description: 'ผู้ใช้งาน, หน่วยงาน, บทบาท และสถานะบัญชี', fields: ['UserID', 'Email', 'FullName', 'Department', 'Role', 'Status'] },
    { key: 'settings', category: 'ระบบ', label: 'Settings', sheet: SHEETS.SETTINGS, description: 'ค่าตั้งค่าระบบทั่วไปที่ไม่ใช่ความลับ', fields: ['Key', 'Value', 'Description', 'Group', 'UpdatedAt', 'UpdatedBy'] },
    { key: 'auditTrail', category: 'ระบบ', label: 'Audit Log', sheet: SHEETS.AUDIT_TRAIL, description: 'ประวัติการกระทำสำคัญในระบบ', fields: ['LogID', 'Timestamp', 'ActorEmail', 'Action', 'Module', 'Result'] },
    { key: 'tester', category: 'ระบบ', label: 'Tester / QA', sheet: SHEETS.QA_TEST, description: 'รายการทดสอบ, ผลทดสอบ และ smoke check ของระบบ', fields: ['CaseID', 'Module', 'Scenario', 'Status', 'Priority', 'TestedAt'] },

    { key: 'access', category: 'ธรรมาภิบาล ISMS', label: 'การบริหารสิทธิ์การเข้าถึง', sheet: SHEETS.ACCESS_REQ, description: 'คำขอสิทธิ์และทะเบียน RBAC', fields: ['ReqID', 'RequesterName', 'SystemName', 'AccessLevel', 'Status', 'ReviewDue'] },
    { key: 'incident', category: 'ธรรมาภิบาล ISMS', label: 'การบริหารจัดการเหตุการณ์', sheet: SHEETS.INCIDENT, description: 'Incident, PDPA deadline, root cause และ resolution', fields: ['IncidentID', 'Title', 'Severity', 'Status', 'Assignee', 'CloseDate'] },
    { key: 'backup', category: 'ธรรมาภิบาล ISMS', label: 'การสำรองข้อมูลและแผนฉุกเฉิน', sheet: SHEETS.BACKUP, description: 'Backup, Recovery test และ BCP/DR', fields: ['BackupID', 'SystemName', 'BackupDate', 'Result', 'NextBackupDue'] },
    { key: 'logging', category: 'ธรรมาภิบาล ISMS', label: 'Logging & Monitoring', sheet: SHEETS.LOG_REGISTER, description: 'ทะเบียนระบบที่บันทึก log และรอบทบทวน', fields: ['LogSysID', 'SystemName', 'LogType', 'ReviewFrequency', 'NextReviewDue'] },
    { key: 'change', category: 'ธรรมาภิบาล ISMS', label: 'การควบคุมการเปลี่ยนแปลงระบบงาน', sheet: SHEETS.CHANGE, description: 'คำขอ change, approval, deploy และ rollback plan', fields: ['ChangeID', 'Title', 'RiskLevel', 'Status', 'DeployDate'] },
    { key: 'dataClass', category: 'ธรรมาภิบาล ISMS', label: 'การจัดประเภทและคุ้มครองข้อมูล', sheet: SHEETS.DATA_CLASS, description: 'ชั้นความลับ เจ้าของข้อมูล และกำหนดทำลาย', fields: ['DataID', 'DataName', 'Classification', 'DataOwner', 'DestructionDue'] },
    { key: 'privacy', category: 'ธรรมาภิบาล ISMS', label: 'Privacy / PDPA', sheet: SHEETS.PRIVACY_ROPA, description: 'RoPA, Consent evidence และคำขอใช้สิทธิของเจ้าของข้อมูล', fields: ['RopaID', 'ProcessName', 'Department', 'LawfulBasis', 'ReviewDate', 'Status'] },
    { key: 'problem', category: 'งานหลัก', label: 'Problem / Known Error', sheet: SHEETS.PROBLEM, description: 'Problem, Root Cause, Workaround และ Permanent Fix', fields: ['ProblemID', 'Title', 'AffectedSystem', 'Priority', 'Status', 'ReviewDate'] },
    { key: 'vulnerability', category: 'ธรรมาภิบาล ISMS', label: 'Vulnerability / Patch', sheet: SHEETS.VULNERABILITY, description: 'ช่องโหว่ CVE/CVSS แผนแก้ไข และการตรวจยืนยัน', fields: ['VulnerabilityID', 'Title', 'CVE', 'Severity', 'DueDate', 'Status'] },
    { key: 'audit', category: 'ตรวจสอบและตั้งค่า', label: 'Audit Management', sheet: SHEETS.AUDIT_FINDING, description: 'งานตรวจ ข้อตรวจพบ แผนแก้ไข และการตรวจยืนยัน', fields: ['FindingID', 'AuditID', 'Title', 'FindingType', 'DueDate', 'Status'] },
    { key: 'ai', category: 'ธรรมาภิบาล ISMS', label: 'ทะเบียนเครื่องมือ AI', sheet: SHEETS.AI, description: 'เครื่องมือ AI ที่อนุญาตและประเภทข้อมูลที่ใช้ได้', fields: ['AIID', 'ToolName', 'Vendor', 'Owner', 'Status'] },
    { key: 'cloud', category: 'ธรรมาภิบาล ISMS', label: 'ทะเบียนระบบ Cloud', sheet: SHEETS.CLOUD, description: 'Cloud service, allowed data class, exit plan และวันหมดสัญญา', fields: ['CloudID', 'ServiceName', 'Provider', 'AllowedDataClass', 'ContractExpiry'] },
    { key: 'awareness', category: 'ธรรมาภิบาล ISMS', label: 'การสร้างความตระหนัก/อบรม', sheet: SHEETS.TRAIN_PLAN, description: 'แผนอบรม บันทึกอบรม และการรับทราบนโยบาย', fields: ['PlanID', 'Year', 'Quarter', 'Topic', 'PlannedDate', 'Status'] },
    { key: 'evidence', category: 'ตรวจสอบและตั้งค่า', label: 'ศูนย์รวมหลักฐานตรวจสอบ', sheet: SHEETS.POLICY_MAP, description: 'Mapping นโยบายและหลักฐานประกอบ IT Audit', fields: ['MapID', 'Module', 'Feature', 'PolicyClause'] },
    { key: 'notification', category: 'ระบบ', label: 'ตั้งค่าการแจ้งเตือน', sheet: SHEETS.NOTIFY_LOG, description: 'ประวัติการส่งแจ้งเตือน Email/LINE และผลลัพธ์', fields: ['NotifyID', 'SentAt', 'Channel', 'Recipient', 'Subject', 'Result'] }
  ];
}

function summarizeRowsForCatalog_(entry, scopedRows) {
  if (!entry.sheet) return { total: 0, rows: [] };
  const rows = Array.isArray(scopedRows) ? scopedRows :
    (DB_SCHEMA[entry.sheet] ? readSheetObjectsEnsured_(entry.sheet) : readSheetObjects_(entry.sheet));
  return {
    total: rows.length,
    rows: rows.slice(Math.max(rows.length - 5, 0)).reverse().map(function (r) {
      const obj = {};
      entry.fields.forEach(function (f) {
        obj[f] = (r[f] instanceof Date) ? fmtDateTime(r[f]) : (r[f] === undefined ? '' : r[f]);
      });
      return obj;
    })
  };
}

// ===== Borrow / Return Asset =====
function getBorrowModuleData() {
  try {
    const user = requireModule('borrow', false);
    const movements = latestByDate_(readSheetObjectsEnsured_(SHEETS.ASSET_MOVEMENT), 'ActionDate', 100)
      .map(function (r) {
        return {
          row: r._row, id: r.MovementID, assetId: r.AssetID, assetName: r.AssetName,
          action: r.ActionType, fromUser: r.FromUser, toUser: r.ToUser,
          department: r.Department, location: r.Location, actionDate: safeFmtDate_(r.ActionDate),
          dueDate: safeFmtDate_(r.DueDate), condition: r.Condition,
          ticketId: r.RelatedTicketID, status: r.Status, evidence: r.EvidenceLink, notes: r.Notes
        };
      });
    const assetRows = readSheetObjectsEnsured_(SHEETS.ASSET);
    const assets = getAssetOptions_();
    const available = assets.filter(function (a) { return a.status === ASSET_STATUS.AVAILABLE; });
    const inUse = assets.filter(function (a) { return a.status === ASSET_STATUS.IN_USE; });

    const onLoan = assetRows.filter(function (r) {
      return String(r.Status) === ASSET_STATUS.IN_USE && (r.OwnerName || r.Owner);
    }).map(function (r) {
      return {
        id: r.AssetID, code: r.AssetCode, name: r.AssetName,
        borrower: r.OwnerName || r.Owner, borrowerEmail: r.OwnerEmail,
        department: r.Department, location: r.Location,
        loanDate: safeFmtDate_(r.LoanDate), loanDue: safeFmtDate_(r.LoanDueDate),
        dueDays: daysUntil(r.LoanDueDate), hasDue: !!r.LoanDueDate
      };
    }).sort(function (a, b) {
      const av = a.dueDays === null ? 99999 : a.dueDays;
      const bv = b.dueDays === null ? 99999 : b.dueDays;
      return av - bv;
    });
    let overdue = 0, dueSoon = 0;
    onLoan.forEach(function (l) { if (l.dueDays !== null) { if (l.dueDays < 0) overdue++; else if (l.dueDays <= 7) dueSoon++; } });

    return ok({
      role: user.role,
      canEdit: canEditModule(user.role, 'borrow'),
      canViewAnalytics: user.role !== ROLES.USER,
      actions: BORROW_ACTIONS,
      assets: assets,
      availableAssets: available,
      inUseAssets: inUse,
      onLoan: onLoan,
      movements: movements,
      summary: {
        assets: assets.length,
        available: available.length,
        inUse: inUse.length,
        movements: movements.length,
        onLoan: onLoan.length,
        overdue: overdue,
        dueSoon: dueSoon
      }
    });
  } catch (e) { return fail(e.message); }
}

/** รายงานวิเคราะห์การยืม-คืน (ผู้ยืม/แผนก/แนวโน้ม/ระยะเวลายืม/ถูกยืมบ่อย) */
function getBorrowAnalytics() {
  try {
    const user = requireModule('borrow', false);
    if (user.role === ROLES.USER) throw new Error('บทบาทนี้ไม่มีสิทธิ์ดูรายงานวิเคราะห์');
    const now = new Date();
    const assetRows = readSheetObjectsEnsured_(SHEETS.ASSET);
    const moves = readSheetObjectsEnsured_(SHEETS.ASSET_MOVEMENT);

    let currentlyOut = 0, overdue = 0, dueSoon = 0;
    const byBorrower = {}, byDept = {};
    const bump = function (m, k) { k = String(k || 'ไม่ระบุ'); m[k] = (m[k] || 0) + 1; };
    assetRows.forEach(function (r) {
      if (String(r.Status) !== ASSET_STATUS.IN_USE || !(r.OwnerName || r.Owner)) return;
      currentlyOut++;
      bump(byBorrower, r.OwnerName || r.Owner);
      bump(byDept, r.Department);
      const d = daysUntil(r.LoanDueDate);
      if (d !== null) { if (d < 0) overdue++; else if (d <= 7) dueSoon++; }
    });

    // ถูกยืมบ่อย + แนวโน้ม + ระยะเวลายืมเฉลี่ย (จับคู่ Assign→Return ตามลำดับเวลาต่อ Asset)
    const mostBorrowed = {}, trend = {};
    const openLoan = {};
    const durations = [];
    const monthKey = function (d) { return Utilities.formatDate(new Date(d), 'Asia/Bangkok', 'yyyy-MM'); };
    moves.slice().sort(function (a, b) { return new Date(a.ActionDate) - new Date(b.ActionDate); }).forEach(function (m) {
      const act = String(m.ActionType);
      const aid = String(m.AssetID);
      const dt = m.ActionDate ? new Date(m.ActionDate) : null;
      if (act === 'ยืม/มอบหมาย') {
        bump(mostBorrowed, m.AssetName || m.AssetID);
        if (dt) { const k = monthKey(dt); trend[k] = trend[k] || { assign: 0, ret: 0 }; trend[k].assign++; openLoan[aid] = dt; }
      } else if (act === 'คืน') {
        if (dt) { const k = monthKey(dt); trend[k] = trend[k] || { assign: 0, ret: 0 }; trend[k].ret++; }
        if (openLoan[aid] && dt) { durations.push((dt - openLoan[aid]) / 86400000); delete openLoan[aid]; }
      }
    });

    const trendArr = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const k = monthKey(d);
      const v = trend[k] || { assign: 0, ret: 0 };
      trendArr.push({ month: k, assign: v.assign, ret: v.ret });
    }
    const toArr = function (map) {
      return Object.keys(map).map(function (k) { return { label: k, value: map[k] }; }).sort(function (a, b) { return b.value - a.value; });
    };
    const avgDuration = durations.length ? +(durations.reduce(function (s, x) { return s + x; }, 0) / durations.length).toFixed(1) : null;

    return ok({
      currentlyOut: currentlyOut, overdue: overdue, dueSoon: dueSoon,
      avgLoanDurationDays: avgDuration, completedLoans: durations.length,
      byBorrower: toArr(byBorrower).slice(0, 10),
      byDepartment: toArr(byDept),
      mostBorrowed: toArr(mostBorrowed).slice(0, 10),
      trend: trendArr
    });
  } catch (e) { return fail(e.message); }
}

function addAssetMovement(form) {
  try {
    const user = requireModule('borrow', true);
    form = form || {};
    const assetId = sanitizeText(form.assetId, 80);
    const action = sanitizeText(form.action, 40);
    requireFields({ AssetID: assetId, ActionType: action }, ['AssetID', 'ActionType']);
    if (!isInList(action, BORROW_ACTIONS)) throw new Error('ประเภทการดำเนินการไม่ถูกต้อง');
    const asset = findRow_(SHEETS.ASSET, 'AssetID', assetId);
    const id = generateId('MOV');
    appendRowEnsured_(SHEETS.ASSET_MOVEMENT, {
      MovementID: id,
      AssetID: assetId,
      AssetName: sanitizeText(form.assetName, 160) || (asset ? asset.AssetName : ''),
      ActionType: action,
      FromUser: sanitizeText(form.fromUser, 160),
      ToUser: sanitizeText(form.toUser, 160),
      Department: sanitizeText(form.department, 120),
      Location: sanitizeText(form.location, 120),
      ActionDate: parseDate(form.actionDate) || new Date(),
      RelatedTicketID: sanitizeText(form.ticketId, 80),
      Status: sanitizeText(form.status, 60) || 'เปิดรายการ',
      Notes: sanitizeText(form.notes, 500)
    }, user.email);
    writeAudit_(user, 'CREATE', 'borrow', SHEETS.ASSET_MOVEMENT, id, action + ': ' + assetId, 'success');
    return ok('บันทึกยืม/คืน Asset เรียบร้อย (' + id + ')');
  } catch (e) { return fail(e.message); }
}

// ===== PM / Maintenance =====
function getMaintenanceModuleData() {
  try {
    const user = requireModule('maintenance', false);
    const plans = latestByDate_(readSheetObjectsEnsured_(SHEETS.MAINTENANCE), 'PlanDate', 200)
      .map(function (r) {
        const pd = r.PlanDate ? new Date(r.PlanDate) : null;
        return {
          row: r._row, id: r.MaintenanceID, assetId: r.AssetID, assetName: r.AssetName,
          planDate: safeFmtDate_(r.PlanDate), planDays: daysUntil(r.PlanDate),
          planMonth: pd && !isNaN(pd) ? Utilities.formatDate(pd, 'Asia/Bangkok', 'yyyy-MM') : '',
          planISO: pd && !isNaN(pd) ? Utilities.formatDate(pd, 'Asia/Bangkok', 'yyyy-MM-dd') : '',
          actualDate: safeFmtDate_(r.ActualDate), checklist: r.Checklist, result: r.Result,
          checklistItems: parsePmChecklist_(r.ChecklistJSON),
          status: r.Status, technician: r.Technician, recurrence: r.Recurrence || 'ครั้งเดียว',
          nextDue: safeFmtDate_(r.NextDueDate), nextDays: daysUntil(r.NextDueDate),
          evidence: r.EvidenceLink, notes: r.Notes
        };
      });
    return ok({
      role: user.role,
      canEdit: canEditModule(user.role, 'maintenance'),
      canViewAnalytics: user.role !== ROLES.USER,
      canManageTemplates: user.role === ROLES.IT_ADMIN,
      statuses: PM_STATUSES,
      recurrences: PM_RECURRENCES,
      assets: getAssetOptions_(),
      assignees: getAssignableStaff_(),
      templates: getActivePMTemplates_(),
      plans: plans
    });
  } catch (e) { return fail(e.message); }
}

function addMaintenancePlan(form) {
  try {
    const user = requireModule('maintenance', true);
    form = form || {};
    const assetId = sanitizeText(form.assetId, 80);
    requireFields({ AssetID: assetId, PlanDate: form.planDate }, ['AssetID', 'PlanDate']);
    const asset = findRow_(SHEETS.ASSET, 'AssetID', assetId);
    const recurrence = sanitizeText(form.recurrence, 40) || 'ครั้งเดียว';
    if (!isInList(recurrence, PM_RECURRENCES)) throw new Error('รอบการทำซ้ำไม่ถูกต้อง');
    const planDate = parseDate(form.planDate);
    const nextDue = parseDate(form.nextDueDate) || computeNextPmDate_(planDate, recurrence);
    const id = generateId('PM');
    // เช็กลิสต์รายข้อ (จากฟอร์มหรือเทมเพลต) — เก็บทั้ง JSON และข้อความสรุปเพื่อความเข้ากันได้เดิม
    const items = pmChecklistFromInput_(form.checklistItems);
    const checklistText = items.length ? items.map(function (i) { return '• ' + i.text; }).join('\n') : sanitizeText(form.checklist, 1200);
    appendRowEnsured_(SHEETS.MAINTENANCE, {
      MaintenanceID: id,
      AssetID: assetId,
      AssetName: sanitizeText(form.assetName, 160) || (asset ? asset.AssetName : ''),
      PlanDate: planDate,
      ActualDate: '',
      Checklist: checklistText,
      Result: '',
      ChecklistJSON: items.length ? JSON.stringify(items) : '',
      Status: 'วางแผน',
      Technician: sanitizeText(form.technician, 120) || user.email,
      Recurrence: recurrence,
      NextDueDate: nextDue,
      EvidenceLink: sanitizeText(form.evidence, 500),
      Notes: sanitizeText(form.notes, 500)
    }, user.email);
    writeAudit_(user, 'CREATE', 'maintenance', SHEETS.MAINTENANCE, id, assetId, 'success');
    return ok('บันทึกแผน PM เรียบร้อย (' + id + ')');
  } catch (e) { return fail(e.message); }
}

function updateMaintenancePlanResult(planId, form) {
  try {
    const user = requireModule('maintenance', true);
    const p = findRowEnsured_(SHEETS.MAINTENANCE, 'MaintenanceID', planId);
    if (!p) throw new Error('ไม่พบแผน PM');
    form = form || {};
    const status = sanitizeText(form.status, 60) || 'ดำเนินการแล้ว';
    if (!isInList(status, PM_STATUSES)) throw new Error('สถานะ PM ไม่ถูกต้อง');
    const actualDate = parseDate(form.actualDate) || new Date();
    // ผลเช็กลิสต์รายข้อ (ผ่าน/ไม่ผ่าน/N/A) → สรุปลง Result + เก็บ ChecklistJSON
    const results = pmChecklistResultsFromInput_(form.checklistResults);
    let resultText = sanitizeText(form.result, 1500);
    let checklistJson = p.ChecklistJSON || '';
    if (results.length) {
      checklistJson = JSON.stringify(results);
      const pass = results.filter(function (x) { return x.result === 'ผ่าน'; }).length;
      const fail = results.filter(function (x) { return x.result === 'ไม่ผ่าน'; }).length;
      resultText = 'เช็กลิสต์ผ่าน ' + pass + '/' + results.length + (fail ? ' · ไม่ผ่าน ' + fail : '') + (resultText ? ' — ' + resultText : '');
    }
    updateRow_(SHEETS.MAINTENANCE, p._row, {
      ActualDate: actualDate,
      Result: resultText,
      ChecklistJSON: checklistJson,
      Status: status,
      Technician: sanitizeText(form.technician, 120) || user.email,
      EvidenceLink: sanitizeText(form.evidence, 500) || p.EvidenceLink,
      Notes: sanitizeText(form.notes, 500)
    }, user.email);
    writeAudit_(user, 'UPDATE', 'maintenance', SHEETS.MAINTENANCE, planId, status, 'success');

    // ถ้าเป็นแผนทำซ้ำและทำเสร็จแล้ว → สร้างแผนรอบถัดไปอัตโนมัติ
    let createdNext = '';
    const recurrence = p.Recurrence || 'ครั้งเดียว';
    if (status === 'ดำเนินการแล้ว' && recurrence !== 'ครั้งเดียว') {
      const base = p.NextDueDate ? new Date(p.NextDueDate) : computeNextPmDate_(actualDate, recurrence);
      const nextId = generateId('PM');
      appendRowEnsured_(SHEETS.MAINTENANCE, {
        MaintenanceID: nextId, AssetID: p.AssetID, AssetName: p.AssetName,
        PlanDate: base, ActualDate: '', Checklist: p.Checklist, Result: '',
        ChecklistJSON: pmChecklistResetResults_(p.ChecklistJSON),
        Status: 'วางแผน', Technician: p.Technician, Recurrence: recurrence,
        NextDueDate: computeNextPmDate_(base, recurrence), EvidenceLink: '',
        Notes: 'สร้างอัตโนมัติจากแผนทำซ้ำ ' + planId
      }, user.email);
      createdNext = nextId;
    }
    return ok('อัปเดตผล PM เรียบร้อย' + (createdNext ? ' · สร้างรอบถัดไป ' + createdNext : ''));
  } catch (e) { return fail(e.message); }
}

/** ยกเลิกแผน PM */
function cancelMaintenancePlan(planId, reason) {
  try {
    const user = requireModule('maintenance', true);
    const p = findRowEnsured_(SHEETS.MAINTENANCE, 'MaintenanceID', planId);
    if (!p) throw new Error('ไม่พบแผน PM');
    if (p.Status === 'ดำเนินการแล้ว') throw new Error('แผนนี้ดำเนินการแล้ว ไม่สามารถยกเลิกได้');
    updateRow_(SHEETS.MAINTENANCE, p._row, {
      Status: 'ยกเลิก', Notes: sanitizeText(reason, 500) || p.Notes
    }, user.email);
    writeAudit_(user, 'CANCEL', 'maintenance', SHEETS.MAINTENANCE, planId, sanitizeText(reason, 200), 'success');
    return ok('ยกเลิกแผน PM เรียบร้อย');
  } catch (e) { return fail(e.message); }
}

/** คำนวณวันครบกำหนดรอบถัดไปตามรอบทำซ้ำ */
function computeNextPmDate_(baseDate, recurrence) {
  if (!baseDate) return '';
  const d = (baseDate instanceof Date) ? new Date(baseDate) : new Date(baseDate);
  if (isNaN(d)) return '';
  if (recurrence === 'รายเดือน') d.setMonth(d.getMonth() + 1);
  else if (recurrence === 'รายไตรมาส') d.setMonth(d.getMonth() + 3);
  else if (recurrence === 'รายปี') d.setFullYear(d.getFullYear() + 1);
  else return '';
  return d;
}

// ===== Inventory =====
function getInventoryModuleData() {
  try {
    const user = requireModule('inventory', false);
    const items = readSheetObjectsEnsured_(SHEETS.INVENTORY).map(function (r) {
      const stock = numberOrZero_(r.StockQty);
      const min = numberOrZero_(r.MinQty);
      const price = numberOrZero_(r.UnitPrice);
      return {
        row: r._row, id: r.ItemID, name: r.ItemName, category: r.Category, unit: r.Unit,
        stock: stock, min: min, low: stock <= min, unitPrice: price, value: Math.round(stock * price),
        reorderQty: numberOrZero_(r.ReorderQty), location: r.Location, status: r.Status, notes: r.Notes
      };
    });
    const tx = latestByDate_(readSheetObjectsEnsured_(SHEETS.INVENTORY_TX), 'ActionDate', 30).map(function (r) {
      return {
        id: r.TransactionID, itemId: r.ItemID, itemName: r.ItemName, type: r.TransactionType,
        qty: r.Qty, balanceAfter: r.BalanceAfter, variance: r.Variance,
        ticketId: r.TicketID, actionDate: safeFmtDateTime_(r.ActionDate || r.Timestamp), notes: r.Notes
      };
    });
    return ok({
      role: user.role,
      canEdit: canEditModule(user.role, 'inventory'),
      canViewAnalytics: user.role !== ROLES.USER,
      items: items,
      transactions: tx,
      txTypes: INVENTORY_TX_TYPES
    });
  } catch (e) { return fail(e.message); }
}

function addInventoryItem(form) {
  try {
    const user = requireModule('inventory', true);
    form = form || {};
    const name = sanitizeText(form.name, 160);
    requireFields({ ItemName: name, Unit: form.unit }, ['ItemName', 'Unit']);
    const stock = numberOrZero_(form.stock);
    const min = numberOrZero_(form.min);
    if (stock < 0 || min < 0) throw new Error('จำนวนคงเหลือและขั้นต่ำต้องไม่ติดลบ');
    const id = generateId('ITEM');
    appendRowEnsured_(SHEETS.INVENTORY, {
      ItemID: id,
      ItemName: name,
      Category: sanitizeText(form.category, 120),
      Unit: sanitizeText(form.unit, 40),
      StockQty: stock,
      MinQty: min,
      Location: sanitizeText(form.location, 120),
      Status: sanitizeText(form.status, 60) || 'Active',
      Notes: sanitizeText(form.notes, 500),
      UnitPrice: numberOrZero_(form.unitPrice) || '',
      ReorderQty: numberOrZero_(form.reorderQty) || ''
    }, user.email);
    writeAudit_(user, 'CREATE', 'inventory', SHEETS.INVENTORY, id, name, 'success');
    return ok('บันทึกรายการ Inventory เรียบร้อย (' + id + ')');
  } catch (e) { return fail(e.message); }
}

function updateInventoryItem(itemId, form) {
  try {
    const user = requireModule('inventory', true);
    const item = findRowEnsured_(SHEETS.INVENTORY, 'ItemID', itemId);
    if (!item) throw new Error('ไม่พบรายการ Inventory');
    form = form || {};
    const patch = {};
    if (form.name !== undefined) patch.ItemName = sanitizeText(form.name, 160);
    if (form.category !== undefined) patch.Category = sanitizeText(form.category, 120);
    if (form.unit !== undefined) patch.Unit = sanitizeText(form.unit, 40);
    if (form.location !== undefined) patch.Location = sanitizeText(form.location, 120);
    if (form.notes !== undefined) patch.Notes = sanitizeText(form.notes, 500);
    if (form.min !== undefined) {
      const min = numberOrZero_(form.min);
      if (min < 0) throw new Error('จำนวนขั้นต่ำต้องไม่ติดลบ');
      patch.MinQty = min;
    }
    if (form.unitPrice !== undefined) patch.UnitPrice = numberOrZero_(form.unitPrice) || '';
    if (form.reorderQty !== undefined) patch.ReorderQty = numberOrZero_(form.reorderQty) || '';
    updateRow_(SHEETS.INVENTORY, item._row, patch, user.email);
    writeAudit_(user, 'UPDATE', 'inventory', SHEETS.INVENTORY, itemId, JSON.stringify(patch), 'success');
    return ok('แก้ไขรายการ Inventory เรียบร้อย');
  } catch (e) { return fail(e.message); }
}

/** ปิด/เปิดใช้งานรายการแบบปลอดภัย (ไม่ลบทิ้ง) */
function setInventoryItemStatus(itemId, status) {
  try {
    const user = requireModule('inventory', true);
    const item = findRowEnsured_(SHEETS.INVENTORY, 'ItemID', itemId);
    if (!item) throw new Error('ไม่พบรายการ Inventory');
    status = sanitizeText(status, 40);
    if (!isInList(status, ['Active', 'Inactive'])) throw new Error('สถานะไม่ถูกต้อง');
    updateRow_(SHEETS.INVENTORY, item._row, { Status: status }, user.email);
    writeAudit_(user, 'UPDATE_STATUS', 'inventory', SHEETS.INVENTORY, itemId, status, 'success');
    return ok('ปรับสถานะรายการเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

function recordInventoryTransaction(form) {
  try {
    const user = requireModule('inventory', true);
    form = form || {};
    const itemId = sanitizeText(form.itemId, 80);
    const type = sanitizeText(form.type, 10);
    const qty = numberOrZero_(form.qty);
    requireFields({ ItemID: itemId, TransactionType: type, Qty: form.qty }, ['ItemID', 'TransactionType', 'Qty']);
    if (!isInList(type, INVENTORY_TX_TYPES)) throw new Error('ประเภทรับเข้า/จ่ายออกไม่ถูกต้อง');
    if (qty <= 0) throw new Error('จำนวนต้องมากกว่า 0');
    const item = findRowEnsured_(SHEETS.INVENTORY, 'ItemID', itemId);
    if (!item) throw new Error('ไม่พบรายการ Inventory');
    const current = numberOrZero_(item.StockQty);
    const next = type === 'IN' ? current + qty : current - qty;
    if (next < 0) throw new Error('Stock คงเหลือไม่พอสำหรับจ่ายออก');
    updateRow_(SHEETS.INVENTORY, item._row, { StockQty: next }, user.email);
    const id = generateId('TX');
    appendRowEnsured_(SHEETS.INVENTORY_TX, {
      TransactionID: id,
      ItemID: itemId,
      ItemName: item.ItemName,
      TransactionType: type,
      Qty: qty,
      TicketID: sanitizeText(form.ticketId, 80),
      ActionDate: new Date(),
      Notes: sanitizeText(form.notes, 500),
      BalanceAfter: next
    }, user.email);
    writeAudit_(user, type === 'IN' ? 'STOCK_IN' : 'STOCK_OUT', 'inventory', SHEETS.INVENTORY, itemId, String(qty), 'success');
    return ok('บันทึกความเคลื่อนไหว Inventory เรียบร้อย');
  } catch (e) { return fail(e.message); }
}

// ===== Software License =====
function getLicenseModuleData() {
  try {
    const user = requireModule('license', false);
    const licenses = readSheetObjectsEnsured_(SHEETS.SOFTWARE_LICENSE).map(function (r) {
      return {
        row: r._row, id: r.LicenseID, name: r.SoftwareName, type: r.LicenseType,
        total: numberOrZero_(r.TotalQty), used: numberOrZero_(r.UsedQty),
        start: safeFmtDate_(r.StartDate), expire: safeFmtDate_(r.ExpireDate),
        expireDays: daysUntil(r.ExpireDate), vendorId: r.VendorID, assignedTo: r.AssignedTo,
        status: r.Status, notes: r.Notes
      };
    });
    return ok({
      role: user.role,
      canEdit: canEditModule(user.role, 'license'),
      types: LICENSE_TYPES,
      statuses: LICENSE_STATUSES,
      vendors: readSheetObjects_(SHEETS.VENDOR).map(function (r) { return { id: r.VendorID, name: r.VendorName }; }),
      licenses: licenses
    });
  } catch (e) { return fail(e.message); }
}

/** alias ตามชื่อสเปก */
function getLicenses() { return getLicenseModuleData(); }
function createLicense(form) { return addSoftwareLicense(form); }

function addSoftwareLicense(form) {
  try {
    const user = requireModule('license', true);
    form = form || {};
    const name = sanitizeText(form.name, 160);
    const total = numberOrZero_(form.total);
    const used = numberOrZero_(form.used);
    requireFields({ SoftwareName: name, TotalQty: form.total }, ['SoftwareName', 'TotalQty']);
    if (total < 0 || used < 0) throw new Error('จำนวน License ต้องไม่ติดลบ');
    if (used > total) throw new Error('UsedQty ต้องไม่มากกว่า TotalQty');
    const start = parseDate(form.start);
    const expire = parseDate(form.expire);
    if (start && expire && expire < start) throw new Error('วันหมดอายุต้องไม่น้อยกว่าวันเริ่มต้น');
    const id = generateId('LIC');
    appendRowEnsured_(SHEETS.SOFTWARE_LICENSE, {
      LicenseID: id,
      SoftwareName: name,
      LicenseType: sanitizeText(form.type, 80),
      TotalQty: total,
      UsedQty: used,
      StartDate: start,
      ExpireDate: expire,
      VendorID: sanitizeText(form.vendorId, 80),
      AssignedTo: sanitizeText(form.assignedTo, 500),
      Status: sanitizeText(form.status, 60) || 'Active',
      Notes: sanitizeText(form.notes, 500)
    }, user.email);
    writeAudit_(user, 'CREATE', 'license', SHEETS.SOFTWARE_LICENSE, id, name, 'success');
    return ok('บันทึก Software License เรียบร้อย (' + id + ')');
  } catch (e) { return fail(e.message); }
}

function updateLicense(licenseId, form) {
  try {
    const user = requireModule('license', true);
    const lic = findRowEnsured_(SHEETS.SOFTWARE_LICENSE, 'LicenseID', licenseId);
    if (!lic) throw new Error('ไม่พบ License');
    form = form || {};
    const patch = {};
    if (form.name !== undefined) patch.SoftwareName = sanitizeText(form.name, 160);
    if (form.type !== undefined) patch.LicenseType = sanitizeText(form.type, 80);
    if (form.vendorId !== undefined) patch.VendorID = sanitizeText(form.vendorId, 80);
    if (form.assignedTo !== undefined) patch.AssignedTo = sanitizeText(form.assignedTo, 500);
    if (form.notes !== undefined) patch.Notes = sanitizeText(form.notes, 500);
    if (form.total !== undefined) patch.TotalQty = numberOrZero_(form.total);
    if (form.used !== undefined) patch.UsedQty = numberOrZero_(form.used);
    if (form.start !== undefined) patch.StartDate = parseDate(form.start);
    if (form.expire !== undefined) patch.ExpireDate = parseDate(form.expire);
    const total = patch.TotalQty !== undefined ? patch.TotalQty : numberOrZero_(lic.TotalQty);
    const used = patch.UsedQty !== undefined ? patch.UsedQty : numberOrZero_(lic.UsedQty);
    if (used > total) throw new Error('UsedQty ต้องไม่มากกว่า TotalQty');
    if (form.status !== undefined && form.status !== '') {
      const st = sanitizeText(form.status, 40);
      if (!isInList(st, LICENSE_STATUSES)) throw new Error('สถานะ License ไม่ถูกต้อง');
      patch.Status = st;
    }
    updateRow_(SHEETS.SOFTWARE_LICENSE, lic._row, patch, user.email);
    writeAudit_(user, 'UPDATE', 'license', SHEETS.SOFTWARE_LICENSE, licenseId, JSON.stringify(patch), 'success');
    return ok('แก้ไข License เรียบร้อย');
  } catch (e) { return fail(e.message); }
}

/** ปิดใช้งาน/ลบแบบปลอดภัย (ตั้งสถานะ Inactive ไม่ลบแถว) */
function deleteLicense(licenseId) { return setLicenseStatus(licenseId, 'Inactive'); }

function setLicenseStatus(licenseId, status) {
  try {
    const user = requireModule('license', true);
    const lic = findRowEnsured_(SHEETS.SOFTWARE_LICENSE, 'LicenseID', licenseId);
    if (!lic) throw new Error('ไม่พบ License');
    status = sanitizeText(status, 40);
    if (!isInList(status, LICENSE_STATUSES)) throw new Error('สถานะ License ไม่ถูกต้อง');
    updateRow_(SHEETS.SOFTWARE_LICENSE, lic._row, { Status: status }, user.email);
    writeAudit_(user, 'UPDATE_STATUS', 'license', SHEETS.SOFTWARE_LICENSE, licenseId, status, 'success');
    return ok('ปรับสถานะ License เรียบร้อย');
  } catch (e) { return fail(e.message); }
}

/**
 * ตรวจ License ที่หมดอายุแล้วและปรับสถานะเป็น Expired อัตโนมัติ
 * คืนจำนวนรายการที่ถูกปรับ — เรียกได้จาก trigger หรือ dailyNotificationCheck_
 */
function checkExpireLicenses_() {
  let updated = 0;
  const rows = readSheetObjectsEnsured_(SHEETS.SOFTWARE_LICENSE);
  rows.forEach(function (r) {
    if (String(r.Status) === 'Inactive' || String(r.Status) === 'Expired') return;
    const d = daysUntil(r.ExpireDate);
    if (d !== null && d < 0) {
      updateRow_(SHEETS.SOFTWARE_LICENSE, r._row, { Status: 'Expired' }, 'system');
      updated++;
    }
  });
  return updated;
}

/** แจ้งเตือน License ที่ใกล้/หมดอายุไปยังผู้ดูแลตามช่องทางที่เปิดใช้งาน */
function sendLicenseExpiryNotifications_() {
  const lead = parseInt(getConfig_('NOTIFY_LEAD_DAYS', '30'), 10);
  const alerts = [];
  readSheetObjectsEnsured_(SHEETS.SOFTWARE_LICENSE).forEach(function (r) {
    if (String(r.Status) === 'Inactive') return;
    const d = daysUntil(r.ExpireDate);
    if (d === null) return;
    if (d < 0) alerts.push('• License "' + r.SoftwareName + '" หมดอายุแล้ว ' + Math.abs(d) + ' วัน (' + fmtDate(r.ExpireDate) + ')');
    else if (d <= lead) alerts.push('• License "' + r.SoftwareName + '" จะหมดอายุใน ' + d + ' วัน (' + fmtDate(r.ExpireDate) + ')');
  });
  if (!alerts.length) return 0;
  const to = getITAdminEmails_().join(',');
  const body = '<p>รายการ Software License ที่ใกล้/หมดอายุ:</p><ul>' +
    alerts.map(function (a) { return '<li>' + escapeHtml(a.replace('• ', '')) + '</li>'; }).join('') + '</ul>';
  if (to) notify_(to, 'แจ้งเตือน License ใกล้/หมดอายุ (' + alerts.length + ')', body,
    'แจ้งเตือน License:\n' + alerts.join('\n'), 'license', '');
  return alerts.length;
}

/** เรียกตรวจ + แจ้งเตือน License แบบ manual จากหน้า UI */
function runLicenseExpiryCheck() {
  try {
    requireModule('license', true);
    const expired = checkExpireLicenses_();
    const notified = sendLicenseExpiryNotifications_();
    return ok('ปรับสถานะหมดอายุ ' + expired + ' รายการ · แจ้งเตือน ' + notified + ' รายการ');
  } catch (e) { return fail(e.message); }
}

// ===== Reports =====
function getReportsModuleData() {
  try {
    const user = requireModule('reports', false);
    // กรองสิทธิ์ก่อนอ่านชีต เพื่อไม่ให้ role ที่เปิด Reports ได้เห็นจำนวน/ตัวอย่างข้อมูล
    // จากโมดูลที่ตนไม่มีสิทธิ์เข้าถึง
    const modules = getModuleCatalog_().filter(function (entry) {
      return canAccessModule(user.role, entry.key);
    }).map(function (entry) {
      let scopedRows;
      // Service Catalog เป็นโมดูล row-level: ผู้ที่เปิดโมดูลได้ไม่ได้แปลว่าเห็นคำขอของผู้อื่นได้
      if (entry.key === 'serviceCatalog' && user.role !== ROLES.IT_ADMIN) {
        const email = String(user.email || '').toLowerCase();
        scopedRows = readSheetObjectsEnsured_(SHEETS.SERVICE_REQUEST).filter(function (row) {
          return String(row.RequesterEmail || '').toLowerCase() === email ||
            String(row.Approver || '').toLowerCase() === email ||
            String(row.Assignee || '').toLowerCase() === email;
        });
      }
      const summary = summarizeRowsForCatalog_(entry, scopedRows);
      return Object.assign({}, entry, {
        total: summary.total,
        rows: summary.rows,
        canOpen: true
      });
    });
    const byCategory = {};
    modules.forEach(function (m) {
      byCategory[m.category] = (byCategory[m.category] || 0) + 1;
    });
    return ok({
      generatedAt: fmtDateTime(new Date()),
      modules: modules,
      categories: Object.keys(byCategory).map(function (k) { return { name: k, count: byCategory[k] }; })
    });
  } catch (e) { return fail(e.message); }
}

// ===== Users =====
function getUsersModuleData() {
  try {
    const user = requireModule('users', false);
    const rows = readSheetObjects_(SHEETS.USERS).map(function (r) {
      return {
        row: r._row, id: r.UserID, username: r.Username, employeeCode: r.EmployeeCode, email: r.Email,
        name: r.FullName, dept: r.Department,
        role: r.Role, roleLabel: ROLE_LABELS[r.Role] || r.Role, supervisor: r.Supervisor,
        status: r.Status, createdAt: safeFmtDateTime_(r.Timestamp)
      };
    });
    const lineUsers = readSheetObjectsEnsured_(SHEETS.LINE_USERS).map(function (r) {
      const id = String(r.LineUserID || '');
      return {
        lineUserId: id,
        maskedId: id ? id.substring(0, 5) + '…' + id.substring(Math.max(5, id.length - 5)) : '',
        displayName: r.DisplayName,
        fullName: r.FullName,
        pictureUrl: r.PictureURL,
        employeeCode: r.EmployeeCode,
        department: r.Department,
        linkStatus: r.LinkStatus,
        friendStatus: r.FriendStatus,
        lastLoginAt: safeFmtDateTime_(r.LastLoginAt)
      };
    });
    return ok({
      role: user.role,
      canEdit: canEditModule(user.role, 'users'),
      roles: Object.keys(ROLE_LABELS).map(function (k) { return { value: k, label: ROLE_LABELS[k] }; }),
      users: rows,
      lineUsers: lineUsers
    });
  } catch (e) { return fail(e.message); }
}

function addSystemUser(form) {
  try {
    const user = requireModule('users', true);
    form = form || {};
    const username = normalizeUsername_(form.username);
    const email = sanitizeText(form.email, 160).toLowerCase();
    const employeeCode = sanitizeText(form.employeeCode, 80);
    const name = sanitizeText(form.name, 160);
    const role = sanitizeText(form.role, 40) || ROLES.USER;
    requireFields({ Username: username, Email: email, FullName: name, Role: role }, ['Username', 'Email', 'FullName', 'Role']);
    validateUsername_(username);
    if (!isValidEmail(email)) throw new Error('รูปแบบอีเมลไม่ถูกต้อง');
    if (!ROLE_LABELS[role]) throw new Error('บทบาทผู้ใช้ไม่ถูกต้อง');
    if (findRow_(SHEETS.USERS, 'Username', username)) throw new Error('มี Username นี้ในทะเบียน Users แล้ว');
    if (findRow_(SHEETS.USERS, 'Email', email)) throw new Error('มีอีเมลนี้ในทะเบียน Users แล้ว');
    if (employeeCode && readSheetObjects_(SHEETS.USERS).some(function (r) {
      return String(r.EmployeeCode || '').trim().toLowerCase() === employeeCode.toLowerCase();
    })) throw new Error('มีรหัสพนักงานนี้ในทะเบียน Users แล้ว');
    const id = generateId('USR');
    appendRow_(SHEETS.USERS, {
      UserID: id,
      Username: username,
      EmployeeCode: employeeCode,
      Email: email,
      FullName: name,
      Department: sanitizeText(form.dept, 120),
      Role: role,
      Supervisor: sanitizeText(form.supervisor, 160),
      Status: sanitizeText(form.status, 40) || 'Active'
    }, user.email);
    writeAudit_(user, 'CREATE', 'users', SHEETS.USERS, id, username, 'success');
    return ok('เพิ่มผู้ใช้งานเรียบร้อย (' + id + ')');
  } catch (e) { return fail(e.message); }
}

function normalizeUsername_(value) {
  return sanitizeText(value, 50).toLowerCase().trim();
}

function validateUsername_(username) {
  if (username.indexOf('@') > -1) throw new Error('Username ต้องไม่ใช่อีเมล');
  if (!/^[a-z0-9][a-z0-9._-]{2,49}$/.test(username)) {
    throw new Error('Username ต้องมี 3-50 ตัว ใช้ได้เฉพาะ a-z, 0-9, จุด, ขีดกลาง และขีดล่าง');
  }
}

function updateSystemUserEmployeeCode(userId, employeeCode) {
  try {
    const user = requireModule('users', true);
    userId = sanitizeText(userId, 80);
    employeeCode = sanitizeText(employeeCode, 80);
    requireFields({ UserID: userId, EmployeeCode: employeeCode }, ['UserID', 'EmployeeCode']);
    const row = findRow_(SHEETS.USERS, 'UserID', userId);
    if (!row) throw new Error('ไม่พบผู้ใช้งาน');
    const duplicate = readSheetObjects_(SHEETS.USERS).some(function (r) {
      return String(r.UserID) !== String(userId) &&
        String(r.EmployeeCode || '').trim().toLowerCase() === employeeCode.toLowerCase();
    });
    if (duplicate) throw new Error('มีรหัสพนักงานนี้ในทะเบียน Users แล้ว');
    updateRow_(SHEETS.USERS, row._row, { EmployeeCode: employeeCode }, user.email);
    writeAudit_(user, 'UPDATE_EMPLOYEE_CODE', 'users', SHEETS.USERS, userId,
      'ตั้งรหัสพนักงาน', 'success');
    return ok('บันทึกรหัสพนักงานเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

function setLineUserStatus(lineUserId, status) {
  try {
    const user = requireModule('users', true);
    lineUserId = sanitizeText(lineUserId, 200);
    status = sanitizeText(status, 40);
    if (!isInList(status, ['Pending', 'Active', 'Suspended', 'Unlinked'])) {
      throw new Error('สถานะบัญชี LINE ไม่ถูกต้อง');
    }
    const row = findRowEnsured_(SHEETS.LINE_USERS, 'LineUserID', lineUserId);
    if (!row) throw new Error('ไม่พบบัญชี LINE');
    updateRow_(SHEETS.LINE_USERS, row._row, { LinkStatus: status }, user.email);
    writeAudit_(user, 'UPDATE_LINE_USER_STATUS', 'users', SHEETS.LINE_USERS,
      lineUserId, status, 'success');
    return ok('ปรับสถานะบัญชี LINE เป็น ' + status + ' เรียบร้อย');
  } catch (e) { return fail(e.message); }
}

function setSystemUserStatus(userId, status) {
  try {
    const user = requireModule('users', true);
    const row = findRow_(SHEETS.USERS, 'UserID', userId);
    if (!row) throw new Error('ไม่พบผู้ใช้งาน');
    if (!isInList(status, ['Active', 'Inactive'])) throw new Error('สถานะผู้ใช้ไม่ถูกต้อง');
    updateRow_(SHEETS.USERS, row._row, { Status: status }, user.email);
    writeAudit_(user, 'UPDATE_STATUS', 'users', SHEETS.USERS, userId, status, 'success');
    return ok('ปรับสถานะผู้ใช้งานเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

// ===== Settings =====
function seedSettingsRows_() {
  ensureSheetBySchema_(SHEETS.SETTINGS);
  const existing = {};
  readSheetObjectsEnsured_(SHEETS.SETTINGS).forEach(function (r) { existing[r.Key] = r; });
  const defaults = [
    { Key: 'ORG_NAME', Value: getConfig_('ORG_NAME', 'กองทุนประกันชีวิต'), Description: 'ชื่อองค์กรที่แสดงในระบบ', Group: 'General' },
    { Key: 'NOTIFY_LINE_ENABLED', Value: getConfig_('NOTIFY_LINE_ENABLED', 'true'), Description: 'เปิด/ปิดแจ้งเตือนทาง LINE Messaging API (ช่องทางหลัก)', Group: 'Notification' },
    { Key: 'NOTIFY_PRIMARY_CHANNEL', Value: getConfig_('NOTIFY_PRIMARY_CHANNEL', 'LINE'), Description: 'ช่องทางแจ้งเตือนหลักของระบบ (LINE)', Group: 'Notification' },
    { Key: 'NOTIFY_LEAD_DAYS', Value: getConfig_('NOTIFY_LEAD_DAYS', '30'), Description: 'จำนวนวันแจ้งเตือนล่วงหน้า', Group: 'Notification' },
    { Key: 'LINE_QUEUE_MAX_ATTEMPTS', Value: getConfig_('LINE_QUEUE_MAX_ATTEMPTS', '5'), Description: 'จำนวนครั้งสูงสุดที่คิว LINE จะ retry ก่อนเป็น DEAD', Group: 'Notification' },
    { Key: 'REVIEW_CYCLE_DAYS', Value: getConfig_('REVIEW_CYCLE_DAYS', '180'), Description: 'รอบทบทวนสิทธิ์และข้อมูลสำคัญ', Group: 'Governance' },
    { Key: 'INCIDENT_DPO_ESCALATION_HOURS', Value: getConfig_('INCIDENT_DPO_ESCALATION_HOURS', '4'), Description: 'กรอบเวลาภายในให้นำเหตุข้อมูลส่วนบุคคลส่ง DPO คัดกรอง (ไม่ใช่ deadline แจ้ง สคส.)', Group: 'Governance' },
    { Key: 'LOGIN_MAX_FAILS_5MIN', Value: getConfig_('LOGIN_MAX_FAILS_5MIN', '10'), Description: 'จำนวนครั้งที่ล็อกอินผิดก่อนพัก 5 นาที', Group: 'Security' },
    { Key: 'PASSWORD_HASH_ITERATIONS', Value: getConfig_('PASSWORD_HASH_ITERATIONS', '20000'), Description: 'จำนวนรอบ hash รหัสผ่านใหม่ (ขั้นต่ำ 10000)', Group: 'Security' },
    { Key: 'ADMIN_MFA_ENABLED', Value: getConfig_('ADMIN_MFA_ENABLED', 'true'), Description: 'บังคับ OTP ทางอีเมลสำหรับเข้าสู่ระบบหลังบ้าน', Group: 'Security' },
    { Key: 'LINE_LOGIN_ENABLED', Value: getConfig_('LINE_LOGIN_ENABLED', 'false'), Description: 'เปิด/ปิด LINE Login สำหรับหน้าแจ้งซ่อม (ต้องตั้ง Channel ID/Secret/Callback ใน Script Properties ก่อน)', Group: 'LINE Login' },
    { Key: 'LINE_REQUIRE_EMPLOYEE_LINK', Value: getConfig_('LINE_REQUIRE_EMPLOYEE_LINK', 'false'), Description: 'บังคับให้ LINE ผูกกับรหัสพนักงานในทะเบียน Users ก่อนใช้งาน', Group: 'LINE Login' },
    { Key: 'LINE_AUTO_APPROVE_EMPLOYEE_LINK', Value: getConfig_('LINE_AUTO_APPROVE_EMPLOYEE_LINK', 'false'), Description: 'อนุมัติการผูก EmployeeCode อัตโนมัติ; แนะนำ false เพื่อให้ Admin ตรวจสอบก่อน', Group: 'LINE Login' },
    { Key: 'LINE_SESSION_HOURS', Value: getConfig_('LINE_SESSION_HOURS', '24'), Description: 'อายุ session ของผู้ใช้ LINE (ชั่วโมง)', Group: 'LINE Login' },
    { Key: 'PUBLIC_TICKET_ENABLED', Value: getConfig_('PUBLIC_TICKET_ENABLED', 'true'), Description: 'เปิด/ปิดหน้าแจ้งซ่อมสาธารณะ', Group: 'Public Helpdesk' },
    { Key: 'PUBLIC_TICKET_REQUIRE_LINE', Value: getConfig_('PUBLIC_TICKET_REQUIRE_LINE', 'false'), Description: 'true = บังคับ LINE Login ก่อนส่ง Ticket เพื่อลด abuse; false = อนุญาต anonymous', Group: 'Public Helpdesk' },
    { Key: 'PUBLIC_TICKET_MAX_FILES', Value: getConfig_('PUBLIC_TICKET_MAX_FILES', '5'), Description: 'จำนวนไฟล์แนบสูงสุดต่อ Ticket', Group: 'Public Helpdesk' },
    { Key: 'PUBLIC_TICKET_MAX_FILE_MB', Value: getConfig_('PUBLIC_TICKET_MAX_FILE_MB', '10'), Description: 'ขนาดไฟล์แนบสูงสุดต่อไฟล์ (MB)', Group: 'Public Helpdesk' },
    { Key: 'PUBLIC_TICKET_MAX_TOTAL_MB', Value: getConfig_('PUBLIC_TICKET_MAX_TOTAL_MB', '20'), Description: 'ขนาดไฟล์แนบรวมสูงสุดต่อ Ticket (MB)', Group: 'Public Helpdesk' },
    { Key: 'PUBLIC_TICKET_MAX_PER_HOUR', Value: getConfig_('PUBLIC_TICKET_MAX_PER_HOUR', '3'), Description: 'จำนวน Ticket สูงสุดต่ออุปกรณ์ต่อชั่วโมง', Group: 'Public Helpdesk' },
    { Key: 'PUBLIC_TICKET_MAX_PER_DAY', Value: getConfig_('PUBLIC_TICKET_MAX_PER_DAY', '8'), Description: 'จำนวน Ticket สูงสุดต่ออุปกรณ์ต่อวัน', Group: 'Public Helpdesk' },
    { Key: 'PUBLIC_TICKET_GLOBAL_MAX_PER_HOUR', Value: getConfig_('PUBLIC_TICKET_GLOBAL_MAX_PER_HOUR', '60'), Description: 'จำนวน Ticket รวมสูงสุดจากหน้าสาธารณะต่อชั่วโมง', Group: 'Public Helpdesk' },
    { Key: 'PUBLIC_TICKET_GLOBAL_MAX_PER_DAY', Value: getConfig_('PUBLIC_TICKET_GLOBAL_MAX_PER_DAY', '300'), Description: 'จำนวน Ticket รวมสูงสุดจากหน้าสาธารณะต่อวัน', Group: 'Public Helpdesk' },
    { Key: 'PUBLIC_TICKET_EMAIL_OTP_ENABLED', Value: getConfig_('PUBLIC_TICKET_EMAIL_OTP_ENABLED', 'false'), Description: 'เปิด Email OTP สำหรับดู Ticket หลายรายการ; ระบบ LINE-only ให้คงเป็น false', Group: 'Public Helpdesk' },
    { Key: 'PUBLIC_TICKET_ALLOWED_EMAIL_DOMAINS', Value: getConfig_('PUBLIC_TICKET_ALLOWED_EMAIL_DOMAINS', ''), Description: 'โดเมนอีเมลที่อนุญาตเมื่อผู้แจ้งกรอกอีเมล; เว้นว่าง = ทุกโดเมน', Group: 'Public Helpdesk' },
    { Key: 'PUBLIC_TICKET_CONSENT_REQUIRED', Value: getConfig_('PUBLIC_TICKET_CONSENT_REQUIRED', 'true'), Description: 'บังคับให้ผู้แจ้งยอมรับ Privacy Notice ก่อนส่ง Ticket จากหน้าสาธารณะ/LINE', Group: 'Privacy / PDPA' },
    { Key: 'PUBLIC_PRIVACY_NOTICE_VERSION', Value: getConfig_('PUBLIC_PRIVACY_NOTICE_VERSION', '2026-07-08'), Description: 'เวอร์ชัน Privacy Notice ที่แสดงบนหน้าแจ้งซ่อมสาธารณะ', Group: 'Privacy / PDPA' },
    { Key: 'PUBLIC_PRIVACY_NOTICE_TEXT', Value: getConfig_('PUBLIC_PRIVACY_NOTICE_TEXT', 'ระบบใช้ข้อมูลผู้แจ้งเพื่อรับเรื่อง ติดต่อกลับ ดำเนินการแจ้งซ่อม แจ้งสถานะผ่าน LINE และเก็บหลักฐานตามนโยบายความปลอดภัยขององค์กร'), Description: 'ข้อความสรุป Privacy Notice แบบย่อที่แสดงก่อนส่ง Ticket', Group: 'Privacy / PDPA' },
    { Key: 'PUBLIC_PRIVACY_NOTICE_URL', Value: getConfig_('PUBLIC_PRIVACY_NOTICE_URL', ''), Description: 'ลิงก์ประกาศความเป็นส่วนตัวฉบับเต็ม (ถ้ามี)', Group: 'Privacy / PDPA' },
    { Key: 'PUBLIC_PRIVACY_DPO_CONTACT', Value: getConfig_('PUBLIC_PRIVACY_DPO_CONTACT', 'DPO / ส่วนงาน IT'), Description: 'ช่องทางติดต่อผู้ดูแลข้อมูลส่วนบุคคลหรือส่วนงานที่รับผิดชอบ', Group: 'Privacy / PDPA' },
    { Key: 'AUTO_BACKUP_ENABLED', Value: getConfig_('AUTO_BACKUP_ENABLED', 'true'), Description: 'สร้าง System Snapshot อัตโนมัติทุกวัน', Group: 'Backup / Recovery' },
    { Key: 'AUTO_RESTORE_DRILL_ENABLED', Value: getConfig_('AUTO_RESTORE_DRILL_ENABLED', 'true'), Description: 'ทดสอบ Restore ไป Sandbox อัตโนมัติทุกเดือน', Group: 'Backup / Recovery' },
    { Key: 'BACKUP_RETENTION_DAYS', Value: getConfig_('BACKUP_RETENTION_DAYS', '90'), Description: 'อายุไฟล์ Snapshot ก่อนย้ายเข้าถังขยะ Drive', Group: 'Backup / Recovery' },
    { Key: 'RESTORE_SANDBOX_RETENTION_DAYS', Value: getConfig_('RESTORE_SANDBOX_RETENTION_DAYS', '30'), Description: 'อายุไฟล์ Sandbox จาก Restore drill', Group: 'Backup / Recovery' },
    { Key: 'BACKUP_HEALTH_MAX_HOURS', Value: getConfig_('BACKUP_HEALTH_MAX_HOURS', '30'), Description: 'จำนวนชั่วโมงสูงสุดที่ยอมให้ไม่มี backup health ใหม่', Group: 'Backup / Recovery' },
    { Key: 'RETENTION_MODE', Value: getConfig_('RETENTION_MODE', 'DRY_RUN'), Description: 'DRY_RUN = ตรวจอย่างเดียว, ENFORCE = ดำเนินการตาม Policy', Group: 'Retention / PDPA' },
    { Key: 'LINE_SESSION_RETENTION_DAYS', Value: getConfig_('LINE_SESSION_RETENTION_DAYS', '30'), Description: 'อายุ session LINE ที่หมดอายุ/ถูกเพิกถอน', Group: 'Retention / PDPA' },
    { Key: 'NOTIFICATION_LOG_RETENTION_DAYS', Value: getConfig_('NOTIFICATION_LOG_RETENTION_DAYS', '365'), Description: 'อายุ NotificationLog', Group: 'Retention / PDPA' },
    { Key: 'NOTIFICATION_QUEUE_RETENTION_DAYS', Value: getConfig_('NOTIFICATION_QUEUE_RETENTION_DAYS', '90'), Description: 'อายุคิว LINE ที่ SENT/DEAD', Group: 'Retention / PDPA' },
    { Key: 'TICKET_PII_RETENTION_DAYS', Value: getConfig_('TICKET_PII_RETENTION_DAYS', '730'), Description: 'อายุ Ticket ที่ปิดแล้วก่อน anonymize ข้อมูลผู้แจ้ง', Group: 'Retention / PDPA' },
    { Key: 'SERVICE_REQUEST_PII_RETENTION_DAYS', Value: getConfig_('SERVICE_REQUEST_PII_RETENTION_DAYS', '730'), Description: 'อายุ Service Request ที่ปิดแล้วก่อน anonymize ข้อมูลผู้ขอ งานย่อย และ timeline', Group: 'Retention / PDPA' },
    { Key: 'WORKFLOW_PII_RETENTION_DAYS', Value: getConfig_('WORKFLOW_PII_RETENTION_DAYS', '730'), Description: 'อายุ Workflow ที่สิ้นสุดแล้วก่อน anonymize ผู้เกี่ยวข้อง เหตุผล และ timeline', Group: 'Retention / PDPA' },
    { Key: 'ATTACHMENT_RETENTION_DAYS', Value: getConfig_('ATTACHMENT_RETENTION_DAYS', '730'), Description: 'อายุไฟล์แนบทั่วไปก่อนเข้าสู่กระบวนการ retention (ไม่ใช้กับ Legal Hold)', Group: 'Retention / PDPA' },
    { Key: 'ATTACHMENT_STAGED_RETENTION_HOURS', Value: getConfig_('ATTACHMENT_STAGED_RETENTION_HOURS', '72'), Description: 'อายุไฟล์ที่อัปโหลดค้างแต่ยังไม่ถูกผูกกับรายการ ก่อน soft delete (ชั่วโมง)', Group: 'Retention / PDPA' },
    { Key: 'ATTACHMENT_DOWNLOAD_MAX_MB', Value: getConfig_('ATTACHMENT_DOWNLOAD_MAX_MB', '10'), Description: 'ขนาดไฟล์สูงสุดที่ดาวน์โหลดผ่านระบบได้ต่อครั้ง (MB)', Group: 'Security' },
    { Key: 'SOFT_DELETE_RETENTION_DAYS', Value: getConfig_('SOFT_DELETE_RETENTION_DAYS', '365'), Description: 'อายุรายการในถังขยะก่อนลบถาวร', Group: 'Retention / PDPA' },
    { Key: 'RETENTION_TRASH_EVIDENCE', Value: getConfig_('RETENTION_TRASH_EVIDENCE', 'false'), Description: 'ย้ายไฟล์หลักฐาน Ticket ที่พ้น retention เข้าถังขยะ Drive', Group: 'Retention / PDPA' },
    { Key: 'SLA_BUSINESS_START', Value: getConfig_('SLA_BUSINESS_START', '08:30'), Description: 'เวลาเริ่มงาน HH:mm', Group: 'Ticket SLA' },
    { Key: 'SLA_BUSINESS_END', Value: getConfig_('SLA_BUSINESS_END', '17:30'), Description: 'เวลาสิ้นสุดงาน HH:mm', Group: 'Ticket SLA' },
    { Key: 'SLA_BUSINESS_DAYS', Value: getConfig_('SLA_BUSINESS_DAYS', '1,2,3,4,5'), Description: 'วันทำการ 0=อาทิตย์ ... 6=เสาร์', Group: 'Ticket SLA' },
    { Key: 'SLA_HOLIDAYS', Value: getConfig_('SLA_HOLIDAYS', ''), Description: 'วันหยุด yyyy-mm-dd คั่นด้วย comma', Group: 'Ticket SLA' },
    { Key: 'LIVE_HEALTH_PUBLIC_URL', Value: getConfig_('LIVE_HEALTH_PUBLIC_URL', ''), Description: 'URL /exec ของ Web App ที่ใช้ตรวจ Live Health; เว้นว่างเพื่อใช้ LINE callback หรือ deployment URL อัตโนมัติ', Group: 'Live Health' }
  ];
  defaults.forEach(function (row) {
    if (!existing[row.Key]) {
      appendRowEnsured_(SHEETS.SETTINGS, Object.assign({}, row, {
        UpdatedAt: new Date(),
        UpdatedBy: 'system'
      }), 'system');
    }
  });
}

function getSettingsModuleData() {
  try {
    const user = requireModule('settings', false);
    seedSettingsRows_();
    let schemaDesigner;
    try {
      schemaDesigner = getFieldSchemaDesignerData_();
    } catch (schemaError) {
      schemaDesigner = { modules: [], types: [], guidance: [], error: schemaError.message };
    }
    const rows = readSheetObjectsEnsured_(SHEETS.SETTINGS)
      .filter(function (r) { return SYSTEM_SETTING_KEYS.indexOf(r.Key) > -1; })
      .map(function (r) {
      return {
        row: r._row, key: r.Key, value: SYSTEM_SETTING_KEYS.indexOf(r.Key) > -1 ? getConfig_(r.Key, r.Value) : r.Value,
        description: r.Description, group: r.Group, updatedAt: safeFmtDateTime_(r.UpdatedAt), updatedBy: r.UpdatedBy
      };
    });
    return ok({
      role: user.role, canEdit: canEditModule(user.role, 'settings'),
      settings: rows, allowedKeys: SYSTEM_SETTING_KEYS,
      logoUrl: getConfig_('ORG_LOGO_URL', ''), orgName: getConfig_('ORG_NAME', 'กองทุนประกันชีวิต'),
      schemaDesigner: schemaDesigner
    });
  } catch (e) { return fail(e.message); }
}

function saveSystemSetting(key, value) {
  try {
    const user = requireModule('settings', true);
    key = sanitizeText(key, 80);
    if (SYSTEM_SETTING_KEYS.indexOf(key) === -1) throw new Error('ไม่อนุญาตให้แก้ไขค่านี้ผ่านหน้า Settings');
    value = normalizeSystemSetting_(key, value);
    if (key === 'LINE_LOGIN_ENABLED' && value === 'true') {
      const required = ['LINE_LOGIN_CHANNEL_ID', 'LINE_LOGIN_CHANNEL_SECRET', 'LINE_LOGIN_CALLBACK_URL'];
      const missing = required.filter(function (k) { return !getConfig_(k, '').trim(); });
      if (missing.length) throw new Error('ยังเปิด LINE Login ไม่ได้ กรุณาตั้ง Script Properties: ' + missing.join(', '));
      if (!/^\d+$/.test(getConfig_('LINE_LOGIN_CHANNEL_ID', '').trim())) {
        throw new Error('LINE_LOGIN_CHANNEL_ID ต้องเป็นตัวเลข');
      }
      if (getConfig_('LINE_LOGIN_CHANNEL_SECRET', '').trim().length < 20) {
        throw new Error('LINE_LOGIN_CHANNEL_SECRET สั้นผิดปกติ');
      }
      const callbackUrl = getConfig_('LINE_LOGIN_CALLBACK_URL', '').trim();
      if (callbackUrl.indexOf('https://') !== 0 || callbackUrl.indexOf('page=line-callback') === -1) {
        throw new Error('LINE_LOGIN_CALLBACK_URL ต้องเป็น HTTPS และมี page=line-callback');
      }
      const db = getDB_();
      const missingSheets = [SHEETS.LINE_USERS, SHEETS.LINE_SESSIONS].filter(function (name) {
        return !db.getSheetByName(name);
      });
      if (missingSheets.length) {
        throw new Error('กรุณารัน setupSystem() ก่อนเปิด LINE Login เพื่อสร้างและป้องกัน Sheet: ' +
          missingSheets.join(', '));
      }
    }
    setConfig_(key, value);
    seedSettingsRows_();
    const row = findRowEnsured_(SHEETS.SETTINGS, 'Key', key);
    if (row) {
      updateRow_(SHEETS.SETTINGS, row._row, { Value: value, UpdatedAt: new Date(), UpdatedBy: user.email }, user.email);
    }
    writeAudit_(user, 'UPDATE_SETTING', 'settings', SHEETS.SETTINGS, key, '', 'success');
    return ok('บันทึกค่า ' + key + ' เรียบร้อย');
  } catch (e) { return fail(e.message); }
}

function normalizeSystemSetting_(key, value) {
  value = sanitizeText(value, 500);
  const boolKeys = ['NOTIFY_LINE_ENABLED',
    'ADMIN_MFA_ENABLED', 'LINE_LOGIN_ENABLED', 'LINE_REQUIRE_EMPLOYEE_LINK',
    'LINE_AUTO_APPROVE_EMPLOYEE_LINK', 'PUBLIC_TICKET_ENABLED', 'PUBLIC_TICKET_EMAIL_OTP_ENABLED',
    'PUBLIC_TICKET_CONSENT_REQUIRED',
    'AUTO_BACKUP_ENABLED', 'AUTO_RESTORE_DRILL_ENABLED', 'RETENTION_TRASH_EVIDENCE'];
  if (boolKeys.indexOf(key) > -1) {
    const v = String(value).toLowerCase();
    if (['true', '1', 'yes', 'on', 'เปิด'].indexOf(v) > -1) return 'true';
    if (['false', '0', 'no', 'off', 'ปิด'].indexOf(v) > -1) return 'false';
    throw new Error('ค่า ' + key + ' ต้องเป็น true/false');
  }
  if (key === 'NOTIFY_PRIMARY_CHANNEL') {
    if (String(value).toUpperCase() !== 'LINE') throw new Error('ช่องทางหลักของระบบนี้ต้องเป็น LINE');
    return 'LINE';
  }
  const ranges = {
    NOTIFY_LEAD_DAYS: [1, 365],
    LINE_QUEUE_MAX_ATTEMPTS: [1, 10],
    REVIEW_CYCLE_DAYS: [1, 1095],
    INCIDENT_DPO_ESCALATION_HOURS: [1, 24],
    LOGIN_MAX_FAILS_5MIN: [5, 30],
    PASSWORD_HASH_ITERATIONS: [1000, 20000],
    LINE_SESSION_HOURS: [1, 720],
    PUBLIC_TICKET_MAX_FILES: [1, 5],
    PUBLIC_TICKET_MAX_FILE_MB: [1, 15],
    PUBLIC_TICKET_MAX_TOTAL_MB: [1, 50],
    PUBLIC_TICKET_MAX_PER_HOUR: [1, 20],
    PUBLIC_TICKET_MAX_PER_DAY: [1, 50],
    PUBLIC_TICKET_GLOBAL_MAX_PER_HOUR: [10, 1000],
    PUBLIC_TICKET_GLOBAL_MAX_PER_DAY: [20, 5000],
    BACKUP_RETENTION_DAYS: [7, 3650],
    RESTORE_SANDBOX_RETENTION_DAYS: [7, 3650],
    BACKUP_HEALTH_MAX_HOURS: [1, 168],
    LINE_SESSION_RETENTION_DAYS: [1, 3650],
    NOTIFICATION_LOG_RETENTION_DAYS: [30, 3650],
    NOTIFICATION_QUEUE_RETENTION_DAYS: [7, 3650],
    TICKET_PII_RETENTION_DAYS: [30, 36500],
    SERVICE_REQUEST_PII_RETENTION_DAYS: [30, 36500],
    WORKFLOW_PII_RETENTION_DAYS: [30, 36500],
    ATTACHMENT_RETENTION_DAYS: [30, 36500],
    ATTACHMENT_STAGED_RETENTION_HOURS: [1, 720],
    ATTACHMENT_DOWNLOAD_MAX_MB: [1, 15],
    SOFT_DELETE_RETENTION_DAYS: [30, 36500]
  };
  if (ranges[key]) {
    const n = parseInt(value, 10);
    if (isNaN(n) || n < ranges[key][0] || n > ranges[key][1]) {
      throw new Error('ค่า ' + key + ' ต้องอยู่ระหว่าง ' + ranges[key][0] + '-' + ranges[key][1]);
    }
    return String(n);
  }
  if (key === 'PUBLIC_TICKET_ALLOWED_EMAIL_DOMAINS') {
    return value.split(',').map(function (d) { return d.trim().toLowerCase(); }).filter(String).join(',');
  }
  if (key === 'PUBLIC_PRIVACY_NOTICE_URL') {
    if (value && value.indexOf('https://') !== 0) {
      throw new Error('PUBLIC_PRIVACY_NOTICE_URL ต้องเป็น HTTPS หรือเว้นว่าง');
    }
    return value;
  }
  if (key === 'PUBLIC_PRIVACY_NOTICE_VERSION') {
    if (!/^[0-9A-Za-z_.-]{4,40}$/.test(value)) {
      throw new Error('PUBLIC_PRIVACY_NOTICE_VERSION ใช้ได้เฉพาะตัวเลข/ตัวอักษร/.-_ และยาว 4-40 ตัวอักษร');
    }
    return value;
  }
  if (key === 'RETENTION_MODE') {
    const mode = String(value).toUpperCase();
    if (['DRY_RUN', 'ENFORCE'].indexOf(mode) === -1) throw new Error('RETENTION_MODE ต้องเป็น DRY_RUN หรือ ENFORCE');
    return mode;
  }
  if (key === 'SLA_BUSINESS_START' || key === 'SLA_BUSINESS_END') {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error(key + ' ต้องเป็น HH:mm');
    return value;
  }
  if (key === 'SLA_BUSINESS_DAYS') {
    const days = value.split(',').map(function (d) { return d.trim(); }).filter(String);
    if (!days.length || days.some(function (d) { return !/^[0-6]$/.test(d); })) {
      throw new Error('SLA_BUSINESS_DAYS ต้องเป็นตัวเลข 0-6 คั่นด้วย comma');
    }
    return days.filter(function (d, i) { return days.indexOf(d) === i; }).join(',');
  }
  if (key === 'SLA_HOLIDAYS') {
    const holidays = value.split(',').map(function (d) { return d.trim(); }).filter(String);
    if (holidays.some(function (d) { return !/^\d{4}-\d{2}-\d{2}$/.test(d); })) {
      throw new Error('SLA_HOLIDAYS ต้องเป็น yyyy-mm-dd คั่นด้วย comma');
    }
    return holidays.join(',');
  }
  return value;
}

// ===== Tester / QA =====
function getTesterModuleData() {
  try {
    const user = requireModule('tester', false);
    const cases = latestByDate_(readSheetObjectsEnsured_(SHEETS.QA_TEST), 'TestedAt', 200).map(function (r) {
      return {
        row: r._row, id: r.CaseID, module: r.Module, scenario: r.Scenario,
        steps: r.Steps, expected: r.Expected, actual: r.Actual, status: r.Status,
        priority: r.Priority, tester: r.Tester, testedAt: safeFmtDateTime_(r.TestedAt), notes: r.Notes
      };
    });
    return ok({
      role: user.role,
      canEdit: canEditModule(user.role, 'tester'),
      statuses: QA_STATUSES,
      priorities: QA_PRIORITIES,
      modules: getModuleCatalog_().map(function (m) { return { key: m.key, label: m.label, category: m.category }; }),
      cases: cases,
      checks: runQaSmokeChecks_(),
      goLive: getGoLiveChecklistData_()
    });
  } catch (e) { return fail(e.message); }
}

function getGoLiveChecklistData_() {
  const now = new Date();
  const items = [];
  function add(category, title, status, detail, moduleKey, action) {
    items.push({
      category: category,
      title: title,
      status: status,
      detail: detail || '',
      moduleKey: moduleKey || '',
      action: action || ''
    });
  }

  try {
    const build = getAppBuildInfo();
    const data = build && build.ok ? build.data : null;
    add('Deployment', 'Build และ Schema',
      data && data.schemaReady ? 'PASS' : 'FAIL',
      data
        ? ('Build ' + data.buildId + ' · schema ' + data.installedSchemaVersion + '/' + data.schemaVersion +
          (data.missingSchema && data.missingSchema.length ? ' · ขาด ' + data.missingSchema.join(', ') : ''))
        : ((build && build.error) || 'ตรวจ build/schema ไม่สำเร็จ'),
      'tester');
  } catch (e) {
    add('Deployment', 'Build และ Schema', 'FAIL', e.message, 'tester');
  }

  try {
    const live = latestQaScenario_('LIVE_HEALTH');
    if (!live) {
      add('Deployment', 'Live deployment health', 'WARN',
        'ยังไม่มีผลตรวจ live health ให้กด "ตรวจ Deployment จริง" หลัง deploy เวอร์ชันล่าสุด',
        'tester', 'runLive');
    } else {
      const liveDate = live.TestedAt ? fmtDateTime(live.TestedAt) : '-';
      const status = String(live.Status || 'WARN');
      const isToday = live.TestedAt &&
        Utilities.formatDate(new Date(live.TestedAt), 'Asia/Bangkok', 'yyyy-MM-dd') ===
        Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd');
      add('Deployment', 'Live deployment health',
        status === 'PASS' && isToday ? 'PASS' : (status === 'FAIL' ? 'FAIL' : 'WARN'),
        (isToday ? 'ตรวจวันนี้' : 'ผลตรวจไม่ใช่วันนี้') + ' · ' + liveDate +
          ' · ' + sanitizeText(live.Actual || '', 500),
        'tester', 'runLive');
    }
  } catch (e) {
    add('Deployment', 'Live deployment health', 'WARN', e.message, 'tester', 'runLive');
  }

  try {
    const triggerNames = ScriptApp.getProjectTriggers()
      .map(function (t) { return t.getHandlerFunction(); });
    const requiredTriggers = operationalTriggerNames_().concat(['monthlyExecutiveReport_']);
    const missing = requiredTriggers.filter(function (name) {
      return triggerNames.filter(function (value) { return value === name; }).length !== 1;
    });
    add('Deployment', 'Operational triggers',
      missing.length ? 'FAIL' : 'PASS',
      missing.length ? ('ขาดหรือซ้ำ: ' + missing.join(', ')) : ('ครบ ' + requiredTriggers.length + ' trigger'),
      'tester');
  } catch (e) {
    add('Deployment', 'Operational triggers', 'FAIL', e.message, 'tester');
  }

  try {
    const propsCount = PropertiesService.getScriptProperties().getKeys().length;
    add('Deployment', 'Script Properties capacity',
      propsCount >= 50 ? 'FAIL' : (propsCount >= 45 ? 'WARN' : 'PASS'),
      propsCount + '/50 keys · ค่าทั่วไปควรอยู่ใน Settings ไม่ใช่ Script Properties',
      'settings');
  } catch (e) {
    add('Deployment', 'Script Properties capacity', 'WARN', e.message, 'settings');
  }

  try {
    const limits = getPublicTicketLimits_();
    add('Public Helpdesk', 'Public ticket intake',
      limits.enabled ? 'PASS' : 'FAIL',
      (limits.enabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน') +
        ' · rate ' + limits.maxPerHour + '/ชม., ' + limits.maxPerDay + '/วัน' +
        ' · files ' + limits.maxFiles + 'x' + limits.maxFileMb + 'MB',
      'settings');
  } catch (e) {
    add('Public Helpdesk', 'Public ticket intake', 'FAIL', e.message, 'settings');
  }

  try {
    const privacy = getPublicPrivacyNotice_();
    add('Public Helpdesk', 'Privacy Notice และ Consent',
      privacy.required && privacy.version && privacy.summary ? 'PASS' : 'WARN',
      (privacy.required ? 'บังคับ consent' : 'ไม่บังคับ consent') +
        ' · version ' + (privacy.version || '-') +
        ' · contact ' + (privacy.dpoContact || '-'),
      'settings');
  } catch (e) {
    add('Public Helpdesk', 'Privacy Notice และ Consent', 'FAIL', e.message, 'settings');
  }

  try {
    const lineStatus = getLineLoginConfigurationStatus_();
    add('LINE', 'LINE Login',
      lineStatus.enabled ? (lineStatus.configured ? 'PASS' : 'FAIL') : 'WARN',
      lineStatus.enabled
        ? (lineStatus.configured ? 'configured' : lineStatus.message)
        : 'ปิดใช้งาน; public ยังติดตามด้วย Ticket+รหัสลับได้ แต่ LINE-first ยังไม่ครบ',
      'settings');
  } catch (e) {
    add('LINE', 'LINE Login', 'FAIL', e.message, 'settings');
  }

  try {
    const lineEnabled = getConfig_('NOTIFY_LINE_ENABLED', 'true') === 'true';
    const lineReady = lineEnabled && !!getConfig_('LINE_CHANNEL_ACCESS_TOKEN', '') &&
      !!getConfig_('LINE_DEFAULT_TO', '');
    const dead = readSheetObjectsEnsured_(SHEETS.NOTIFY_QUEUE, true)
      .filter(function (r) { return String(r.Status) === 'DEAD'; }).length;
    add('LINE', 'LINE notification queue',
      lineReady && !dead ? 'PASS' : 'FAIL',
      'LINE=' + (lineReady ? 'configured' : 'missing token/target') + ' · dead letter=' + dead,
      'notification');
  } catch (e) {
    add('LINE', 'LINE notification queue', 'FAIL', e.message, 'notification');
  }

  try {
    if (getConfig_('AUTO_BACKUP_ENABLED', 'true') !== 'true') {
      add('Backup / Recovery', 'System Snapshot', 'WARN',
        'AUTO_BACKUP_ENABLED=false จึงไม่ตรวจ snapshot อัตโนมัติ', 'backup');
    } else {
      const latest = latestSuccessfulSystemSnapshot_();
      const maxHours = parseInt(getConfig_('BACKUP_HEALTH_MAX_HOURS', '30'), 10) || 30;
      const ageHours = latest && latest.BackupDate
        ? Math.round((now - new Date(latest.BackupDate).getTime()) / 3600000)
        : null;
      add('Backup / Recovery', 'System Snapshot',
        ageHours !== null && ageHours <= maxHours ? 'PASS' : 'FAIL',
        ageHours === null
          ? 'ยังไม่มี System Snapshot สำเร็จ'
          : ('snapshot ล่าสุด ' + fmtDateTime(latest.BackupDate) + ' · อายุ ' + ageHours + '/' + maxHours + ' ชม.'),
        'backup');
    }
  } catch (e) {
    add('Backup / Recovery', 'System Snapshot', 'FAIL', e.message, 'backup');
  }

  try {
    if (getConfig_('AUTO_RESTORE_DRILL_ENABLED', 'true') !== 'true') {
      add('Backup / Recovery', 'Restore drill', 'WARN',
        'AUTO_RESTORE_DRILL_ENABLED=false จึงไม่ตรวจ restore drill อัตโนมัติ', 'backup');
    } else {
      const latestRestore = latestRestoreDrill_();
      const ageDays = latestRestore && latestRestore.TestDate ? daysSince_(latestRestore.TestDate) : null;
      add('Backup / Recovery', 'Restore drill',
        latestRestore && String(latestRestore.Result) === 'ผ่าน' && ageDays !== null && ageDays <= 45 ? 'PASS' : 'WARN',
        latestRestore
          ? ('ผลล่าสุด ' + String(latestRestore.Result || '-') + ' · ' + fmtDate(latestRestore.TestDate) +
            ' · อายุ ' + (ageDays === null ? '-' : ageDays) + ' วัน')
          : 'ยังไม่มีผล Restore drill',
        'backup');
    }
  } catch (e) {
    add('Backup / Recovery', 'Restore drill', 'WARN', e.message, 'backup');
  }

  try {
    const mode = String(getConfig_('RETENTION_MODE', 'DRY_RUN')).toUpperCase();
    const latestRetention = latestRetentionRun_();
    add('Retention / PDPA', 'Retention mode',
      mode === 'ENFORCE' ? 'PASS' : 'WARN',
      mode + (latestRetention ? (' · ล่าสุด ' + fmtDateTime(latestRetention.RunAt) +
        ' · ' + latestRetention.Status) : ' · ยังไม่มี RetentionLog'),
      'backup');
  } catch (e) {
    add('Retention / PDPA', 'Retention mode', 'WARN', e.message, 'backup');
  }

  try {
    const admins = readSheetObjectsEnsured_(SHEETS.USERS)
      .filter(function (u) { return u.Role === ROLES.IT_ADMIN && String(u.Status).toLowerCase() === 'active'; });
    const adminsWithPassword = admins.filter(function (u) { return !!u.PasswordHash; });
    const mfa = getConfig_('ADMIN_MFA_ENABLED', 'true') === 'true';
    add('Access / Audit', 'Admin login และ MFA',
      admins.length && adminsWithPassword.length ? (mfa ? 'PASS' : 'WARN') : 'FAIL',
      adminsWithPassword.length + '/' + admins.length + ' active IT Admin ตั้งรหัสผ่านแล้ว · MFA=' + (mfa ? 'on' : 'off'),
      'users');
  } catch (e) {
    add('Access / Audit', 'Admin login และ MFA', 'FAIL', e.message, 'users');
  }

  const blockers = items.filter(function (i) { return i.status === 'FAIL'; }).length;
  const warnings = items.filter(function (i) { return i.status === 'WARN'; }).length;
  const passed = items.filter(function (i) { return i.status === 'PASS'; }).length;
  return {
    generatedAt: fmtDateTime(now),
    overallStatus: blockers ? 'BLOCKED' : (warnings ? 'WARN' : 'PASS'),
    overallLabel: blockers ? 'ยังไม่ควร Go-live' : (warnings ? 'Go-live ได้แบบมีเงื่อนไข' : 'พร้อม Go-live'),
    blockers: blockers,
    warnings: warnings,
    passed: passed,
    total: items.length,
    items: items,
    nextActions: goLiveNextActions_(items)
  };
}

function latestQaScenario_(scenario) {
  scenario = String(scenario || '');
  return readSheetObjectsEnsured_(SHEETS.QA_TEST, true)
    .filter(function (r) { return String(r.Scenario) === scenario; })
    .sort(function (a, b) {
      return new Date(b.TestedAt || b.Timestamp || 0) - new Date(a.TestedAt || a.Timestamp || 0);
    })[0] || null;
}

function latestRestoreDrill_() {
  return readSheetObjectsEnsured_(SHEETS.RECOVERY, true)
    .filter(function (r) {
      return String(r.Scenario || '').indexOf('Snapshot') > -1 || String(r.TestID || '').indexOf('RCV') === 0;
    })
    .sort(function (a, b) { return new Date(b.TestDate || 0) - new Date(a.TestDate || 0); })[0] || null;
}

function latestRetentionRun_() {
  return readSheetObjectsEnsured_(SHEETS.RETENTION_LOG, true)
    .sort(function (a, b) { return new Date(b.RunAt || b.Timestamp || 0) - new Date(a.RunAt || a.Timestamp || 0); })[0] || null;
}

function goLiveNextActions_(items) {
  const seen = {};
  return items.filter(function (item) {
    return item.status === 'FAIL' || item.status === 'WARN';
  }).map(function (item) {
    if (item.action === 'runLive') return 'กดตรวจ Deployment จริงหลัง Deploy New version';
    if (item.moduleKey === 'settings') return 'ตรวจและบันทึกค่า Settings: ' + item.title;
    if (item.moduleKey === 'backup') return 'เปิด Backup เพื่อตรวจ Snapshot/Restore/Retention: ' + item.title;
    if (item.moduleKey === 'notification') return 'เปิดตั้งค่าการแจ้งเตือนและจัดการ LINE queue';
    if (item.moduleKey === 'users') return 'ตรวจบัญชี IT Admin และ MFA';
    return 'ตรวจหัวข้อ: ' + item.title;
  }).filter(function (text) {
    if (seen[text]) return false;
    seen[text] = true;
    return true;
  }).slice(0, 6);
}

function addQaCase(form) {
  try {
    const user = requireModule('tester', true);
    form = form || {};
    const moduleKey = sanitizeText(form.module, 80);
    const scenario = sanitizeText(form.scenario, 240);
    requireFields({ Module: moduleKey, Scenario: scenario }, ['Module', 'Scenario']);
    const id = generateId('QA');
    appendRowEnsured_(SHEETS.QA_TEST, {
      CaseID: id,
      Module: moduleKey,
      Scenario: scenario,
      Steps: sanitizeText(form.steps, 1500),
      Expected: sanitizeText(form.expected, 1000),
      Actual: sanitizeText(form.actual, 1000),
      Status: sanitizeText(form.status, 40) || 'PENDING',
      Priority: sanitizeText(form.priority, 40) || 'กลาง',
      Tester: user.email,
      TestedAt: form.status ? new Date() : '',
      Notes: sanitizeText(form.notes, 500)
    }, user.email);
    writeAudit_(user, 'CREATE', 'tester', SHEETS.QA_TEST, id, scenario, 'success');
    return ok('เพิ่ม Test case เรียบร้อย (' + id + ')');
  } catch (e) { return fail(e.message); }
}

function updateQaCaseResult(caseId, status, actual) {
  try {
    const user = requireModule('tester', true);
    const c = findRowEnsured_(SHEETS.QA_TEST, 'CaseID', caseId);
    if (!c) throw new Error('ไม่พบ Test case');
    status = sanitizeText(status, 40);
    if (!isInList(status, QA_STATUSES)) throw new Error('สถานะ QA ไม่ถูกต้อง');
    updateRow_(SHEETS.QA_TEST, c._row, {
      Status: status,
      Actual: sanitizeText(actual, 1200),
      Tester: user.email,
      TestedAt: new Date()
    }, user.email);
    writeAudit_(user, 'UPDATE_RESULT', 'tester', SHEETS.QA_TEST, caseId, status, 'success');
    return ok('อัปเดตผลทดสอบเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

function runQaSmokeChecks_() {
  const checks = [];
  try {
    const exposed = ['setConfig', 'readSheetObjects', 'getSheet', 'appendRow', 'updateRow', 'findRow', 'writeAudit', 'notify'];
    const found = exposed.filter(function (name) { return typeof globalThis[name] === 'function'; });
    let compat = '';
    if (typeof globalThis.getConfig === 'function') {
      try {
        getConfig('LINE_CHANNEL_ACCESS_TOKEN', '');
        found.push('getConfig');
      } catch (e) {
        compat += ' (มี getConfig compatibility เฉพาะ ORG_NAME)';
      }
    }
    if (typeof globalThis.include === 'function') {
      try {
        include('__not_allowed__');
        found.push('include');
      } catch (e) {
        compat += ' (มี include compatibility เฉพาะ UI partial ที่อนุญาต)';
      }
    }
    checks.push({
      name: 'API surface',
      detail: found.length ? ('ยังมี helper public: ' + found.join(', ')) : ('helper อ่าน/เขียนหลักเป็น private function แล้ว' + compat),
      status: found.length ? 'FAIL' : 'PASS'
    });
  } catch (e) {
    checks.push({ name: 'API surface', detail: e.message, status: 'FAIL' });
  }

  try {
    const dbId = getConfig_('SPREADSHEET_ID', '');
    const ss = getDB_();
    checks.push({
      name: 'Database',
      detail: dbId ? ('SPREADSHEET_ID พร้อม: ' + ss.getName()) : ('container-bound: ' + ss.getName()),
      status: 'PASS'
    });
  } catch (e) {
    checks.push({ name: 'Database', detail: e.message, status: 'FAIL' });
  }

  try {
    const triggerNames = ScriptApp.getProjectTriggers()
      .map(function (t) { return t.getHandlerFunction(); });
    const requiredTriggers = operationalTriggerNames_().concat(['monthlyExecutiveReport_']);
    const triggerProblems = requiredTriggers.filter(function (name) {
      return triggerNames.filter(function (value) { return value === name; }).length !== 1;
    });
    checks.push({
      name: 'Operational triggers',
      detail: triggerProblems.length
        ? ('ขาดหรือซ้ำ: ' + triggerProblems.join(', '))
        : ('ครบ ' + requiredTriggers.length + ' trigger'),
      status: triggerProblems.length ? 'FAIL' : 'PASS'
    });
  } catch (e) {
    checks.push({ name: 'Operational triggers', detail: e.message, status: 'FAIL' });
  }

  try {
    const admins = readSheetObjects_(SHEETS.USERS)
      .filter(function (u) { return u.Role === ROLES.IT_ADMIN && String(u.Status).toLowerCase() === 'active'; });
    const adminsWithPassword = admins.filter(function (u) { return !!u.PasswordHash; });
    checks.push({
      name: 'Admin login',
      detail: adminsWithPassword.length + '/' + admins.length + ' active IT Admin ตั้งรหัสผ่านแล้ว · MFA=' +
        (getConfig_('ADMIN_MFA_ENABLED', 'true') === 'true' ? 'on' : 'off'),
      status: admins.length && adminsWithPassword.length
        ? (getConfig_('ADMIN_MFA_ENABLED', 'true') === 'true' ? 'PASS' : 'WARN')
        : 'FAIL'
    });
  } catch (e) {
    checks.push({ name: 'Admin login', detail: e.message, status: 'FAIL' });
  }

  try {
    const limits = getPublicTicketLimits_();
    checks.push({
      name: 'Public helpdesk',
      detail: (limits.enabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน') +
        ' · ต่ออุปกรณ์ ' + limits.maxPerHour + '/ชม., ' + limits.maxPerDay + '/วัน' +
        ' · รวมทั้งระบบ ' + limits.globalMaxPerHour + '/ชม., ' + limits.globalMaxPerDay + '/วัน' +
        ' · ไฟล์ ' + limits.maxFiles + 'x' + limits.maxFileMb + 'MB (รวม ' + limits.maxTotalMb + 'MB)' +
        (limits.sharedCode ? ' · มี shared code' : ' · ไม่มี shared code') +
        ' · ไม่ใช้อีเมล · ติดตามด้วย Ticket+รหัสลับ หรือ LINE',
      status: limits.enabled ? 'PASS' : 'INFO'
    });
  } catch (e) {
    checks.push({ name: 'Public helpdesk', detail: e.message, status: 'FAIL' });
  }

  try {
    const build = getAppBuildInfo();
    const info = build && build.ok ? build.data : null;
    checks.push({
      name: 'Deployment / Schema',
      detail: info
        ? ('Build ' + info.buildId + ' · schema ' + info.installedSchemaVersion + '/' + info.schemaVersion +
          (info.missingSchema.length ? ' · ขาด ' + info.missingSchema.join(', ') : ''))
        : ((build && build.error) || 'ไม่สามารถอ่านข้อมูล Build ได้'),
      status: info && info.schemaReady ? 'PASS' : 'FAIL'
    });
  } catch (e) {
    checks.push({ name: 'Deployment / Schema', detail: e.message, status: 'FAIL' });
  }

  try {
    const lineEnabled = getConfig_('NOTIFY_LINE_ENABLED', 'true') === 'true';
    const lineOk = lineEnabled && !!getConfig_('LINE_CHANNEL_ACCESS_TOKEN', '') &&
      !!getConfig_('LINE_DEFAULT_TO', '');
    const queueRows = readSheetObjectsEnsured_(SHEETS.NOTIFY_QUEUE, true);
    const dead = queueRows.filter(function (r) { return String(r.Status) === 'DEAD'; }).length;
    checks.push({
      name: 'LINE notification / queue',
      detail: 'LINE=' + (lineOk ? 'configured' : 'missing token/target') +
        ' · dead letter=' + dead,
      status: lineOk && !dead ? 'PASS' : 'FAIL'
    });
  } catch (e) {
    checks.push({ name: 'LINE notification / queue', detail: e.message, status: 'FAIL' });
  }

  try {
    const loginStatus = getLineLoginConfigurationStatus_();
    checks.push({
      name: 'LINE Login',
      detail: loginStatus.enabled
        ? (loginStatus.configured ? 'configured · พร้อมทดสอบ OAuth callback' : loginStatus.message)
        : 'ปิดใช้งาน (ยังติดตามด้วย Ticket+รหัสลับได้)',
      status: loginStatus.enabled ? (loginStatus.configured ? 'PASS' : 'FAIL') : 'INFO'
    });
  } catch (e) {
    checks.push({ name: 'LINE Login', detail: e.message, status: 'FAIL' });
  }

  getModuleCatalog_().forEach(function (m) {
    if (!m.sheet) {
      checks.push({ name: m.label, detail: 'ไม่มีชีตข้อมูลหลัก', status: 'INFO' });
      return;
    }
    try {
      if (DB_SCHEMA[m.sheet]) ensureSheetBySchema_(m.sheet);
      const sh = getDB_().getSheetByName(m.sheet);
      checks.push({
        name: m.label,
        detail: m.sheet + ' พร้อมใช้งาน (' + Math.max((sh ? sh.getLastRow() : 1) - 1, 0) + ' รายการ)',
        status: sh ? 'PASS' : 'FAIL'
      });
    } catch (e) {
      checks.push({ name: m.label, detail: e.message, status: 'FAIL' });
    }
  });
  return checks;
}
