/**
 * Setup.gs
 * ติดตั้งระบบครั้งแรก: สร้างไฟล์ Spreadsheet (หรือใช้ที่ผูกไว้), สร้างทุก Sheet ตาม DB_SCHEMA,
 * ใส่หัวคอลัมน์ + จัดรูปแบบ, ป้องกัน Sheet AuditTrail, เพิ่มผู้ติดตั้งเป็น IT Admin,
 * เติมข้อมูล PolicyMapping เริ่มต้น และตั้ง Time-driven Trigger รายวัน
 *
 * วิธีใช้: เปิดโปรเจกต์ Apps Script -> เลือกฟังก์ชัน setupSystem -> Run (ครั้งเดียว)
 */

function setupSystem() {
  const installerEmail = assertEditorOwner_();
  const props = PropertiesService.getScriptProperties();

  // 1) เตรียม Spreadsheet ฐานข้อมูล
  let ss;
  let id = props.getProperty('SPREADSHEET_ID');
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else if (SpreadsheetApp.getActiveSpreadsheet()) {
    ss = SpreadsheetApp.getActiveSpreadsheet();
    props.setProperty('SPREADSHEET_ID', ss.getId());
  } else {
    ss = SpreadsheetApp.create('ISMS_DB_กองทุนประกันชีวิต');
    props.setProperty('SPREADSHEET_ID', ss.getId());
  }

  // 2) สร้างทุก Sheet ตาม schema (เพิ่มคอลัมน์ที่ขาดแบบปลอดภัย ไม่สลับตำแหน่ง/ไม่ทำลายข้อมูลเดิม)
  Object.keys(DB_SCHEMA).forEach(function (sheetName) {
    let sh = ss.getSheetByName(sheetName);
    if (!sh) sh = ss.insertSheet(sheetName);
    ensureSheetColumns_(sh, DB_SCHEMA[sheetName]);
  });

  // 3) ค่า non-secret เช่น SLA, retention, public limits ให้เก็บในชีต Settings แทน Script Properties
  seedSettingsRows_();
  const propertyCleanup = cleanupScriptPropertiesForLine_();
  if (!props.getProperty('NOTIFY_LINE_ENABLED')) props.setProperty('NOTIFY_LINE_ENABLED', 'true');
  if (!props.getProperty('ADMIN_MFA_PEPPER')) {
    props.setProperty('ADMIN_MFA_PEPPER', Utilities.getUuid() + Utilities.getUuid());
  }
  if (!props.getProperty('PUBLIC_TICKET_TOKEN_PEPPER')) {
    props.setProperty('PUBLIC_TICKET_TOKEN_PEPPER', Utilities.getUuid() + Utilities.getUuid());
  }
  if (!props.getProperty('LINE_LOGIN_ENABLED')) props.setProperty('LINE_LOGIN_ENABLED', 'false');
  if (!props.getProperty('LINE_REQUIRE_EMPLOYEE_LINK')) props.setProperty('LINE_REQUIRE_EMPLOYEE_LINK', 'false');
  if (!props.getProperty('LINE_AUTO_APPROVE_EMPLOYEE_LINK')) props.setProperty('LINE_AUTO_APPROVE_EMPLOYEE_LINK', 'false');
  if (!props.getProperty('LINE_SESSION_HOURS')) props.setProperty('LINE_SESSION_HOURS', '24');
  if (!props.getProperty('LINE_SESSION_SECRET')) {
    props.setProperty('LINE_SESSION_SECRET',
      Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid());
  }

  // 4) ลบ Sheet ตั้งต้น "Sheet1"/"ชีต1" ถ้ามีและว่าง
  ['Sheet1', 'ชีต1'].forEach(function (n) {
    const s = ss.getSheetByName(n);
    if (s && ss.getSheets().length > 1 && setupSheetIsBlank_(s)) {
      try { ss.deleteSheet(s); } catch (e) {}
    }
  });

  // 5) ป้องกัน AuditTrail จากการแก้ไขโดยผู้ใช้ทั่วไป
  protectAuditSheet(ss);
  protectSensitiveSheet_(ss, SHEETS.USERS, 'Users — บทบาท รหัสผ่าน และข้อมูลยืนยันตัวตน');
  protectSensitiveSheet_(ss, SHEETS.SETTINGS, 'Settings — ค่าควบคุมและนโยบายระบบ');
  protectSensitiveSheet_(ss, SHEETS.EMPLOYEES, 'Employees — ข้อมูลส่วนบุคคลและสถานะพนักงาน');
  protectSensitiveSheet_(ss, SHEETS.EMPLOYEE_ASSIGNMENTS, 'EmployeeAssignments — บัญชีและทรัพย์สินของพนักงาน');
  protectSensitiveSheet_(ss, SHEETS.LINE_USERS, 'LineUsers — ข้อมูลระบุตัวผู้ใช้ LINE');
  protectSensitiveSheet_(ss, SHEETS.LINE_SESSIONS, 'LineSessions — session hash ของผู้ใช้ LINE');
  protectSensitiveSheet_(ss, SHEETS.NOTIFY_QUEUE, 'NotificationQueue — เนื้อหาคิวแจ้งเตือน LINE');
  protectSensitiveSheet_(ss, SHEETS.TASK_SUBTASK, 'TaskSubtasks — Checklist งานส่วนตัวของผู้ใช้');
  protectSensitiveSheet_(ss, SHEETS.TASK_PROGRESS, 'TaskProgressLogs — ประวัติความคืบหน้าส่วนตัว');
  protectSensitiveSheet_(ss, SHEETS.TASK_LINK, 'TaskLinks — ลิงก์ประกอบงานส่วนตัว');
  protectSensitiveSheet_(ss, SHEETS.TASK_ATTACHMENT, 'TaskAttachments — ดัชนีไฟล์แนบส่วนตัว');
  protectSensitiveSheet_(ss, SHEETS.TASK_REMINDER, 'TaskReminders — การแจ้งเตือนงานส่วนตัว');
  protectSensitiveSheet_(ss, SHEETS.EMPLOYEE_LIFECYCLE, 'EmployeeLifecycle — ข้อมูลวงจรพนักงาน');
  protectSensitiveSheet_(ss, SHEETS.RETENTION_LOG, 'RetentionLog — หลักฐานการทำลายข้อมูล');
  protectSensitiveSheet_(ss, SHEETS.REGULATORY_NOTIFICATION,
    'RegulatoryNotifications — หลักฐานการแจ้งหน่วยงานกำกับ');
  protectSensitiveSheet_(ss, SHEETS.PRIVACY_ROPA, 'PrivacyROPA — รายการกิจกรรมประมวลผลข้อมูลส่วนบุคคล');
  protectSensitiveSheet_(ss, SHEETS.PRIVACY_CONSENT, 'PrivacyConsents — หลักฐานความยินยอมและการถอนความยินยอม');
  protectSensitiveSheet_(ss, SHEETS.PRIVACY_DSR, 'PrivacyDSR — คำขอใช้สิทธิและข้อมูลติดต่อเจ้าของข้อมูล');
  protectSensitiveSheet_(ss, SHEETS.VULNERABILITY, 'VulnerabilityFindings — ช่องโหว่และแผนแก้ไข');
  protectSensitiveSheet_(ss, SHEETS.AUDIT_FINDING, 'AuditFindings — ข้อบกพร่อง หลักฐาน และแผนแก้ไข');
  protectSensitiveSheet_(ss, SHEETS.CONFIG_ITEM, 'ConfigurationItems — โครงสร้างและรายละเอียดระบบสำคัญ');
  protectSensitiveSheet_(ss, SHEETS.CI_RELATIONSHIP, 'CIRelationships — แผนผังการพึ่งพาระบบและทรัพย์สิน');
  protectSensitiveSheet_(ss, SHEETS.SERVICE_CATALOG, 'ServiceCatalog — นิยาม Workflow และเงื่อนไขบริการ');
  protectSensitiveSheet_(ss, SHEETS.SERVICE_REQUEST, 'ServiceRequests — คำขอและข้อมูลผู้ร้องขอบริการ');
  protectSensitiveSheet_(ss, SHEETS.SERVICE_REQUEST_TASK, 'ServiceRequestTasks — Checklist การดำเนินงานบริการ');
  protectSensitiveSheet_(ss, SHEETS.SERVICE_REQUEST_HISTORY, 'ServiceRequestHistory — Timeline คำขอบริการ');
  protectSensitiveSheet_(ss, SHEETS.WORKFLOW_DEFINITION, 'WorkflowDefinitions — นิยามกระบวนการอนุมัติกลาง');
  protectSensitiveSheet_(ss, SHEETS.WORKFLOW_STEP, 'WorkflowSteps — ขั้นตอนและเงื่อนไขผู้อนุมัติ');
  protectSensitiveSheet_(ss, SHEETS.WORKFLOW_INSTANCE, 'WorkflowInstances — ธุรกรรม Workflow และ context');
  protectSensitiveSheet_(ss, SHEETS.WORKFLOW_APPROVAL, 'WorkflowApprovals — งานอนุมัติและผลตัดสินใจ');
  protectSensitiveSheet_(ss, SHEETS.WORKFLOW_HISTORY, 'WorkflowHistory — Timeline การอนุมัติ');
  protectSensitiveSheet_(ss, SHEETS.WORKFLOW_DELEGATION, 'WorkflowDelegations — การมอบหมายแทน');
  protectSensitiveSheet_(ss, SHEETS.ATTACHMENT_REGISTRY, 'AttachmentRegistry — metadata ไฟล์หลักฐานส่วนตัว');
  protectSensitiveSheet_(ss, SHEETS.ATTACHMENT_LINK, 'AttachmentLinks — row-level link และ legal hold');
  protectSensitiveSheet_(ss, SHEETS.ATTACHMENT_ACCESS_LOG, 'AttachmentAccessLog — ประวัติการเข้าถึงไฟล์');
  protectSensitiveSheet_(ss, SHEETS.RECORD_LINK, 'RecordLinks — ความสัมพันธ์ข้ามโมดูล');
  protectSensitiveSheet_(ss, SHEETS.INTEGRATION_OUTBOX, 'IntegrationOutbox — คิวสร้างรายการข้ามโมดูล');
  protectSensitiveSheet_(ss, SHEETS.ACTION_PERMISSION, 'ActionPermissions — สิทธิ์ราย action');
  protectSensitiveSheet_(ss, SHEETS.ROLE_ACTION_PERMISSION, 'RoleActionPermissions — สิทธิ์ action ต่อบทบาท');
  protectSensitiveSheet_(ss, SHEETS.USER_PERMISSION_OVERRIDE, 'UserPermissionOverrides — ข้อยกเว้นสิทธิ์รายบุคคล');
  protectSensitiveSheet_(ss, SHEETS.APPROVAL_GROUP, 'ApprovalGroups — กลุ่มผู้อนุมัติ');
  protectSensitiveSheet_(ss, SHEETS.APPROVAL_GROUP_MEMBER, 'ApprovalGroupMembers — สมาชิกกลุ่มผู้อนุมัติ');

  // 6) เพิ่มผู้ติดตั้งเป็น IT Admin (ถ้ายังไม่มี)
  seedInitialAdmin(ss);
  migrateUsernames_();

  // 7) เติม PolicyMapping เริ่มต้น
  seedPolicyMapping(ss);
  seedLegalCompliance_(ss);

  // 7b) เติมหมวดหมู่ Ticket ตั้งต้น
  seedTicketCategories(ss);
  seedServiceCatalog_(ss);
  seedWorkflowFoundation_(ss);
  const migratedWorkflowSteps = migrateWorkflowStepVersionsP3_(ss);
  const migratedWorkflowCatalog = migrateServiceCatalogP3_(ss);
  const migratedTicketSla = migrateTicketSlaSchema_();

  // 7c) ย้ายรหัสติดตาม Ticket รุ่นเก่าจาก plaintext เป็น HMAC hash
  const migratedTicketTokens = migratePublicTicketTokens_();

  // 8) ตั้ง Trigger แจ้งเตือนรายวัน + รายงานผู้บริหารรายเดือน
  ensureDailyTrigger();
  ensureMonthlyReportTrigger();
  ensureOperationalTriggers();

  props.setProperty('APP_SCHEMA_VERSION', String(getCurrentSchemaVersion_()));
  const propertyCountFinal = props.getKeys().length;

  return 'ติดตั้งระบบสำเร็จ! Spreadsheet ID = ' + ss.getId() +
    '\nURL = ' + ss.getUrl() +
    '\nผู้ดูแลระบบเริ่มต้น = ' + installerEmail +
    '\nย้ายรหัสติดตาม Ticket รุ่นเก่า = ' + migratedTicketTokens + ' รายการ' +
    '\nปรับ Ticket เป็น Business-hours SLA = ' + migratedTicketSla + ' รายการ' +
    '\nเติม WorkflowSteps.DefinitionVersion = ' + migratedWorkflowSteps + ' รายการ' +
    '\nเชื่อม Catalog กับ Workflow/Integration = ' + migratedWorkflowCatalog + ' รายการ' +
    '\nจัดการ Script Properties = ' + propertyCleanup.before + ' → ' + propertyCountFinal +
    ' รายการ (ย้ายไป Settings ' + propertyCleanup.migrated.length + ', ลบทิ้ง ' + propertyCleanup.deleted.length + ')' +
    '\n\nขั้นตอนถัดไป: รัน bootstrapFirstAdmin("รหัสผ่านที่ต้องการ") เพื่อตั้งรหัสผ่านล็อกอินหลังบ้าน';
}

/**
 * ตั้งรหัสผ่านล็อกอินหลังบ้านให้บัญชีของผู้ที่รันฟังก์ชันนี้ (รันจาก Apps Script editor เท่านั้น)
 * ใช้ Session.getEffectiveUser() ซึ่งจะมีค่าเฉพาะตอนรันใน editor — ป้องกันการเรียกผ่านเว็บแบบ anonymous
 * วิธีใช้: เลือกฟังก์ชัน bootstrapFirstAdmin -> แก้พารามิเตอร์รหัสผ่านในโค้ดชั่วคราว หรือใช้ Script Property
 */
/**
 * ★ ใช้ข้อความรหัสผ่านอย่างน้อย 12 ตัวอักษรและไม่เกี่ยวกับชื่อผู้ใช้
 *   แล้วเลือกฟังก์ชัน setupAdminLogin -> กด Run (ไม่ต้องส่งพารามิเตอร์)
 */
function setupAdminLogin() {
  assertEditorOwner_();
  const password = PropertiesService.getScriptProperties().getProperty('ADMIN_INIT_PASSWORD') || '';
  if (!password) throw new Error('กรุณาตั้ง Script Property ADMIN_INIT_PASSWORD แล้วรัน setupAdminLogin อีกครั้ง');
  return bootstrapFirstAdmin(password);
}

function bootstrapFirstAdmin(password) {
  const email = assertEditorOwner_();
  if (!email) throw new Error('ต้องรันจาก Apps Script editor เท่านั้น (ไม่พบอีเมลผู้รัน)');
  const props = PropertiesService.getScriptProperties();
  password = String(password || props.getProperty('ADMIN_INIT_PASSWORD') || '');
  if (password.length < 12) {
    throw new Error('ไม่ได้รับรหัสผ่าน — ปุ่ม Run ในเอดิเตอร์ส่งพารามิเตอร์ไม่ได้ ' +
      'ให้ใช้วิธีใดวิธีหนึ่ง: (1) เลือกฟังก์ชัน setupAdminLogin แล้วแก้รหัสในโค้ด -> Run ' +
      'หรือ (2) ตั้ง Script Property ADMIN_INIT_PASSWORD = รหัสผ่าน แล้ว Run bootstrapFirstAdmin');
  }

  // ทำให้ชีต Users มีคอลัมน์ PasswordHash/PasswordSalt ก่อน (กันกรณียังไม่ได้รัน setupSystem ใหม่)
  const ss = getDB_();
  const userSheet = ss.getSheetByName(SHEETS.USERS);
  if (!userSheet) throw new Error('ไม่พบชีต Users (รัน setupSystem ก่อน)');
  ensureSheetColumns_(userSheet, DB_SCHEMA.Users);

  const u = findRowInSheet(userSheet, 'Email', email);
  if (!u) throw new Error('ไม่พบบัญชี ' + email + ' ในทะเบียน Users (รัน setupSystem ก่อน)');
  const proposedUsername = String(u.Username || '').trim() ||
    makeAvailableUsername_(String(email).split('@')[0], u.UserID);
  password = validateNewPassword_(password, proposedUsername);
  const salt = genSalt_();
  const passwordHash = hashPassword_(password, salt);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let outcome;
  try {
    const fresh = findRowInSheet(userSheet, 'Email', email);
    if (!fresh) throw new Error('บัญชีหายไประหว่าง Bootstrap');
    const username = String(fresh.Username || '').trim() ||
      makeAvailableUsername_(String(email).split('@')[0], fresh.UserID);
    // Revalidate against the row observed under lock. The hash itself does not
    // depend on Username, so it can be computed before the critical section.
    validateNewPassword_(password, username);
    password = '';
    outcome = setupCommitBootstrapAdminLocked_(ss, userSheet, fresh, {
      email: email,
      username: username,
      salt: salt,
      passwordHash: passwordHash
    });
  } finally {
    lock.releaseLock();
  }

  // Re-read after releasing the transaction lock as a final durable-state
  // guard. This also ensures an immediately following secret cleanup can never
  // hide a failed/overwritten bootstrap commit.
  const expectedBootstrapState = { Role: ROLES.IT_ADMIN, Status: 'Active' };
  const check = findRowInSheet(userSheet, 'Email', email);
  if (!check || !check.PasswordHash) {
    throw new Error('ตรวจทวนรหัสผ่าน Bootstrap ไม่สำเร็จ จึงยังไม่ลบ ADMIN_INIT_PASSWORD');
  }
  if (String(check.Role || '') !== expectedBootstrapState.Role ||
      String(check.Status || '') !== expectedBootstrapState.Status ||
      String(check.Username || '') !== String(outcome.username || '')) {
    throw new Error('สถานะบัญชี Bootstrap ถูกเปลี่ยนก่อลบ ADMIN_INIT_PASSWORD');
  }

  // ADMIN_INIT_PASSWORD is a one-time secret. Delete it only after both the
  // Users row and the success audit entry have been flushed and verified.
  props.deleteProperty('ADMIN_INIT_PASSWORD');
  if (props.getProperty('ADMIN_INIT_PASSWORD')) {
    throw new Error('Bootstrap สำเร็จแล้ว แต่ลบ Script Property ADMIN_INIT_PASSWORD ไม่สำเร็จ ' +
      'กรุณาลบค่านี้ด้วยตนเองทันที');
  }
  return 'ตั้งรหัสผ่านล็อกอินหลังบ้านเรียบร้อย — Username: ' + outcome.username +
    ' — เข้าใช้งานที่ ?page=admin';
}

/** Caller owns ScriptLock. Audit INTENT -> mutate/verify -> Audit SUCCESS. */
function setupCommitBootstrapAdminLocked_(ss, userSheet, userRow, input) {
  const eventId = generateId('BST');
  const targetId = String(userRow.UserID || input.email);
  const original = setupCaptureRowImageLocked_(userSheet, userRow._row);
  const baseDetail = 'event=' + eventId + '; account=' + input.email +
    '; username=' + input.username + '; previousRole=' + String(userRow.Role || '') +
    '; previousStatus=' + String(userRow.Status || '');

  // A durable intent guarantees that a failed rollback can still be
  // investigated. No password, salt or hash is ever written to AuditTrail.
  setupAppendCriticalAuditLocked_(ss, {
    ActorEmail: input.email,
    ActorRole: 'Bootstrap',
    Action: 'BOOTSTRAP_ADMIN_INTENT',
    Module: 'auth',
    TargetSheet: SHEETS.USERS,
    TargetID: targetId,
    Detail: baseDetail,
    Result: 'pending'
  });

  let mutationAttempted = false;
  try {
    mutationAttempted = true;
    setupWriteRowPatchLocked_(original, {
      Username: input.username,
      PasswordSalt: input.salt,
      PasswordHash: input.passwordHash,
      Role: ROLES.IT_ADMIN,
      Status: 'Active',
      LastUpdatedBy: 'bootstrap',
      LastUpdatedAt: new Date()
    });
    setupVerifyRowFieldsLocked_(userSheet, userRow._row, {
      Username: input.username,
      PasswordSalt: input.salt,
      PasswordHash: input.passwordHash,
      Role: ROLES.IT_ADMIN,
      Status: 'Active'
    });

    const successLogId = setupAppendCriticalAuditLocked_(ss, {
      ActorEmail: input.email,
      ActorRole: ROLES.IT_ADMIN,
      Action: 'BOOTSTRAP_ADMIN',
      Module: 'auth',
      TargetSheet: SHEETS.USERS,
      TargetID: targetId,
      Detail: baseDetail + '; committed=true',
      Result: 'success'
    });
    return { username: input.username, eventId: eventId, auditLogId: successLogId };
  } catch (e) {
    const failure = sanitizeText(e && e.message || e, 700);
    let rollbackResult = 'not-required';
    let rollbackError = '';
    if (mutationAttempted) {
      try {
        setupRestoreRowImageLocked_(original);
        setupVerifyRowFieldsLocked_(userSheet, userRow._row,
          setupPickRowFields_(original, ['Username', 'PasswordSalt', 'PasswordHash', 'Role', 'Status']));
        rollbackResult = 'restored';
      } catch (restoreError) {
        rollbackResult = 'failed';
        rollbackError = sanitizeText(restoreError && restoreError.message || restoreError, 500);
      }
    }
    let rollbackAuditError = '';
    try {
      setupAppendCriticalAuditLocked_(ss, {
        ActorEmail: input.email,
        ActorRole: 'Bootstrap',
        Action: 'BOOTSTRAP_ADMIN_ROLLBACK',
        Module: 'auth',
        TargetSheet: SHEETS.USERS,
        TargetID: targetId,
        Detail: baseDetail + '; error=' + failure + '; rollback=' + rollbackResult +
          (rollbackError ? '; rollbackError=' + rollbackError : ''),
        Result: rollbackResult === 'restored' ? 'rolled_back' : 'error'
      });
    } catch (auditError) {
      rollbackAuditError = sanitizeText(auditError && auditError.message || auditError, 500);
    }
    throw new Error('Bootstrap admin ไม่สำเร็จ: ' + failure + '; rollback=' + rollbackResult +
      (rollbackError ? '; rollbackError=' + rollbackError : '') +
      (rollbackAuditError ? '; rollbackAuditError=' + rollbackAuditError : ''));
  }
}

function setupCaptureRowImageLocked_(sh, rowNumber) {
  const headers = setupActualHeaders_(sh);
  const range = sh.getRange(rowNumber, 1, 1, headers.length);
  return {
    sheet: sh,
    rowNumber: rowNumber,
    headers: headers,
    values: range.getValues()[0],
    formulas: range.getFormulas()[0]
  };
}

function setupWriteRowPatchLocked_(image, patch) {
  const next = image.values.map(function (value, index) {
    return image.formulas[index] || value;
  });
  image.headers.forEach(function (header, index) {
    if (Object.prototype.hasOwnProperty.call(patch || {}, header)) {
      next[index] = sheetSafeValue_(patch[header]);
    }
  });
  image.sheet.getRange(image.rowNumber, 1, 1, image.headers.length).setValues([next]);
  SpreadsheetApp.flush();
}

function setupRestoreRowImageLocked_(image) {
  const original = image.values.map(function (value, index) {
    return image.formulas[index] || value;
  });
  image.sheet.getRange(image.rowNumber, 1, 1, image.headers.length).setValues([original]);
  SpreadsheetApp.flush();
}

function setupPickRowFields_(image, fields) {
  const out = {};
  (fields || []).forEach(function (field) {
    const index = image.headers.indexOf(field);
    if (index > -1) out[field] = image.values[index];
  });
  return out;
}

function setupVerifyRowFieldsLocked_(sh, rowNumber, expected) {
  const headers = setupActualHeaders_(sh);
  const values = sh.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  Object.keys(expected || {}).forEach(function (field) {
    const index = headers.indexOf(field);
    if (index === -1) throw new Error('Users header missing: ' + field);
    const actual = values[index];
    const wanted = expected[field];
    const same = actual instanceof Date && wanted instanceof Date ?
      actual.getTime() === wanted.getTime() : String(actual === undefined ? '' : actual) ===
        String(wanted === undefined ? '' : wanted);
    if (!same) throw new Error('Users verification failed: ' + field);
  });
  return true;
}

/** Caller owns ScriptLock. Append by actual headers and verify the durable row. */
function setupAppendCriticalAuditLocked_(ss, record) {
  const sh = ss.getSheetByName(SHEETS.AUDIT_TRAIL);
  if (!sh) throw new Error('AuditTrail sheet is missing');
  const headers = setupActualHeaders_(sh);
  const required = ['LogID', 'Timestamp', 'ActorEmail', 'ActorRole', 'Action', 'Module',
    'TargetSheet', 'TargetID', 'Detail', 'IPHint', 'Result'];
  const missing = required.filter(function (header) { return headers.indexOf(header) === -1; });
  if (missing.length) throw new Error('AuditTrail headers missing: ' + missing.join(','));
  const data = Object.assign({}, record || {}, {
    LogID: generateId('LOG'),
    Timestamp: new Date(),
    IPHint: record && record.IPHint || ''
  });
  const rowNumber = Math.max(2, sh.getLastRow() + 1);
  sh.getRange(rowNumber, 1, 1, headers.length).setValues([headers.map(function (header) {
    return sheetSafeValue_(Object.prototype.hasOwnProperty.call(data, header) ? data[header] : '');
  })]);
  SpreadsheetApp.flush();
  const written = sh.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  const check = {};
  headers.forEach(function (header, index) { check[header] = written[index]; });
  if (String(check.LogID || '') !== String(data.LogID) ||
      String(check.Action || '') !== String(data.Action || '') ||
      String(check.ActorEmail || '').toLowerCase().trim() !== String(data.ActorEmail || '').toLowerCase().trim() ||
      String(check.TargetID || '') !== String(data.TargetID || '') ||
      String(check.Result || '') !== String(data.Result || '')) {
    throw new Error('AuditTrail verification failed for ' + String(data.Action || 'bootstrap'));
  }
  return data.LogID;
}

/**
 * ตรวจวินิจฉัยปัญหาล็อกอิน — รันจาก editor (ส่ง Username หรือเว้นว่างเพื่อค้นหาจากอีเมลผู้รัน)
 * คืนข้อมูล: เจอบัญชีไหม, มีคอลัมน์รหัสผ่านไหม, ตั้งรหัสแล้วหรือยัง, สถานะบัญชี
 */
function diagnoseLogin(username) {
  const runner = assertEditorOwner_();
  username = normalizeUsername_(username);
  const sh = getDB_().getSheetByName(SHEETS.USERS);
  if (!sh) return 'ไม่พบชีต Users — ยังไม่ได้รัน setupSystem';
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const hasHashCol = headers.indexOf('PasswordHash') > -1;
  const hasSaltCol = headers.indexOf('PasswordSalt') > -1;
  const u = username ? findRow_(SHEETS.USERS, 'Username', username) :
    findRow_(SHEETS.USERS, 'Email', String(runner || '').toLowerCase());
  const lines = [
    'Username ที่ตรวจ: ' + (username || (u && u.Username) || '(ว่าง)'),
    'คอลัมน์ใน Users: ' + headers.join(', '),
    'มีคอลัมน์ PasswordHash: ' + hasHashCol,
    'มีคอลัมน์ PasswordSalt: ' + hasSaltCol,
    'พบบัญชีในทะเบียน: ' + (!!u),
    u ? ('สถานะบัญชี (ต้องเป็น Active): ' + u.Status) : '',
    u ? ('ตั้งรหัสผ่านแล้ว: ' + (u.PasswordHash ? 'ใช่' : 'ยัง')) : '',
    u ? ('บทบาท: ' + u.Role) : ''
  ].filter(function (x) { return x; });
  return lines.join('\n');
}

/**
 * ทำให้ชีตมีคอลัมน์ครบตาม schema โดยไม่ทำลายข้อมูลเดิม:
 * - ชีตว่าง/ใหม่ → เขียน header ตาม schema
 * - ชีตที่มีข้อมูล → เติมเฉพาะคอลัมน์ที่ "ขาด" ต่อท้าย (ไม่สลับตำแหน่งคอลัมน์เดิม)
 */
function ensureSheetColumns_(sh, want) {
  if (!sh || !want || !want.length) return;
  if (want.length > sh.getMaxColumns()) {
    sh.insertColumnsAfter(sh.getMaxColumns(), want.length - sh.getMaxColumns());
  }
  if (sh.getLastRow() < 1 || sh.getLastColumn() < 1) {
    sh.getRange(1, 1, 1, want.length).setValues([want])
      .setFontWeight('bold').setBackground('#1a3c6e').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, Math.min(want.length, 12));
    return;
  }
  const cur = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const missing = want.filter(function (h) { return cur.indexOf(h) === -1; });
  if (missing.length) {
    const requiredColumns = cur.length + missing.length;
    if (requiredColumns > sh.getMaxColumns()) {
      sh.insertColumnsAfter(sh.getMaxColumns(), requiredColumns - sh.getMaxColumns());
    }
    sh.getRange(1, cur.length + 1, 1, missing.length).setValues([missing])
      .setFontWeight('bold').setBackground('#1a3c6e').setFontColor('#ffffff');
  }
}

function setupSheetIsBlank_(sh) {
  if (!sh) return false;
  const range = sh.getDataRange();
  const values = range.getValues();
  const formulas = range.getFormulas();
  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      if (values[r][c] !== '' || formulas[r][c] !== '') return false;
    }
  }
  return true;
}

function setupActualHeaders_(sh) {
  if (!sh || sh.getLastColumn() < 1) throw new Error('ไม่พบ header ของชีตสำหรับ seed');
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
}

/** Append by the sheet's actual header order; upgrades never assume DB_SCHEMA order. */
function setupAppendObject_(sh, obj) {
  const headers = setupActualHeaders_(sh);
  sh.getRange(Math.max(2, sh.getLastRow() + 1), 1, 1, headers.length).setValues([
    headers.map(function (header) {
      return sheetSafeValue_(Object.prototype.hasOwnProperty.call(obj || {}, header) ? obj[header] : '');
    })
  ]);
  return sh.getLastRow();
}

function protectAuditSheet(ss) {
  assertEditorOwner_();
  const sh = ss.getSheetByName(SHEETS.AUDIT_TRAIL);
  if (!sh) return;
  let protections = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  if (protections.length === 0) protections = [sh.protect()];
  protections.forEach(function (p) {
    hardenSheetProtection_(p, 'AuditTrail — ห้ามแก้ไข (เขียนผ่านระบบเท่านั้น)');
  });
}

/** ป้องกันชีตข้อมูลระบุตัวบุคคล/ข้อมูลยืนยันตัวตนจาก editor ทั่วไป */
function protectSensitiveSheet_(ss, sheetName, description) {
  assertEditorOwner_();
  const sh = ss.getSheetByName(sheetName);
  if (!sh) return;
  let protections = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  if (protections.length === 0) protections = [sh.protect()];
  protections.forEach(function (p) {
    hardenSheetProtection_(p, description || (sheetName + ' — protected'));
  });
}

function hardenSheetProtection_(protection, description) {
  protection.setDescription(description || 'App LIFE protected sheet');
  if (protection.isWarningOnly && protection.isWarningOnly()) protection.setWarningOnly(false);
  const editors = protection.getEditors ? protection.getEditors() : [];
  if (editors && editors.length) protection.removeEditors(editors);
  if (protection.canDomainEdit && protection.canDomainEdit()) protection.setDomainEdit(false);
  if (protection.setUnprotectedRanges) protection.setUnprotectedRanges([]);
}

function seedInitialAdmin(ss) {
  assertEditorOwner_();
  const sh = ss.getSheetByName(SHEETS.USERS);
  const email = (Session.getEffectiveUser().getEmail() || '').toLowerCase();
  if (!email) return;
  const existing = findRowInSheet(sh, 'Email', email);
  // Ordinary schema/setup reruns must never override an intentional demotion
  // or account suspension. Explicit recovery is performed by
  // bootstrapFirstAdmin(), which is audited and requires an editor identity.
  if (existing) return;
  const now = new Date();
  const obj = {
    UserID: generateId('USR'),
    Username: makeAvailableUsername_(String(email).split('@')[0]),
    Email: email,
    FullName: 'ผู้ดูแลระบบ (ตั้งต้น)',
    Department: 'ส่วนงานเทคโนโลยีและสารสนเทศ',
    Role: ROLES.IT_ADMIN,
    Supervisor: '',
    Status: 'Active',
    Timestamp: now, CreatedBy: 'setup', LastUpdatedBy: 'setup', LastUpdatedAt: now
  };
  setupAppendObject_(sh, obj);
}

/** เติม Username ให้ข้อมูล Users เดิมโดยไม่เปลี่ยน Email หรือความสัมพันธ์ในโมดูลอื่น */
function migrateUsernames_() {
  readSheetObjects_(SHEETS.USERS).forEach(function (row) {
    if (String(row.Username || '').trim()) return;
    const base = String(row.Email || row.EmployeeCode || row.UserID || 'user').split('@')[0];
    updateRow_(SHEETS.USERS, row._row, {
      Username: makeAvailableUsername_(base, row.UserID)
    }, 'setup');
  });
}

function makeAvailableUsername_(base, excludeUserId) {
  base = String(base || 'user').toLowerCase().replace(/[^a-z0-9._-]/g, '').replace(/^[._-]+/, '');
  if (base.length < 3) base = 'user' + base;
  base = base.substring(0, 42);
  let candidate = base;
  let n = 1;
  const rows = readSheetObjects_(SHEETS.USERS);
  while (rows.some(function (r) {
    return String(r.UserID) !== String(excludeUserId || '') &&
      String(r.Username || '').toLowerCase() === candidate;
  })) candidate = base + (n++);
  return candidate;
}

function seedPolicyMapping(ss) {
  assertEditorOwner_();
  const sh = ss.getSheetByName(SHEETS.POLICY_MAP);
  const P1 = 'นโยบายความมั่นคงปลอดภัยทางสารสนเทศ ฉบับปรับปรุงปี 2569';
  const P2 = 'ประมวลแนวปฏิบัติด้านการรักษาความมั่นคงปลอดภัยไซเบอร์ ประจำปี พ.ศ. 2569';
  const rows = [
    ['MAP-000', 'ticket', 'Help Desk/Ticket และการยกระดับเป็น Incident', P1 + ' + ' + P2, 'การรับแจ้งเหตุ/คัดแยก/บันทึกหลักฐาน', 'รับแจ้งปัญหา IT Support พร้อม SLA และยกระดับเป็น Incident เมื่อเข้าข่ายภัยคุกคาม'],
    ['MAP-001', 'asset', 'ทะเบียนทรัพย์สิน/License/Patch', P2, 'หมวด 1 + การควบคุมการเข้าถึงเครื่องแม่ข่าย', 'บันทึก Server/Network/Software พร้อมวันหมดอายุและสถานะ Patch'],
    ['MAP-002', 'dataClass', 'การจัดประเภทและทำลายข้อมูล', P2, 'หมวด 4', 'ระดับชั้นความลับ + workflow ขออนุมัติทำลายข้อมูล'],
    ['MAP-003', 'access', 'คำขอสิทธิ์/RBAC/ทบทวนสิทธิ์', P1, 'การกำหนดอำนาจหน้าที่ + หมวด 3, 5', 'Workflow อนุมัติสิทธิ์ และทบทวนสิทธิ์ตามรอบ'],
    ['MAP-004', 'change', 'การควบคุมการเปลี่ยนแปลงระบบงาน', P1, 'การควบคุมการพัฒนา/แก้ไขระบบ', 'Request→Test→Approve→Deploy พร้อม rollback plan'],
    ['MAP-005', 'backup', 'สำรองข้อมูล/ทดสอบกู้คืน/BCP', P2, 'การสำรองข้อมูล + หมวด 6-7', 'บันทึกผลสำรอง/กู้คืน และทะเบียนแผนฉุกเฉิน'],
    ['MAP-006', 'logging', 'Logging & Monitoring', P2, 'หมวด 12', 'ทะเบียน Log + บันทึกผลการตรวจสอบและ Anomaly'],
    ['MAP-007', 'incident', 'การบริหารจัดการเหตุการณ์', P2, 'การตอบสนองต่อเหตุการณ์ + หมวด 13', 'แจ้งเหตุ→DPO คัดกรอง→ประเมินหน้าที่แจ้งภายนอก→เก็บหลักฐาน→ปิดเคส'],
    ['MAP-008', 'vendor', 'ทะเบียนผู้ให้บริการภายนอก', P1, 'การควบคุมผู้ให้บริการภายนอก', 'สัญญา/วันหมดอายุ/ผลประเมิน'],
    ['MAP-009', 'ai', 'ทะเบียนเครื่องมือ AI', P2, 'หมวด 9', 'AI ที่อนุญาต + ประเภทข้อมูลที่อนุญาต/ห้าม'],
    ['MAP-010', 'cloud', 'ทะเบียนระบบ Cloud', P2, 'หมวด 10', 'Cloud ที่อนุญาต + ระดับข้อมูล + exit plan'],
    ['MAP-011', 'awareness', 'การสร้างความตระหนัก/อบรม', P2, 'หมวด 11', 'แผนอบรมรายไตรมาส + e-sign รับทราบนโยบาย'],
    ['MAP-012', 'evidence', 'ศูนย์รวมหลักฐานตรวจสอบ', P1 + ' + ' + P2, 'ทุกหมวด', 'รวมหลักฐาน + Export PDF/Excel + สุขภาพมาตรการควบคุม'],
    ['MAP-013', 'notification', 'ระบบแจ้งเตือนอัตโนมัติ', P1 + ' + ' + P2, 'ทุกหมวด', 'Time-driven trigger แจ้งเตือนวันครบกำหนด'],
    ['MAP-014', 'auditTrail', 'Audit Trail ของระบบ', P1 + ' + ' + P2, 'สนับสนุนทุกหมวด', 'บันทึก ใคร/ทำอะไร/เมื่อไร/กับข้อมูลใด'],
    ['MAP-015', 'compliance', 'ทะเบียนกฎหมาย/ข้อกำหนด/ผลประเมิน/CAPA', P1 + ' + ' + P2,
      'ธรรมาภิบาลกฎหมาย', 'เชื่อมกฎหมาย→ข้อกำหนด→หลักฐาน→ผลประเมิน→แผนแก้ไข'],
    ['MAP-016', 'privacy', 'RoPA/Consent/Data Subject Request', P1 + ' + ' + P2,
      'PDPA และธรรมาภิบาลข้อมูล', 'ทะเบียนกิจกรรมประมวลผล หลักฐานความยินยอม และคำขอใช้สิทธิ'],
    ['MAP-017', 'problem', 'Problem/Known Error/RCA', P1 + ' + ' + P2,
      'การปรับปรุงอย่างต่อเนื่อง', 'เชื่อมปัญหาซ้ำ Ticket Incident Known Error และแผนแก้ไขถาวร'],
    ['MAP-018', 'vulnerability', 'Vulnerability/Remediation/Verification', P2,
      'การจัดการช่องโหว่', 'ติดตาม CVE/CVSS แผนแก้ไข ข้อยกเว้น และผู้ตรวจยืนยันอิสระ'],
    ['MAP-019', 'audit', 'Audit Engagement/Finding/Corrective Action', P1 + ' + ' + P2,
      'การตรวจสอบภายใน', 'งานตรวจ ข้อตรวจพบ แผนแก้ไข และหลักฐานตรวจยืนยันปิดประเด็น'],
    ['MAP-020', 'cmdb', 'CMDB/Configuration Relationship Map', P1 + ' + ' + P2,
      'Asset และ Configuration Management', 'ทะเบียน CI และความสัมพันธ์กับ Asset Vendor Backup Incident และ Change'],
    ['MAP-021', 'serviceCatalog', 'Service Catalog/Request Fulfilment', P1 + ' + ' + P2,
      'การให้บริการและควบคุมการเข้าถึง', 'นิยามบริการ แบบฟอร์ม SLA การอนุมัติ Checklist Workflow และเงื่อนไขปิดงาน'],
    ['MAP-022', 'workflow', 'Workflow/Approval Engine กลาง', P1 + ' + ' + P2,
      'การแบ่งแยกหน้าที่และหลักฐานการอนุมัติ', 'รองรับลำดับ ขนาน quorum เงื่อนไข delegation reminder escalation และ timeline กลาง'],
    ['MAP-023', 'attachment', 'Attachment Registry และ Download Audit', P1 + ' + ' + P2,
      'การควบคุมหลักฐานและการเข้าถึงข้อมูล', 'ทะเบียนไฟล์ private row-level access checksum legal hold retention และ download audit'],
    ['MAP-024', 'integration', 'Transactional Integration Outbox', P1 + ' + ' + P2,
      'ความถูกต้องครบถ้วนของธุรกรรมข้ามระบบ', 'เชื่อม Service Request กับ Access Ticket Asset และ Change แบบ idempotent/retry ได้']
  ];
  const existing = {};
  const actualHeaders = setupActualHeaders_(sh);
  const idIndex = actualHeaders.indexOf('MapID');
  if (idIndex < 0) throw new Error('PolicyMapping ไม่มีคอลัมน์ MapID');
  const values = sh.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) existing[String(values[i][idIndex])] = true;
  rows.forEach(function (r) {
    if (existing[r[0]]) return;
    const obj = {};
    DB_SCHEMA.PolicyMapping.forEach(function (header, index) { obj[header] = r[index]; });
    setupAppendObject_(sh, obj);
  });
}

/**
 * เติมทะเบียนกฎหมายและข้อกำหนดตั้งต้นแบบ idempotent
 * สถานะ "ต้องยืนยัน" มีเจตนาให้ฝ่ายกฎหมาย/DPO ยืนยัน applicability ก่อนนับเป็นข้อบังคับขององค์กร
 */
function seedLegalCompliance_(ss) {
  assertEditorOwner_();
  const lawSheet = ss.getSheetByName(SHEETS.LEGAL_REGISTER);
  const obligationSheet = ss.getSheetByName(SHEETS.COMPLIANCE_OBLIGATION);
  if (!lawSheet || !obligationSheet) return;

  const laws = [
    {
      LawID: 'LAW-PDPA-2562',
      LawName: 'พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562',
      ShortName: 'PDPA', Authority: 'สำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคล',
      Version: 'พ.ศ. 2562', ApplicabilityStatus: 'ใช้บังคับ',
      ApplicabilityReason: 'องค์กรมีการเก็บ ใช้ หรือเปิดเผยข้อมูลส่วนบุคคลของผู้ใช้และผู้แจ้ง Ticket',
      Owner: 'DPO', SourceURL: 'https://www.pdpc.or.th/', Status: 'ใช้งาน',
      Notes: 'ให้ DPO/ฝ่ายกฎหมายทบทวนฐานกฎหมายและข้อยกเว้นของแต่ละกิจกรรมประมวลผล'
    },
    {
      LawID: 'LAW-CYBER-2562',
      LawName: 'พระราชบัญญัติการรักษาความมั่นคงปลอดภัยไซเบอร์ พ.ศ. 2562',
      ShortName: 'พ.ร.บ.ไซเบอร์', Authority: 'สำนักงานคณะกรรมการการรักษาความมั่นคงปลอดภัยไซเบอร์แห่งชาติ',
      Version: 'พ.ศ. 2562', ApplicabilityStatus: 'ต้องยืนยัน',
      ApplicabilityReason: 'ต้องยืนยันสถานะหน่วยงานของรัฐ หน่วยงานกำกับ หรือ CII กับฝ่ายกฎหมาย/สกมช.',
      Owner: 'ITAdmin', SourceURL: 'https://www.ncsa.or.th/standards/laws', Status: 'ใช้งาน'
    },
    {
      LawID: 'STD-WEB-2568',
      LawName: 'มาตรฐานการรักษาความมั่นคงปลอดภัยสำหรับเว็บไซต์ พ.ศ. 2568',
      ShortName: 'Website Security Standard', Authority: 'สกมช.',
      Version: 'พ.ศ. 2568', ApplicabilityStatus: 'ต้องยืนยัน',
      ApplicabilityReason: 'ใช้กับหน่วยงานรัฐ หน่วยงานกำกับ และ CII; ภาคเอกชนใช้เป็นแนวทางได้',
      Owner: 'ITAdmin', SourceURL: 'https://www.ncsa.or.th/standards', Status: 'ใช้งาน'
    },
    {
      LawID: 'LAW-COMPUTER-2550-2560',
      LawName: 'พระราชบัญญัติว่าด้วยการกระทำความผิดเกี่ยวกับคอมพิวเตอร์ พ.ศ. 2550 และที่แก้ไขเพิ่มเติม',
      ShortName: 'พ.ร.บ.คอมพิวเตอร์', Authority: 'กระทรวงดิจิทัลเพื่อเศรษฐกิจและสังคม',
      Version: 'แก้ไขเพิ่มเติม พ.ศ. 2560', ApplicabilityStatus: 'ต้องยืนยัน',
      ApplicabilityReason: 'หน้าที่เก็บข้อมูลจราจรตามมาตรา 26 ขึ้นกับการเข้าข่ายผู้ให้บริการ',
      Owner: 'ITAdmin',
      SourceURL: 'https://www.etda.or.th/th/Useful-Resource/law/computer-crimes.aspx',
      Status: 'ใช้งาน'
    },
    {
      LawID: 'LAW-ETA-2544',
      LawName: 'พระราชบัญญัติว่าด้วยธุรกรรมทางอิเล็กทรอนิกส์ พ.ศ. 2544 และที่แก้ไขเพิ่มเติม',
      ShortName: 'พ.ร.บ.ธุรกรรมอิเล็กทรอนิกส์', Authority: 'สำนักงานพัฒนาธุรกรรมทางอิเล็กทรอนิกส์',
      Version: 'รวมฉบับแก้ไขเพิ่มเติม', ApplicabilityStatus: 'ใช้เป็นกรอบ',
      ApplicabilityReason: 'รองรับหลักฐานอิเล็กทรอนิกส์ การอนุมัติ และการรับทราบนโยบาย',
      Owner: 'ITAdmin',
      SourceURL: 'https://www.etda.or.th/th/Useful-Resource/law/transactionlaws.aspx',
      Status: 'ใช้งาน'
    },
    {
      LawID: 'REG-OIC-IT-LIFE-2563',
      LawName: 'หลักเกณฑ์การกำกับดูแลและบริหารจัดการความเสี่ยงด้านเทคโนโลยีสารสนเทศของบริษัทประกันชีวิต',
      ShortName: 'หลักเกณฑ์ IT Risk คปภ.', Authority: 'สำนักงาน คปภ.',
      Version: 'พ.ศ. 2563', ApplicabilityStatus: 'ต้องยืนยัน',
      ApplicabilityReason: 'ประกาศใช้กับบริษัทประกันชีวิต ต้องยืนยันขอบเขตที่ใช้โดยตรงกับกองทุนประกันชีวิต',
      Owner: 'ITAdmin', SourceURL: 'https://www.oic.or.th/', Status: 'ใช้งาน'
    }
  ];

  const obligations = [
    {
      ObligationID: 'OBL-PDPA-ROPA', LawID: 'LAW-PDPA-2562', Clause: 'มาตรา 39',
      Requirement: 'จัดทำและรักษาบันทึกรายการกิจกรรมการประมวลผลข้อมูลส่วนบุคคล (ROPA)',
      ControlDomain: 'Privacy Governance', ControlOwner: 'DPO', Frequency: 'ทบทวนอย่างน้อยปีละ 1 ครั้งและเมื่อกระบวนการเปลี่ยน',
      EvidenceRequired: 'ROPA ที่อนุมัติและประวัติการทบทวน', RelatedModule: 'dataClass',
      ApplicabilityStatus: 'ใช้บังคับ', Status: 'เปิด'
    },
    {
      ObligationID: 'OBL-PDPA-BREACH', LawID: 'LAW-PDPA-2562', Clause: 'มาตรา 37',
      Requirement: 'ประเมินเหตุละเมิดและแจ้งสำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคลภายในกรอบเวลาที่กฎหมายกำหนดเมื่อเข้าเงื่อนไข',
      ControlDomain: 'Incident Response', ControlOwner: 'DPO', Frequency: 'ทุกเหตุการณ์',
      EvidenceRequired: 'แบบประเมินความเสี่ยง เหตุผลการตัดสินใจ หลักฐานการแจ้ง และเลขรับเรื่อง',
      RelatedModule: 'incident', ApplicabilityStatus: 'ใช้บังคับ', Status: 'เปิด'
    },
    {
      ObligationID: 'OBL-PDPA-DSAR', LawID: 'LAW-PDPA-2562', Clause: 'มาตรา 30-36',
      Requirement: 'มีช่องทางรับ ตรวจสอบตัวตน ดำเนินการ และติดตามคำขอใช้สิทธิของเจ้าของข้อมูล',
      ControlDomain: 'Data Subject Rights', ControlOwner: 'DPO', Frequency: 'ทุกคำขอ',
      EvidenceRequired: 'ทะเบียนคำขอ การตรวจสอบตัวตน การตอบกลับ และเหตุผลกรณีปฏิเสธ',
      RelatedModule: 'compliance', ApplicabilityStatus: 'ใช้บังคับ', Status: 'เปิด'
    },
    {
      ObligationID: 'OBL-CYBER-RISK', LawID: 'LAW-CYBER-2562', Clause: 'การประเมินความเสี่ยงและมาตรการขั้นต่ำ',
      Requirement: 'ประเมินความเสี่ยงไซเบอร์ กำหนดมาตรการควบคุม และทบทวนตามรอบ',
      ControlDomain: 'Cyber Risk', ControlOwner: 'ITAdmin', Frequency: 'อย่างน้อยปีละ 1 ครั้งและเมื่อมีการเปลี่ยนสำคัญ',
      EvidenceRequired: 'Risk assessment, treatment plan และผลทบทวน', RelatedModule: 'risk',
      ApplicabilityStatus: 'ต้องยืนยัน', Status: 'เปิด'
    },
    {
      ObligationID: 'OBL-CYBER-REPORT', LawID: 'LAW-CYBER-2562', Clause: 'การแจ้งและรายงานภัยคุกคามทางไซเบอร์',
      Requirement: 'ประเมินระดับภัยคุกคามและรายงาน สกมช./หน่วยงานกำกับตามหลักเกณฑ์และกรอบเวลาที่ใช้บังคับ',
      ControlDomain: 'Incident Response', ControlOwner: 'ITAdmin', Frequency: 'ทุกเหตุการณ์ไซเบอร์',
      EvidenceRequired: 'แบบประเมิน แบบรายงาน เลขรับเรื่อง และลำดับเวลาการตอบสนอง',
      RelatedModule: 'incident', ApplicabilityStatus: 'ต้องยืนยัน', Status: 'เปิด'
    },
    {
      ObligationID: 'OBL-WEB-SA', LawID: 'STD-WEB-2568', Clause: 'แบบประเมิน ค1/แผนปรับปรุง ค2',
      Requirement: 'ประเมินความมั่นคงปลอดภัยเว็บไซต์ เก็บหลักฐาน เสนอผู้บริหาร และติดตามรายการที่ต้องปรับปรุง',
      ControlDomain: 'Website Security', ControlOwner: 'ITAdmin', Frequency: 'อย่างน้อยปีละ 1 ครั้ง',
      EvidenceRequired: 'แบบ ค1 หลักฐานประกอบ ผลอนุมัติ และแบบ ค2/CAPA',
      RelatedModule: 'compliance', ApplicabilityStatus: 'ต้องยืนยัน', Status: 'เปิด'
    },
    {
      ObligationID: 'OBL-COMPUTER-LOG', LawID: 'LAW-COMPUTER-2550-2560', Clause: 'มาตรา 26',
      Requirement: 'เก็บรักษาข้อมูลจราจรทางคอมพิวเตอร์และข้อมูลผู้ใช้บริการตามประเภทผู้ให้บริการและระยะเวลาที่กฎหมายกำหนด',
      ControlDomain: 'Logging & Monitoring', ControlOwner: 'ITAdmin', Frequency: 'ต่อเนื่อง',
      EvidenceRequired: 'ทะเบียน Log ค่า retention การเทียบเวลา การควบคุมสิทธิ์ และผลตรวจสอบความครบถ้วน',
      RelatedModule: 'logging', ApplicabilityStatus: 'ต้องยืนยัน', Status: 'เปิด'
    },
    {
      ObligationID: 'OBL-ETA-ESIGN', LawID: 'LAW-ETA-2544', Clause: 'หลักฐานและลายมือชื่ออิเล็กทรอนิกส์',
      Requirement: 'การอนุมัติหรือรับทราบทางอิเล็กทรอนิกส์ต้องเชื่อมโยงตัวบุคคล เจตนา เวลา และเอกสารฉบับที่ลงนาม',
      ControlDomain: 'Electronic Evidence', ControlOwner: 'ITAdmin', Frequency: 'ทุกธุรกรรมที่กำหนด',
      EvidenceRequired: 'ตัวตนผู้ใช้ วันเวลา เวอร์ชันเอกสาร ผลยืนยัน และ Audit Trail',
      RelatedModule: 'awareness', ApplicabilityStatus: 'ใช้เป็นกรอบ', Status: 'เปิด'
    },
    {
      ObligationID: 'OBL-OIC-IT-GOV', LawID: 'REG-OIC-IT-LIFE-2563', Clause: 'IT Governance / IT Risk',
      Requirement: 'กำหนดผู้รับผิดชอบ นโยบาย การบริหารความเสี่ยง และการรายงานต่อผู้บริหาร',
      ControlDomain: 'IT Governance', ControlOwner: 'ITAdmin', Frequency: 'ตามรอบที่ฝ่ายกฎหมายยืนยัน',
      EvidenceRequired: 'นโยบาย มติ/อนุมัติ รายงานความเสี่ยง และแผนแก้ไข',
      RelatedModule: 'compliance', ApplicabilityStatus: 'ต้องยืนยัน', Status: 'เปิด'
    }
  ];

  function appendSeedRows_(sheet, headers, idKey, rows) {
    const existing = {};
    const actualHeaders = setupActualHeaders_(sheet);
    const idIndex = actualHeaders.indexOf(idKey);
    if (idIndex < 0) throw new Error(sheet.getName() + ' ไม่มีคอลัมน์ ' + idKey);
    const values = sheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) existing[String(values[i][idIndex])] = true;
    const now = new Date();
    rows.forEach(function (item) {
      if (existing[String(item[idKey])]) return;
      const row = Object.assign({}, item, {
        Timestamp: now, CreatedBy: 'setup', LastUpdatedBy: 'setup', LastUpdatedAt: now
      });
      setupAppendObject_(sheet, row);
    });
  }

  appendSeedRows_(lawSheet, DB_SCHEMA.LegalRegister, 'LawID', laws);
  appendSeedRows_(obligationSheet, DB_SCHEMA.ComplianceObligations, 'ObligationID', obligations);
}

function seedTicketCategories(ss) {
  assertEditorOwner_();
  const sh = ss.getSheetByName(SHEETS.TICKET_CATEGORY);
  if (!sh || sh.getLastRow() > 1) return;
  const now = new Date();
  const rows = [
    { CategoryID: 'TCAT-001', CategoryName: 'Computer', DefaultPriority: 'ปานกลาง', SLAHours: 24, IsSecurityDefault: 'No', Status: 'Active', Notes: 'เครื่องคอมพิวเตอร์ตั้งโต๊ะ (PC)' },
    { CategoryID: 'TCAT-002', CategoryName: 'Notebook', DefaultPriority: 'ปานกลาง', SLAHours: 24, IsSecurityDefault: 'No', Status: 'Active', Notes: 'โน้ตบุ๊ก/แล็ปท็อป' },
    { CategoryID: 'TCAT-003', CategoryName: 'Printer', DefaultPriority: 'ปานกลาง', SLAHours: 16, IsSecurityDefault: 'No', Status: 'Active', Notes: 'เครื่องพิมพ์/สแกนเนอร์/หมึกพิมพ์' },
    { CategoryID: 'TCAT-004', CategoryName: 'Network', DefaultPriority: 'สูง', SLAHours: 8, IsSecurityDefault: 'No', Status: 'Active', Notes: 'เครือข่าย VPN Wi-Fi หรืออินเทอร์เน็ต' },
    { CategoryID: 'TCAT-005', CategoryName: 'Software', DefaultPriority: 'ปานกลาง', SLAHours: 16, IsSecurityDefault: 'No', Status: 'Active', Notes: 'โปรแกรม/แอปพลิเคชัน/ระบบงาน' },
    { CategoryID: 'TCAT-006', CategoryName: 'Email', DefaultPriority: 'สูง', SLAHours: 8, IsSecurityDefault: 'No', Status: 'Active', Notes: 'อีเมล/บัญชีผู้ใช้/การเข้าใช้งาน' },
    { CategoryID: 'TCAT-007', CategoryName: 'ขอรับบริการ IT', DefaultPriority: 'ปานกลาง', SLAHours: 24, IsSecurityDefault: 'No', Status: 'Active', Notes: 'ขอติดตั้ง/ขอรับบริการ/คำขอทั่วไป' }
  ];
  rows.forEach(function (obj) {
    obj.ResponseSLAHours = obj.DefaultPriority === 'สูง' ? 2 : 4;
    obj.ResolutionSLAHours = obj.SLAHours;
    obj.Timestamp = now;
    obj.CreatedBy = 'setup';
    obj.LastUpdatedBy = 'setup';
    obj.LastUpdatedAt = now;
    setupAppendObject_(sh, obj);
  });
}

/** เติม Service Catalog ตั้งต้นแบบ idempotent — ผู้ดูแลแก้แบบฟอร์ม/SLA/Workflow ได้ภายหลัง */
function seedServiceCatalog_(ss) {
  assertEditorOwner_();
  const sh = ss.getSheetByName(SHEETS.SERVICE_CATALOG);
  if (!sh) return;
  const headers = setupActualHeaders_(sh);
  const existing = {};
  const values = sh.getDataRange().getValues();
  const idIndex = headers.indexOf('CatalogID');
  if (idIndex < 0) throw new Error('ServiceCatalog ไม่มีคอลัมน์ CatalogID');
  for (let i = 1; i < values.length; i++) existing[String(values[i][idIndex])] = true;

  const field = function (key, label, type, required, options) {
    const item = { key:key, label:label, type:type || 'text', required:required !== false };
    if (options && options.length) item.options = options;
    return item;
  };
  const standardWorkflow = ['รออนุมัติ', 'รอมอบหมาย', 'กำลังดำเนินการ',
    'รอผู้ใช้งาน', 'รอผู้ให้บริการ', 'รอยืนยันผล', 'ปิดงาน', 'ปฏิเสธ', 'ยกเลิก'];
  const baseChecklist = [
    { name:'ตรวจสอบข้อมูลและสิทธิ์ผู้ขอ', type:'ตรวจสอบ', required:true, evidenceRequired:false },
    { name:'ดำเนินการตามมาตรฐานบริการ', type:'ดำเนินการ', required:true, evidenceRequired:false },
    { name:'ทดสอบผลและแนบหลักฐาน', type:'ทดสอบ/หลักฐาน', required:true, evidenceRequired:true },
    { name:'แจ้งผู้ขอเพื่อยืนยันผล', type:'แจ้งผล', required:true, evidenceRequired:false }
  ];
  const rows = [
    {
      CatalogID:'SVC-CAT-001', ServiceCode:'ACCOUNT_CREATE', ServiceName:'ขอสร้างบัญชี', Category:'บัญชีและสิทธิ์',
      Description:'สร้างบัญชีผู้ใช้สำหรับระบบงานที่ได้รับอนุมัติ', SLAHours:16, ApprovalMode:'หัวหน้างาน',
      FormSchemaJSON:JSON.stringify([field('system','ระบบงาน','text'), field('requestedRole','บทบาท/ระดับสิทธิ์','text'), field('startDate','วันที่ต้องการเริ่มใช้','date')])
    },
    {
      CatalogID:'SVC-CAT-002', ServiceCode:'ACCESS_MODIFY', ServiceName:'ขอแก้ไขสิทธิ์', Category:'บัญชีและสิทธิ์',
      Description:'เพิ่มหรือลดสิทธิ์ในระบบงาน', SLAHours:16, ApprovalMode:'หัวหน้างาน',
      FormSchemaJSON:JSON.stringify([field('system','ระบบงาน','text'), field('currentAccess','สิทธิ์ปัจจุบัน','text'), field('requestedAccess','สิทธิ์ที่ต้องการ','text')])
    },
    {
      CatalogID:'SVC-CAT-003', ServiceCode:'ACCESS_REVOKE', ServiceName:'ขอถอนสิทธิ์', Category:'บัญชีและสิทธิ์',
      Description:'ถอนหรือระงับสิทธิ์ผู้ใช้งาน', SLAHours:8, ApprovalMode:'หัวหน้างาน',
      FormSchemaJSON:JSON.stringify([field('system','ระบบงาน','text'), field('account','บัญชีที่ต้องการถอน','text'), field('effectiveDate','วันที่มีผล','date')])
    },
    {
      CatalogID:'SVC-CAT-004', ServiceCode:'SOFTWARE_INSTALL', ServiceName:'ขอติดตั้งโปรแกรม', Category:'Software',
      Description:'ตรวจสอบ License และติดตั้ง Software ที่ได้รับอนุญาต', SLAHours:16, ApprovalMode:'หัวหน้างาน',
      FormSchemaJSON:JSON.stringify([field('software','ชื่อโปรแกรม','text'), field('assetCode','รหัสเครื่อง/Asset','text'), field('version','Version ที่ต้องการ','text',false)])
    },
    {
      CatalogID:'SVC-CAT-005', ServiceCode:'IT_EQUIPMENT', ServiceName:'ขออุปกรณ์ IT', Category:'อุปกรณ์',
      Description:'ขอจัดสรรอุปกรณ์ IT สำหรับการปฏิบัติงาน', SLAHours:24, ApprovalMode:'หัวหน้างาน',
      FormSchemaJSON:JSON.stringify([field('equipmentType','ประเภทอุปกรณ์','select',true,['Notebook','Desktop','Monitor','Printer','อุปกรณ์เสริม']), field('neededDate','วันที่ต้องการใช้','date'), field('specification','Specification/เหตุผลเพิ่มเติม','textarea',false)])
    },
    {
      CatalogID:'SVC-CAT-006', ServiceCode:'EQUIPMENT_BORROW', ServiceName:'ขอยืมอุปกรณ์', Category:'อุปกรณ์',
      Description:'ยืมอุปกรณ์ IT ชั่วคราวพร้อมกำหนดคืน', SLAHours:8, ApprovalMode:'หัวหน้างาน',
      FormSchemaJSON:JSON.stringify([field('equipmentType','ประเภทอุปกรณ์','text'), field('borrowDate','วันที่ยืม','date'), field('returnDate','วันที่คืน','date')])
    },
    {
      CatalogID:'SVC-CAT-007', ServiceCode:'VPN_ACCESS', ServiceName:'ขอ VPN', Category:'Network',
      Description:'ขอสิทธิ์เชื่อมต่อเครือข่ายจากภายนอก', SLAHours:8, ApprovalMode:'หัวหน้างาน',
      FormSchemaJSON:JSON.stringify([field('device','เครื่องที่ใช้เชื่อมต่อ','text'), field('accessSystems','ระบบที่ต้องเข้าใช้','textarea'), field('period','ระยะเวลาที่ต้องการ','text')])
    },
    {
      CatalogID:'SVC-CAT-008', ServiceCode:'STORAGE_QUOTA', ServiceName:'ขอพื้นที่จัดเก็บข้อมูล', Category:'Storage',
      Description:'ขอพื้นที่จัดเก็บหรือเพิ่ม Quota ตามระดับชั้นข้อมูล', SLAHours:16, ApprovalMode:'หัวหน้างาน',
      FormSchemaJSON:JSON.stringify([field('storageType','ประเภทพื้นที่','select',true,['Shared Drive','File Server','Cloud Storage']), field('sizeGb','ขนาดที่ต้องการ (GB)','number'), field('dataClass','ระดับชั้นข้อมูล','select',true,['สาธารณะ','ใช้ภายใน','ลับ','ลับมาก'])])
    },
    {
      CatalogID:'SVC-CAT-009', ServiceCode:'FIREWALL_PORT', ServiceName:'ขอเปิด Port', Category:'Network',
      Description:'ขอ Firewall rule/Port พร้อมเหตุผลและระยะเวลา', SLAHours:16, ApprovalMode:'หัวหน้างาน',
      FormSchemaJSON:JSON.stringify([field('source','Source IP/Network','text'), field('destination','Destination IP/Host','text'), field('portProtocol','Port/Protocol','text'), field('expiryDate','วันสิ้นสุด Rule','date',false)])
    },
    {
      CatalogID:'SVC-CAT-010', ServiceCode:'EMAIL_ACCOUNT', ServiceName:'ขอ Email', Category:'บัญชีและสิทธิ์',
      Description:'สร้างหรือปรับปรุง Email/Distribution List', SLAHours:16, ApprovalMode:'หัวหน้างาน',
      FormSchemaJSON:JSON.stringify([field('emailType','ประเภท','select',true,['User Mailbox','Shared Mailbox','Distribution List']), field('preferredName','ชื่อที่ต้องการ','text'), field('members','สมาชิก/ผู้รับผิดชอบ','textarea',false)])
    },
    {
      CatalogID:'SVC-CAT-011', ServiceCode:'SHARED_FOLDER', ServiceName:'ขอ Shared Folder', Category:'Storage',
      Description:'สร้าง Shared Folder และกำหนดกลุ่มผู้มีสิทธิ์', SLAHours:16, ApprovalMode:'หัวหน้างาน',
      FormSchemaJSON:JSON.stringify([field('folderName','ชื่อ Folder','text'), field('members','ผู้ใช้งาน/กลุ่ม','textarea'), field('accessLevel','ระดับสิทธิ์','select',true,['Read','Modify','Owner']), field('dataClass','ระดับชั้นข้อมูล','select',true,['ใช้ภายใน','ลับ','ลับมาก'])])
    },
    {
      CatalogID:'SVC-CAT-012', ServiceCode:'IT_CONSULT', ServiceName:'ขอคำปรึกษา IT', Category:'Consulting',
      Description:'ขอคำปรึกษาด้านระบบ อุปกรณ์ ความมั่นคงปลอดภัย หรือโครงการ IT', SLAHours:8, ApprovalMode:'ไม่ต้องอนุมัติ',
      FormSchemaJSON:JSON.stringify([field('topic','หัวข้อที่ต้องการปรึกษา','text'), field('preferredDate','วันที่สะดวก','date',false), field('context','บริบท/คำถาม','textarea')])
    }
  ];

  const now = new Date();
  rows.forEach(function (item) {
    if (existing[item.CatalogID]) return;
    const row = Object.assign({
      Eligibility:'ทั้งหมด', AttachmentRequired:'No', FulfillmentGroup:'IT Support',
      ChecklistJSON:JSON.stringify(baseChecklist), WorkflowJSON:JSON.stringify(standardWorkflow),
      CloseMode:'ผู้ขอยืนยัน', CloseCondition:'งานย่อยที่บังคับต้องเสร็จและผู้ขอยืนยันผล',
      Status:'ใช้งาน', Version:1, PublishedAt:now, Owner:'ITAdmin', Notes:'Seed จาก setupSystem',
      Timestamp:now, CreatedBy:'setup', LastUpdatedBy:'setup', LastUpdatedAt:now
    }, item);
    setupAppendObject_(sh, row);
  });
}

/**
 * Seed Workflow/Action Permission foundation แบบ idempotent.
 * นิยามตั้งต้นใช้ CONTEXT.approverEmail เพื่อคง routing ของ Service Catalog เดิม
 * แต่ transaction/decision/timeline ถูกย้ายมาอยู่ใน engine กลาง
 */
function seedWorkflowFoundation_(ss) {
  assertEditorOwner_();
  const now = new Date();
  const defSheet = ss.getSheetByName(SHEETS.WORKFLOW_DEFINITION);
  const stepSheet = ss.getSheetByName(SHEETS.WORKFLOW_STEP);
  if (!defSheet || !stepSheet) return;

  const defExists = findRowInSheet(defSheet, 'DefinitionID', 'WF-DEF-SERVICE-APPROVAL');
  if (!defExists) {
    const obj = {
      DefinitionID: 'WF-DEF-SERVICE-APPROVAL', WorkflowCode: 'WF-SERVICE-APPROVAL',
      WorkflowName: 'การอนุมัติคำขอบริการมาตรฐาน', ModuleKey: 'serviceCatalog',
      Description: 'ผู้อนุมัติจาก snapshot ของ Service Catalog; รองรับ delegation/reminder/escalation กลาง',
      Version: 1, TriggerEvent: 'SERVICE_REQUEST_SUBMITTED', Mode: 'SEQUENTIAL',
      ConditionsJSON: '{}', SLAHours: 24, ReminderHours: 4, EscalationHours: 8,
      EscalationRole: 'ITAdmin', IsDefault: 'Yes', Status: 'ใช้งาน', Revision: 1,
      Notes: 'P3 seed', Timestamp: now, CreatedBy: 'setup', LastUpdatedBy: 'setup', LastUpdatedAt: now
    };
    setupAppendObject_(defSheet, obj);
  }
  const stepExists = findRowInSheet(stepSheet, 'StepID', 'WF-STEP-SERVICE-APPROVER');
  if (!stepExists) {
    const obj = {
      StepID: 'WF-STEP-SERVICE-APPROVER', DefinitionID: 'WF-DEF-SERVICE-APPROVAL', DefinitionVersion: 1,
      StepOrder: 1, StepCode: 'SERVICE_APPROVER', StepName: 'ผู้อนุมัติคำขอบริการ',
      ApprovalType: 'CONTEXT', ApproverValue: 'approverEmail', Mode: 'ANY', MinApprovals: 1,
      ConditionJSON: '{}', SLAHours: 24, ReminderHours: 4, EscalationHours: 8,
      EscalationApprover: 'ROLE:ITAdmin', AllowDelegation: 'Yes', AllowReturn: 'No',
      Status: 'ใช้งาน', Notes: 'P3 seed', Timestamp: now, CreatedBy: 'setup',
      LastUpdatedBy: 'setup', LastUpdatedAt: now
    };
    setupAppendObject_(stepSheet, obj);
  }

  // เปลี่ยน fallback code policy ให้เป็นข้อมูลที่ตรวจสอบ/ปรับได้ โดยไม่เปิด unknown key
  const permissionSheet = ss.getSheetByName(SHEETS.ACTION_PERMISSION);
  const roleSheet = ss.getSheetByName(SHEETS.ROLE_ACTION_PERMISSION);
  if (permissionSheet && roleSheet && typeof AP_PERMISSION_FALLBACK_ !== 'undefined') {
    const permissions = readSheetObjectsEnsured_(SHEETS.ACTION_PERMISSION, true);
    const roles = readSheetObjectsEnsured_(SHEETS.ROLE_ACTION_PERMISSION, true);
    let roleSequence = roles.length + 1;
    Object.keys(AP_PERMISSION_FALLBACK_).sort().forEach(function (key) {
      const item = AP_PERMISSION_FALLBACK_[key];
      if (!permissions.some(function (row) { return String(row.PermissionKey) === key; })) {
        const obj = { PermissionKey:key, ModuleKey:item.moduleKey, Action:item.action,
          Description:item.description, Status:'Active', Timestamp:now, CreatedBy:'setup',
          LastUpdatedBy:'setup', LastUpdatedAt:now };
        setupAppendObject_(permissionSheet, obj);
      }
      (item.roles || []).forEach(function (role) {
        if (roles.some(function (row) { return String(row.Role) === role && String(row.PermissionKey) === key; })) return;
        const obj = { MappingID:'RAP-SEED-' + String(roleSequence++).padStart(3, '0'), Role:role,
          PermissionKey:key, Effect:'ALLOW', Status:'Active', Notes:'P3 seed', Timestamp:now,
          CreatedBy:'setup', LastUpdatedBy:'setup', LastUpdatedAt:now };
        setupAppendObject_(roleSheet, obj);
      });
    });
  }

  // กลุ่ม escalation เริ่มต้น ใช้สมาชิก Active ที่เป็น ITAdmin เท่านั้น
  const groupSheet = ss.getSheetByName(SHEETS.APPROVAL_GROUP);
  const memberSheet = ss.getSheetByName(SHEETS.APPROVAL_GROUP_MEMBER);
  if (groupSheet && memberSheet) {
    const admins = readSheetObjectsEnsured_(SHEETS.USERS, true).filter(function (row) {
      return String(row.Role) === ROLES.IT_ADMIN && String(row.Status).toLowerCase() === 'active';
    });
    const owner = admins.length ? String(admins[0].Email || '').toLowerCase() : '';
    if (!findRowInSheet(groupSheet, 'GroupID', 'APG-IT-ADMINS')) {
      const group = { GroupID:'APG-IT-ADMINS', GroupCode:'IT_ADMINS', GroupName:'ผู้ดูแลระบบไอที',
        Department:'ส่วนงานเทคโนโลยีและสารสนเทศ', Description:'กลุ่ม escalation Workflow',
        Status:'Active', OwnerEmail:owner, Notes:'P3 seed', Timestamp:now, CreatedBy:'setup',
        LastUpdatedBy:'setup', LastUpdatedAt:now };
      setupAppendObject_(groupSheet, group);
    }
    const existingMembers = readSheetObjectsEnsured_(SHEETS.APPROVAL_GROUP_MEMBER, true);
    admins.forEach(function (admin, index) {
      const email = String(admin.Email || '').toLowerCase();
      if (existingMembers.some(function (row) {
        return String(row.GroupID) === 'APG-IT-ADMINS' &&
          String(row.UserEmail || '').toLowerCase() === email && String(row.Status || '') === 'Active';
      })) return;
      const member = { MemberID:generateId('APGM'), GroupID:'APG-IT-ADMINS',
        UserEmail:email, MemberRole:index === 0 ? 'PRIMARY' : 'MEMBER',
        Priority:index + 1, Status:'Active', Notes:'P3 seed', Timestamp:now, CreatedBy:'setup',
        LastUpdatedBy:'setup', LastUpdatedAt:now };
      setupAppendObject_(memberSheet, member);
    });
  }
}

/**
 * Backfill the immutable step-generation marker for early/legacy P3 data.
 * Blank rows inherit the currently committed parent definition version. The
 * migration is additive, lock-protected, audited before mutation and verified.
 */
function migrateWorkflowStepVersionsP3_(ss) {
  assertEditorOwner_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = ss.getSheetByName(SHEETS.WORKFLOW_STEP);
    if (!sh || sh.getLastRow() < 2) return 0;
    const headers = setupActualHeaders_(sh);
    const definitionIndex = headers.indexOf('DefinitionID');
    const versionIndex = headers.indexOf('DefinitionVersion');
    const statusIndex = headers.indexOf('Status');
    if (definitionIndex < 0 || versionIndex < 0 || statusIndex < 0) {
      throw new Error('WorkflowSteps headers ไม่ครบสำหรับ DefinitionVersion migration');
    }
    const definitions = {};
    readSheetObjectsEnsured_(SHEETS.WORKFLOW_DEFINITION, true).forEach(function (row) {
      definitions[String(row.DefinitionID || '')] = Math.max(1, parseInt(row.Version, 10) || 1);
    });
    const count = sh.getLastRow() - 1;
    const values = sh.getRange(2, 1, count, headers.length).getValues();
    const formulas = sh.getRange(2, 1, count, headers.length).getFormulas();
    const byVersion = {}, planned = {}, unresolvedActive = [];
    let changed = 0;
    let column = versionIndex + 1, columnA1 = '';
    while (column > 0) {
      column--;
      columnA1 = String.fromCharCode(65 + (column % 26)) + columnA1;
      column = Math.floor(column / 26);
    }
    values.forEach(function (row, index) {
      if (String(row[versionIndex] || '').trim() || String(formulas[index][versionIndex] || '').trim()) return;
      const definitionId = String(row[definitionIndex] || '');
      const version = definitions[definitionId];
      if (!version) {
        if (String(row[statusIndex] || '') === 'ใช้งาน') unresolvedActive.push(definitionId || ('row ' + (index + 2)));
        return;
      }
      if (!byVersion[version]) byVersion[version] = [];
      byVersion[version].push(columnA1 + String(index + 2));
      planned[index] = version;
      changed++;
    });
    if (unresolvedActive.length) {
      throw new Error('พบ WorkflowSteps ที่ใช้งานแต่ไม่มี parent definition: ' + unresolvedActive.slice(0, 10).join(','));
    }
    if (!changed) return 0;
    setupAppendCriticalAuditLocked_(ss, {
      ActorEmail:'migration-v1.11', ActorRole:'system', Action:'MIGRATE_WORKFLOW_STEP_VERSION_INTENT',
      Module:'workflow', TargetSheet:SHEETS.WORKFLOW_STEP, TargetID:'DefinitionVersion',
      Detail:'rows=' + changed, Result:'pending'
    });
    Object.keys(byVersion).forEach(function (version) {
      const addresses = byVersion[version];
      for (let offset = 0; offset < addresses.length; offset += 200) {
        sh.getRangeList(addresses.slice(offset, offset + 200)).setValue(Number(version));
      }
    });
    SpreadsheetApp.flush();
    const verified = sh.getRange(2, versionIndex + 1, count, 1).getValues();
    Object.keys(planned).forEach(function (index) {
      if (Number(verified[Number(index)][0] || 0) !== Number(planned[index])) {
        throw new Error('ตรวจสอบ WorkflowSteps.DefinitionVersion ไม่สำเร็จที่ row ' + (Number(index) + 2));
      }
    });
    setupAppendCriticalAuditLocked_(ss, {
      ActorEmail:'migration-v1.11', ActorRole:'system', Action:'MIGRATE_WORKFLOW_STEP_VERSION',
      Module:'workflow', TargetSheet:SHEETS.WORKFLOW_STEP, TargetID:'DefinitionVersion',
      Detail:'rows=' + changed, Result:'success'
    });
    return changed;
  } finally {
    lock.releaseLock();
  }
}

/** เติม routing P3 เฉพาะช่องว่าง ไม่ทับค่าที่ผู้ดูแลกำหนดเอง */
function migrateServiceCatalogP3_(ss) {
  assertEditorOwner_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    let changed = 0;
    const catalogSheet = ss.getSheetByName(SHEETS.SERVICE_CATALOG);
    if (!catalogSheet) throw new Error('ServiceCatalog sheet is missing');
    const routes = {
    ACCOUNT_CREATE:      { target:'access', auto:'No', mapping:{} },
    ACCESS_MODIFY:       { target:'access', auto:'No', mapping:{} },
    ACCESS_REVOKE:       { target:'access', auto:'No', mapping:{} },
    SOFTWARE_INSTALL:    { target:'ticket', auto:'Yes', mapping:{ fields:{ category:'Software' } } },
    IT_EQUIPMENT:        { target:'asset', auto:'No', mapping:{} },
    EQUIPMENT_BORROW:    { target:'asset', auto:'No', mapping:{} },
    VPN_ACCESS:          { target:'access', auto:'Yes', mapping:{} },
    STORAGE_QUOTA:       { target:'ticket', auto:'Yes', mapping:{ fields:{ category:'ขอรับบริการ IT' } } },
    FIREWALL_PORT:       { target:'change', auto:'Yes', mapping:{ fields:{ system:'$details.destination', changeType:'Standard' } } },
    EMAIL_ACCOUNT:       { target:'access', auto:'Yes', mapping:{} },
    SHARED_FOLDER:       { target:'access', auto:'No', mapping:{ fields:{ system:'Google Workspace', accessLevel:'Standard' } } },
    IT_CONSULT:          { target:'ticket', auto:'Yes', mapping:{ fields:{ category:'ขอรับบริการ IT' } } }
    };
    readSheetObjectsEnsured_(SHEETS.SERVICE_CATALOG, true).forEach(function (row) {
    const route = routes[String(row.ServiceCode || '').toUpperCase()] || null;
    const patch = {};
    if (String(row.ApprovalMode || '') !== 'ไม่ต้องอนุมัติ' && !String(row.WorkflowDefinitionID || '').trim()) {
      patch.WorkflowDefinitionID = 'WF-DEF-SERVICE-APPROVAL';
    }
    if (route) {
      if (!String(row.FulfillmentTarget || '').trim()) patch.FulfillmentTarget = route.target;
      if (!String(row.AutoCreateTarget || '').trim()) patch.AutoCreateTarget = route.auto;
      if (!String(row.TargetMappingJSON || '').trim()) patch.TargetMappingJSON = JSON.stringify(route.mapping);
    }
    if (Object.keys(patch).length) {
      patch.Version = (parseInt(row.Version, 10) || 1) + 1;
      patch.Notes = (String(row.Notes || '') ? String(row.Notes) + '\n' : '') +
        '[migration-v1.11] added Workflow/Integration routing; existing transactions are not backfilled';
      setupAppendCriticalAuditLocked_(ss, {
        ActorEmail:'migration-v1.11', ActorRole:'system', Action:'MIGRATE_CATALOG_P3_INTENT',
        Module:'serviceCatalog', TargetSheet:SHEETS.SERVICE_CATALOG, TargetID:row.CatalogID,
        Detail:'version=' + patch.Version + ', fields=' + Object.keys(patch).join(','), Result:'pending'
      });
      const image = setupCaptureRowImageLocked_(catalogSheet, row._row);
      const writePatch = Object.assign({}, patch);
      if (image.headers.indexOf('LastUpdatedBy') > -1) writePatch.LastUpdatedBy = 'migration-v1.11';
      if (image.headers.indexOf('LastUpdatedAt') > -1) writePatch.LastUpdatedAt = new Date();
      setupWriteRowPatchLocked_(image, writePatch);
      setupVerifyRowFieldsLocked_(catalogSheet, row._row, writePatch);
      setupAppendCriticalAuditLocked_(ss, {
        ActorEmail:'migration-v1.11', ActorRole:'system', Action:'MIGRATE_CATALOG_P3',
        Module:'serviceCatalog', TargetSheet:SHEETS.SERVICE_CATALOG, TargetID:row.CatalogID,
        Detail:'version=' + patch.Version + ', fields=' + Object.keys(patch).join(','), Result:'success'
      });
      changed++;
    }
    });
    return changed;
  } finally {
    lock.releaseLock();
  }
}

function migrateTicketSlaSchema_() {
  let changed = 0;
  ensureSheetBySchema_(SHEETS.TICKET_CATEGORY);
  ensureSheetBySchema_(SHEETS.TICKET);
  readSheetObjectsEnsured_(SHEETS.TICKET_CATEGORY, true).forEach(function (row) {
    const resolution = parseInt(row.ResolutionSLAHours || row.SLAHours, 10) || 24;
    const response = parseInt(row.ResponseSLAHours, 10) ||
      (String(row.DefaultPriority) === 'วิกฤต' ? 1 : (String(row.DefaultPriority) === 'สูง' ? 2 : 4));
    if (!row.ResponseSLAHours || !row.ResolutionSLAHours) {
      updateRow_(SHEETS.TICKET_CATEGORY, row._row, {
        ResponseSLAHours: response,
        ResolutionSLAHours: resolution,
        SLAHours: resolution
      }, 'setup');
      changed++;
    }
  });
  readSheetObjectsEnsured_(SHEETS.TICKET, true).forEach(function (row) {
    const category = getTicketCategoryByName_(row.Category) || {};
    const resolution = parseInt(row.ResolutionSLAHours || row.SLAHours ||
      category.ResolutionSLAHours || category.SLAHours, 10) || 24;
    const response = parseInt(row.ResponseSLAHours || category.ResponseSLAHours, 10) || 4;
    if (!row.ResponseSLAHours || !row.ResolutionSLAHours || !row.ResponseDueAt) {
      const start = row.Timestamp instanceof Date ? row.Timestamp : new Date(row.Timestamp || new Date());
      const patch = {
        ResponseSLAHours: response,
        ResponseDueAt: addBusinessHours_(start, response),
        ResolutionSLAHours: resolution,
        SLAHours: resolution
      };
      if (!isTicketTerminal_(row.Status)) patch.DueAt = addBusinessHours_(start, resolution);
      updateRow_(SHEETS.TICKET, row._row, patch, 'setup');
      changed++;
    }
  });
  return changed;
}

/** helper เฉพาะ setup (ไม่พึ่ง getDB_ เพราะ property อาจยังไม่ครบ) */
function findRowInSheet(sh, keyCol, keyVal) {
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return null;
  const headers = values[0];
  const idx = headers.indexOf(keyCol);
  if (idx === -1) return null;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idx]).toLowerCase() === String(keyVal).toLowerCase()) {
      const row = { _row: i + 1 };
      headers.forEach(function (header, column) { if (header) row[header] = values[i][column]; });
      return row;
    }
  }
  return null;
}

/** ตั้ง Trigger รายวัน 07:00 เรียก dailyNotificationCheck_ (ลบของเดิมก่อนกันซ้ำ) */
function ensureDailyTrigger() {
  assertEditorOwner_();
  const handlers = ScriptApp.getProjectTriggers();
  handlers.forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyNotificationCheck' || t.getHandlerFunction() === 'dailyNotificationCheck_') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('dailyNotificationCheck_')
    .timeBased().everyDays(1).atHour(7).create();
}

/** ตั้ง Trigger รายเดือน (วันที่ 1 เวลา 08:00) ส่งรายงานสรุปให้ผู้บริหาร (ลบของเดิมก่อนกันซ้ำ) */
function ensureMonthlyReportTrigger() {
  assertEditorOwner_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'monthlyExecutiveReport_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('monthlyExecutiveReport_')
    .timeBased().onMonthDay(1).atHour(8).create();
}

/** Trigger งาน Production: LINE retry, backup, restore drill, retention และ live health รายวัน */
function ensureOperationalTriggers() {
  assertEditorOwner_();
  const handlers = [
    'processNotificationQueue_',
    'scheduledSystemBackup_',
    'monthlyRestoreDrill_',
    'dailyRetentionMaintenance_',
    'scheduledLiveHealthCheck_',
    'scheduledWorkflowAutomation_'
  ];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (handlers.indexOf(t.getHandlerFunction()) > -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processNotificationQueue_').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('scheduledSystemBackup_').timeBased().everyDays(1).atHour(2).create();
  ScriptApp.newTrigger('monthlyRestoreDrill_').timeBased().onMonthDay(2).atHour(3).create();
  ScriptApp.newTrigger('dailyRetentionMaintenance_').timeBased().everyDays(1).atHour(4).create();
  ScriptApp.newTrigger('scheduledLiveHealthCheck_').timeBased().everyDays(1).atHour(6).create();
  ScriptApp.newTrigger('scheduledWorkflowAutomation_').timeBased().everyHours(1).create();
}

function assertEditorOwner_() {
  const active = (Session.getActiveUser().getEmail() || '').toLowerCase();
  const effective = (Session.getEffectiveUser().getEmail() || '').toLowerCase();
  if (!effective || active !== effective) {
    throw new Error('ฟังก์ชันนี้ต้องรันจาก Apps Script editor ด้วยบัญชีเจ้าของ/ผู้ deploy เท่านั้น');
  }
  return effective;
}

// ===================================================================
// ข้อมูลตัวอย่าง (Sample Data) — รันครั้งเดียวหลัง setupSystem
// วิธีใช้: เลือกฟังก์ชัน seedSampleData แล้ว Run
// กันการเพิ่มซ้ำ: ถ้าเจอ ID ตัวอย่างตัวแรกของแต่ละชีตแล้วจะข้าม
// ===================================================================
function seedSampleData() {
  assertEditorOwner_();
  getDB_(); // ตรวจว่าตั้งค่า DB แล้ว
  const report = [];
  report.push(seedVendorsSample_());
  report.push(seedAssetsSample_());
  report.push(seedAssetHistorySample_());
  report.push(seedMaintenanceSample_());
  report.push(seedInventorySample_());
  report.push(seedLicensesSample_());
  report.push(seedTicketsSample_());
  return 'เพิ่มข้อมูลตัวอย่างเสร็จสิ้น:\n' + report.join('\n');
}

/** ลบข้อมูลตัวอย่างทั้งหมด (ลบเฉพาะแถวที่ CreatedBy = 'seed') */
function clearSampleData() {
  assertEditorOwner_();
  const sheets = [SHEETS.VENDOR, SHEETS.ASSET, SHEETS.ASSET_MOVEMENT, SHEETS.MAINTENANCE,
    SHEETS.INVENTORY, SHEETS.INVENTORY_TX, SHEETS.SOFTWARE_LICENSE, SHEETS.TICKET, SHEETS.TICKET_WORKLOG];
  let removed = 0;
  sheets.forEach(function (name) {
    const sh = getDB_().getSheetByName(name);
    if (!sh) return;
    const values = sh.getDataRange().getValues();
    if (values.length < 2) return;
    const cbIdx = values[0].indexOf('CreatedBy');
    if (cbIdx === -1) return;
    for (let i = values.length - 1; i >= 1; i--) {
      if (String(values[i][cbIdx]) === 'seed') { sh.deleteRow(i + 1); removed++; }
    }
  });
  return 'ลบข้อมูลตัวอย่าง ' + removed + ' แถว';
}

function sampleDate_(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d;
}

/** เพิ่มแถวตัวอย่างถ้ายังไม่มี (ตรวจจาก ID ตัวแรก) */
function seedRows_(sheetName, keyCol, firstKey, rows, label) {
  ensureSheetBySchema_(sheetName);
  if (findRowEnsured_(sheetName, keyCol, firstKey)) return label + ': ข้าม (มีตัวอย่างแล้ว)';
  rows.forEach(function (r) { appendRowEnsured_(sheetName, r, 'seed'); });
  return label + ': เพิ่ม ' + rows.length + ' รายการ';
}

function seedVendorsSample_() {
  const rows = [
    { VendorID: 'VND-S001', VendorName: 'บริษัท ไอที โซลูชั่น จำกัด', ServiceType: 'ร้านซ่อม', ServiceScope: 'ซ่อม/บำรุงรักษาคอมพิวเตอร์และโน้ตบุ๊ก', ContractNo: 'CT-2569-001', ContractStart: sampleDate_(-220), ContractExpiry: sampleDate_(150), ContactPerson: 'คุณวิชัย ใจดี', Phone: '02-111-2222', Email: 'service@itsolution.co.th', Status: 'Active', Notes: 'ผู้รับเหมาดูแลเครื่องลูกข่าย' },
    { VendorID: 'VND-S002', VendorName: 'Microsoft (Thailand)', ServiceType: 'Software', ServiceScope: 'สิทธิ์ใช้งาน Windows / Microsoft 365', ContractNo: 'MS-2569-014', ContractStart: sampleDate_(-120), ContractExpiry: sampleDate_(240), ContactPerson: 'Partner Support', Phone: '02-263-6888', Email: 'support@microsoft.com', Status: 'Active', Notes: '' },
    { VendorID: 'VND-S003', VendorName: 'บริษัท เน็ตเวิร์ค โปร จำกัด', ServiceType: 'Internet Provider', ServiceScope: 'วงจรอินเทอร์เน็ตองค์กร 1 Gbps', ContractNo: 'NET-2569-007', ContractStart: sampleDate_(-300), ContractExpiry: sampleDate_(25), ContactPerson: 'คุณสุรชัย', Phone: '02-555-7777', Email: 'noc@networkpro.co.th', Status: 'Active', Notes: 'สัญญาใกล้หมด ควรต่ออายุ' },
    { VendorID: 'VND-S004', VendorName: 'บริษัท พรินเตอร์ เซอร์วิส จำกัด', ServiceType: 'ผู้ให้บริการ MA', ServiceScope: 'MA เครื่องพิมพ์/หมึกพิมพ์', ContractNo: 'PRN-2569-022', ContractStart: sampleDate_(-90), ContractExpiry: sampleDate_(275), ContactPerson: 'คุณมานพ', Phone: '02-888-9999', Email: 'ma@printerservice.co.th', Status: 'Active', Notes: '' },
    { VendorID: 'VND-S005', VendorName: 'Adobe Systems', ServiceType: 'Software', ServiceScope: 'Adobe Acrobat / Creative Cloud', ContractNo: 'ADB-2568-099', ContractStart: sampleDate_(-400), ContractExpiry: sampleDate_(-10), ContactPerson: 'Reseller', Phone: '02-000-0000', Email: 'sales@adobe-th.com', Status: 'Inactive', Notes: 'สัญญาเดิมหมดอายุแล้ว' }
  ];
  return seedRows_(SHEETS.VENDOR, 'VendorID', 'VND-S001', rows, 'Vendor');
}

function seedAssetsSample_() {
  const mk = function (code, name) { return buildAssetQrUrl_(code, name); };
  const rows = [
    { AssetID: 'AST-S001', AssetCode: 'PC-6701', AssetName: 'คอมพิวเตอร์ตั้งโต๊ะ ฝ่ายบัญชี', AssetType: 'Endpoint', Category: 'Computer', Brand: 'Dell', Model: 'OptiPlex 7010', SerialNumber: 'DL7010-0001', Vendor: 'บริษัท ไอที โซลูชั่น จำกัด', VendorID: 'VND-S001', PurchaseDate: sampleDate_(-380), WarrantyExpire: sampleDate_(350), Price: 22900, Location: 'อาคาร A ชั้น 3 ฝ่ายบัญชี', Department: 'บัญชีและการเงิน', Owner: 'สมชาย รักงาน', OwnerName: 'สมชาย รักงาน', OwnerEmail: 'somchai@example.com', Criticality: 'กลาง', Status: 'ใช้งานอยู่', QRCodeURL: mk('PC-6701', 'คอมพิวเตอร์ตั้งโต๊ะ ฝ่ายบัญชี'), Remark: '' },
    { AssetID: 'AST-S002', AssetCode: 'NB-6702', AssetName: 'โน้ตบุ๊กผู้บริหาร', AssetType: 'Endpoint', Category: 'Notebook', Brand: 'Lenovo', Model: 'ThinkPad X1', SerialNumber: 'LN-X1-0002', Vendor: 'บริษัท ไอที โซลูชั่น จำกัด', VendorID: 'VND-S001', PurchaseDate: sampleDate_(-200), WarrantyExpire: sampleDate_(20), Price: 45900, Location: 'อาคาร A ชั้น 5', Department: 'สำนักผู้บริหาร', Owner: 'สมหญิง ตั้งใจ', OwnerName: 'สมหญิง ตั้งใจ', OwnerEmail: 'somying@example.com', Criticality: 'สูง', Status: 'ใช้งานอยู่', QRCodeURL: mk('NB-6702', 'โน้ตบุ๊กผู้บริหาร'), Remark: 'ประกันใกล้หมด' },
    { AssetID: 'AST-S003', AssetCode: 'PRN-6703', AssetName: 'เครื่องพิมพ์เลเซอร์ส่วนกลาง', AssetType: 'Endpoint', Category: 'Printer', Brand: 'HP', Model: 'LaserJet M404', SerialNumber: 'HP404-0003', Vendor: 'บริษัท พรินเตอร์ เซอร์วิส จำกัด', VendorID: 'VND-S004', PurchaseDate: sampleDate_(-150), WarrantyExpire: sampleDate_(560), Price: 8900, Location: 'อาคาร A ชั้น 3 จุดถ่ายเอกสาร', Department: 'ส่วนกลาง', Owner: '', OwnerName: '', OwnerEmail: '', Criticality: 'กลาง', Status: 'ซ่อมบำรุง', QRCodeURL: mk('PRN-6703', 'เครื่องพิมพ์เลเซอร์ส่วนกลาง'), Remark: 'รออะไหล่ชุดดรัม' },
    { AssetID: 'AST-S004', AssetCode: 'SRV-6704', AssetName: 'เครื่องแม่ข่ายระบบงานหลัก', AssetType: 'Server', Category: 'Server', Brand: 'Dell', Model: 'PowerEdge R650', SerialNumber: 'DLR650-0004', Vendor: 'บริษัท ไอที โซลูชั่น จำกัด', VendorID: 'VND-S001', PurchaseDate: sampleDate_(-500), WarrantyExpire: sampleDate_(230), Price: 189000, Location: 'ห้อง Server ชั้น 2', Department: 'ส่วนงานเทคโนโลยีและสารสนเทศ', Owner: 'ทีม IT', OwnerName: 'ทีม IT', OwnerEmail: 'it@example.com', Criticality: 'สูง', Status: 'ใช้งานอยู่', QRCodeURL: mk('SRV-6704', 'เครื่องแม่ข่ายระบบงานหลัก'), Remark: '' },
    { AssetID: 'AST-S005', AssetCode: 'NET-6705', AssetName: 'Core Switch สำนักงานใหญ่', AssetType: 'Network Device', Category: 'Network', Brand: 'Cisco', Model: 'Catalyst 9200', SerialNumber: 'CS9200-0005', Vendor: 'บริษัท เน็ตเวิร์ค โปร จำกัด', VendorID: 'VND-S003', PurchaseDate: sampleDate_(-260), WarrantyExpire: sampleDate_(470), Price: 96000, Location: 'ห้อง Server ชั้น 2', Department: 'ส่วนงานเทคโนโลยีและสารสนเทศ', Owner: 'ทีม IT', OwnerName: 'ทีม IT', OwnerEmail: 'it@example.com', Criticality: 'สูง', Status: 'พร้อมใช้งาน', QRCodeURL: mk('NET-6705', 'Core Switch สำนักงานใหญ่'), Remark: 'อะไหล่สำรอง' }
  ];
  return seedRows_(SHEETS.ASSET, 'AssetID', 'AST-S001', rows, 'Asset');
}

function seedAssetHistorySample_() {
  const rows = [
    { MovementID: 'MOV-S001', AssetID: 'AST-S001', AssetName: 'คอมพิวเตอร์ตั้งโต๊ะ ฝ่ายบัญชี', ActionType: 'Assign', FromUser: '', ToUser: 'สมชาย รักงาน', Department: 'บัญชีและการเงิน', Location: 'อาคาร A ชั้น 3', ActionDate: sampleDate_(-120), RelatedTicketID: '', Status: 'ยืม/ใช้งาน', EvidenceLink: '', Notes: 'มอบหมายเครื่องให้พนักงานใหม่' },
    { MovementID: 'MOV-S002', AssetID: 'AST-S002', AssetName: 'โน้ตบุ๊กผู้บริหาร', ActionType: 'Assign', FromUser: '', ToUser: 'สมหญิง ตั้งใจ', Department: 'สำนักผู้บริหาร', Location: 'อาคาร A ชั้น 5', ActionDate: sampleDate_(-90), RelatedTicketID: '', Status: 'ยืม/ใช้งาน', EvidenceLink: '', Notes: '' },
    { MovementID: 'MOV-S003', AssetID: 'AST-S005', AssetName: 'Core Switch สำนักงานใหญ่', ActionType: 'Transfer', FromUser: 'คลัง IT', ToUser: 'ห้อง Server', Department: 'ส่วนงานเทคโนโลยีและสารสนเทศ', Location: 'ห้อง Server ชั้น 2', ActionDate: sampleDate_(-60), RelatedTicketID: '', Status: 'โอนย้าย', EvidenceLink: '', Notes: 'ย้ายเข้าติดตั้งในตู้ Rack' },
    { MovementID: 'MOV-S004', AssetID: 'AST-S003', AssetName: 'เครื่องพิมพ์เลเซอร์ส่วนกลาง', ActionType: 'Status', FromUser: '', ToUser: '', Department: '', Location: '', ActionDate: sampleDate_(-5), RelatedTicketID: 'TCK-S003', Status: 'บันทึก', EvidenceLink: '', Notes: 'ส่งซ่อม รออะไหล่ดรัม' },
    { MovementID: 'MOV-S005', AssetID: 'AST-S005', AssetName: 'Core Switch สำนักงานใหญ่', ActionType: 'Return', FromUser: 'ห้อง Server', ToUser: '', Department: '', Location: 'คลัง IT', ActionDate: sampleDate_(-2), RelatedTicketID: '', Status: 'คืนแล้ว', EvidenceLink: '', Notes: 'นำกลับเป็นอะไหล่สำรอง' }
  ];
  return seedRows_(SHEETS.ASSET_MOVEMENT, 'MovementID', 'MOV-S001', rows, 'Asset_History');
}

function seedMaintenanceSample_() {
  const rows = [
    { MaintenanceID: 'PM-S001', AssetID: 'AST-S004', AssetName: 'เครื่องแม่ข่ายระบบงานหลัก', PlanDate: sampleDate_(5), ActualDate: '', Checklist: 'ตรวจ RAID, อุณหภูมิ, พื้นที่ดิสก์, อัปเดตแพตช์', Result: '', Status: 'วางแผน', Technician: 'it@example.com', Recurrence: 'รายไตรมาส', NextDueDate: sampleDate_(95), EvidenceLink: '', Notes: '' },
    { MaintenanceID: 'PM-S002', AssetID: 'AST-S005', AssetName: 'Core Switch สำนักงานใหญ่', PlanDate: sampleDate_(-3), ActualDate: '', Checklist: 'ตรวจสถานะพอร์ต, อุณหภูมิ, firmware', Result: '', Status: 'วางแผน', Technician: 'it@example.com', Recurrence: 'รายปี', NextDueDate: sampleDate_(362), EvidenceLink: '', Notes: 'เลยกำหนดเล็กน้อย' },
    { MaintenanceID: 'PM-S003', AssetID: 'AST-S001', AssetName: 'คอมพิวเตอร์ตั้งโต๊ะ ฝ่ายบัญชี', PlanDate: sampleDate_(-30), ActualDate: sampleDate_(-29), Checklist: 'ทำความสะอาด, สแกนไวรัส, อัปเดต Windows', Result: 'ดำเนินการเรียบร้อย เครื่องปกติ', Status: 'ดำเนินการแล้ว', Technician: 'tech1@example.com', Recurrence: 'รายเดือน', NextDueDate: sampleDate_(1), EvidenceLink: '', Notes: '' },
    { MaintenanceID: 'PM-S004', AssetID: 'AST-S003', AssetName: 'เครื่องพิมพ์เลเซอร์ส่วนกลาง', PlanDate: sampleDate_(14), ActualDate: '', Checklist: 'เปลี่ยนชุดดรัม, ทำความสะอาดลูกกลิ้ง', Result: '', Status: 'วางแผน', Technician: 'tech2@example.com', Recurrence: 'ครั้งเดียว', NextDueDate: '', EvidenceLink: '', Notes: 'รออะไหล่จากผู้ขาย' },
    { MaintenanceID: 'PM-S005', AssetID: 'AST-S002', AssetName: 'โน้ตบุ๊กผู้บริหาร', PlanDate: sampleDate_(45), ActualDate: '', Checklist: 'ตรวจแบตเตอรี่, ทำความสะอาด, สำรองข้อมูล', Result: '', Status: 'วางแผน', Technician: 'tech1@example.com', Recurrence: 'รายไตรมาส', NextDueDate: sampleDate_(135), EvidenceLink: '', Notes: '' }
  ];
  return seedRows_(SHEETS.MAINTENANCE, 'MaintenanceID', 'PM-S001', rows, 'PM/Maintenance');
}

function seedInventorySample_() {
  const rows = [
    { ItemID: 'ITEM-S001', ItemName: 'RAM DDR4 8GB', Category: 'อะไหล่', Unit: 'แถว', StockQty: 12, MinQty: 5, Location: 'คลัง IT ชั้น 2', Status: 'Active', Notes: '' },
    { ItemID: 'ITEM-S002', ItemName: 'SSD 512GB SATA', Category: 'อะไหล่', Unit: 'ตัว', StockQty: 3, MinQty: 5, Location: 'คลัง IT ชั้น 2', Status: 'Active', Notes: 'ต่ำกว่าขั้นต่ำ ควรสั่งเพิ่ม' },
    { ItemID: 'ITEM-S003', ItemName: 'เมาส์ USB', Category: 'อุปกรณ์ต่อพ่วง', Unit: 'ตัว', StockQty: 25, MinQty: 10, Location: 'คลัง IT ชั้น 2', Status: 'Active', Notes: '' },
    { ItemID: 'ITEM-S004', ItemName: 'หมึกพิมพ์ HP 59A', Category: 'วัสดุสิ้นเปลือง', Unit: 'กล่อง', StockQty: 2, MinQty: 3, Location: 'คลัง IT ชั้น 2', Status: 'Active', Notes: 'ใกล้หมด' },
    { ItemID: 'ITEM-S005', ItemName: 'สาย LAN Cat6 (3m)', Category: 'อุปกรณ์เครือข่าย', Unit: 'เส้น', StockQty: 40, MinQty: 15, Location: 'คลัง IT ชั้น 2', Status: 'Active', Notes: '' }
  ];
  const msg = seedRows_(SHEETS.INVENTORY, 'ItemID', 'ITEM-S001', rows, 'Inventory');
  // ประวัติรับเข้า/จ่ายออกตัวอย่าง
  const tx = [
    { TransactionID: 'TX-S001', ItemID: 'ITEM-S001', ItemName: 'RAM DDR4 8GB', TransactionType: 'IN', Qty: 10, TicketID: '', ActionDate: sampleDate_(-40), Notes: 'รับเข้าตามใบสั่งซื้อ' },
    { TransactionID: 'TX-S002', ItemID: 'ITEM-S002', ItemName: 'SSD 512GB SATA', TransactionType: 'OUT', Qty: 2, TicketID: 'TCK-S001', ActionDate: sampleDate_(-7), Notes: 'เบิกใช้กับงานซ่อม' },
    { TransactionID: 'TX-S003', ItemID: 'ITEM-S004', ItemName: 'หมึกพิมพ์ HP 59A', TransactionType: 'OUT', Qty: 1, TicketID: '', ActionDate: sampleDate_(-3), Notes: 'เปลี่ยนหมึกเครื่องพิมพ์ส่วนกลาง' }
  ];
  seedRows_(SHEETS.INVENTORY_TX, 'TransactionID', 'TX-S001', tx, 'Inventory_Tx');
  return msg;
}

function seedLicensesSample_() {
  const rows = [
    { LicenseID: 'LIC-S001', SoftwareName: 'Microsoft Windows 11 Pro', LicenseType: 'OEM', TotalQty: 50, UsedQty: 38, StartDate: sampleDate_(-365), ExpireDate: '', VendorID: 'VND-S002', AssignedTo: 'เครื่องลูกข่ายทั้งองค์กร', Status: 'Active', Notes: 'สิทธิ์ถาวรติดเครื่อง' },
    { LicenseID: 'LIC-S002', SoftwareName: 'Microsoft 365 Business', LicenseType: 'Subscription', TotalQty: 60, UsedQty: 55, StartDate: sampleDate_(-120), ExpireDate: sampleDate_(240), VendorID: 'VND-S002', AssignedTo: 'พนักงานทุกหน่วยงาน', Status: 'Active', Notes: '' },
    { LicenseID: 'LIC-S003', SoftwareName: 'Adobe Acrobat Pro', LicenseType: 'Subscription', TotalQty: 10, UsedQty: 9, StartDate: sampleDate_(-340), ExpireDate: sampleDate_(20), VendorID: 'VND-S005', AssignedTo: 'ฝ่ายเอกสาร/กฎหมาย', Status: 'Active', Notes: 'ใกล้หมดอายุ ควรต่ออายุ' },
    { LicenseID: 'LIC-S004', SoftwareName: 'ESET Endpoint Antivirus', LicenseType: 'Volume', TotalQty: 80, UsedQty: 62, StartDate: sampleDate_(-200), ExpireDate: sampleDate_(160), VendorID: 'VND-S001', AssignedTo: 'เครื่องลูกข่าย/แม่ข่าย', Status: 'Active', Notes: '' },
    { LicenseID: 'LIC-S005', SoftwareName: 'Autodesk AutoCAD', LicenseType: 'Subscription', TotalQty: 3, UsedQty: 3, StartDate: sampleDate_(-400), ExpireDate: sampleDate_(-15), VendorID: 'VND-S001', AssignedTo: 'ฝ่ายอาคารสถานที่', Status: 'Expired', Notes: 'หมดอายุแล้ว' }
  ];
  return seedRows_(SHEETS.SOFTWARE_LICENSE, 'LicenseID', 'LIC-S001', rows, 'License');
}

function seedTicketsSample_() {
  const rows = [
    { TicketID: 'TCK-S001', Title: 'คอมพิวเตอร์เปิดไม่ติด', RequesterEmail: 'somchai@example.com', RequesterName: 'สมชาย รักงาน', RequesterPhone: '081-111-1111', Department: 'บัญชีและการเงิน', Location: 'อาคาร A ชั้น 3', Category: 'Computer', Priority: 'สูง', SLAHours: 24, DueAt: sampleDate_(-1), AssetID: 'AST-S001', AssetName: 'คอมพิวเตอร์ตั้งโต๊ะ ฝ่ายบัญชี', Description: 'กดปุ่มเปิดเครื่องแล้วไฟไม่ติด สงสัย Power Supply เสีย', Assignee: 'tech1@example.com', IsSecurity: 'No', IncidentID: '', Status: 'กำลังดำเนินการ', Resolution: '', CloseDate: '', EvidenceLink: '', PublicToken: 'A1B2C3D4', Rating: '', Feedback: '', FeedbackAt: '', Notes: '' },
    { TicketID: 'TCK-S002', Title: 'ขอติดตั้งโปรแกรม Microsoft 365', RequesterEmail: 'somying@example.com', RequesterName: 'สมหญิง ตั้งใจ', RequesterPhone: '081-222-2222', Department: 'สำนักผู้บริหาร', Location: 'อาคาร A ชั้น 5', Category: 'Software', Priority: 'ปานกลาง', SLAHours: 16, DueAt: sampleDate_(1), AssetID: 'AST-S002', AssetName: 'โน้ตบุ๊กผู้บริหาร', Description: 'ขอติดตั้ง Microsoft 365 และตั้งค่าอีเมล', Assignee: 'tech2@example.com', IsSecurity: 'No', IncidentID: '', Status: 'รับเรื่องแล้ว', Resolution: '', CloseDate: '', EvidenceLink: '', PublicToken: 'B2C3D4E5', Rating: '', Feedback: '', FeedbackAt: '', Notes: '' },
    { TicketID: 'TCK-S003', Title: 'เครื่องพิมพ์ส่วนกลางพิมพ์ไม่ออก', RequesterEmail: 'office@example.com', RequesterName: 'ธุรการส่วนกลาง', RequesterPhone: '02-333-3333', Department: 'ส่วนกลาง', Location: 'อาคาร A ชั้น 3', Category: 'Printer', Priority: 'ปานกลาง', SLAHours: 16, DueAt: sampleDate_(2), AssetID: 'AST-S003', AssetName: 'เครื่องพิมพ์เลเซอร์ส่วนกลาง', Description: 'พิมพ์งานแล้วมีรอยดำเป็นเส้น คาดว่าชุดดรัมเสื่อม', Assignee: 'tech2@example.com', IsSecurity: 'No', IncidentID: '', Status: 'รออะไหล่', Resolution: '', CloseDate: '', EvidenceLink: '', PublicToken: 'C3D4E5F6', Rating: '', Feedback: '', FeedbackAt: '', Notes: '' },
    { TicketID: 'TCK-S004', Title: 'อินเทอร์เน็ตช้าทั้งชั้น 4', RequesterEmail: 'staff4@example.com', RequesterName: 'พนักงานชั้น 4', RequesterPhone: '081-444-4444', Department: 'ฝ่ายสินไหม', Location: 'อาคาร A ชั้น 4', Category: 'Network', Priority: 'สูง', SLAHours: 8, DueAt: sampleDate_(-2), AssetID: 'AST-S005', AssetName: 'Core Switch สำนักงานใหญ่', Description: 'อินเทอร์เน็ตช้ามากตั้งแต่เช้า กระทบทั้งชั้น', Assignee: 'it@example.com', IsSecurity: 'No', IncidentID: '', Status: 'เสร็จสิ้น', Resolution: 'พบ Loop ที่พอร์ตหนึ่ง แก้ไขและเปิด STP เรียบร้อย', CloseDate: '', EvidenceLink: '', PublicToken: 'D4E5F6G7', Rating: '', Feedback: '', FeedbackAt: '', Notes: '' },
    { TicketID: 'TCK-S005', Title: 'รีเซ็ตรหัสผ่านอีเมล', RequesterEmail: 'newuser@example.com', RequesterName: 'พนักงานใหม่', RequesterPhone: '081-555-5555', Department: 'ทรัพยากรบุคคล', Location: 'อาคาร A ชั้น 2', Category: 'Email', Priority: 'ปานกลาง', SLAHours: 8, DueAt: sampleDate_(-5), AssetID: '', AssetName: '', Description: 'ลืมรหัสผ่านอีเมล เข้าใช้งานไม่ได้', Assignee: 'tech1@example.com', IsSecurity: 'No', IncidentID: '', Status: 'ปิดงาน', Resolution: 'รีเซ็ตรหัสผ่านและแจ้งผู้ใช้ตั้งรหัสใหม่เรียบร้อย', CloseDate: sampleDate_(-4), EvidenceLink: '', PublicToken: 'E5F6G7H8', Rating: 5, Feedback: 'รวดเร็วมาก ขอบคุณครับ', FeedbackAt: sampleDate_(-3), Notes: '' }
  ];
  const msg = seedRows_(SHEETS.TICKET, 'TicketID', 'TCK-S001', rows, 'Ticket');
  // worklog ตัวอย่างของแต่ละ Ticket
  const wl = [
    { WorklogID: 'WL-S001', TicketID: 'TCK-S001', Action: 'เปิด Ticket', Detail: 'ช่องทาง: หน้าแจ้งซ่อม (public)', StatusFrom: '', StatusTo: 'ใหม่', MinutesSpent: '', AttachmentURL: '', IsPublic: 'Yes', ActorEmail: 'somchai@example.com', ActorName: 'สมชาย รักงาน' },
    { WorklogID: 'WL-S002', TicketID: 'TCK-S001', Action: 'รับเรื่อง', Detail: 'มอบหมายช่าง', StatusFrom: 'ใหม่', StatusTo: 'รับเรื่องแล้ว', MinutesSpent: '', AttachmentURL: '', IsPublic: 'Yes', ActorEmail: 'tech1@example.com', ActorName: 'ช่าง 1' },
    { WorklogID: 'WL-S003', TicketID: 'TCK-S001', Action: 'บันทึกการดำเนินงาน', Detail: 'ตรวจสอบเบื้องต้น พบ Power Supply ไม่จ่ายไฟ กำลังเบิกอะไหล่', StatusFrom: 'รับเรื่องแล้ว', StatusTo: 'กำลังดำเนินการ', MinutesSpent: 30, AttachmentURL: '', IsPublic: 'Yes', ActorEmail: 'tech1@example.com', ActorName: 'ช่าง 1' },
    { WorklogID: 'WL-S004', TicketID: 'TCK-S004', Action: 'บันทึกการดำเนินงาน', Detail: 'แก้ไข network loop เรียบร้อย', StatusFrom: 'กำลังดำเนินการ', StatusTo: 'เสร็จสิ้น', MinutesSpent: 45, AttachmentURL: '', IsPublic: 'Yes', ActorEmail: 'it@example.com', ActorName: 'ทีม IT' },
    { WorklogID: 'WL-S005', TicketID: 'TCK-S005', Action: 'ปิดงาน', Detail: 'รีเซ็ตรหัสผ่านเรียบร้อย', StatusFrom: 'กำลังดำเนินการ', StatusTo: 'ปิดงาน', MinutesSpent: 10, AttachmentURL: '', IsPublic: 'Yes', ActorEmail: 'tech1@example.com', ActorName: 'ช่าง 1' },
    { WorklogID: 'WL-S006', TicketID: 'TCK-S005', Action: 'ให้คะแนนความพึงพอใจ', Detail: '5/5 รวดเร็วมาก ขอบคุณครับ', StatusFrom: '', StatusTo: '', MinutesSpent: '', AttachmentURL: '', IsPublic: 'Yes', ActorEmail: 'newuser@example.com', ActorName: 'พนักงานใหม่' }
  ];
  seedRows_(SHEETS.TICKET_WORKLOG, 'WorklogID', 'WL-S001', wl, 'Ticket_Worklog');
  return msg;
}
